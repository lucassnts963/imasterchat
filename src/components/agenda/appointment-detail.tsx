'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, Hand, Loader2, MessageSquare, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatInZone, zonedParts, zonedTimeToUtc } from '@/lib/time/zone';
import type { AppointmentRow } from './agenda-board';

// ============================================================
// One booking: what it is, where it came from, and the two things you
// can do to it.
//
// There is no delete. A cancelled appointment is history the shop
// wants — who cancelled, when, and whether the customer came back —
// and it is what explains a gap in the day.
// ============================================================

export function AppointmentDetail({
  appointment,
  timezone,
  onClose,
  onChanged,
}: {
  appointment: AppointmentRow;
  timezone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Agenda.detail');
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [reason, setReason] = useState('');

  const current = useMemo(() => {
    const parts = zonedParts(new Date(appointment.starts_at), timezone);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
      time: `${pad(parts.hour)}:${pad(parts.minute)}`,
      durationMinutes: Math.round(
        (new Date(appointment.ends_at).getTime() -
          new Date(appointment.starts_at).getTime()) /
          60_000,
      ),
    };
  }, [appointment, timezone]);

  const [date, setDate] = useState(current.date);
  const [time, setTime] = useState(current.time);

  const cancelled = appointment.status === 'cancelled';
  const unsynced = appointment.status === 'scheduled' && !appointment.google_event_id;

  async function patch(body: Record<string, unknown>, successKey: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('error'));
        return;
      }
      if (data.calendar_synced === false) {
        toast.warning(t('unsyncedWarning'));
      } else {
        toast.success(t(successKey));
      }
      onChanged();
    } catch {
      toast.error(t('error'));
    } finally {
      setBusy(false);
    }
  }

  function reschedule() {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return;
    const startsAt = zonedTimeToUtc(
      { year: y, month: m, day: d, hour: hh, minute: mm },
      timezone,
    );
    void patch(
      {
        starts_at: startsAt.toISOString(),
        ends_at: new Date(
          startsAt.getTime() + current.durationMinutes * 60_000,
        ).toISOString(),
      },
      'rescheduled',
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {appointment.contacts?.name?.trim() ||
              appointment.contacts?.phone ||
              t('unknownContact')}
          </DialogTitle>
          <DialogDescription>
            {formatInZone(new Date(appointment.starts_at), timezone)} ({timezone})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {appointment.created_via === 'native' ? (
                <>
                  <Bot className="h-3.5 w-3.5 text-primary" /> {t('viaAgent')}
                </>
              ) : (
                <>
                  <Hand className="h-3.5 w-3.5" /> {t('viaManual')}
                </>
              )}
            </span>
            <span>{t(`status.${appointment.status}`)}</span>
          </div>

          {appointment.title && (
            <p className="text-sm text-foreground">{appointment.title}</p>
          )}

          {unsynced && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              {t('notOnCalendar')}
            </p>
          )}

          {cancelled && appointment.cancellation_reason && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {t('cancelledBecause', { reason: appointment.cancellation_reason })}
            </p>
          )}

          {appointment.conversation_id && (
            <Link
              href={`/inbox?conversation=${appointment.conversation_id}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {t('openConversation')}
            </Link>
          )}

          {!cancelled && (
            <>
              {rescheduling ? (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-date">{t('newDate')}</Label>
                      <Input
                        id="new-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-time">{t('newTime')}</Label>
                      <Input
                        id="new-time"
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRescheduling(false)}
                      disabled={busy}
                    >
                      {t('back')}
                    </Button>
                    <Button size="sm" onClick={reschedule} disabled={busy}>
                      {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      {t('confirmReschedule')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cancel-reason">{t('cancelReason')}</Label>
                    <Input
                      id="cancel-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t('cancelReasonPlaceholder')}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRescheduling(true)}
                      disabled={busy}
                    >
                      {t('reschedule')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        patch(
                          { status: 'cancelled', cancellation_reason: reason },
                          'cancelled',
                        )
                      }
                      disabled={busy}
                    >
                      {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
