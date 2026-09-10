import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateInZone } from '@/lib/time/zone'
import type {
  CobrancaEmAberto,
  Degrau,
  DisparoAnterior,
  RegraDaRegua,
} from './regua'
import { parseJanela, type JanelaContato } from './janela'

// ============================================================
// O que a régua precisa ler e escrever.
//
// Separado do planejador (`regua.ts`, puro) e do worker: aqui mora todo
// o SQL, e é o único arquivo que precisa mudar quando o schema mudar.
// ============================================================

export interface ReguaCarregada {
  id: string
  nome: string
  janela: JanelaContato
  regra: RegraDaRegua
  degraus: Degrau[]
}

interface ReguaRow {
  id: string
  nome: string
  janela: unknown
  max_contatos_periodo: number
  periodo_dias: number
  intervalo_minimo_dias: number
  pausa_apos_resposta_dias: number
}

interface DegrauRow {
  id: string
  offset_dias: number
  template_name: string
  template_language: string | null
  template_vars: Record<string, string> | null
  hora_do_dia: string
  flow_id: string | null
  is_active: boolean
}

/** Guarda o que o degrau precisa para montar a mensagem, além do plano. */
export interface DegrauCompleto extends Degrau {
  templateLanguage: string | null
  templateVars: Record<string, string>
}

export async function loadReguaAtiva(
  db: SupabaseClient,
  accountId: string,
  timezone: string,
): Promise<(ReguaCarregada & { degrausCompletos: DegrauCompleto[] }) | null> {
  const { data: regua, error } = await db
    .from('reguas')
    .select(
      'id, nome, janela, max_contatos_periodo, periodo_dias, intervalo_minimo_dias, pausa_apos_resposta_dias',
    )
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<ReguaRow>()

  if (error || !regua) return null

  const { data: degrausRaw } = await db
    .from('regua_degraus')
    .select(
      'id, offset_dias, template_name, template_language, template_vars, hora_do_dia, flow_id, is_active',
    )
    .eq('regua_id', regua.id)
    .order('offset_dias', { ascending: true })

  const degrausCompletos: DegrauCompleto[] = ((degrausRaw ?? []) as DegrauRow[]).map(
    (d) => ({
      id: d.id,
      offsetDias: d.offset_dias,
      templateName: d.template_name,
      templateLanguage: d.template_language,
      templateVars: d.template_vars ?? {},
      horaDoDia: String(d.hora_do_dia).slice(0, 5),
      flowId: d.flow_id,
      isActive: d.is_active,
    }),
  )

  return {
    id: regua.id,
    nome: regua.nome,
    janela: parseJanela(regua.janela, timezone),
    regra: {
      maxContatosPeriodo: regua.max_contatos_periodo,
      periodoDias: regua.periodo_dias,
      intervaloMinimoDias: regua.intervalo_minimo_dias,
      pausaAposRespostaDias: regua.pausa_apos_resposta_dias,
    },
    degraus: degrausCompletos,
    degrausCompletos,
  }
}

interface CobrancaRow {
  id: string
  contact_id: string | null
  titular_ref: string | null
  valor: number | string
  vencimento: string
  status: string
  descricao: string | null
  link_pagamento: string | null
  codigo_pix: string | null
  linha_digitavel: string | null
}

export interface CobrancaCompleta extends CobrancaEmAberto {
  descricao: string | null
  linkPagamento: string | null
  codigoPix: string | null
  linhaDigitavel: string | null
}

/**
 * A carteira em aberto, já com promessa e última resposta do titular.
 *
 * Uma consulta por eixo em vez de uma junção grande: a carteira de uma
 * conta cabe em memória, e três consultas simples são mais fáceis de
 * entender — e de indexar — que um join com dois LATERALs.
 */
