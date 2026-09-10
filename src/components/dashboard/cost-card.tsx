'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Bot, MessageSquare } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/dashboard/skeleton'

// ============================================================
// Os DOIS custos, num card só — fase 3, R-15.
//
// A partir de 1º/10/2026 uma conversa custa em duas moedas: tokens do
// provedor de IA e mensagens da Meta. Antes desta fase o painel mostrava
// só a primeira, e o operador olhava um número sob controle enquanto a
// fatura da outra crescia sem ninguém ver.
//
// Dois cards distantes não resolveriam: o que importa é a SOMA, e a soma
// só existe se as duas estiverem no mesmo lugar.
// ============================================================

interface AiCostsResponse {
  configured: boolean
  estimated?: boolean
  month_spend_usd?: number
  budget_usd?: number | null
}

interface Bucket {
  key: string
  count: number
  billed_usd: number
  forecast_usd: number
}

interface WhatsappCostsResponse {
  count: number
  billed_usd: number
  forecast_usd: number
  free_entry_point_count: number
  by_origin: Bucket[]
  budget_usd: number | null
  blocked_count: number
  using_fallback_prices: boolean
}

/** Warning starts here — the "balance is running out" signal. */
const WARN_RATIO = 0.8
/** Critical (red) from here on. */
const CRITICAL_RATIO = 0.95

// Ambos os gastos são em dólares, independentemente da moeda da conta:
// é o que o provedor de IA cobra na chave BYO e o que a Meta cobra por
// mensagem. Quatro casas na linha de mensagem porque uma mensagem custa
// menos de um centavo, e arredondar para dois esconderia o número.
function usd(value: number, digits = 2): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function CostCard() {
  const t = useTranslations('Dashboard.cost')
  const { accountId, accountRole, profileLoading } = useAuth()
  const canView = accountRole ? canEditSettings(accountRole) : false

  const [ai, setAi] = useState<AiCostsResponse | null>(null)
  const [wa, setWa] = useState<WhatsappCostsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!canView || !accountId) return
    if (loadedRef.current === accountId) return
    loadedRef.current = accountId
    void (async () => {
      setLoading(true)
      // Em paralelo, e cada uma falha por conta própria: uma conta sem
      // IA configurada ainda precisa ver o custo de mensagem.
      const [aiRes, waRes] = await Promise.allSettled([
        fetch('/api/ai/costs', { cache: 'no-store' }),
        fetch('/api/whatsapp/costs', { cache: 'no-store' }),
      ])
      setAi(await readJson<AiCostsResponse>(aiRes))
      setWa(await readJson<WhatsappCostsResponse>(waRes))
      setLoading(false)
    })()
  }, [canView, accountId])

  if (profileLoading || !canView) return null
  if (loading) return <Skeleton className="h-[168px] w-full rounded-xl" />

  const aiSpend = ai?.configured ? (ai.month_spend_usd ?? 0) : 0
  const waSpend = wa?.billed_usd ?? 0
  const total = aiSpend + waSpend

  // Nada configurado e nada enviado: esconder o card inteiro, para uma
  // instalação nova não olhar zeros que não significam nada.
  if (!ai?.configured && !wa) return null

  const aiBudget = ai?.budget_usd ?? null
  const waBudget = wa?.budget_usd ?? null
  const worst = Math.max(ratioOf(aiSpend, aiBudget), ratioOf(waSpend, waBudget))
  const critical = worst >= CRITICAL_RATIO
  const warning = worst >= WARN_RATIO

  // A previsão só interessa enquanto ela for MAIOR que o cobrado — isto
  // é, enquanto ainda houver mensagem grátis que vai deixar de ser.
  const forecastGap = (wa?.forecast_usd ?? 0) - waSpend
  const topOrigins = (wa?.by_origin ?? []).slice(0, 3)

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
          <p className="text-sm font-medium text-muted-foreground">{t('title')}</p>
          <p className="mt-2 text-[28px] leading-none font-bold tabular-nums text-foreground">
            {usd(total)}
          </p>
        </div>
        <Link href="/agents" className="text-sm text-primary hover:text-primary/80">
          {t('manage')}
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Line
          icon={<Bot className="h-4 w-4" />}
          label={t('ai')}
          value={usd(aiSpend)}
          spend={aiSpend}
          budget={aiBudget}
          t={t}
        />
        <Line
          icon={<MessageSquare className="h-4 w-4" />}
          label={t('whatsapp', { count: wa?.count ?? 0 })}
          value={usd(waSpend, 4)}
          spend={waSpend}
          budget={waBudget}
          t={t}
        />
      </div>

      {forecastGap > 0 && (
        <p className="mt-3 text-sm text-amber-400">
          {t('forecast', { value: usd(wa?.forecast_usd ?? 0, 2) })}
        </p>
      )}

      {topOrigins.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('byOrigin')}{' '}
          {topOrigins
            .map((o) => `${t(`origins.${o.key}`)} ${usd(o.forecast_usd, 2)}`)
            .join(' · ')}
        </p>
      )}

      {(wa?.blocked_count ?? 0) > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4" />
          {t('blocked', { count: wa?.blocked_count ?? 0 })}
        </p>
      )}

      {wa?.using_fallback_prices && (
        <p className="mt-2 text-[11px] text-muted-foreground">{t('fallbackPrices')}</p>
      )}
    </div>
  )
}

function Line({
  icon,
  label,
  value,
  spend,
  budget,
  t,
}: {
  icon: React.ReactNode
  label: string
  value: string
  spend: number
  budget: number | null
  t: ReturnType<typeof useTranslations>
}) {
  const ratio = ratioOf(spend, budget)
  return (
    <div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
        {budget !== null && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {t('ofBudget', { budget: formatBudget(budget) })}
          </span>
        )}
      </p>
      {budget !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              ratio >= CRITICAL_RATIO
                ? 'bg-red-500'
                : ratio >= WARN_RATIO
                  ? 'bg-amber-500'
                  : 'bg-primary',
            )}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

function formatBudget(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function ratioOf(spend: number, budget: number | null): number {
  return budget && budget > 0 ? spend / budget : 0
}

async function readJson<T>(
  settled: PromiseSettledResult<Response>,
): Promise<T | null> {
  if (settled.status !== 'fulfilled' || !settled.value.ok) return null
  return (await settled.value.json().catch(() => null)) as T | null
}
