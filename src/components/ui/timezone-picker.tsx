'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ============================================================
// Timezone picker.
//
// The list comes from `Intl.supportedValuesOf('timeZone')` rather than a
// hardcoded table, so it is exactly the set this runtime can format —
// which is the set the server validates against and the set the slot
// maths will actually resolve. A curated list would drift from all three.
//
// Each row shows the current UTC offset, because "America/Sao_Paulo" and
// "America/Fortaleza" are indistinguishable to someone who just wants
// the right clock, and the offset is what tells them apart.
// ============================================================

interface Zone {
  id: string
  /** `-03:00` right now — recomputed per render batch, not cached at
   *  module load, so a DST change does not leave stale labels. */
  offset: string
  /** Lowercased haystack for the filter. */
  search: string
}

/** Enough to keep the picker usable if the runtime lacks the API. */
const FALLBACK_ZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Belem',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/New_York',
  'Europe/Lisbon',
  'Europe/London',
  'UTC',
];

function offsetLabel(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(now);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    // `GMT-03:00` → `UTC-03:00`; bare `GMT` (zero offset) → `UTC+00:00`.
    if (name === 'GMT') return 'UTC+00:00';
    return name.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

function listZones(): string[] {
  try {
    const supported = Intl.supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) return [...supported];
  } catch {
    // Older runtime — fall through.
  }
  return FALLBACK_ZONES;
}

export function TimezonePicker({
  value,
  onChange,
  disabled,
  id,
  placeholder,
  searchPlaceholder,
  emptyLabel,
}: {
  value: string;
  onChange: (timezone: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const zones: Zone[] = useMemo(() => {
    const now = new Date();
    return listZones().map((id) => {
      const offset = offsetLabel(id, now);
      return {
        id,
        offset,
        // Match on the city too: someone types "sao paulo", not
        // "America/Sao_Paulo".
        search: `${id} ${id.replace(/[_/]/g, ' ')} ${offset}`.toLowerCase(),
      };
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    const terms = q.split(/\s+/);
    return zones.filter((z) => terms.every((t) => z.search.includes(t)));
  }, [zones, query]);

  // The search field is the whole point of opening this; focusing it
  // saves a click and makes keyboard use work without a roving index.
  // Clearing the query belongs to the close handler, not here — resetting
  // state from an effect makes the render that opened the popover
  // immediately schedule another one.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const currentOffset = value ? offsetLabel(value, new Date()) : '';

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
            <span className="truncate">
              {value ? value.replace(/_/g, ' ') : placeholder}
              {currentOffset && (
                <span className="ml-2 text-muted-foreground">{currentOffset}</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            filtered.map((zone) => (
              <button
                key={zone.id}
                type="button"
                onClick={() => {
                  onChange(zone.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted',
                  zone.id === value ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <Check
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    zone.id === value ? 'opacity-100 text-primary' : 'opacity-0',
                  )}
                />
                <span className="truncate">{zone.id.replace(/_/g, ' ')}</span>
                <span className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">
                  {zone.offset}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
