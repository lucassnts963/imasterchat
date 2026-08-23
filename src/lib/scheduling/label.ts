// ============================================================
// Como ESTE negócio chama um agendamento.
//
// O produto nasceu numa ótica e o vocabulário foi junto — "consulta"
// em toda a tela. Numa loja de bicicletas elétricas o cliente pede uma
// DEMONSTRAÇÃO; numa empresa de projetos fotovoltaicos, uma VISITA
// TÉCNICA. Devolver "consulta" para quem escreveu "demonstração" é o
// tipo de detalhe que faz o atendimento soar automático.
//
// Vazio é o caso normal, não um defeito: significa "use o termo
// genérico", e é onde toda conta existente já está.
// ============================================================

/** Espelha o CHECK da migração 054. */
export const APPOINTMENT_LABEL_MAX = 40

/**
 * Limpa o que o operador digitou.
 *
 * Este texto entra no contexto do agente, então quebra de linha é
 * removida junto com o resto dos caracteres de controle: um campo que
 * aceita `\n` aceita um parágrafo, e um parágrafo num lugar que promete
 * ser um substantivo é por onde uma instrução se disfarçaria de
 * configuração. O corte em 40 é a mesma ideia pelo outro lado.
 *
 * Devolve `null` — e não `''` — para o caso vazio, porque é assim que a
 * coluna representa "sem termo próprio" e não vale ter duas grafias
 * para o mesmo estado.
 */
export function sanitizeAppointmentLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, APPOINTMENT_LABEL_MAX)
  return cleaned || null
}

/**
 * A frase que ensina o termo ao modelo, ou `null` quando não há termo
 * próprio a ensinar.
 *
 * Fica em inglês, como o resto do andaime do prompt, mas carrega a
 * palavra na língua do negócio e entre aspas — o modelo precisa
 * reproduzi-la exatamente, não traduzi-la.
 */
export function describeAppointmentLabel(label: string | null): string | null {
  if (!label) return null
  return (
    `This business calls a booking a "${label}". Use that exact word when ` +
    `you talk to the customer about scheduling, rescheduling or cancelling ` +
    `— not a translation of it, and not a generic word like "appointment".`
  )
}
