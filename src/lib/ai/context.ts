import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import { stampTranscript, type StampedMessage } from './transcript-stamp'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  created_at: string
}

export interface ConversationContextOptions {
  limit?: number
  /**
   * Marcar cada mensagem com quando ela foi dita.
   *
   * Sem isso o transcript não tem ontem: para o modelo, tudo aconteceu
   * agora. Ver `./transcript-stamp.ts` para o caso real que motivou.
   */
  timestamps?: boolean
  /** Fuso do negócio. As marcas saem no relógio de quem lê a conversa. */
  timezone?: string
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Non-text messages (media,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  options: ConversationContextOptions | number = {},
): Promise<ChatMessage[]> {
  // O terceiro parâmetro era um `limit` solto. Aceitar os dois formatos
  // evita um passo de migração em cada chamador só para ganhar duas
  // opções novas — e o número continua significando o que significava.
  const opts: ConversationContextOptions =
    typeof options === 'number' ? { limit: options } : options
  const limit = opts.limit ?? aiContextMessageLimit()

  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const messages: StampedMessage[] = rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_text!.trim(),
      at: m.created_at,
    }))

  if (!opts.timestamps) {
    return messages.map(({ role, content }) => ({ role, content }))
  }
  return stampTranscript(messages, opts.timezone)
}