export async function loadCarteira(
  db: SupabaseClient,
  accountId: string,
  timezone: string,
  agora: Date,
): Promise<CobrancaCompleta[]> {
  const { data } = await db
    .from('cobrancas')
    .select(
      'id, contact_id, titular_ref, valor, vencimento, status, descricao, link_pagamento, codigo_pix, linha_digitavel',
    )
    .eq('account_id', accountId)
    .eq('status', 'aberta')
    .limit(20_000)

  const rows = (data ?? []) as CobrancaRow[]
  if (rows.length === 0) return []

  const hoje = formatDateInZone(agora, timezone)
  const ids = rows.map((r) => r.id)

  // Promessas vigentes: a mais distante manda, porque prometer duas
  // vezes é prometer a última.
  const promessaPor = new Map<string, string>()
  const { data: promessas } = await db
    .from('cobranca_promessas')
    .select('cobranca_id, promessa_para')
    .in('cobranca_id', ids)
    .gte('promessa_para', hoje)
  for (const p of (promessas ?? []) as {
    cobranca_id: string
    promessa_para: string
  }[]) {
    const atual = promessaPor.get(p.cobranca_id)
    if (!atual || p.promessa_para > atual) {
      promessaPor.set(p.cobranca_id, p.promessa_para)
    }
  }

  // Última mensagem RECEBIDA de cada contato. É o que pausa a régua: o
  // cliente respondeu, virou atendimento humano, e continuar disparando
  // por cima é o caminho mais rápido para virar reclamação.
  const respondeuPor = new Map<string, Date>()
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[]
  if (contactIds.length > 0) {
    const { data: convs } = await db
      .from('conversations')
      .select('contact_id, last_message_at')
      .eq('account_id', accountId)
      .in('contact_id', contactIds)
    for (const c of (convs ?? []) as {
      contact_id: string
      last_message_at: string | null
    }[]) {
      if (c.last_message_at) respondeuPor.set(c.contact_id, new Date(c.last_message_at))
    }
  }

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    titularRef: r.titular_ref,
    valor: Number(r.valor),
    vencimento: r.vencimento,
    status: r.status,
    promessaPara: promessaPor.get(r.id) ?? null,
    respondeuEm: r.contact_id ? (respondeuPor.get(r.contact_id) ?? null) : null,
    descricao: r.descricao,
    linkPagamento: r.link_pagamento,
    codigoPix: r.codigo_pix,
    linhaDigitavel: r.linha_digitavel,
  }))
}

export async function loadDisparos(
  db: SupabaseClient,
  cobrancaIds: string[],
): Promise<DisparoAnterior[]> {
  if (cobrancaIds.length === 0) return []
  const out: DisparoAnterior[] = []
  for (let i = 0; i < cobrancaIds.length; i += 500) {
    const { data } = await db
      .from('regua_disparos')
      .select('cobranca_id, degrau_id, disparado_em, resultado')
      .in('cobranca_id', cobrancaIds.slice(i, i + 500))
    for (const d of (data ?? []) as {
      cobranca_id: string
      degrau_id: string
      disparado_em: string
      resultado: 'enviado' | 'suprimido'
    }[]) {
      out.push({
        cobrancaId: d.cobranca_id,
        degrauId: d.degrau_id,
        disparadoEm: new Date(d.disparado_em),
        resultado: d.resultado,
      })
    }
  }
  return out
}

export async function registrarDisparo(
  db: SupabaseClient,
  row: {
    accountId: string
    cobrancaId: string
    degrauId: string
    resultado: 'enviado' | 'suprimido'
    motivo?: string | null
    textoEnviado?: string | null
    messageId?: string | null
    agrupadoEm?: string | null
  },
): Promise<{ ok: boolean; duplicado: boolean }> {
  const { error } = await db.from('regua_disparos').insert({
    account_id: row.accountId,
    cobranca_id: row.cobrancaId,
    degrau_id: row.degrauId,
    resultado: row.resultado,
    motivo: row.motivo ?? null,
    texto_enviado: row.textoEnviado ?? null,
    message_id: row.messageId ?? null,
    agrupado_em: row.agrupadoEm ?? null,
  })
  if (!error) return { ok: true, duplicado: false }

  // 23505 na unicidade parcial: outro worker já mandou este degrau. Não
  // é falha — é a trava fazendo o trabalho dela.
  const msg = error.message ?? ''
  if (msg.includes('23505') || msg.includes('duplicate key')) {
    return { ok: false, duplicado: true }
  }
  console.error('[cobranca] registrarDisparo falhou:', msg)
  return { ok: false, duplicado: false }
}

/** Os feriados que valem para esta conta: nacionais mais os dela. */
export async function loadFeriados(
  db: SupabaseClient,
  accountId: string,
): Promise<Set<string>> {
  const { data } = await db
    .from('feriados')
    .select('data, account_id')
    .or(`account_id.is.null,account_id.eq.${accountId}`)
    .limit(2_000)
  return new Set(((data ?? []) as { data: string }[]).map((f) => f.data))
}
