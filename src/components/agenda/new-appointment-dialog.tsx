'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
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
import { zonedTimeToUtc } from '@/lib/time/zone';

// ============================================================
// Booking by hand.
//
// Unlike the agent, an attendant may deliberately book outside the
// usual hours — she can see the calendar and knows why. So this does
// not filter by `computeAvailableSlots`; the database still refuses a
// genuine double-booking, which is the part that protects the customer
// rather than the policy.
// ============================================================

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
}

export function NewAppointmentDialog({
  timezone,
  onClose,
  onCreated,
}: {
  timezone: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('Agenda.newDialog');
  const supabase = createClient();
  const { accountId } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [contactId, setContactId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState(60);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      let query = supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('account_id', accountId)
        .order('name', { ascending: true })
        .limit(30);
      if (search.trim()) {
        query = query.or(`name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`);
      }
      const { data } = await query;
      if (!cancelled) setContacts((data ?? []) as Contact[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, accountId, search]);

  // Both instants are resolved in the SHOP's zone, not the browser's:
  // an attendant working from home in another state must not book an
  // hour off.
  const slot = useMemo(() => {
    if (!date || !time) return null;
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const startsAt = zonedTimeToUtc(
      { year: y, month: m, day: d, hour: hh, minute: mm },
      timezone,
    );
    return {
      startsAt,
      endsAt: new Date(startsAt.getTime() + duration * 60_000),
    };
  }, [date, time, duration, timezone]);

  async function submit() {
    if (!contactId || !slot) return;
    setSaving(true);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          starts_at: slot.startsAt.toISOString(),
          ends_at: slot.endsAt.toISOString(),
          title: title.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('error'));
        return;
      }
      // Recorded but not on the shop's calendar — say so rather than
      // letting them find out from an empty Google Agenda.
      if (data.calendar_synced === false) {
        toast.warning(t('createdUnsynced'));
      } else {
        toast.success(t('created'));
      }
      onCreated();
    } catch {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { timezone })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contact-search">{t('contact')}</Label>
            <Input
              id="contact-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('contactSearch')}
            />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
              {contacts.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  {t('noContacts')}
                </p>
              ) : (
                contacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setContactId(c.id)}
                    className={`block w-full px-3 py-1.5 text-left text-sm ${
                      contactId === c.id
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {c.name?.trim() || c.phone}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">{t('time')}</Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duration">{t('duration')}</Label>
            <Input
              id="duration"
              type="number"
              min={5}
              max={480}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appt-title">{t('subject')}</Label>
            <Input
              id="appt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('subjectPlaceholder')}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button onClick={submit} disabled={!contactId || !slot || saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
