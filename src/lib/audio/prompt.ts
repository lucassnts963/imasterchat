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
  /** Jargão do ramo que a conta escreveu na tela de Regras. */
  vocabulary?: string | null
}

/** Espelha o CHECK da 062. Cortar aqui evita mandar ao Whisper um
 *  prompt que o banco recusaria — e um prompt longo demais empurra o
 *  começo da fala para fora da janela, piorando o que veio corrigir. */
const MAX_VOCABULARY = 500

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
  const parts = [BASE_PT]

  const label = input.appointmentLabel?.trim()
  if (label) parts.push(`O cliente costuma pedir uma ${label}.`)

  // O jargão da conta vai por último: é o mais específico, e o que o
  // modelo leu por último pesa mais na primeira palavra que ele decodifica.
  const extra = input.vocabulary?.trim().slice(0, MAX_VOCABULARY)
  if (extra) {
    parts.push(
      // Apresentado como termos DESTE negócio, e não como lista solta:
      // o Whisper espera texto natural, e uma enumeração seca ensina
      // menos que uma frase sobre o assunto.
      `Termos deste negócio: ${extra.replace(/\s+/g, ' ')}`,
    )
  }

  return parts.join(' ')
}
