import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseMessagePricing, recordMessageCost } from './message-cost'

const status = (pricing?: unknown) => ({
  id: 'wamid.X',
  status: 'sent',
  timestamp: '1756000000',
  recipient_id: '5511999999999',
  ...(pricing === undefined ? {} : { pricing }),
})

describe('parseMessagePricing', () => {
  it('reads the block Meta sends today', () => {
    expect(
      parseMessagePricing(
        status({
          billable: false,
          pricing_model: 'PMP',
          type: 'free_customer_service',
          category: 'utility',
        }),
      ),
    ).toEqual({
      billable: false,
      pricingModel: 'PMP',
      type: 'free_customer_service',
      category: 'utility',
    })
  })

  it('reads a billable service message — the shape October brings', () => {
    expect(
      parseMessagePricing(
        status({
          billable: true,
          pricing_model: 'PMP',
          type: 'regular',
          category: 'service',
        }),
      ),
    ).toMatchObject({ billable: true, type: 'regular', category: 'service' })
  })

  it('keeps free_entry_point distinguishable — it is the 72h ad window', () => {
    const out = parseMessagePricing(
      status({ billable: false, type: 'free_entry_point', category: 'service' }),
    )
    expect(out?.type).toBe('free_entry_point')
  })

  // The distinction this whole feature rests on: absent pricing must not
  // read as free, or the forecast is zero exactly when it matters.
  it('returns null when there is no pricing block at all', () => {
    expect(parseMessagePricing(status())).toBeNull()
  })

  it('returns null when billable is missing rather than assuming one', () => {
    expect(parseMessagePricing(status({ pricing_model: 'PMP' }))).toBeNull()
    expect(parseMessagePricing(status({ billable: 'yes' }))).toBeNull()
  })

  it('tolerates a partial block', () => {
    expect(parseMessagePricing(status({ billable: true }))).toEqual({
      billable: true,
      pricingModel: null,
      type: null,
      category: null,
    })
  })

  it.each([null, undefined, 'nope', 42])('ignores a %s status', (bad) => {
    expect(parseMessagePricing(bad)).toBeNull()
  })
})

describe('recordMessageCost', () => {
  function db() {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    return { client: { from: vi.fn(() => ({ upsert })) }, upsert }
  }

  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => {
    delete process.env.WHATSAPP_LOG_PRICING
  })

  it('stores Meta’s determination, de-duplicated per account+message', async () => {
    const { client, upsert } = db()
    await recordMessageCost(client as never, {
      accountId: 'acct-1',
      messageId: 'wamid.X',
      pricing: {
        billable: true,
        pricingModel: 'PMP',
        type: 'regular',
        category: 'service',
      },
    })

    const [row, opts] = upsert.mock.calls[0]
    expect(row).toMatchObject({
      account_id: 'acct-1',
      message_id: 'wamid.X',
      billable: true,
      pricing_category: 'service',
    })
    // Pricing can ride on sent AND delivered; counting twice would
    // inflate the one number this table exists to get right.
    expect(opts).toMatchObject({
      onConflict: 'account_id,message_id',
      ignoreDuplicates: true,
    })
  })

  it('warns on a category Meta has not documented, but still stores it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, upsert } = db()

    await recordMessageCost(client as never, {
      accountId: 'acct-1',
      messageId: 'wamid.Y',
      pricing: { billable: true, pricingModel: 'PMP', type: 'regular', category: 'newthing' },
    })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('newthing'))
    // Storing it anyway is the point: a CHECK here would have turned a
    // new Meta category into a dropped delivery receipt.
    expect(upsert).toHaveBeenCalled()
  })

  it('never throws when the write fails — it rides the receipt path', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const client = { from: vi.fn(() => ({ upsert })) }

    await expect(
      recordMessageCost(client as never, {
        accountId: 'acct-1',
        messageId: 'wamid.Z',
        pricing: { billable: true, pricingModel: null, type: null, category: null },
      }),
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })

  it('logs no phone number when the verification hatch is on', async () => {
    process.env.WHATSAPP_LOG_PRICING = 'true'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { client } = db()

    await recordMessageCost(client as never, {
      accountId: 'acct-1',
      messageId: 'wamid.X',
      pricing: { billable: true, pricingModel: 'PMP', type: 'regular', category: 'service' },
    })

    const logged = log.mock.calls.flat().join(' ')
    expect(logged).toContain('service')
    expect(logged).not.toContain('5511')
  })
})
