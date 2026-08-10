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
