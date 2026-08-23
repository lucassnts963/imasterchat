import { describe, it, expect } from 'vitest'

import { decideAudioAction, isAudioPolicy } from './policy'

// O comportamento anterior era silêncio total: o cliente mandava áudio
// e o bot não respondia, não transferia, não errava. Estes testes
// seguram cada saída dessa política.

describe('decideAudioAction', () => {
  it('ignore não faz nada — é o comportamento anterior, preservado', () => {
    expect(decideAudioAction({ policy: 'ignore' })).toEqual({ action: 'none' })
  })

  it('notice responde pedindo texto', () => {
    expect(decideAudioAction({ policy: 'notice' })).toEqual({
      action: 'notice',
    })
  })

  it('handoff passa para uma pessoa', () => {
    expect(decideAudioAction({ policy: 'handoff' })).toEqual({
      action: 'handoff',
    })
  })

  it('transcribe segue como texto quando deu certo', () => {
    expect(
      decideAudioAction({
        policy: 'transcribe',
        transcript: '  quero marcar uma demonstração  ',
      }),
    ).toEqual({ action: 'text', text: 'quero marcar uma demonstração' })
  })

  it('transcrição que falhou vira AVISO, não silêncio', () => {
    // A regra que mais importa. Quem escolheu transcrever disse que quer
    // atender quem manda áudio; devolver nada porque o Whisper engasgou
    // entrega de volta o problema que a configuração existia para
    // resolver.
    expect(decideAudioAction({ policy: 'transcribe', transcript: null })).toEqual(
      { action: 'notice' },
    )
  })

  it('transcrição vazia conta como falha', () => {
    // Áudio de meio segundo, ou só ruído: o provedor devolve string
    // vazia com status 200. Seguir com texto vazio faria o agente
    // responder ao nada.
    expect(decideAudioAction({ policy: 'transcribe', transcript: '   ' })).toEqual(
      { action: 'notice' },
    )
  })
})

describe('isAudioPolicy', () => {
  it('aceita as quatro', () => {
    for (const p of ['ignore', 'notice', 'transcribe', 'handoff']) {
      expect(isAudioPolicy(p)).toBe(true)
    }
  })

  it('recusa o resto', () => {
    expect(isAudioPolicy('transcrever')).toBe(false)
    expect(isAudioPolicy(null)).toBe(false)
  })
})
