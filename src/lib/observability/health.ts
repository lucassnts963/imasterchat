import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError } from '@/lib/ai/types'
import { loadGoogleConnection } from '@/lib/google/connection'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { recordEvent } from './events'

// ============================================================
// Bater na porta de cada dependência antes de o cliente bater na
// nossa.
//
// A 052 grava a falha QUANDO ALGUÉM TENTA USAR. Isso é o suficiente
// para quase tudo e não é suficiente para os dois casos mais caros: a
// chave da IA que vence às 3h da manhã e o Google revogado no domingo.
// Nesses, quem descobre primeiro é o cliente na segunda-feira, e o
// intervalo entre quebrar e alguém tentar é exatamente o tempo em que
// dava para ter consertado.
//
// TRÊS ESTADOS, NÃO DOIS
//
// 'skipped' existe porque "a conta não conectou o Google" e "conectou
// e funciona" são coisas diferentes, e nenhuma das duas é falha. Uma
// tela que pinta as duas de verde mente; uma que pinta as duas de
// vermelho vira ruído que se aprende a ignorar.
// ============================================================

export type HealthStatus = 'ok' | 'failing' | 'skipped'

export interface CheckResult {
  status: HealthStatus
  code?: string
  detail?: string
}

/** Depois de quanto tempo um problema JÁ AVISADO e ainda quebrado
 *  merece um lembrete. Sem isto, uma verificação horária sobre uma
 *  chave vencida vira 24 mensagens por dia sobre algo já sabido. */
const REMINDER_MS = 24 * 60 * 60 * 1000

interface HealthRow {
  status: HealthStatus
  failing_since: string | null
  last_alerted_at: string | null
}

/**
 * Roda todas as verificações de uma conta e persiste o resultado.
 *
 * Nunca lança: uma conta com problema não pode impedir a varredura
 * das outras de acontecer.
 */
