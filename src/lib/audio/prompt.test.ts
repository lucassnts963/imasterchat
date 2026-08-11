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

describe('vocabulário do ramo', () => {
  it('entra por último, depois da base e do termo', () => {
    // O que o modelo lê por último pesa mais na primeira palavra que ele
    // decodifica — e o jargão é o mais específico dos três.
    const out = buildTranscriptionPrompt({
      appointmentLabel: 'demonstração',
      vocabulary: 'autonomia, pedal assistido, bateria de lítio',
    })
    expect(out.indexOf('demonstração')).toBeLessThan(
      out.indexOf('pedal assistido'),
    )
    expect(out).toContain('Termos deste negócio:')
  })

  it('normaliza quebras de linha', () => {
    // A pessoa escreve numa textarea e usa Enter. O `initial_prompt` é
    // um parâmetro de query — quebra de linha ali só gasta espaço.
    expect(
      buildTranscriptionPrompt({ vocabulary: 'armação\n\n  lente' }),
    ).toContain('armação lente')
  })

  it('corta em 500 para não empurrar a fala para fora da janela', () => {
    const out = buildTranscriptionPrompt({ vocabulary: 'x'.repeat(900) })
    expect(out).toContain('x'.repeat(500))
    expect(out).not.toContain('x'.repeat(501))
  })

  it('vazio não acrescenta seção nenhuma', () => {
    expect(buildTranscriptionPrompt({ vocabulary: '  ' })).toBe(
      buildTranscriptionPrompt(),
    )
  })
})
