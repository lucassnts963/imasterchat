'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { knownModels } from '@/lib/ai/pricing';
import type { AiProvider } from '@/lib/ai/types';

// ============================================================
// Model picker.
//
// The field was free text, which asked the operator to know that the
// id is "gpt-5-mini" and not "GPT 5 mini", and answered a typo with a
// provider error hours later when a customer was waiting.
//
// The list comes from the price table, not a second hardcoded list: a
// model offered here but missing there would be priced by class
// fallback, and the operator would be choosing something whose cost we
// then only guess at. Showing the price beside each one is the point —
// the difference between the cheapest and dearest here is 300×, and
// that is the single biggest lever on the bill.
//
// It stays a SUGGESTION, never an allow-list. Model ids churn fast and
// a forker must be able to type one this table has never heard of, so
// whatever is typed in the search box can be used as-is.
// ============================================================

export function ModelPicker({
  provider,
  value,
  onChange,
  disabled,
  id,
  searchPlaceholder,
  customLabel,
  priceLabel,
}: {
  provider: AiProvider;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  id?: string;
  searchPlaceholder: string;
  /** "Use «{model}»" — the escape hatch for an id we do not know. */
  customLabel: (model: string) => string;
  /** "US$ {input} / {output} per 1M" */
  priceLabel: (input: number, output: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const models = useMemo(() => knownModels(provider), [provider]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q));
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const typed = query.trim();
  // Offer the typed value only when it is not already an exact option —
  // otherwise the list shows the same id twice.
  const showCustom =
    typed.length > 0 && !models.some((m) => m.id === typed) && typed !== value;

  const current = models.find((m) => m.id === value);

  function choose(model: string) {
    onChange(model);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate font-mono text-xs">{value || '—'}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground outline-none"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => choose(m.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted',
                m.id === value ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  m.id === value ? 'text-primary opacity-100' : 'opacity-0',
                )}
              />
              <span className="truncate font-mono text-xs">{m.id}</span>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {priceLabel(m.price.input, m.price.output)}
              </span>
            </button>
          ))}

          {showCustom && (
            <button
              type="button"
              onClick={() => choose(typed)}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-muted-foreground hover:bg-muted"
            >
              <Check className="h-3.5 w-3.5 shrink-0 opacity-0" />
              <span className="truncate text-xs">{customLabel(typed)}</span>
            </button>
          )}

          {filtered.length === 0 && !showCustom && (
            <p className="px-3 py-2 text-xs text-muted-foreground">—</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** True when the model is not one this build knows a price for. The
 *  settings form uses it to warn that the cost figures will be a
 *  class-based guess. */
export function isUnknownModel(
  provider: AiProvider,
  model: string,
): boolean {
  return !knownModels(provider).some((m) => m.id === model.trim());
}
