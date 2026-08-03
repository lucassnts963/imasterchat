'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CalendarCheck2,
  CalendarX2,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TimezonePicker } from '@/components/ui/timezone-picker';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Scheduling settings — the Google Calendar connection and the rules
 * the server enforces when the agent books.
 *
 * These are one panel on purpose. Switching autonomous booking on
 * without a calendar connected is a coherent but bad state (the shop's
 * hand-blocked days become invisible), and putting both controls side
 * by side is what makes that obvious rather than something to discover
 * in production.
 */

type Window = [string, string];
type WeeklyHours = Record<string, Window[]>;

interface Settings {
  timezone: string;
  slot_minutes: number;
  lead_time_minutes: number;
  max_advance_days: number;
  weekly_hours: WeeklyHours;
  is_active: boolean;
  /** Como este negócio chama um agendamento. Null usa o genérico. */
  appointment_label: string | null;
}

interface ConnectionStatus {
  available: boolean;
  connected: boolean;
  google_email: string | null;
  calendar_id: string | null;
}

const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'] as const;

export function SchedulingSettings() {
  const t = useTranslations('Settings.scheduling');
  const { canEditSettings } = useAuth();
  const searchParams = useSearchParams();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch('/api/scheduling/settings'),
        fetch('/api/google/calendar/status'),
      ]);
      const settingsData = await settingsRes.json().catch(() => null);
      const statusData = await statusRes.json().catch(() => null);
      if (settingsData?.settings) setSettings(settingsData.settings as Settings);
      if (statusData) setStatus(statusData as ConnectionStatus);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The OAuth callback lands back here with the outcome in the query
  // string — it is a browser redirect, so there is no response body to
  // read. Report it once, then let the reload show the real state.
  useEffect(() => {
    const outcome = searchParams.get('google');
    if (!outcome) return;
    if (outcome === 'connected') toast.success(t('connectSuccess'));
    else toast.error(t('connectFailed', { code: outcome }));
  }, [searchParams, t]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/scheduling/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? t('saveError'));
        return;
      }
      toast.success(t('saved'));
      await load();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/google/calendar/status', { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('disconnectError'));
        return;
      }
      toast.success(t('disconnected'));
      await load();
    } finally {
      setSaving(false);
    }
  }

  function patch(next: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...next } : s));
  }

  function setWindow(day: string, index: number, which: 0 | 1, value: string) {
    setSettings((s) => {
      if (!s) return s;
      const windows = [...(s.weekly_hours[day] ?? [])];
      const window: Window = [...windows[index]] as Window;
      window[which] = value;
      windows[index] = window;
      return { ...s, weekly_hours: { ...s.weekly_hours, [day]: windows } };
    });
  }

  function addWindow(day: string) {
    setSettings((s) => {
      if (!s) return s;
      const windows = [...(s.weekly_hours[day] ?? []), ['09:00', '12:00'] as Window];
      return { ...s, weekly_hours: { ...s.weekly_hours, [day]: windows } };
    });
  }

  function removeWindow(day: string, index: number) {
    setSettings((s) => {
      if (!s) return s;
      const windows = (s.weekly_hours[day] ?? []).filter((_, i) => i !== index);
      return { ...s, weekly_hours: { ...s.weekly_hours, [day]: windows } };
    });
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  const readOnly = !canEditSettings;
  const dayNames = t.raw('dayNames') as string[];

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {status?.connected ? (
              <CalendarCheck2 className="h-4 w-4 text-primary" />
            ) : (
              <CalendarX2 className="h-4 w-4 text-muted-foreground" />
            )}
            {t('connectionTitle')}
          </CardTitle>
          <CardDescription>{t('connectionDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status && !status.available && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              {t('notConfigured')}
            </p>
          )}

          {status?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium text-foreground">
                  {status.google_email ?? t('connectedUnknownAccount')}
                </p>
                <p className="text-muted-foreground">
                  {t('calendarLabel', { id: status.calendar_id ?? 'primary' })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={disconnect}
                disabled={readOnly || saving}
              >
                {t('disconnect')}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              disabled={readOnly || !status?.available}
              // A full navigation, not fetch: the route answers with a
              // redirect to Google's consent screen, which the browser
              // has to follow itself.
              onClick={() => {
                window.location.href = '/api/google/calendar/connect';
              }}
            >
              {t('connect')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Rules */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t('rulesTitle')}</CardTitle>
          <CardDescription>{t('rulesDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('activeLabel')}
              </p>
              <p className="text-xs text-muted-foreground">{t('activeHint')}</p>
            </div>
            <Switch
              checked={settings.is_active}
              onCheckedChange={(v) => patch({ is_active: v })}
              disabled={readOnly}
            />
          </div>

          {settings.is_active && !status?.connected && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              {t('activeWithoutCalendar')}
            </p>
          )}

          {/* The inverse, and the one that actually wastes an afternoon:
              calendar connected, rules filled in, switch off — so the
              agent behaves as if booking did not exist and nothing says
              why. Filling in this form is a clear statement of intent;
              silence in response to it is the wrong answer. */}
          {!settings.is_active && status?.connected && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              {t('connectedButInactive')}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">{t('timezone')}</Label>
              <TimezonePicker
                id="timezone"
                value={settings.timezone}
                onChange={(timezone) => patch({ timezone })}
                disabled={readOnly}
                placeholder={t('timezonePlaceholder')}
                searchPlaceholder={t('timezoneSearch')}
                emptyLabel={t('timezoneEmpty')}
              />
              <p className="text-xs text-muted-foreground">{t('timezoneHint')}</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="appointment-label">{t('labelTitle')}</Label>
              <Input
                id="appointment-label"
                maxLength={40}
                value={settings.appointment_label ?? ''}
                onChange={(e) =>
                  // Vazio grava null, e não '': é assim que a coluna
                  // representa "sem termo próprio", e duas grafias para
                  // o mesmo estado só rendem um `if` a mais em cada
                  // lugar que lê isto.
                  patch({ appointment_label: e.target.value || null })
                }
                disabled={readOnly}
                placeholder={t('labelPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('labelDesc')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slot">{t('slotMinutes')}</Label>
              <Input
                id="slot"
                type="number"
                min={5}
                max={480}
                value={settings.slot_minutes}
                onChange={(e) => patch({ slot_minutes: Number(e.target.value) })}
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead">{t('leadTime')}</Label>
              <Input
                id="lead"
                type="number"
                min={0}
                value={settings.lead_time_minutes}
                onChange={(e) =>
                  patch({ lead_time_minutes: Number(e.target.value) })
                }
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">{t('leadTimeHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="advance">{t('maxAdvance')}</Label>
              <Input
                id="advance"
                type="number"
                min={1}
                max={365}
                value={settings.max_advance_days}
                onChange={(e) =>
                  patch({ max_advance_days: Number(e.target.value) })
                }
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('hours')}</Label>
            <p className="text-xs text-muted-foreground">{t('hoursHint')}</p>
            <div className="space-y-2">
              {DAY_KEYS.map((day) => {
                const windows = settings.weekly_hours[day] ?? [];
                return (
                  <div
                    key={day}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="w-24 shrink-0 text-sm text-foreground">
                      {dayNames[Number(day)]}
                    </span>
                    {windows.length === 0 && (
                      <span className="text-sm text-muted-foreground">
                        {t('closed')}
                      </span>
                    )}
                    {windows.map((w, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <Input
                          type="time"
                          value={w[0]}
                          onChange={(e) => setWindow(day, i, 0, e.target.value)}
                          disabled={readOnly}
                          className="h-8 w-[7.5rem]"
                        />
                        <span className="text-muted-foreground">–</span>
                        <Input
                          type="time"
                          value={w[1]}
                          onChange={(e) => setWindow(day, i, 1, e.target.value)}
                          disabled={readOnly}
                          className="h-8 w-[7.5rem]"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeWindow(day, i)}
                          disabled={readOnly}
                          className="h-8 w-8 p-0 text-muted-foreground"
                          aria-label={t('removeWindow')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addWindow(day)}
                      disabled={readOnly}
                      className="ml-auto h-8 text-muted-foreground"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> {t('addWindow')}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <Button onClick={save} disabled={readOnly || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
