'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DollarSign, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// ============================================================
// Model prices and the dollar, for the platform admin.
//
// Both are global facts, and both go wrong in silence. A provider
// reprices and the projection keeps quoting the old figure with total
// confidence; the dollar moves and a rate typed three months ago looks
// exactly as authoritative as one fetched this morning.
//
// So the age of the rate is on screen, always. That is the whole point
// of storing `fetched_at` and `source` — the same principle as showing
// the token estimate beside its measured correction: give the number
// and give the reason to doubt it.
// ============================================================

interface Price {
  model_prefix: string;
  provider: string;
  input_usd: string | number;
  output_usd: string | number;
  updated_at: string;
}

interface Rate {
  currency: string;
  rate: number;
  source: 'manual' | 'auto';
  fetchedAt: string;
  ageDays: number;
}

export function PricingPanel() {
  const [prices, setPrices] = useState<Price[]>([]);
  const [rate, setRate] = useState<Rate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [manualRate, setManualRate] = useState('');
  const [edits, setEdits] = useState<Record<string, { input: string; output: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/pricing');
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? 'Não foi possível carregar os preços.');
        return;
      }
      setPrices((data.prices ?? []) as Price[]);
      setRate((data.rate ?? null) as Rate | null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePrice(price: Price) {
    const edit = edits[price.model_prefix];
    if (!edit) return;
    setBusy(price.model_prefix);
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_prefix: price.model_prefix,
          input_usd: Number(edit.input),
          output_usd: Number(edit.output),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Não foi possível salvar.');
        return;
      }
      toast.success(`${price.model_prefix} atualizado.`);
      setEdits((e) => {
        const next = { ...e };
        delete next[price.model_prefix];
        return next;
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function refreshRate() {
    setBusy('rate');
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh_rate' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Não foi possível buscar a cotação.');
        return;
      }
      setRate(data.rate as Rate);
      toast.success('Cotação atualizada.');
    } finally {
      setBusy(null);
    }
  }

  async function saveManualRate() {
    const value = Number(manualRate.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy('rate');
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usd_rate: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Não foi possível salvar.');
        return;
      }
      setRate(data.rate as Rate);
      setManualRate('');
      toast.success('Cotação salva.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando preços…
      </div>
    );
  }

  // Past a week the figure is decorative. Named rather than left to the
  // reader's arithmetic on a date.
  const stale = rate ? rate.ageDays >= 7 : true;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4 text-primary" />
            Cotação do dólar
          </CardTitle>
          <CardDescription>
            Usada só para mostrar uma aproximação em reais nas telas de custo. Os
            provedores cobram em dólar no cartão, com IOF e spread do emissor por
            cima — o valor em real serve para ter noção de grandeza, não para
            conferir fatura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rate ? (
            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
                stale
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-border bg-muted/30',
              )}
            >
              <div>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  R$ {rate.rate.toFixed(4)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {rate.source === 'auto' ? 'Buscado automaticamente' : 'Definido à mão'}
                  {' · '}
                  {rate.ageDays === 0
                    ? 'atualizado hoje'
                    : `atualizado há ${rate.ageDays} ${rate.ageDays === 1 ? 'dia' : 'dias'}`}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshRate}
                disabled={busy === 'rate'}
              >
                {busy === 'rate' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Buscar agora
              </Button>
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              Nenhuma cotação definida. Enquanto não houver, as telas mostram
              apenas dólar — preferimos não inventar um câmbio.
            </p>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="fx-manual">
                Definir à mão (R$ por US$ 1)
              </label>
              <Input
                id="fx-manual"
                inputMode="decimal"
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
                placeholder="5,42"
              />
            </div>
            <Button
              variant="outline"
              onClick={saveManualRate}
              disabled={busy === 'rate' || !manualRate.trim()}
            >
              Salvar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Um valor definido à mão vale até a próxima busca automática. É
            correção, não trava.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preço dos modelos</CardTitle>
          <CardDescription>
            Dólares por 1 milhão de tokens, como os provedores publicam. Vale para
            todas as contas — quando um provedor reajusta, é aqui que se corrige.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {prices.map((price) => {
            const edit = edits[price.model_prefix] ?? {
              input: String(price.input_usd),
              output: String(price.output_usd),
            };
            const dirty =
              Number(edit.input) !== Number(price.input_usd) ||
              Number(edit.output) !== Number(price.output_usd);

            return (
              <div
                key={price.model_prefix}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span className="w-48 shrink-0 font-mono text-xs text-foreground">
                  {price.model_prefix}
                </span>
                <span className="text-[11px] text-muted-foreground">entrada</span>
                <Input
                  inputMode="decimal"
                  value={edit.input}
                  onChange={(e) =>
                    setEdits((s) => ({
                      ...s,
                      [price.model_prefix]: { ...edit, input: e.target.value },
                    }))
                  }
                  className="h-8 w-24"
                />
                <span className="text-[11px] text-muted-foreground">saída</span>
                <Input
                  inputMode="decimal"
                  value={edit.output}
                  onChange={(e) =>
                    setEdits((s) => ({
                      ...s,
                      [price.model_prefix]: { ...edit, output: e.target.value },
                    }))
                  }
                  className="h-8 w-24"
                />
                <Button
                  size="sm"
                  variant={dirty ? 'default' : 'ghost'}
                  disabled={!dirty || busy === price.model_prefix}
                  onClick={() => savePrice(price)}
                  className="ml-auto h-8"
                >
                  {busy === price.model_prefix && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Salvar
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
