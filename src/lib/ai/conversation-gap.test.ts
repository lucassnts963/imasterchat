import { describe, it, expect } from 'vitest'

import { describeConversationGap } from './conversation-gap'

// O caso real: sumiu no dia 03 deixando uma oferta sem resposta, voltou
// no dia 07 com "Oi", e o agente chamou humano dizendo que o cliente
// tinha pedido reagendamento. Ele não pediu nada — o modelo leu o fio
// solto do passado como se fosse a conversa de agora.

const VOLTOU = new Date(2026, 7, 7, 19, 52)

describe('describeConversationGap', () => {
  it('quatro dias depois é conversa nova, e diz quantos dias', () => {
    const out = describeConversationGap({
      current: VOLTOU,
      previous: new Date(2026, 7, 3, 8, 50),
    })
    expect(out).toContain('4 days')
    expect(out).toContain('NEW')
  })

  it('proíbe explicitamente o handoff por assunto velho', () => {
    // É a regra que faltava. Sem ela, "prefer handing off over guessing"
    // do andaime transforma um cumprimento em transferência sempre que
    // existe fio solto no passado.
    const out = describeConversationGap({
      current: VOLTOU,
      previous: new Date(2026, 7, 3, 8, 50),
    })
    expect(out).toMatch(/do NOT hand off/i)
  })

  it('pausa para o almoço não é conversa nova', () => {
    // O corte precisa cair entre "voltou depois do almoço" e "voltou
    // noutro dia". Duas horas é claramente a mesma conversa.
    expect(
      describeConversationGap({
        current: new Date(2026, 7, 7, 14, 0),
        previous: new Date(2026, 7, 7, 12, 0),
      }),
    ).toBeNull()
  })

  it('uma noite de sono é', () => {
    expect(
      describeConversationGap({
        current: new Date(2026, 7, 7, 9, 0),
        previous: new Date(2026, 7, 6, 18, 0),
      }),
    ).toContain('15 hours')
  })

  it('primeira mensagem da conversa não tem lacuna', () => {
    expect(
      describeConversationGap({ current: VOLTOU, previous: null }),
    ).toBeNull()
  })

  it('data quebrada não vira instrução com NaN', () => {
    expect(
      describeConversationGap({
        current: VOLTOU,
        previous: new Date('lixo'),
      }),
    ).toBeNull()
  })
})
