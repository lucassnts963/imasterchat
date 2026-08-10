import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import { stampTranscript, type StampedMessage } from './transcript-stamp'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
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
    .select('sender_type, content_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    // Qualquer linha COM TEXTO, e não apenas `content_type = 'text'`.
    //
    // O filtro por tipo fazia sentido quando só mensagem de texto tinha
    // texto. Depois da 061 um áudio transcrito guarda a transcrição em
    // `content_text` — e continuava sendo excluído aqui, então o modelo
    // recebia a conversa sem ela e respondia com um cumprimento genérico
    // a quem tinha acabado de pedir um agendamento.
    //
    // De carona entram legendas de imagem e vídeo, texto de localização
    // e o rótulo do botão que o cliente tocou. Todos são coisas que o
    // cliente disse, e todos estavam invisíveis pelo mesmo motivo.
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const messages: StampedMessage[] = rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: label(m.content_type, m.content_text!.trim()),
      at: m.created_at,
    }))

  if (!opts.timestamps) {
    return messages.map(({ role, content }) => ({ role, content }))
  }
  return stampTranscript(messages, opts.timezone)
}

/**
 * Marca o texto que NÃO foi digitado.
 *
 * Uma transcrição erra, e erra em palavra inteira: no primeiro teste em
 * produção o Whisper ouviu "demonstração" como "administração". Sem
 * saber que aquilo veio de voz, o modelo trata a palavra errada como
 * certa e age sobre ela — e agir sobre palavra errada, num agendamento,
 * custa caro.
 *
 * Com a marca ele pode confirmar quando algo não fizer sentido, que é o
 * que uma pessoa faria ao ouvir mal.
 *
 * Só áudio leva marca. Legenda de imagem e rótulo de botão foram
 * digitados pelo cliente e são exatos; anotá-los seria ruído pago em
 * token toda resposta.
 */
function label(contentType: string, text: string): string {
  return contentType === 'audio' ? `[transcrição de áudio] ${text}` : text
}
