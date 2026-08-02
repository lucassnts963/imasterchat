'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calculator, Loader2, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// ============================================================
// Where the money goes on one reply.
//
// A total says it is expensive. A breakdown says what to cut — and
// cutting is the only thing that lowers it, because every section here
// is re-sent on every single message, once per step of the agent loop.
//
// The estimate is labelled as one, loudly, and the measured average
// sits beside it once there is any. An operator who trusts a number
// this soft without knowing it is soft will be surprised by a bill.
// ============================================================

interface Section {
  key: string;
  chars: number;
  tokens: number;
}

interface Projection {
  configured: boolean;
  model?: string;
  sections?: Section[];
  promptTokens?: number;
  rawPromptTokens?: number;
  calibrationFactor?: number;
  completionTokens?: number;
  steps?: number;
  costPerReplyUsd?: number;
  messagesLast30Days?: number;
  projectedMonthlyUsd?: number;
  priceEstimated?: boolean;
  measured?: {
    calls: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;
  } | null;
}

const money = (usd: number) =>
  usd < 0.01 ? `US$ ${usd.toFixed(5)}` : `US$ ${usd.toFixed(2)}`;

export function AiCostProjection() {
  const t = useTranslations('Agents.costProjection');
  const [data, setData] = useState<Projection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/costs/projection');
        const json = await res.json().catch(() => null);
        if (!cancelled && json) setData(json as Projection);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  if (!data?.configured || !data.sections) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        {t('notConfigured')}
      </p>
    );
  }

  const total = data.promptTokens ?? 0;
  const factor = data.calibrationFactor ?? 1;
  // Whether the raw character estimate needed correcting, and by how
  // much. Shown rather than hidden: a number that silently corrects
  // itself is a number nobody can sanity-check.
  const corrected = Math.abs(factor - 1) > 0.02;
  const driftPct = Math.round((factor - 1) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('perReply')} value={money(data.costPerReplyUsd ?? 0)} />
          <Stat
            label={t('perMonth')}
            value={money(data.projectedMonthlyUsd ?? 0)}
            hint={t('basedOn', { count: data.messagesLast30Days ?? 0 })}
          />
          <Stat label={t('promptTokens')} value={String(total)} />
          <Stat
            label={t('steps')}
            value={String(data.steps ?? 1)}
            hint={t('stepsHint')}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t('breakdown')}
          </p>
          <div className="space-y-1.5">
            {data.sections.map((s) => {
              const share = total > 0 ? (s.tokens / total) * 100 : 0;
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-foreground">
                    {t(`sections.${s.key}`)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(share, 1)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {s.tokens} · {share.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('everyMessage')}</p>
        </div>

        <div
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            data.measured
              ? 'border-border bg-muted/40 text-muted-foreground'
              : 'border-amber-500/40 bg-amber-500/5 text-muted-foreground',
          )}
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div>
            <p>{t('estimateWarning')}</p>
            {data.measured ? (
              <p className="mt-1">
                {corrected
                  ? t('calibrated', {
                      calls: data.measured.calls,
                      raw: data.rawPromptTokens ?? 0,
                      drift: driftPct,
                    })
                  : t('calibratedMatch', { calls: data.measured.calls })}
              </p>
            ) : (
              <p className="mt-1">{t('noMeasurement')}</p>
            )}
            {data.priceEstimated && <p className="mt-1">{t('priceFallback')}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
