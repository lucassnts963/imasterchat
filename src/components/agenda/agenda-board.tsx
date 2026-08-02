'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Hand,
  Loader2,
  MessageSquare,
  Plus,
  TriangleAlert,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  formatDateForDisplay,
  formatDateInZone,
  formatDayMonthForDisplay,
  formatTimeInZone,
  zonedParts,
} from '@/lib/time/zone';
import { NewAppointmentDialog } from './new-appointment-dialog';
import { AppointmentDetail } from './appointment-detail';

// ============================================================
// The agenda.
//
// A week of columns, each listing its bookings in order. Deliberately
// NOT an absolutely-positioned hour grid: a shop books a handful of
// slots a day, overlapping bookings are the exception the constraints
// already prevent, and a list reads better on a phone than a grid does.
//
// Cancelled bookings stay visible. They are what explains a gap in the
// day, which is the question someone opening this screen is usually
// asking.
// ============================================================

export interface AppointmentRow {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'completed' | 'no_show' | 'cancelled';
  title: string | null;
  notes: string | null;
  google_event_id: string | null;
  created_via: string;
  cancellation_reason: string | null;
  contacts?: { name: string | null; phone: string | null } | null;
}

type View = 'week' | 'day';

const DAY_MS = 24 * 60 * 60 * 1000;

export function AgendaBoard() {
  const t = useTranslations('Agenda');
  // The reader's convention, not the model's. `day.key` stays ISO — it
  // is a Map key and a sort key, and it must not change shape with the
  // locale — but nothing ISO reaches the screen.
  const locale = useLocale();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  // The visible range, as instants. Anchored on local midnight in the
  // shop's zone so a week is the shop's week, not the viewer's.
  const range = useMemo(() => {
    const parts = zonedParts(anchor, timezone);
    const localMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
    if (view === 'day') {
      return { from: new Date(localMidnight), days: 1 };
    }
    // Week starts on Monday — the shop's week, and the weekly_hours
    // editor reads Sunday-first only because JS getDay() does.
    const offsetToMonday = (parts.weekday + 6) % 7;
    return { from: new Date(localMidnight - offsetToMonday * DAY_MS), days: 7 };
  }, [anchor, view, timezone]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(range.from.getTime() - DAY_MS).toISOString();
      const to = new Date(range.from.getTime() + (range.days + 1) * DAY_MS).toISOString();
      const res = await fetch(
        `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        toast.error(t('loadError'));
        return;
      }
      setAppointments((data.appointments ?? []) as AppointmentRow[]);
      if (data.timezone) setTimezone(data.timezone as string);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Group into the columns actually rendered. Anything outside the
  // visible days (the ±1 day fetched for timezone slack) falls away.
  const columns = useMemo(() => {
    const days = Array.from({ length: range.days }, (_, i) => {
      const at = new Date(range.from.getTime() + i * DAY_MS);
      return { key: formatDateInZone(at, timezone), at, items: [] as AppointmentRow[] };
    });
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const appointment of appointments) {
      const key = formatDateInZone(new Date(appointment.starts_at), timezone);
      byKey.get(key)?.items.push(appointment);
    }
    for (const day of days) {
      day.items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    }
    return days;
  }, [appointments, range.from, range.days, timezone]);

  const shift = (direction: -1 | 1) =>
    setAnchor(new Date(anchor.getTime() + direction * range.days * DAY_MS));

  const todayKey = formatDateInZone(new Date(), timezone);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => shift(-1)}
            aria-label={t('previous')}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            {t('today')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => shift(1)}
            aria-label={t('next')}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm text-muted-foreground">
            {columns[0] && formatDateForDisplay(columns[0].at, timezone, locale)}
            {range.days > 1 &&
              columns.length > 0 &&
              ` – ${formatDateForDisplay(
                columns[columns.length - 1].at,
                timezone,
                locale,
              )}`}
          </span>
          {loading && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {(['week', 'day'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs',
                  view === v
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {t(v)}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('newButton')}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'mt-4 grid gap-2',
          range.days === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-7',
        )}
      >
        {columns.map((day) => (
          <div
            key={day.key}
            className={cn(
              'min-h-[9rem] rounded-xl border p-2',
              day.key === todayKey
                ? 'border-primary/40 bg-primary/[0.03]'
                : 'border-border bg-card',
            )}
          >
            <div className="mb-2 flex items-baseline justify-between px-0.5">
              <span className="text-xs font-medium text-foreground">
                {new Intl.DateTimeFormat(locale, {
                  timeZone: timezone,
                  weekday: 'short',
                }).format(day.at)}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDayMonthForDisplay(day.at, timezone, locale)}
              </span>
            </div>

            {day.items.length === 0 ? (
              <p className="px-0.5 text-xs text-muted-foreground">{t('empty')}</p>
            ) : (
              <div className="space-y-1.5">
                {day.items.map((item) => (
                  <AppointmentCard
                    key={item.id}
                    appointment={item}
                    timezone={timezone}
                    onSelect={() => setSelected(item)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <NewAppointmentDialog
          timezone={timezone}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {selected && (
        <AppointmentDetail
          appointment={selected}
          timezone={timezone}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AppointmentCard({
  appointment,
  timezone,
  onSelect,
}: {
  appointment: AppointmentRow;
  timezone: string;
  onSelect: () => void;
}) {
  const t = useTranslations('Agenda');
  const cancelled = appointment.status === 'cancelled';
  // A booking with no calendar event exists here but not where the shop
  // actually looks. Surfacing it is the point of storing it at all.
  const unsynced = appointment.status === 'scheduled' && !appointment.google_event_id;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
        cancelled && 'border-border bg-muted/30 opacity-60',
        !cancelled && unsynced && 'border-amber-500/50 bg-amber-500/5',
        !cancelled && !unsynced && 'border-border bg-muted/50 hover:bg-muted',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'font-medium tabular-nums',
            cancelled ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {formatTimeInZone(new Date(appointment.starts_at), timezone)}
        </span>
        {appointment.created_via === 'native' ? (
          <Bot className="h-3 w-3 shrink-0 text-primary" aria-label={t('viaAgent')} />
        ) : (
          <Hand className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t('viaManual')} />
        )}
        {unsynced && (
          <TriangleAlert
            className="ml-auto h-3 w-3 shrink-0 text-amber-500"
            aria-label={t('notOnCalendar')}
          />
        )}
      </div>
      <p className={cn('truncate', cancelled ? 'text-muted-foreground' : 'text-foreground')}>
        {appointment.contacts?.name?.trim() ||
          appointment.contacts?.phone ||
          t('unknownContact')}
      </p>
      {appointment.title && (
        <p className="truncate text-muted-foreground">{appointment.title}</p>
      )}
    </button>
  );
}

/** Link back to the thread that produced a booking, when there was one. */
export function ConversationLink({ conversationId }: { conversationId: string }) {
  const t = useTranslations('Agenda');
  return (
    <Link
      href={`/inbox?conversation=${conversationId}`}
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
    >
      <MessageSquare className="h-3.5 w-3.5" />
      {t('openConversation')}
    </Link>
  );
}

export { CalendarDays };
