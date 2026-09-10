// ============================================================
// POST /api/v1/cobrancas — o webhook genérico de cobrança.
//
// A peça mais importante do módulo de integrações, e a menos glamourosa:
// um endereço que QUALQUER sistema chama. Atende todo cliente cujo
// software não tem API própria — que vai ser a maioria — e é o que tira
// o roteiro da dependência de um fornecedor terceiro.
//
// Idempotente por `(origem, id_externo)`: reentrega não duplica a
// carteira, e carteira duplicada é duas mensagens de cobrança para a
// mesma pessoa.
//
// Corpo:
//   {
//     "origem": "meu-erp",            // opcional; padrão "webhook"
//     "cobrancas": [ { ... } ],       // uma ou muitas
//     "mapa": { "valor": "vlr" }      // opcional: os nomes que VOCÊ usa
//   }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { normalizarLinha, resumirImportacao } from '@/lib/integrations/normalize'
import type { MapaDeCampos, ResultadoDeLinha } from '@/lib/integrations/normalize'
import { upsertCobrancas } from '@/lib/integrations/upsert'

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'cobrancas:write')
    const body = (await request.json().catch(() => null)) as {
      origem?: unknown
      cobrancas?: unknown
      mapa?: unknown
    } | null

    if (!body || !Array.isArray(body.cobrancas)) {
      return fail('bad_request', 'cobrancas must be an array', 400)
    }
    if (body.cobrancas.length > 5_000) {
      // Um lote maior que isso é uma carga inicial, e carga inicial é
      // trabalho de importação — com pré-visualização — e não de webhook.
      return fail('bad_request', 'at most 5000 cobrancas per request', 400)
    }

    const origem =
      typeof body.origem === 'string' && body.origem.trim()
        ? body.origem.trim().slice(0, 60)
        : 'webhook'
    const mapa = (typeof body.mapa === 'object' && body.mapa !== null
      ? body.mapa
      : {}) as MapaDeCampos

    const linhas: ResultadoDeLinha[] = body.cobrancas.map((linha) =>
      normalizarLinha(
        (typeof linha === 'object' && linha !== null ? linha : {}) as Record<
          string,
          unknown
        >,
        mapa,
      ),
    )
    const resumo = resumirImportacao(linhas)
    const validas = linhas.flatMap((l) => (l.ok ? [l.cobranca] : []))

    const resultado = await upsertCobrancas(ctx.supabase, {
      accountId: ctx.accountId,
      origem,
      cobrancas: validas,
    })
    if (resultado.erro) {
      return fail('internal_error', resultado.erro, 500)
    }

    // As rejeitadas voltam com o motivo, e não em silêncio: "mandei e
    // não chegou" precisa ser respondível pelo lado de quem mandou.
    return ok(
      {
        origem,
        recebidas: resumo.total,
        gravadas: resultado.gravadas,
        rejeitadas: resumo.rejeitadas,
        por_erro: resumo.porErro,
        sem_contato: resultado.semContato,
      },
      201,
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
