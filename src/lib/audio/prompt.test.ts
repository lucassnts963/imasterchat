import { describe, it, expect } from 'vitest'

import { buildTranscriptionPrompt } from './prompt'

// Medido com áudio real de cliente, mesmo modelo e mesma máquina:
//   sem viés   "Você consegue reagir a andar para mim na quarta-feira?"
//   com viés   "Você consegue reagendar para mim na quarta-feira?"

describe('buildTranscriptionPrompt', () => {
  it('sempre carrega o vocabulário de agendamento', () => {
    const out = buildTranscriptionPrompt()
    expect(out).toContain('reagendar')
    expect(out).toContain('quarta-feira')
  })

  it('inclui o termo que a conta escolheu', () => {
    // "demonstração" e "administração" soam parecido, e trocá-las muda o
    // pedido inteiro — é a palavra que mais importa acertar.
    expect(
      buildTranscriptionPrompt({ appointmentLabel: 'demonstração' }),
    ).toContain('uma demonstração')
  })

  it('sem termo próprio, fica só a base', () => {
    expect(buildTranscriptionPrompt({ appointmentLabel: null })).toBe(
      buildTranscriptionPrompt(),
    )
    expect(buildTranscriptionPrompt({ appointmentLabel: '   ' })).toBe(
      buildTranscriptionPrompt(),
    )
  })
})
