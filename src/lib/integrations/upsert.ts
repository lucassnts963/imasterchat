import type { SupabaseClient } from '@supabase/supabase-js'
import type { CobrancaExterna } from './types'

// ============================================================
// Gravar cobranças vindas de fora, sem duplicar — fase 5.
//
// Uma função para as duas entradas: a planilha e o webhook genérico. Os
// dois têm o mesmo requisito, e é o que mais importa neste arquivo:
//
//   Reentrega do fornecedor, ou reimportação do mesmo arquivo, NÃO pode
//   duplicar a carteira — porque uma carteira duplicada vira duas
//   mensagens de cobrança para a mesma pessoa, e essa é a falha que
//   custa o cliente.
//
// A unicidade é do banco (`cobrancas_externo_idx` sobre conta, origem e
// id externo). Aqui só se escolhe o que fazer no conflito: sobrescrever.
// ============================================================

export interface ResultadoUpsert {
  gravadas: number
  atualizadas: number
  semContato: number
  erro?: string
}

/**
 * Casa a cobrança com um contato pelo telefone.
 *
 * Cobrança órfã **não é descartada**: ela entra com `contact_id` nulo e
 * aparece numa fila própria para o operador resolver. Descartar
 * silenciosamente faria a carteira do sistema divergir da do cliente, e
 * ninguém descobriria até alguém reclamar de não ter sido cobrado.
 */
async function resolverContatos(
  db: SupabaseClient,
  accountId: string,
  telefones: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  const unicos = [...new Set(telefones.filter(Boolean))]
  for (let i = 0; i < unicos.length; i += 500) {
    const { data } = await db
      .from('contacts')
      .select('id, phone')
      .eq('account_id', accountId)
      .in('phone', unicos.slice(i, i + 500))
    for (const c of (data ?? []) as { id: string; phone: string }[]) {
      mapa.set(c.phone, c.id)
    }
  }
  return mapa
}

export async function upsertCobrancas(
  db: SupabaseClient,
  args: { accountId: string; origem: string; cobrancas: CobrancaExterna[] },
): Promise<ResultadoUpsert> {
  const { accountId, origem, cobrancas } = args
  if (cobrancas.length === 0) {
    return { gravadas: 0, atualizadas: 0, semContato: 0 }
  }

  const contatos = await resolverContatos(
    db,
    accountId,
    cobrancas.map((c) => c.telefone ?? '').filter(Boolean),
  )

  let semContato = 0
  const linhas = cobrancas.map((c) => {
    const contactId = c.telefone ? (contatos.get(c.telefone) ?? null) : null
    if (!contactId) semContato += 1
    return {
      account_id: accountId,
      contact_id: contactId,
      titular_ref: c.titularRef ?? null,
      telefone_bruto: c.telefone ?? null,
      origem,
      id_externo: c.idExterno,
      descricao: c.descricao ?? null,
      valor: c.valor,
      vencimento: c.vencimento,
      status: c.status,
      pago_em: c.pagoEm ?? null,
      valor_pago: c.valorPago ?? null,
      link_pagamento: c.linkPagamento ?? null,
      codigo_pix: c.codigoPix ?? null,
      linha_digitavel: c.linhaDigitavel ?? null,
      sincronizado_em: new Date().toISOString(),
    }
  })

  // `onConflict` sobre a chave externa: a fonte é a autoridade sobre o
  // estado da cobrança, e uma reentrega que traz `paga` tem de vencer o
  // `aberta` que está aqui — é assim que a baixa chega.
  const { error, count } = await db
    .from('cobrancas')
    .upsert(linhas, { onConflict: 'account_id,origem,id_externo', count: 'exact' })

  if (error) {
    console.error('[integrations] upsert de cobranças falhou:', error.message)
    return { gravadas: 0, atualizadas: 0, semContato, erro: error.message }
  }

  return { gravadas: count ?? linhas.length, atualizadas: 0, semContato }
}

/**
 * A baixa: marca uma cobrança como paga.
 *
 * Endereçada pelo id EXTERNO, porque quem chama é o sistema de origem e
 * ele não conhece o nosso. Devolve falso quando não achou — e não um
 * erro — para o chamador poder distinguir "não existe aqui" de "falhou".
 */
export async function registrarPagamento(
  db: SupabaseClient,
  args: {
    accountId: string
    origem: string
    idExterno: string
    pagoEm?: string | null
    valorPago?: number | null
  },
): Promise<boolean> {
  const { data, error } = await db
    .from('cobrancas')
    .update({
      status: 'paga',
      pago_em: args.pagoEm ?? new Date().toISOString().slice(0, 10),
      valor_pago: args.valorPago ?? null,
      sincronizado_em: new Date().toISOString(),
    })
    .eq('account_id', args.accountId)
    .eq('origem', args.origem)
    .eq('id_externo', args.idExterno)
    .select('id')

  if (error) {
    console.error('[integrations] baixa falhou:', error.message)
    return false
  }
  return Array.isArray(data) && data.length > 0
}
