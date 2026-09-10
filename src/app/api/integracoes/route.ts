import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { INTEGRACOES } from '@/lib/integrations/catalog'

/**
 * GET /api/integracoes — o catálogo, com o que está conectado.
 *
 * A tela lê **daqui**, e o executor lê do mesmo `catalog.ts`. Uma lista,
 * não duas: manter o catálogo em dois lugares é o defeito que este
 * repositório já teve duas vezes, e nas duas as cópias divergiram.
 *
 * Os indisponíveis vêm junto, marcados. O catálogo é argumento comercial
 * antes de ser recurso técnico — esconder o que ainda não existe
 * transforma um roteiro público num segredo interno.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data } = await supabase
      .from('integrations')
      .select('provider, label, is_active, last_sync_at, last_error')
      .eq('account_id', accountId)

    const conectadas = new Map(
      ((data ?? []) as Array<{ provider: string }>).map((i) => [i.provider, i]),
    )

    return NextResponse.json({
      integracoes: INTEGRACOES.map((preset) => ({
        ...preset,
        // As credenciais NUNCA saem, nem cifradas: a tela só precisa
        // saber se existe conexão, não qual é.
        conexao: conectadas.get(preset.id) ?? null,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
