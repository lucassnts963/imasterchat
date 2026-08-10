import { supabaseAdmin } from '@/lib/admin/client'
import { handOffConversation } from '@/lib/conversations/handoff'
import { engineSendText } from '@/lib/flows/meta-send'
import { DEFAULT_AUDIO_NOTICE, type AudioAction } from './policy'

// ============================================================
// As políticas de áudio que FALAM com o cliente.
//
// Separadas da decisão porque a decisão é pura e esta parte é toda
// efeito colateral — enviar mensagem e mover conversa de estado. A
// fronteira é o que permite testar a regra sem um WhatsApp por perto.
//
// Roda depois de a mensagem estar gravada e a conversa atualizada, pelo
// mesmo motivo do aviso de transferência: não prometer ao cliente algo
// sobre um estado que ainda não existe.
// ============================================================

export interface AudioSideEffectArgs {
  action: AudioAction
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
}

export async function applyAudioSideEffect(
  args: AudioSideEffectArgs,
): Promise<void> {
  const { action } = args
  if (action.action !== 'notice' && action.action !== 'handoff') return

  const db = supabaseAdmin()

  try {
    if (action.action === 'handoff') {
      await handOffConversation({
        db,
        accountId: args.accountId,
        conversationId: args.conversationId,
        summary:
          'O cliente mandou um áudio e esta conta está configurada para ' +
          'passar áudio direto para uma pessoa. Ouça a mensagem na conversa.',
        assignTo: null,
      })
      return
    }

    const { data } = await db
      .from('ai_configs')
      .select('audio_notice_text')
      .eq('account_id', args.accountId)
      .maybeSingle<{ audio_notice_text: string | null }>()

    await engineSendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: (data?.audio_notice_text ?? '').trim() || DEFAULT_AUDIO_NOTICE,
      aiGenerated: true,
    })
  } catch (err) {
    // Nunca derruba o webhook. A mensagem do cliente já está gravada e
    // visível na caixa de entrada; o que se perde é a cortesia.
    console.error('[audio] efeito da política falhou:', err)
  }
}
