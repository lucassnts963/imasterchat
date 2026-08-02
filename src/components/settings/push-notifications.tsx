'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bell, BellOff, Loader2, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

// ============================================================
// Notifications on a device somebody carries.
//
// Three states, not a switch: off, everything, and only what needs a
// person. The middle one is a phone that buzzes all day for a shop
// that gets fifty messages; the third is why the guardrails and the
// handoff exist, and is the setting most people should be on.
//
// Per DEVICE, not per user. The same attendant on a phone and a laptop
// keeps two settings, because "buzz me on the thing in my pocket, stay
// quiet on the machine I walked away from" is the normal case.
// ============================================================

type Mode = 'off' | 'all' | 'human_needed';

/** The browser's own permission, which no server setting can override. */
type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

function urlBase64ToBytes(base64: string): ArrayBuffer {
  // The VAPID key travels as URL-safe base64; PushManager wants bytes.
  // An ArrayBuffer rather than a Uint8Array on purpose: TypeScript's
  // BufferSource rejects a view whose backing buffer could be shared.
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export function PushNotifications() {
  const t = useTranslations('Settings.push');
  const [permission, setPermission] = useState<Permission>('default');
  const [mode, setMode] = useState<Mode>('off');
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        setPermission('unsupported');
        return;
      }
      setPermission(Notification.permission as Permission);

      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();

      const url = sub
        ? `/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`
        : '/api/push/subscribe';
      const data = await fetch(url).then((r) => r.json());

      setAvailable(Boolean(data?.available));
      setMode(data?.subscribed ? (data.notify_mode as Mode) : 'off');
    } catch {
      // Nothing actionable: the panel simply shows "off".
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(next: Mode) {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      if (next === 'off') {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(
            `/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`,
            { method: 'DELETE' },
          );
          // Unsubscribe locally too, so a stale endpoint cannot linger
          // in the browser pointing at a row we just deleted.
          await sub.unsubscribe();
        }
        setMode('off');
        toast.success(t('turnedOff'));
        return;
      }

      const granted = await Notification.requestPermission();
      setPermission(granted as Permission);
      if (granted !== 'granted') {
        toast.error(t('permissionDenied'));
        return;
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        toast.error(t('notConfigured'));
        return;
      }

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Required by every browser: a push that cannot be shown to
          // the user is not allowed to be silent.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(key),
        }));

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: sub.toJSON().keys,
          notify_mode: next,
          user_agent: navigator.userAgent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveError'));
        return;
      }

      setMode(next);
      setAvailable(true);
      toast.success(t('saved'));
    } catch (err) {
      console.error('[push] subscribe failed:', err);
      toast.error(t('saveError'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  const options: { id: Mode; label: string; hint: string }[] = [
    { id: 'off', label: t('modeOff'), hint: t('modeOffHint') },
    { id: 'human_needed', label: t('modeHuman'), hint: t('modeHumanHint') },
    { id: 'all', label: t('modeAll'), hint: t('modeAllHint') },
  ];

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {mode === 'off' ? (
              <BellOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Bell className="h-4 w-4 text-primary" />
            )}
            {t('thisDevice')}
          </CardTitle>
          <CardDescription>{t('perDevice')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {permission === 'unsupported' && (
            <Warning>{t('unsupported')}</Warning>
          )}
          {permission === 'denied' && <Warning>{t('blocked')}</Warning>}
          {!available && permission !== 'unsupported' && (
            <Warning>{t('notConfigured')}</Warning>
          )}

          <div className="space-y-2">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => choose(option.id)}
                disabled={
                  busy ||
                  permission === 'unsupported' ||
                  permission === 'denied' ||
                  (!available && option.id !== 'off')
                }
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50',
                  mode === option.id
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border hover:bg-muted/50',
                )}
              >
                <span
                  className={cn(
                    'mt-1 h-3 w-3 shrink-0 rounded-full border',
                    mode === option.id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40',
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('saving')}
            </p>
          )}

          <p className="text-xs text-muted-foreground">{t('iosNote')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      {children}
    </p>
  );
}
