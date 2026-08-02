'use client';

import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, CircleMinus, Loader2, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

// ============================================================
// A faixa que responde "quem está quebrado agora", antes da linha do
// tempo.
//
// Fica acima dos eventos de propósito: a lista de eventos é história —
// bom para entender o que houve — e num dia ruim a primeira pergunta
// não é "o que aconteceu", é "está quebrado AGORA e em qual cliente".
//
// Só mostra o que está falhando. Uma faixa que lista dez linhas verdes
// é uma faixa que ninguém lê, e o vermelho no meio delas desaparece.
// ============================================================

interface Check {
  account_id: string | null;
  check_name: string;
  status: 'ok' | 'failing' | 'skipped';
  code: string | null;
  detail: string | null;
  checked_at: string;
  failing_since: string | null;
}

interface Cron {
  status: 'ok' | 'failing';
  code?: string;
  detail: string | null;
  checked_at: string | null;
}

const LABEL: Record<string, string> = {
  ai_credentials: 'Chave da IA',
  whatsapp_token: 'Token do WhatsApp',
  google_calendar: 'Google Agenda',
  migrations: 'Migrações do banco',
};

function since(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `há ${mins}min`;
  if (mins < 60 * 24) return `há ${Math.round(mins / 60)}h`;
  return `há ${Math.round(mins / 1440)} dia(s)`;
}

export function HealthStrip() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [cron, setCron] = useState<Cron | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/health');
      if (!res.ok) return;
      const data = await res.json();
      setChecks(data.checks ?? []);
      setNames(data.accountNames ?? {});
      setCron(data.cron ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando…
      </p>
    );
  }

  const failing = checks.filter((c) => c.status === 'failing');
  const cronBroken = cron?.status === 'failing';
  const skipped = checks.filter((c) => c.status === 'skipped').length;
  const ok = checks.filter((c) => c.status === 'ok').length;

  return (
    <div className="space-y-2">
      {cronBroken && (
        <Row
          tone="failing"
          title="A ronda de verificação"
          detail={cron?.detail ?? ''}
        />
      )}

      {failing.map((c) => (
        <Row
          key={`${c.account_id}-${c.check_name}`}
          tone="failing"
          title={`${LABEL[c.check_name] ?? c.check_name}${
            c.account_id
              ? ` · ${names[c.account_id] ?? c.account_id.slice(0, 8)}`
              : ''
          }`}
          detail={`${c.detail ?? c.code ?? 'falhou'}${
            c.failing_since ? ` — ${since(c.failing_since)}` : ''
          }`}
        />
      ))}

      {!cronBroken && failing.length === 0 && (
        <Row
          tone="ok"
          title="Nenhuma dependência falhando"
          detail={
            ok + skipped === 0
              ? 'Mas nada foi verificado ainda — a primeira ronda não rodou.'
              : `${ok} verificação(ões) ok, ${skipped} não se aplica(m). Última ronda ${since(cron?.checked_at ?? null)}.`
          }
        />
      )}
    </div>
  );
}

function Row({
  tone,
  title,
  detail,
}: {
  tone: 'ok' | 'failing' | 'skipped';
  title: string;
  detail: string;
}) {
  const Icon =
    tone === 'failing'
      ? TriangleAlert
      : tone === 'ok'
        ? CircleCheck
        : CircleMinus;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2',
        tone === 'failing'
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-border',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          tone === 'failing' ? 'text-destructive' : 'text-emerald-500',
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}
