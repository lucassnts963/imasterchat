// ============================================================
// O que o evento diz na Google Agenda.
//
// Antes daqui, um evento marcado pelo agente chegava assim:
//
//     Atendimento — Jaqueline Msena
//     (sem descrição)
//
// Quem abrisse a agenda de manhã via um horário ocupado e nada mais.
// Nem o telefone para confirmar, nem o que a pessoa pediu, nem por onde
// voltar à conversa. Numa ótica dá para viver com isso — o cliente
// chega e você descobre ali. Numa visita técnica de painel solar, sair
// para a rua sem endereço e sem telefone é a diferença entre a visita
// acontecer e não acontecer.
//
// A Google Agenda é a tela que essas equipes já olham. Se a informação
// não está nela, ela não existe no momento em que é necessária.
//
// Texto puro, sem HTML: a descrição de evento do Google aceita um
// subconjunto de HTML, mas ele varia entre a web, o Android e o iOS, e
// tag que não é suportada aparece crua para o usuário. Linha em branco
// separa igual em todo lugar.
// ============================================================

export interface EventTextInput {
  /** O que o cliente pediu, nas palavras dele. */
  title?: string | null
  /** Observação livre de quem marcou. */
  notes?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  contactCompany?: string | null
  /** Para o link de volta à conversa. */
  conversationId?: string | null
  /** Origem da marcação, que muda quem procurar em caso de dúvida. */
  createdVia: 'native' | 'manual'
  /** Como o negócio chama isso. Null usa "Atendimento". */
  appointmentLabel?: string | null
  /** Origem pública do app, para montar o link. Sem ela, o link cai. */
  siteUrl?: string | null
}

/** O título do evento — a única linha que aparece na grade da semana. */
export function buildEventSummary(input: EventTextInput): string {
  // O assunto na frente do nome, e não o contrário: na grade da semana
  // o texto é cortado por largura de coluna, e o que distingue dois
  // eventos do mesmo dia é o que é, não quem é.
  const what =
    input.title?.trim() || input.appointmentLabel?.trim() || 'Atendimento'
  const who = input.contactName?.trim()
  return who ? `${what} — ${who}` : what
}

/**
 * O corpo do evento.
 *
 * Devolve `undefined` quando não há nada de útil a dizer — uma
 * descrição vazia polui a tela de detalhe do Google com um campo em
 * branco, e "sem descrição" já é a ausência.
 */
export function buildEventDescription(
  input: EventTextInput,
): string | undefined {
  const blocks: string[] = []

  const quem: string[] = []
  if (input.contactName?.trim()) quem.push(`Cliente: ${input.contactName.trim()}`)
  if (input.contactPhone?.trim()) quem.push(`WhatsApp: ${input.contactPhone.trim()}`)
  if (input.contactEmail?.trim()) quem.push(`E-mail: ${input.contactEmail.trim()}`)
  if (input.contactCompany?.trim()) quem.push(`Empresa: ${input.contactCompany.trim()}`)
  if (quem.length > 0) blocks.push(quem.join('\n'))

  // O pedido em bloco próprio: é a única parte escrita pelo cliente, e
  // é o que a pessoa lê primeiro para lembrar do que se trata.
  if (input.title?.trim()) blocks.push(`Pedido: ${input.title.trim()}`)
  if (input.notes?.trim()) blocks.push(`Observações: ${input.notes.trim()}`)

  const site = input.siteUrl?.trim().replace(/\/+$/, '')
  if (site && input.conversationId) {
    blocks.push(`Conversa: ${site}/inbox?conversation=${input.conversationId}`)
  }

  blocks.push(
    input.createdVia === 'native'
      ? 'Marcado pelo agente de IA, a partir da conversa no WhatsApp.'
      : 'Marcado manualmente pela equipe.',
  )

  // Só o rodapé de origem não justifica uma descrição: ele explica de
  // onde veio um evento que, sem os outros blocos, não diz nada mesmo.
  if (blocks.length === 1) return undefined
  return blocks.join('\n\n')
}
