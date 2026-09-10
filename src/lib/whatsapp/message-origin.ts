// ============================================================
// Qual superfície mandou a mensagem.
//
// Gravado no ENVIO, por quem envia, porque é a única hora em que se
// sabe: o webhook de status, que grava o custo (migração 075), recebe um
// id da Meta e nada mais.
//
// Existe por uma razão de produto, não de auditoria. Um total mensal sem
// quebra por origem informa que a conta subiu e não O QUE CORTAR —
// "trinta dólares em resposta automática de IA" e "trinta dólares em
// broadcast" pedem decisões opostas.
// ============================================================

export const MESSAGE_ORIGINS = [
  /** Resposta automática do agente. */
  'ai',
  /** Atendente humano, pela inbox. */
  'inbox',
  'automation',
  'flow',
  'broadcast',
  /** API pública (`/api/v1/messages`). */
  'api',
  /** Régua de cobrança. Separada de `automation` porque é a superfície
   *  que mais multiplica mensagem sem ninguém ver, e o operador precisa
   *  enxergá-la sozinha na conta do mês. */
  'cobranca',
] as const

export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number]

/**
 * As origens que um teto de orçamento pode calar.
 *
 * `inbox` fica de fora, e é a decisão mais importante deste arquivo:
 * estourar o teto não pode emudecer o atendente. Calar uma pessoa que
 * está respondendo um cliente para economizar quatro centavos é o pior
 * resultado possível — pior que a fatura que o teto existe para evitar.
 */
export const BLOCKABLE_ORIGINS: readonly MessageOrigin[] = [
  'ai',
  'automation',
  'flow',
  'broadcast',
  'api',
  'cobranca',
]

export function isBlockableOrigin(origin: string | null | undefined): boolean {
  return BLOCKABLE_ORIGINS.includes(origin as MessageOrigin)
}
