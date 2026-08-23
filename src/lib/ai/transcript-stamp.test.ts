import { describe, it, expect } from 'vitest'

import { formatStamp, stampTranscript } from './transcript-stamp'

const SP = 'America/Sao_Paulo'

// O que estes testes seguram é o bug real: um "amanhã" dito ontem foi
// lido como ainda sendo amanhã, e o cliente teve o agendamento movido
// de dia sem concordar. A marca de tempo é o que distingue os dois.

describe('formatStamp', () => {
  it('escreve no fuso do negócio, não em UTC', () => {
    // 03/08 02:51 UTC é 02/08 23:51 em São Paulo — a virada de dia que
    // estava exatamente no meio do caso real.
    expect(formatStamp('2026-08-03T02:51:00Z', SP)).toBe('2026-08-02 23:51')
  })

  it('usa ISO com ano, o mesmo formato das ferramentas de agenda', () => {
    // `check_availability` devolve "2026-08-04: 10:00". Transcript e
    // ferramenta falando igual é meio caminho para o modelo acertar.
    expect(formatStamp('2026-08-04T17:00:00Z', SP)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    )
  })

  it('data inválida não vira "Invalid Date" no transcript', () => {
    // Perder a marca de uma mensagem custa contexto; escrever lixo ali
    // ensina o modelo a desconfiar de todas.
    expect(formatStamp('não é data', SP)).toBeNull()
  })
})

describe('stampTranscript', () => {
  const CONVERSA = [
    {
      role: 'user' as const,
      content: 'Amanhã as 11',
      at: '2026-08-03T02:51:00Z',
    },
    {
      role: 'assistant' as const,
      content: 'agendada para amanhã às 11:00',
      at: '2026-08-03T02:51:50Z',
    },
    {
      role: 'user' as const,
      content: 'Consegue reagendar para as 14hrs?',
      at: '2026-08-03T10:51:43Z',
    },
  ]

  it('deixa visível que o "amanhã" foi dito num dia anterior', () => {
    const out = stampTranscript(CONVERSA, SP)
    expect(out[1].content).toBe('[2026-08-02 23:51] agendada para amanhã às 11:00')
    expect(out[2].content).toBe('[2026-08-03 07:51] Consegue reagendar para as 14hrs?')
    // Os dois em dias diferentes é a informação que faltava: sem ela
    // "amanhã" e "as 14hrs" pareciam a mesma conversa do mesmo dia.
    expect(out[1].content.slice(1, 11)).not.toBe(out[2].content.slice(1, 11))
  })

  it('não mexe no papel nem no texto da mensagem', () => {
    const out = stampTranscript(CONVERSA, SP)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(out[0].content).toContain('Amanhã as 11')
  })

  it('mensagem com data quebrada sai sem prefixo, mas sai', () => {
    const out = stampTranscript(
      [{ role: 'user', content: 'oi', at: 'lixo' }],
      SP,
    )
    expect(out[0].content).toBe('oi')
  })

  it('sem fuso informado, assume o do negócio', () => {
    const out = stampTranscript([CONVERSA[0]])
    expect(out[0].content).toBe('[2026-08-02 23:51] Amanhã as 11')
  })
})
