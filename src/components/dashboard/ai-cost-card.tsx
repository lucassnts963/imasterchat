'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Bot } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/dashboard/skeleton'

interface CostsResponse {
  configured: boolean
  truncated?: boolean
  estimated?: boolean
  month_spend_usd?: number
  budget_usd?: number | null
  by_model?: { model: string; provider: string; cost_usd: number; tokens: number }[]
}

/** Warning starts here — the "balance is running out" signal. */
const WARN_RATIO = 0.8
/** Critical (red) from here on. */
const CRITICAL_RATIO = 0.95

// Spend is in USD regardless of the account currency — that's what
// OpenAI/Anthropic bill the BYO key in. Two decimals because AI spend
// lives in cents, unlike deal values.
function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Dashboard card: month-to-date estimated AI API spend vs the optional
 * monthly budget (Agentes de IA → Configurar). Admin-only — spend is
 * billing-class, mirroring GET /api/ai/costs. Hidden entirely when AI
 * isn't configured, so non-AI installs never see an empty card.
 */
export function AiCostCard() {
  const t = useTranslations('Dashboard.aiCost')
  const { accountId, accountRole, profileLoading } = useAuth()
  const canView = accountRole ? canEditSettings(accountRole) : false

  const [data, setData] = useState<CostsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!canView || !accountId) return
    if (loadedRef.current === accountId) return
    loadedRef.current = accountId
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/ai/costs', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        setData(res.ok ? (json as CostsResponse) : null)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [canView, accountId])

  if (profileLoading || !canView) return null
  if (!loading && !data?.configured) return null

  if (loading || !data) {
    return <Skeleton className="h-[92px] w-full rounded-xl" />
  }

  const spend = data.month_spend_usd ?? 0
  const budget = data.budget_usd ?? null
  const ratio = budget ? spend / budget : null
  const critical = ratio !== null && ratio >= CRITICAL_RATIO
  const warning = ratio !== null && ratio >= WARN_RATIO

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-5',
        critical
          ? 'border-red-500/50'
          : warning
            ? 'border-amber-500/50'
            : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Bot className="h-4 w-4" />
            {t('title')}
            {data.estimated && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide">
                {t('estimatedBadge')}
              </span>
            )}
          </p>
          <p className="mt-2 text-[28px] leading-none font-bold tabular-nums text-foreground">
            {formatUsd(spend)}
            {budget !== null && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {t('ofBudget', { budget: formatUsd(budget) })}
              </span>
            )}
          </p>
        </div>
        <Link
          href="/agents"
          className="text-sm text-primary hover:text-primary/80"
        >
          {t('manage')}
        </Link>
      </div>

      {budget !== null && ratio !== null ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                critical
                  ? 'bg-red-500'
                  : warning
                    ? 'bg-amber-500'
                    : 'bg-primary',
              )}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          {ratio >= 1 ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4" />
              {t('overBudget')}
            </p>
          ) : warning ? (
            <p
              className={cn(
                'mt-2 flex items-center gap-1.5 text-sm',
                critical ? 'text-red-400' : 'text-amber-400',
              )}
            >
              <AlertTriangle className="h-4 w-4" />
              {t('nearBudget', { pct: Math.round(ratio * 100) })}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('usedOfBudget', { pct: Math.round(ratio * 100) })}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('noBudget')}</p>
      )}
    </div>
  )
}