export async function checkAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<Record<string, CheckResult>> {
  const results: Record<string, CheckResult> = {}

  // Em série e não em paralelo, de propósito: são chamadas a APIs
  // externas de terceiros e a varredura não tem pressa. Vinte contas
  // disparando três chamadas ao mesmo tempo é o tipo de coisa que faz
  // a própria verificação virar o motivo do rate limit.
  for (const [name, run] of [
    ['ai_credentials', () => checkAi(db, accountId)],
    ['whatsapp_token', () => checkWhatsApp(db, accountId)],
    ['google_calendar', () => checkGoogle(db, accountId)],
    ['inbound_silence', () => checkInboundSilence(db, accountId)],
  ] as const) {
    let result: CheckResult
    try {
      result = await run()
    } catch (err) {
      // Uma verificação que explode por conta própria é problema da
      // verificação, não da dependência. Não pode ser reportado como
      // "a conta do cliente está fora do ar".
      result = {
        status: 'skipped',
        code: 'check_crashed',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
    results[name] = result
    await persist(db, accountId, name, result)
  }

  return results
}

/**
 * A chave da IA ainda é aceita pelo provedor?
 *
 * Só gasta uma chamada quando NÃO houve prova de vida recente: se a
 * conta já respondeu alguma coisa na última hora, a chave funciona e
 * sondar de novo é pagar por uma informação que já se tem.
 */
async function checkAi(
  db: SupabaseClient,
  accountId: string,
): Promise<CheckResult> {
  const config = await loadAiConfig(db, accountId)
  if (!config || !config.isActive || !config.apiKey) {
    return { status: 'skipped', detail: 'IA não configurada nesta conta.' }
  }

  const { count } = await db
    .from('ai_usage_log')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())

  if (count && count > 0) {
    return { status: 'ok', detail: 'Respondeu na última hora.' }
  }

  try {
    await validateAiCredentials(config)
    return { status: 'ok' }
  } catch (err) {
    if (err instanceof AiError) {
      // Um 429 é o provedor ocupado, não a conta quebrada. Marcar isso
      // como falha faria a tela acusar problema toda vez que o cliente
      // tivesse um pico de movimento.
      if (err.code === 'rate_limited' || err.code === 'timeout') {
        return { status: 'ok', code: err.code, detail: err.message }
      }
      return { status: 'failing', code: err.code, detail: err.message }
    }
    return {
      status: 'failing',
      code: 'unknown',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * O token do WhatsApp ainda vale?
 *
 * Quando ele vence, NADA sai — nem bot, nem flows, nem campanhas — e
 * hoje não existe coluna com data de expiração nem verificação
 * nenhuma. É a falha mais silenciosa e mais total do produto.
 */
async function checkWhatsApp(
  db: SupabaseClient,
  accountId: string,
): Promise<CheckResult> {
  const { data } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle<{ phone_number_id: string; access_token: string }>()

  if (!data?.phone_number_id || !data.access_token) {
    return { status: 'skipped', detail: 'WhatsApp não configurado.' }
  }

  let accessToken: string
  try {
    accessToken = decrypt(data.access_token)
  } catch {
    // ENCRYPTION_KEY rotacionada. O sintoma sem isto é "as mensagens
    // pararam de sair" sem nada em lugar nenhum.
    return {
      status: 'failing',
      code: 'credentials_unreadable',
      detail:
        'O token guardado não pôde ser decifrado — verifique ENCRYPTION_KEY.',
    }
  }

  try {
    await verifyPhoneNumber({ phoneNumberId: data.phone_number_id, accessToken })
    return { status: 'ok' }
  } catch (err) {
    return {
      status: 'failing',
      code: 'meta_token_rejected',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * O Google ainda está de fato conectado?
 *
 * A tela de status responde "conectado" olhando se EXISTE linha, não
 * se o token vale. Então o operador vê verde, o cliente acha que o bot
 * está agendando, e as ferramentas de agendamento simplesmente não
 * entram no catálogo do agente.
 */
async function checkGoogle(
  db: SupabaseClient,
  accountId: string,
): Promise<CheckResult> {
  try {
    const connection = await loadGoogleConnection(db, accountId)
    if (!connection) {
      return { status: 'skipped', detail: 'Google Agenda não conectado.' }
    }
    // `loadGoogleConnection` só devolve com token utilizável — ela
    // renova quando precisa e lança quando não consegue. Chegar aqui
    // já é a prova.
    return { status: 'ok' }
  } catch (err) {
    const code =
      err instanceof Error && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'google_error'
    return {
      status: 'failing',
      code,
      detail:
        code === 'invalid_grant'
          ? 'O acesso ao Google foi revogado. É preciso reconectar em Configurações → Agendamento.'
          : err instanceof Error
            ? err.message
            : String(err),
    }
  }
}

/**
 * Grava o resultado e decide se alguém precisa ser acordado.
 *
 * A regra do alerta é a parte que importa: avisa na TRANSIÇÃO de ok
 * para falhando, e depois fica quieto. Uma verificação horária que
 * avisasse toda vez mandaria 24 mensagens por dia sobre o mesmo
 * problema já conhecido, e um celular que apita demais é um celular
 * que se ignora.
 */
async function persist(
  db: SupabaseClient,
  accountId: string | null,
  checkName: string,
  result: CheckResult,
): Promise<void> {
  try {
    let q = db
      .from('account_health')
      .select('status, failing_since, last_alerted_at')
      .eq('check_name', checkName)
    q = accountId ? q.eq('account_id', accountId) : q.is('account_id', null)
    const { data: previous } = await q.maybeSingle<HealthRow>()

    const now = new Date()
    const wasFailing = previous?.status === 'failing'
    const isFailing = result.status === 'failing'

    // Preservado enquanto continuar quebrado, para a tela poder dizer
    // "há 3 dias" em vez de "há 1 hora" a cada execução.
    const failingSince = isFailing
      ? (wasFailing && previous?.failing_since
          ? previous.failing_since
          : now.toISOString())
      : null

    const lastAlert = previous?.last_alerted_at
      ? new Date(previous.last_alerted_at).getTime()
      : 0
    const shouldAlert =
      isFailing && (!wasFailing || now.getTime() - lastAlert > REMINDER_MS)

    const row = {
      account_id: accountId,
      check_name: checkName,
      status: result.status,
      code: result.code ?? null,
      detail: result.detail?.slice(0, 1000) ?? null,
      checked_at: now.toISOString(),
      failing_since: failingSince,
      last_alerted_at: shouldAlert
        ? now.toISOString()
        : (previous?.last_alerted_at ?? null),
    }

    // UPDATE ou INSERT explícito, e não upsert, por causa das linhas de
    // plataforma. `account_id` é nulável, e em SQL NULL nunca é igual a
    // NULL — então o UNIQUE(account_id, check_name) não cobre elas e a
    // unicidade vem de um índice PARCIAL (`WHERE account_id IS NULL`).
    // Um ON CONFLICT só usa índice parcial se repetir o predicado, o
    // que o PostgREST não sabe expressar: o upsert falhava, `persist`
    // engolia o erro, e a verificação de migrações sumia da tela sem
    // dizer nada. Já sabendo se existe linha anterior — a consulta
    // acima —, o ramo explícito é mais simples e não depende de
    // inferência de índice.
    const { error: writeErr } = previous
      ? await (accountId
          ? db
              .from('account_health')
              .update(row)
              .eq('account_id', accountId)
              .eq('check_name', checkName)
          : db
              .from('account_health')
              .update(row)
              .is('account_id', null)
              .eq('check_name', checkName))
      : await db.from('account_health').insert(row)

    if (writeErr) throw writeErr

    if (shouldAlert) {
      await recordEvent({
        db,
        accountId,
        source: sourceOf(checkName),
        code: result.code ?? `${checkName}_failing`,
        severity: 'critical',
        message: `[verificação] ${checkName}: ${result.detail ?? 'falhou'}`,
        context: {
          check: checkName,
          desde: failingSince,
          lembrete: wasFailing ? 'sim (ainda quebrado após 24h)' : 'não',
        },
      })
    }

    // A volta também é notícia. Sem isto, quem viu o alerta de que
    // caiu fica sem saber se pode parar de olhar.
    if (wasFailing && !isFailing) {
      await recordEvent({
        db,
        accountId,
        source: sourceOf(checkName),
        code: `${checkName}_recovered`,
        severity: 'info',
        message: `[verificação] ${checkName} voltou ao normal.`,
      })
    }
  } catch (err) {
    console.error(`[health] não foi possível gravar ${checkName}:`, err)
  }
}

function sourceOf(checkName: string) {
  if (checkName === 'ai_credentials') return 'ai' as const
  if (checkName === 'whatsapp_token') return 'whatsapp' as const
  if (checkName === 'google_calendar') return 'google' as const
  // Migração faltando é problema do deploy, não da ronda. O default
  // caía em 'cron' e o alerta chegava rotulado como se o agendador
  // tivesse falhado — mandando quem fosse investigar para o lugar
  // errado.
  if (checkName === 'migrations') return 'app' as const
  // Silêncio no inbound é problema do caminho da Meta até aqui, mesmo
  // quando a causa está na borda.
  if (checkName === 'inbound_silence') return 'whatsapp' as const
  return 'cron' as const
}

/**
 * As verificações que não pertencem a conta nenhuma.
 *
 * Só as migrações, por enquanto. A frescura do cron NÃO está aqui de
 * propósito: um cron que não está rodando não consegue detectar a
 * própria ausência. Essa é calculada na leitura, quando alguém abre a
 * tela — o único momento em que existe alguém para receber a resposta.
 */
export async function checkPlatform(
  db: SupabaseClient,
): Promise<Record<string, CheckResult>> {
  const result = await checkMigrations(db)
  await persist(db, null, 'migrations', result)
  return { migrations: result }
}

/** O banco está na mesma migração que este build espera? */
async function checkMigrations(db: SupabaseClient): Promise<CheckResult> {
  const expected = process.env.EXPECTED_MIGRATION
  if (!expected) {
    return {
      status: 'skipped',
      detail: 'Este build não registrou qual migração esperava.',
    }
  }

  const { data, error } = await db
    .from('applied_migrations')
    .select('filename')
    .order('filename', { ascending: false })
    .limit(1)
    .maybeSingle<{ filename: string }>()

  if (error) {
    // A própria tabela do livro-caixa não existir é o caso mais grave
    // de todos: significa que nenhuma migração foi aplicada por este
    // processo, e não dá para saber o que existe no banco.
    return {
      status: 'failing',
      code: 'ledger_unreadable',
      detail: `Não foi possível ler applied_migrations: ${error.message}`,
    }
  }

  const applied = data?.filename ?? '(nenhuma)'
  if (applied === expected) return { status: 'ok', detail: applied }

  // Comparação por nome, que ordena porque os arquivos são numerados.
  // Banco À FRENTE do código é um rollback da aplicação, não um erro —
  // barulhento seria errado.
  if (applied > expected) {
    return {
      status: 'ok',
      code: 'db_ahead',
      detail: `O banco está em ${applied}; este build esperava ${expected}.`,
    }
  }

  return {
    status: 'failing',
    code: 'migration_missing',
    detail: `O banco está em ${applied} e este build espera ${expected}. Rode deploy/apply-migrations.sh.`,
  }
}


/**
 * As mensagens dos clientes ainda estão chegando?
 *
 * Este é o ponto cego que todas as outras verificações deixam passar,
 * e o mais caro de todos. Se algo bloqueia a Meta ANTES do app — um
 * Bot Fight Mode da vida, DNS, TLS, o `phone_number_id` trocado no
 * painel da Meta — a requisição nunca chega aqui. Nenhum evento é
 * gravado, e as outras verificações continuam verdes: o token do
 * WhatsApp está válido, ele só não está sendo usado por ninguém.
 *
 * O sintoma vira "hoje ninguém mandou mensagem", que é
 * indistinguível de um dia parado. É a falha que fica em pé por dias.
 *
 * A REGRA SE CALIBRA SOZINHA
 *
 * "Sem mensagem há 6 horas" seria falso alarme toda madrugada e todo
 * domingo. Em vez de tentar adivinhar o horário da ótica, feriado
 * nacional e ponte, olhamos o que ESTA conta já fez: o maior silêncio
 * que ela teve nos últimos 14 dias já contém as noites, os fins de
 * semana e o feriado que passou. Silêncio maior que isso com folga é
 * anormal para ela, mesmo que fosse normal para outra.
 *
 * Uma conta nova, ou de movimento raro, cai em 'skipped' — não dá para
 * calibrar sem histórico, e chutar seria pior que não olhar.
 */
async function checkInboundSilence(
  db: SupabaseClient,
  accountId: string,
): Promise<CheckResult> {
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString()

  // `messages` não carrega `account_id` — a conta vem da conversa. O
  // resto do app resolve isso por RLS, mas esta ronda roda sob service
  // role, que passa por cima da RLS: aqui o vínculo precisa ser
  // explícito, senão a consulta traria as mensagens de TODAS as contas
  // e o silêncio de uma sumiria no movimento das outras.
  const { data, error } = await db
    .from('messages')
    .select('created_at, conversations!inner(account_id)')
    .eq('conversations.account_id', accountId)
    .eq('sender_type', 'customer')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(5000)

  if (error) {
    return {
      status: 'skipped',
      code: 'query_failed',
      detail: `Não foi possível ler o histórico: ${error.message}`,
    }
  }

  return evaluateSilence(
    (data ?? []).map((m) =>
      new Date((m as { created_at: string }).created_at).getTime(),
    ),
    Date.now(),
  )
}

/** Mínimo de mensagens em 14 dias para haver padrão do que se afastar.
 *  Vinte é pouco mais de uma por dia — o piso do que dá para chamar de
 *  rotina. */
const MIN_HISTORICO = 20

/** Quanto o silêncio atual precisa superar o pior silêncio já visto. */
const FOLGA = 1.5

/** Piso, para uma conta de movimento muito constante não disparar por
 *  causa de um almoço mais demorado. */
const SILENCIO_MINIMO_MS = 3 * 3_600_000

/**
 * A decisão, separada da consulta para poder ser testada.
 *
 * `marcos` são os instantes das mensagens de cliente, em ordem
 * crescente. `agora` entra como argumento em vez de `Date.now()` para
 * o teste conseguir posicionar o relógio.
 */
export function evaluateSilence(
  marcos: number[],
  agora: number,
): CheckResult {
  if (marcos.length < MIN_HISTORICO) {
    return {
      status: 'skipped',
      detail: `Só ${marcos.length} mensagem(ns) de cliente em 14 dias — sem histórico para calibrar.`,
    }
  }

  let maiorSilencio = 0
  for (let i = 1; i < marcos.length; i += 1) {
    const gap = marcos[i] - marcos[i - 1]
    if (gap > maiorSilencio) maiorSilencio = gap
  }

  const silencioAtual = agora - marcos[marcos.length - 1]
  const limite = Math.max(maiorSilencio * FOLGA, SILENCIO_MINIMO_MS)
  const h = (ms: number) => Math.round(ms / 3_600_000)

  if (silencioAtual > limite) {
    return {
      status: 'failing',
      code: 'inbound_silence',
      detail:
        `Nenhuma mensagem de cliente há ${h(silencioAtual)}h. ` +
        `Nos últimos 14 dias esta conta nunca passou de ${h(maiorSilencio)}h sem receber. ` +
        `Verifique o webhook na Meta, o DNS e qualquer proxy na frente do app.`,
    }
  }

  return {
    status: 'ok',
    detail: `Última mensagem há ${h(silencioAtual)}h (maior silêncio recente: ${h(maiorSilencio)}h).`,
  }
}

export { persist as persistCheck }
