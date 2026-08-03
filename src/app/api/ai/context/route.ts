import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { buildContextPreview } from '@/lib/ai/context-preview'

// ============================================================
// GET /api/ai/context — o que o modelo lê, seção por seção
//
// `?conversation_id=` monta sobre uma conversa real (transcript e fatos
// do contato incluídos). Sem ele, monta o genérico — que é o que se
// quer ao conferir configuração, e é o que o Playground enxerga.
//
// Qualquer membro pode ver: é o que o negócio já diz aos próprios
// clientes, e esconder de quem atende só garante que ninguém descubra
// por que o bot respondeu o que respondeu. Nenhuma chave de provedor
// passa por aqui — o que sai é texto de prompt.
// ============================================================

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const conversationId =
      new URL(request.url).searchParams.get('conversation_id') || null

    const preview = await buildContextPreview(
      supabase,
      accountId,
      conversationId,
    )
    if (!preview) return NextResponse.json({ configured: false })
    return NextResponse.json({ configured: true, ...preview })
  } catch (err) {
    return toErrorResponse(err)
  }
}
