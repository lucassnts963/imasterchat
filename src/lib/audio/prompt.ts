// ============================================================
// O vocabulário que o transcritor precisa esperar.
//
// O Whisper decodifica palavra por palavra escolhendo a sequência mais
// provável. Sem contexto, ele não sabe que está ouvindo alguém marcar
// horário — e "reagendar" perde para "reagir a andar", que em português
// genérico é uma sequência perfeitamente plausível.
//
// Medido com o áudio real de um cliente, mesmo modelo, mesma máquina:
//
//   sem viés   "Você consegue reagir a andar para mim na quarta-feira?"
//   com viés   "Você consegue reagendar para mim na quarta-feira?"
//
// É o `initial_prompt` do faster-whisper: um texto que ele lê como se
// fosse o começo da transcrição, e que inclina as probabilidades para
// esse campo semântico. Não força nada — só torna o vocabulário do
// negócio mais provável que o do dicionário inteiro.
//
// Barato do jeito certo: não muda modelo, não muda máquina, não
// acrescenta latência perceptível.
// ============================================================

/**
 * As palavras que uma conversa de atendimento carrega em qualquer ramo.
 *
 * Escrito como frase e não como lista solta de propósito: o Whisper
 * espera um trecho de texto natural, e uma enumeração seca ensina menos
 * do que uma sentença sobre o assunto.
 */
const BASE_PT =
  'Conversa de atendimento por WhatsApp sobre agendamento. ' +
  'Termos comuns: agendar, reagendar, remarcar, desmarcar, cancelar, confirmar, ' +
  'horário, disponibilidade, orçamento, atendimento, ' +
  'segunda-feira, terça-feira, quarta-feira, quinta-feira, sexta-feira, sábado, ' +
  'manhã, tarde, hoje, amanhã.'

export interface TranscriptionPromptInput {
  /** Como o negócio chama um agendamento. Ver `scheduling/label.ts`. */
  appointmentLabel?: string | null
}

/**
 * O `initial_prompt` para este negócio.
 *
 * O termo da conta entra porque é exatamente a palavra que mais importa
 * acertar e a mais fácil de errar: "demonstração" e "administração"
 * soam parecido, e confundi-las troca o assunto do pedido inteiro. A
 * conta já respondeu qual é a palavra na tela de Agendamento — aqui ela
 * ganha um segundo uso.
 */
export function buildTranscriptionPrompt(
  input: TranscriptionPromptInput = {},
): string {
  const label = input.appointmentLabel?.trim()
  if (!label) return BASE_PT
  return `${BASE_PT} O cliente costuma pedir uma ${label}.`
}
