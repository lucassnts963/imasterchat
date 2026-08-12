import { describe, expect, it } from 'vitest'

import { splitWebhookBody } from './inbound-queue'

// ============================================================
// A chave de idempotência.
//
// Errar aqui não dá erro em lugar nenhum: dá mensagem duplicada na
// conversa do cliente, ou status que para de avançar. Por isso os casos
// abaixo são os três que a documentação da Meta e a migração 009
// descrevem, e não exemplos inventados.
// ============================================================

function body(value: Record<string, unknown>) {
  return { entry: [{ id: 'waba', changes: [{ field: 'messages', value }] }] }
}

const META = { display_phone_number: '55...', phone_number_id: 'PN1' }

describe('splitWebhookBody', () => {
  it('quebra um lote em um evento por mensagem', () => {
    const rows = splitWebhookBody(
      body({
        metadata: META,
        contacts: [{ wa_id: '551', profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.A' }, { id: 'wamid.B' }],
      }),
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.dedupe_key)).toEqual(['msg:wamid.A', 'msg:wamid.B'])
  })

  it('leva os contatos junto em cada linha', () => {
    // O processador casa `messages[i].from` com `contacts[]` para achar o
    // nome do perfil. Separar os dois faria todo contato novo nascer sem
    // nome — e só apareceria em produção.
    const rows = splitWebhookBody(
      body({
        metadata: META,
        contacts: [{ wa_id: '551', profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.A' }, { id: 'wamid.B' }],
      }),
    )
    for (const r of rows) {
      expect((r.payload as { contacts: unknown[] }).contacts).toHaveLength(1)
      expect((r.payload as { messages: unknown[] }).messages).toHaveLength(1)
    }
  })

  it('NÃO colapsa os status de uma mesma mensagem', () => {
    // sent → delivered → read chegam com o MESMO id. Se a chave fosse só
    // o wamid, os dois últimos seriam descartados como duplicata e a
    // mensagem ficaria eternamente "enviada" na tela.
    const rows = splitWebhookBody(
      body({
        metadata: META,
        statuses: [
          { id: 'wamid.A', status: 'sent' },
          { id: 'wamid.A', status: 'delivered' },
          { id: 'wamid.A', status: 'read' },
        ],
      }),
    )
    expect(new Set(rows.map((r) => r.dedupe_key)).size).toBe(3)
  })

  it('usa o phone_number_id como metade da chave', () => {
    // Migração 009: os ids da Meta NÃO são únicos entre números. Uma
    // chave global rejeitaria mensagem legítima do segundo cliente.
    const a = splitWebhookBody(
      body({ metadata: META, messages: [{ id: 'wamid.X' }] }),
    )
    const b = splitWebhookBody(
      body({
        metadata: { ...META, phone_number_id: 'PN2' },
        messages: [{ id: 'wamid.X' }],
      }),
    )
    expect(a[0]!.dedupe_key).toBe(b[0]!.dedupe_key)
    expect(a[0]!.phone_number_id).not.toBe(b[0]!.phone_number_id)
  })

  it('ignora o que não dá para identificar em vez de inventar chave', () => {
    // Evento de template chega por WABA, sem phone_number_id. Sem a
    // primeira metade da chave, enfileirar seria fabricar uma — ele
    // segue pelo caminho direto de sempre.
    expect(splitWebhookBody(body({ messages: [{ id: 'wamid.A' }] }))).toEqual([])
    expect(
      splitWebhookBody(body({ metadata: META, messages: [{ noId: true }] })),
    ).toEqual([])
    expect(splitWebhookBody({})).toEqual([])
    expect(splitWebhookBody(null)).toEqual([])
  })

  it('aguenta mensagens e status no mesmo change', () => {
    const rows = splitWebhookBody(
      body({
        metadata: META,
        messages: [{ id: 'wamid.A' }],
        statuses: [{ id: 'wamid.Z', status: 'delivered' }],
      }),
    )
    expect(rows.map((r) => r.kind)).toEqual(['messages', 'statuses'])
    // A linha de status não pode carregar a mensagem junto: o
    // processador entraria no ramo de mensagem e gravaria de novo.
    expect(
      (rows[1]!.payload as { messages?: unknown }).messages,
    ).toBeUndefined()
  })
})
