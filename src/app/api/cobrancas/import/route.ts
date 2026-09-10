import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  normalizarLinha,
  resumirImportacao,
  type MapaDeCampos,
  type ResultadoDeLinha,
} from '@/lib/integrations/normalize'
import { upsertCobrancas } from '@/lib/integrations/upsert'

/**
 * POST /api/cobrancas/import — a importação de planilha.
 *
 * Dois modos, e o primeiro é o que faz a diferença:
 *
 *   `preview` (padrão)  conta e devolve, sem gravar nada
 *   `commit`            grava
 *
 * Meia carteira importada é pior que nenhuma, e o operador precisa ver
 * quantas linhas casam, quantas ficam órfãs e quantas são duplicata
 * ANTES de as mensagens começarem a sair.
 *
 * O arquivo chega já convertido em linhas pelo navegador: parsear XLSX
 * no servidor exigiria uma dependência grande para resolver um problema
 * que o cliente resolve melhor — ele já tem a planilha aberta.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as {
      linhas?: unknown
      mapa?: unknown
      origem?: unknown
      modo?: unknown
    } | null

    if (!body || !Array.isArray(body.linhas)) {
      return NextResponse.json({ error: 'linhas must be an array' }, { status: 400 })
    }
    if (body.linhas.length > 20_000) {
      return NextResponse.json(
        { error: 'at most 20000 rows per import' },
        { status: 400 },
      )
    }

    const mapa = (typeof body.mapa === 'object' && body.mapa !== null
      ? body.mapa
      : {}) as MapaDeCampos
    const origem =
      typeof body.origem === 'string' && body.origem.trim()
        ? body.origem.trim().slice(0, 60)
        : 'planilha'

    const linhas: ResultadoDeLinha[] = body.linhas.map((l) =>
      normalizarLinha(
        (typeof l === 'object' && l !== null ? l : {}) as Record<string, unknown>,
        mapa,
      ),
    )
    const resumo = resumirImportacao(linhas)

    if (body.modo !== 'commit') {
      return NextResponse.json({
        modo: 'preview',
        resumo,
        // Uma amostra das rejeitadas, com a linha como veio: é assim que
        // o operador acha o problema na planilha dele.
        exemplos_rejeitados: linhas
          .filter((l) => !l.ok)
          .slice(0, 10)
          .map((l) => (l.ok ? null : { erro: l.erro, linha: l.bruto })),
      })
    }

    const validas = linhas.flatMap((l) => (l.ok ? [l.cobranca] : []))
    const resultado = await upsertCobrancas(supabase, {
      accountId,
      origem,
      cobrancas: validas,
    })
    if (resultado.erro) {
      return NextResponse.json({ error: resultado.erro }, { status: 500 })
    }

    return NextResponse.json({
      modo: 'commit',
      resumo,
      gravadas: resultado.gravadas,
      sem_contato: resultado.semContato,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
