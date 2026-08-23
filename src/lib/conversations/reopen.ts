import type { ConversationStatus } from '@/types'

// ============================================================
// A conversa fechada que recebe mensagem nova.
//
// Fechar é a atendente dizendo "este atendimento acabou". Quando o
// cliente escreve depois disso, começou outro — e o que sobrou do
// anterior atrapalha os dois.
//
// O que sobrava, antes daqui:
//
//   status                 seguia 'closed', então a thread aparecia
//                          como encerrada com mensagem por ler em cima
//   assigned_agent_id      a atendente do mês passado continuava "dona"
//                          da thread, e é uma das guardas que fazem o
//                          agente de IA não responder
//   ai_autoreply_disabled  se houve handoff naquele atendimento, o bot
//                          ficava mudo ali para sempre
//   ai_handoff_summary     a tarja do inbox mostrava o motivo de um
//                          handoff que já foi resolvido e fechado
//
// Nenhuma dessas era liberada em lugar nenhum. O sintoma que o operador
// vê — "o agente não faz nada" — costuma ser a terceira, não a
// primeira: `status` NÃO é uma das guardas do auto-reply, então fechar,
// por si só, nunca calou o bot.
//
// Este é o mesmo formato que a migração 045 já tinha resolvido para o
// teto de respostas ("un-sticks a thread that hit the cap once and went
// mute"). O princípio existia; faltava aplicá-lo ao resto.
//
// ------------------------------------------------------------
// POR QUE SÓ O CASO 'closed'
//
// `pending` é a fila do handoff: alguém prometeu um humano ao cliente,
// e devolver a thread ao bot porque o cliente insistiu seria quebrar
// essa promessa exatamente quando ele está cobrando. Fica como está.
//
// `open` com dono é uma conversa em andamento: soltar o dono a cada
// mensagem tiraria a thread da atendente no meio do atendimento.
//
// Fechar é o único gesto que declara o fim de um episódio. Por isso é o
// único que autoriza limpar o que era dele.
// ============================================================

/** As colunas que uma reabertura zera. Vazio quando não há reabertura. */
export interface ReopenPatch {
  status?: 'open'
  assigned_agent_id?: null
  ai_autoreply_disabled?: false
  ai_handoff_summary?: null
}

/**
 * O que mudar na conversa quando chega mensagem do cliente.
 *
 * Devolve `{}` — e não `null` — para o caso comum, de propósito: quem
 * chama espalha isto dentro do update que já ia fazer, e um objeto
 * vazio espalha sem `if`.
 */
export function reopenPatch(current: ConversationStatus | string): ReopenPatch {
  if (current !== 'closed') return {}
  return {
    status: 'open',
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    // A nota do handoff descreve o atendimento que foi encerrado.
    // Mantê-la faria a tarja do inbox explicar o episódio errado.
    ai_handoff_summary: null,
  }
}

/** Houve reabertura? Para decidir o evento de webhook, sem repetir a regra. */
export function isReopening(current: ConversationStatus | string): boolean {
  return current === 'closed'
}
