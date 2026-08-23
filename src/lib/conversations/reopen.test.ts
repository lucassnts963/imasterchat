import { describe, it, expect } from 'vitest'

import { isReopening, reopenPatch } from './reopen'

// A promessa: mensagem nova numa conversa FECHADA começa um episódio
// limpo — status, dono e mudez do bot. E não mexe em mais nada.

describe('reopenPatch', () => {
  it('reabre a fechada e solta tudo que era do episódio anterior', () => {
    expect(reopenPatch('closed')).toEqual({
      status: 'open',
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_handoff_summary: null,
    })
  })

  it('não toca em `pending` — alguém prometeu um humano ao cliente', () => {
    // Devolver a thread ao bot aqui quebraria a promessa exatamente
    // quando o cliente está cobrando por ela.
    expect(reopenPatch('pending')).toEqual({})
  })

  it('não toca em `open` — a atendente está no meio do atendimento', () => {
    // Soltar o dono a cada mensagem tiraria a thread da mão de quem
    // está respondendo.
    expect(reopenPatch('open')).toEqual({})
  })

  it('status desconhecido não vira reabertura', () => {
    // Fail-safe: um estado que este código não conhece é melhor deixar
    // quieto do que reabrir por engano.
    expect(reopenPatch('arquivada')).toEqual({})
  })

  it('o patch vazio pode ser espalhado sem apagar nada', () => {
    // É por isso que a função devolve {} e não null: quem chama espalha
    // dentro do update que já ia fazer.
    const base = { last_message_at: 'x', unread_count: 3 }
    expect({ ...base, ...reopenPatch('open') }).toEqual(base)
  })

  it('a reabertura não inventa colunas fora das quatro', () => {
    // Guarda contra alguém acrescentar um campo aqui sem pensar: este
    // patch entra no mesmo update do webhook, e uma coluna a mais
    // sobrescreveria dado que ninguém pediu para sobrescrever.
    expect(Object.keys(reopenPatch('closed')).sort()).toEqual([
      'ai_autoreply_disabled',
      'ai_handoff_summary',
      'assigned_agent_id',
      'status',
    ])
  })
})

describe('isReopening', () => {
  it('só a fechada dispara o evento de reabertura', () => {
    expect(isReopening('closed')).toBe(true)
    expect(isReopening('open')).toBe(false)
    expect(isReopening('pending')).toBe(false)
  })

  it('concorda com o patch — a regra é uma só', () => {
    // As duas funções decidem a mesma coisa e não podem divergir: se
    // divergissem, o webhook emitiria `conversation.reopened` sem ter
    // reaberto, ou o contrário.
    for (const s of ['open', 'pending', 'closed', 'outro']) {
      expect(isReopening(s)).toBe(Object.keys(reopenPatch(s)).length > 0)
    }
  })
})
