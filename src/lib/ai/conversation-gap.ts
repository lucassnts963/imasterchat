// ============================================================
// "Oi" depois de quatro dias começa outra conversa.
//
// O caso: cliente sumiu no dia 03, deixando sem resposta uma oferta do
// bot ("tenho 16:00 ou 17:00, quer que eu reagende?"). Voltou no dia 07
// com um "Oi" e nada mais. O agente chamou humano, com esta
// justificativa gravada:
//
//   "Cliente pediu reagendamento fora do horário atual e preciso de
//    confirmação/andamento da Demonstração agendada."
//
// O cliente não pediu reagendamento nenhum. Ele disse "Oi". O modelo
// leu a última fala pendente do transcript como se fosse a conversa de
// agora, e como não dava para agir sobre ela, desistiu.
//
// As marcas de tempo fizeram a lacuna ficar VISÍVEL — o modelo tinha
// [2026-08-03 08:50] e [2026-08-07 19:52] na frente dele. O que faltava
// era dizer o que uma lacuna SIGNIFICA. Ver não é entender, e a
// instrução aqui é o entendimento.
//
// A última frase é a que mais importa: proibir explicitamente o handoff
// por causa de assunto velho. "Prefer handing off over guessing" é uma
// boa regra geral do andaime, e é exatamente ela que transforma um
// cumprimento em transferência quando existe fio solto no passado.
// ============================================================

/**
 * A partir de quanto tempo o retorno é uma conversa nova.
 *
 * Oito horas, não vinte e quatro: o corte precisa cair entre "voltou
 * depois do almoço" e "voltou noutro dia". Uma noite de sono já muda o
 * assunto; uma pausa para o almoço, não.
 */
const NEW_SESSION_HOURS = 8

export interface GapInput {
  /** Quando chegou a mensagem atual. */
  current: Date
  /** Quando foi a mensagem anterior da conversa. Null se é a primeira. */
  previous: Date | null
}

/**
 * A frase sobre o intervalo, ou null quando não há o que dizer.
 *
 * Em inglês, como o resto do andaime. O número de dias/horas vai
 * escrito porque "há algum tempo" não ajuda ninguém a decidir nada.
 */
export function describeConversationGap({
  current,
  previous,
}: GapInput): string | null {
  if (!previous) return null

  const ms = current.getTime() - previous.getTime()
  if (!Number.isFinite(ms) || ms < NEW_SESSION_HOURS * 3_600_000) return null

  const hours = Math.floor(ms / 3_600_000)
  const howLong =
    hours >= 48
      ? `${Math.floor(hours / 24)} days`
      : hours >= 24
        ? 'more than a day'
        : `${hours} hours`

  return (
    `The previous message in this conversation was ${howLong} ago. This is a NEW ` +
    'contact, not a continuation: whatever was being discussed back then is over ' +
    'unless the customer brings it up again. Do not assume the old topic, do not ' +
    'answer a question nobody just asked, and above all do NOT hand off to a human ' +
    'merely because an older thread was left unanswered. Greet them and find out ' +
    'what they need now.'
  )
}
