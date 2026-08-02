import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// O que estes testes protegem, em uma frase: um provedor fora do ar
// não pode virar duzentas mensagens no celular de quem está de
// plantão — e o gravador não pode transformar uma falha em duas.
// ============================================================

const sendTelegramAlert = vi.fn(async (text: string) => ({
  sent: true,
  length: text.length,
}))
const isTelegramConfigured = vi.fn(() => true)

vi.mock('./telegram', () => ({
  sendTelegramAlert: (text: string) => sendTelegramAlert(text),
  isTelegramConfigured: () => isTelegramConfigured(),
  esc: (v: unknown) => String(v ?? ''),
}))

/** Linhas que a janela de deduplicação deve encontrar. Vazio = nunca
 *  alertamos sobre isto ainda. */
let alertedRows: { id: string }[] = []
let inserted: Record<string, unknown>[] = []
/** Faz o INSERT falhar, para provar que o gravador engole. */
let insertFails = false

vi.mock('@/lib/admin/client', () => ({
  supabaseAdmin: () => makeDb(),
}))

function makeDb() {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'gte', 'limit', 'is', 'maybeSingle']) {
      q[m] = () => {
        if (m === 'maybeSingle') {
          return Promise.resolve({ data: { name: 'Ótica Teste' }, error: null })
        }
        return q
      }
    }
    // A query de deduplicação é awaited direto (sem .single()), então a
    // cadeia precisa ser thenable.
    ;(q as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve({ data: table === 'platform_events' ? alertedRows : [], error: null })

    q.insert = (row: Record<string, unknown>) => {
      inserted.push(row)
      return {
        select: () => ({
          single: () =>
            Promise.resolve(
              insertFails
                ? { data: null, error: new Error('insert boom') }
                : { data: { id: 'evt-1' }, error: null },
            ),
        }),
      }
    }
    return q
  }
  return { from: (table: string) => chain(table) }
}

// Importado depois dos mocks.
const { recordEvent } = await import('./events')

beforeEach(() => {
  alertedRows = []
  inserted = []
  insertFails = false
  sendTelegramAlert.mockClear()
  isTelegramConfigured.mockClear()
  isTelegramConfigured.mockReturnValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

/** O alerta sai em background (`void alert(...)`), então o teste
 *  precisa ceder o loop antes de olhar. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('recordEvent', () => {
  it('grava o evento e alerta quando é uma falha', async () => {
    await recordEvent({
      accountId: 'acc-1',
      source: 'ai',
      code: 'invalid_key',
      severity: 'critical',
      message: 'A chave foi rejeitada.',
    })
    await settle()

    expect(inserted).toHaveLength(1)
    expect(inserted[0].code).toBe('invalid_key')
    expect(inserted[0].kind).toBe('error')
    expect(sendTelegramAlert).toHaveBeenCalledTimes(1)
    expect(sendTelegramAlert.mock.calls.at(0)?.[0] ?? '').toContain('Ótica Teste')
  })

  it('marca alerted_at ANTES de o Telegram responder', async () => {
    // Se marcasse depois, duas falhas simultâneas veriam a janela
    // vazia e as duas alertariam — que é exatamente o caso que a
    // deduplicação existe para impedir.
    await recordEvent({
      accountId: 'acc-1',
      source: 'ai',
      code: 'invalid_key',
      message: 'x',
    })
    expect(inserted[0].alerted_at).toBeTruthy()
  })

  it('não alerta de novo dentro da janela do mesmo (conta, código)', async () => {
    alertedRows = [{ id: 'anterior' }]

    await recordEvent({
      accountId: 'acc-1',
      source: 'ai',
      code: 'invalid_key',
      message: 'a mesma falha, de novo',
    })
    await settle()

    // O evento continua sendo GRAVADO — a contagem é o que mostra o
    // tamanho do estrago. Só o aviso é que fica em silêncio.
    expect(inserted).toHaveLength(1)
    expect(inserted[0].alerted_at).toBeNull()
    expect(sendTelegramAlert).not.toHaveBeenCalled()
  })

  it('não interrompe ninguém por info nem por warning', async () => {
    await recordEvent({
      accountId: 'acc-1',
      source: 'ai',
      code: 'standing_down_for_automation',
      severity: 'info',
      message: 'automação ativa',
    })
    await recordEvent({
      accountId: 'acc-1',
      source: 'ai',
      code: 'account_rate_limited',
      severity: 'warning',
      message: 'estourou o limite do minuto',
    })
    await settle()

    expect(inserted).toHaveLength(2)
    expect(sendTelegramAlert).not.toHaveBeenCalled()
  })

  it('grava mesmo sem Telegram configurado', async () => {
    isTelegramConfigured.mockReturnValue(false)

    await recordEvent({
      accountId: 'acc-1',
      source: 'ai',
      code: 'invalid_key',
      message: 'x',
    })
    await settle()

    expect(inserted).toHaveLength(1)
    expect(inserted[0].alerted_at).toBeNull()
    expect(sendTelegramAlert).not.toHaveBeenCalled()
  })

  it('nunca lança, nem quando o próprio INSERT falha', async () => {
    // O contrato inteiro. Isto roda dentro de catch, no caminho de uma
    // falha que já aconteceu: lançar aqui derruba o handler que estava
    // tratando a primeira.
    insertFails = true

    await expect(
      recordEvent({
        accountId: 'acc-1',
        source: 'ai',
        code: 'invalid_key',
        message: 'x',
      }),
    ).resolves.toBeUndefined()
  })

  it('aceita evento sem conta', async () => {
    // Um webhook com phone_number_id desconhecido não pertence a
    // ninguém, e é justamente o que ninguém consegue diagnosticar hoje.
    await recordEvent({
      accountId: null,
      source: 'whatsapp',
      code: 'unknown_phone_number_id',
      severity: 'critical',
      message: 'número não mapeado',
    })
    await settle()

    expect(inserted[0].account_id).toBeNull()
    expect(sendTelegramAlert.mock.calls.at(0)?.[0] ?? '').toContain('sem conta')
  })

  it('corta mensagem gigante antes de gravar', async () => {
    await recordEvent({
      accountId: 'acc-1',
      source: 'ai',
      code: 'provider_error',
      message: 'x'.repeat(5000),
    })
    expect(String(inserted[0].message)).toHaveLength(2000)
  })
})
