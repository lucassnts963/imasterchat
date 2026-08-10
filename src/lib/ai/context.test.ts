import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().not().order().limit() → { data, error }.
 *
 *  O `.not()` entrou quando o filtro deixou de ser por tipo e passou a
 *  ser "tem texto" — sem ele o áudio transcrito ficava de fora. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })
})

describe('áudio transcrito no contexto', () => {
  it('entra na conversa, marcado como falado', async () => {
    // O bug real: a transcrição era gravada em `content_text` e o
    // contexto a excluía por filtrar `content_type = 'text'`. O modelo
    // recebia a conversa sem ela e cumprimentava quem tinha acabado de
    // pedir um agendamento.
    const rows = [
      {
        sender_type: 'customer',
        content_type: 'audio',
        content_text: 'quero uma demonstração',
      },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: '[transcrição de áudio] quero uma demonstração' },
    ])
  })

  it('texto digitado NÃO leva marca', async () => {
    // A marca existe para o modelo desconfiar de palavra solta. Pôr em
    // texto digitado seria ruído pago em token toda resposta.
    const rows = [
      { sender_type: 'customer', content_type: 'text', content_text: 'oi' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([{ role: 'user', content: 'oi' }])
  })

  it('legenda de imagem entra, e sem marca — foi digitada', async () => {
    const rows = [
      {
        sender_type: 'customer',
        content_type: 'image',
        content_text: 'esse é o modelo que eu quero',
      },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'esse é o modelo que eu quero' },
    ])
  })
})
