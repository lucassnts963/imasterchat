import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// GET /api/ai/vault/runs — o que o keeper andou fazendo
//
// O keeper já gravava tudo isto; só não havia por onde ver. O sintoma
// era caro: com a tela vazia, "o keeper nunca rodou", "rodou e não
// achou nada" e "rodou e quebrou" são o mesmo nada.
//
// Neste servidor ele tinha rodado duas vezes e decidido, das duas, que
// a conversa não trazia nada durável — o que é uma resposta correta, e
// era invisível.
//
// As três operações que uma execução deixa:
//   proposed   nasceu uma página, esperando aprovação
//   no_action  o modelo respondeu sem chamar ferramenta nenhuma
//   finished   o keeper decidiu, com justificativa, que não havia o quê
// ============================================================

/** Só o que uma execução produz. `approved`/`rejected`/`archived` são
 *  atos de gente e pertencem ao histórico da página, não ao do keeper. */
const RUN_OPERATIONS = ['proposed', 'no_action', 'finished'] as const

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const limit = Math.min(
      50,
      Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 20),
    )

    const { data, error } = await supabase
      .from('ai_vault_revisions')
      .select('id, operation, page_id, note, created_at')
      .eq('account_id', accountId)
      .in('operation', RUN_OPERATIONS)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[vault/runs] query failed:', error)
      return NextResponse.json(
        { error: 'Failed to load the keeper history' },
        { status: 500 },
      )
    }

    return NextResponse.json({ runs: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
