// ============================================================
// A política de áudio, sem I/O.
//
// Decidir o que fazer com um áudio é uma coisa; fazer é outra. Esta
// parte fica pura para poder ser testada — o webhook é o lugar mais
// caro do sistema para descobrir um `if` errado.
// ============================================================

export type AudioPolicy = 'ignore' | 'notice' | 'transcribe' | 'handoff'

export const AUDIO_POLICIES: readonly AudioPolicy[] = [
  'ignore',
  'notice',
  'transcribe',
  'handoff',
] as const

export function isAudioPolicy(value: unknown): value is AudioPolicy {
  return (
    typeof value === 'string' &&
    (AUDIO_POLICIES as readonly string[]).includes(value)
  )
}

/**
 * O aviso padrão, para a conta que escolheu `notice` e não escreveu o
 * próprio texto.
 *
 * Pede o que a gente precisa (texto) e diz por quê, sem confessar
 * limitação técnica: "não consigo ouvir áudio" convida o cliente a
 * julgar a ferramenta, e não é o que ele quer resolver.
 */
export const DEFAULT_AUDIO_NOTICE =
  'Recebi seu áudio! Para eu te ajudar mais rápido, pode me escrever o que você precisa?'

export interface AudioDecisionInput {
  policy: AudioPolicy
  /** A transcrição já obtida, quando a política era `transcribe`. */
  transcript?: string | null
}

export type AudioAction =
  /** Não fazer nada — o áudio fica gravado e visível, só isso. */
  | { action: 'none' }
  /** Responder pedindo texto. */
  | { action: 'notice' }
  /** Seguir o fluxo normal de texto com este conteúdo. */
  | { action: 'text'; text: string }
  /** Passar para uma pessoa. */
  | { action: 'handoff' }

/**
 * O que fazer, dada a política e o resultado da transcrição.
 *
 * A regra que merece atenção: **transcrição que falhou vira aviso, não
 * silêncio.** Quem escolheu `transcribe` disse que quer atender quem
 * manda áudio; devolver nada porque o Whisper engasgou entrega
 * exatamente o problema que a configuração existia para resolver.
 */
export function decideAudioAction(input: AudioDecisionInput): AudioAction {
  switch (input.policy) {
    case 'notice':
      return { action: 'notice' }
    case 'handoff':
      return { action: 'handoff' }
    case 'transcribe': {
      const text = (input.transcript ?? '').trim()
      return text ? { action: 'text', text } : { action: 'notice' }
    }
    default:
      return { action: 'none' }
  }
}

/**
 * O que o modelo precisa saber ao ler uma transcrição.
 *
 * Uma transcrição erra em palavra inteira. No primeiro teste em
 * produção o Whisper devolveu "administração do sistema" para quem
 * pediu "demonstração do sistema" — uma palavra, e o pedido inteiro
 * muda de assunto.
 *
 * Sem esta instrução o modelo trata a palavra errada como certa e AGE
 * sobre ela. Com ela, confirma quando algo não fecha — que é o que uma
 * pessoa faz ao ouvir mal, e custa uma pergunta em vez de um
 * agendamento errado.
 */
export const AUDIO_TRANSCRIPT_NOTE =
  'Messages prefixed with [transcrição de áudio] were spoken, not typed: they come ' +
  'from automatic speech-to-text and single words are often wrong. Read them for ' +
  'INTENT, not literally. If a word makes the request odd or contradicts the rest of ' +
  'the conversation, assume it was misheard and confirm in your reply — never act on ' +
  'a suspicious word. Do NOT mention transcription, speech-to-text, or that you could ' +
  'not hear well; just ask naturally, the way anyone would when they did not catch a word. ' +
  'An unclear transcript is NOT a reason to hand off to a human — ASK the customer to ' +
  'confirm instead. Handing off because a word came out garbled turns a five-second ' +
  'question into a queue the customer waits in.'
