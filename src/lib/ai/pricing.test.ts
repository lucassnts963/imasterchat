import { describe, expect, it } from 'vitest'
import { estimateCostUsd } from './pricing'

describe('estimateCostUsd', () => {
  it('prices a known model from the table', () => {
    // gpt-4o-mini: $0.15/M in, $0.60/M out
    const { usd, fallback } = estimateCostUsd('gpt-4o-mini', 1_000_000, 1_000_000)
    expect(usd).toBeCloseTo(0.75)
    expect(fallback).toBe(false)
  })

  it('matches the longest prefix (gpt-4o-mini-2024-07-18 is not gpt-4o)', () => {
    const mini = estimateCostUsd('gpt-4o-mini-2024-07-18', 1_000_000, 0)
    expect(mini.usd).toBeCloseTo(0.15)
    expect(mini.fallback).toBe(false)
  })

  it('strips nothing from dated Anthropic ids', () => {
    const { usd, fallback } = estimateCostUsd('claude-haiku-4-5-20251001', 1_000_000, 0)
    expect(usd).toBeCloseTo(1)
    expect(fallback).toBe(false)
  })

  it('falls back to the cheap tier for unknown small models', () => {
    const { usd, fallback } = estimateCostUsd('gpt-9.9-mini', 1_000_000, 1_000_000)
    expect(fallback).toBe(true)
    expect(usd).toBeCloseTo(2.5) // 0.5 + 2
  })

  it('falls back to the standard tier for unknown large models', () => {
    const { usd, fallback } = estimateCostUsd('some-future-frontier-model', 1_000_000, 1_000_000)
    expect(fallback).toBe(true)
    expect(usd).toBeCloseTo(18) // 3 + 15
  })

  it('never returns a negative cost', () => {
    expect(estimateCostUsd('gpt-4o', -100, -100).usd).toBe(0)
  })
})
