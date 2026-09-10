import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { startFlowRun } from '@/lib/flows/engine'
import { templateParams } from '@/lib/whatsapp/template-params'
import { planejarDisparos, titulosDoTitular } from './regua'
import {
  loadCarteira,
  loadDisparos,
  loadFeriados,
  loadReguaAtiva,
  registrarDisparo,
  type CobrancaCompleta,
  type DegrauCompleto,
} from './store'
import { resolverVariaveis, variaveisDaCobranca } from './mensagem'

// ============================================================
// O worker diário — fase 4, R-25.
//
// A regra que ele existe para cumprir cabe numa frase: **reavaliar o
// estado NO MOMENTO do disparo, e não no do agendamento**. É o que
// separa uma régua de uma automação com esperas — o `wait` não observa
// nada enquanto espera, e o D+5 sai para quem já quitou.
//
// Aqui não há agendamento nenhum: a cada rodada ele lê a carteira como
// ela está agora, decide, e manda. Uma cobrança paga às 9h05 não recebe
// nada às 9h30 porque a leitura das 9h30 já não a enxerga.
// ============================================================

export interface ResultadoDaRodada {
  enviados: number
  suprimidos: number
  /** Por motivo, para a tela de diagnóstico dizer o que está segurando. */
  porMotivo: Record<string, number>
}

export async function runReguaForAccount(
  db: SupabaseClient,
  accountId: string,
  opts: { agora?: Date; timezone?: string; userId?: string } = {},
): Promise<ResultadoDaRodada> {
  const agora = opts.agora ?? new Date()
  const vazio: ResultadoDaRodada = { enviados: 0, suprimidos: 0, porMotivo: {} }

  const timezone = opts.timezone ?? (await resolveTimezone(db, accountId))
  const regua = await loadReguaAtiva(db, accountId, timezone)
  if (!regua) return vazio

  const carteira = await loadCarteira(db, accountId, timezone, agora)
  if (carteira.length === 0) return vazio

  const disparos = await loadDisparos(
    db,
    carteira.map((c) => c.id),
  )
  const feriados = await loadFeriados(db, accountId)

  const plano = planejarDisparos(carteira, regua.degraus, disparos, {
    agora,
    janela: regua.janela,
    feriados,
    regra: regua.regra,
  })

  const porDegrau = new Map(regua.degrausCompletos.map((d) => [d.id, d]))
  const resultado: ResultadoDaRodada = { enviados: 0, suprimidos: 0, porMotivo: {} }

  for (const decisao of plano) {
    if (decisao.acao === 'suprimir') {
      resultado.suprimidos += 1
      resultado.porMotivo[decisao.motivo] =
        (resultado.porMotivo[decisao.motivo] ?? 0) + 1

      // `fora_da_janela` NÃO vira linha: o degrau é do dia, e o worker
      // que rodar mais tarde — quando a janela abrir — precisa reencontrar
      // esta cobrança elegível. Gravar seria transformar a proteção legal
      // numa cobrança perdida.
      if (decisao.motivo === 'fora_da_janela') continue

      await registrarDisparo(db, {
        accountId,
        cobrancaId: decisao.cobranca.id,
        degrauId: decisao.degrau.id,
        resultado: 'suprimido',
        motivo: decisao.motivo,
        agrupadoEm: null,
      })
      continue
    }

    const degrau = porDegrau.get(decisao.degrau.id)
    if (!degrau) continue

    const enviado = await enviarDegrau(db, {
      accountId,
      userId: opts.userId ?? null,
      cobranca: decisao.cobranca as CobrancaCompleta,
      titulos: titulosDoTitular(decisao.titular, carteira),
      degrau,
    })

    if (enviado.ok) resultado.enviados += 1
    else {
      resultado.suprimidos += 1
      resultado.porMotivo[enviado.motivo] =
        (resultado.porMotivo[enviado.motivo] ?? 0) + 1
    }
  }

  return resultado
}

async function enviarDegrau(
  db: SupabaseClient,
  args: {
    accountId: string
    userId: string | null
    cobranca: CobrancaCompleta
    titulos: CobrancaCompleta[]
    degrau: DegrauCompleto
  },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { accountId, cobranca, degrau } = args
  if (!cobranca.contactId) return { ok: false, motivo: 'sem_contato' }

  const vars = variaveisDaCobranca(
    args.titulos.length > 0 ? args.titulos : [cobranca],
  )
  const params = templateParams(degrau.templateVars, (v) =>
    resolverVariaveis(v, vars),
  )

  // A LINHA É GRAVADA ANTES DO ENVIO, e é o que impede a mensagem
  // duplicada. Se o insert falhar por unicidade, outro worker já mandou
  // este degrau — e desistir é o certo. Na ordem inversa, dois workers
  // simultâneos mandariam duas vezes e só o segundo insert falharia,
  // depois de o cliente já ter recebido duas cobranças.
  const marca = await registrarDisparo(db, {
    accountId,
    cobrancaId: cobranca.id,
    degrauId: degrau.id,
    resultado: 'enviado',
    textoEnviado: `${degrau.templateName}: ${params.join(' | ')}`,
  })
  if (marca.duplicado) return { ok: false, motivo: 'ja_disparado' }
  if (!marca.ok) return { ok: false, motivo: 'erro' }

  const conversationId = await resolveConversationId(db, accountId, cobranca.contactId)
  if (!conversationId) return { ok: false, motivo: 'sem_conversa' }

  try {
    const { whatsapp_message_id } = await engineSendTemplate({
      origin: 'cobranca',
      accountId,
      userId: args.userId ?? '',
      conversationId,
      contactId: cobranca.contactId,
      templateName: degrau.templateName,
      language: degrau.templateLanguage ?? undefined,
      params,
    })

    // Liga ao custo (migração 075), para responder depois "quanto custou
    // recuperar este título".
    await db
      .from('regua_disparos')
      .update({ message_id: whatsapp_message_id })
      .eq('cobranca_id', cobranca.id)
      .eq('degrau_id', degrau.id)
      .eq('resultado', 'enviado')
  } catch (err) {
    // O envio falhou depois da marca. Vira supressão com o motivo, para
    // a linha não mentir dizendo que a mensagem saiu.
    await db
      .from('regua_disparos')
      .update({
        resultado: 'suprimido',
        motivo: 'erro',
        texto_enviado: err instanceof Error ? err.message : String(err),
      })
      .eq('cobranca_id', cobranca.id)
      .eq('degrau_id', degrau.id)
    return { ok: false, motivo: 'erro_envio' }
  }

  // O fluxo do degrau, quando houver: é ele que assume se o cliente
  // responder. Uma recusa aqui não desfaz o envio — a mensagem já saiu, e
  // o cliente em outro fluxo é motivo legítimo.
  if (degrau.flowId) {
    await startFlowRun({
      accountId,
      contactId: cobranca.contactId,
      flowId: degrau.flowId,
      startedBy: 'automation',
      conversationId,
      vars: {
        cobranca_id: cobranca.id,
        valor: vars.valor,
        vencimento: vars.vencimento,
      },
    })
  }

  return { ok: true }
}

async function resolveConversationId(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
  const rows = (data as { id: string }[] | null) ?? []
  return rows[0]?.id ?? null
}

/** O fuso da conta vem de onde o agendamento já o guarda. */
async function resolveTimezone(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  const { data } = await db
    .from('ai_scheduling_settings')
    .select('timezone')
    .eq('account_id', accountId)
    .maybeSingle<{ timezone: string | null }>()
  return data?.timezone || 'America/Sao_Paulo'
}
