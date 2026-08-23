'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Lock, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// ============================================================
// What the agent can actually do.
//
// The catalogue used to be invisible, and its most confusing property
// was that an unavailable tool is ABSENT rather than disabled — the
// model never learns it exists. That is the right behaviour and it made
// the screen show nothing, so an agent that could not book looked
// identical to an agent that chose not to.
//
// Hence the two distinct reasons: a prerequisite is unmet, or someone
// switched it off. They look the same from outside and are fixed in
// completely different places.
// ============================================================

interface Tool {
  name: string;
  description: string;
  available: boolean;
  blocked_by: 'prerequisite' | 'disabled' | null;
  requirement: string | null;
  can_toggle: boolean;
}

export function AiTools() {
  const t = useTranslations('Agents.tools');
  const { canEditSettings } = useAuth();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/tools');
      const data = await res.json().catch(() => null);
      if (data?.tools) setTools(data.tools as Tool[]);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(tool: Tool, enabled: boolean) {
    setBusy(tool.name);
    try {
      const res = await fetch('/api/ai/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tool.name, enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? t('saveError'));
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className={cn(
              'flex items-start gap-3 rounded-lg border px-3 py-2.5',
              tool.available
                ? 'border-border'
                : 'border-border bg-muted/30 opacity-70',
            )}
          >
            {tool.can_toggle ? (
              <Switch
                checked={tool.blocked_by !== 'disabled'}
                onCheckedChange={(v) => toggle(tool, v)}
                disabled={
                  !canEditSettings ||
                  busy === tool.name ||
                  tool.blocked_by === 'prerequisite'
                }
                className="mt-0.5"
              />
            ) : (
              <Lock
                className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label={t('alwaysOn')}
              />
            )}

            <div className="min-w-0 flex-1">
              {/* The name the operator thinks in, with the identifier the
                  model actually sees kept underneath — smaller, but not
                  removed: it is what appears in the Playground's tool
                  cards and in ai_agent_steps, so hiding it would break
                  the trail between this screen and the audit log. */}
              <p className="text-sm font-medium text-foreground">
                {t(`names.${tool.name}`)}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground/70">
                {tool.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(`descriptions.${tool.name}`)}
              </p>

              {tool.blocked_by === 'prerequisite' && tool.requirement && (
                <p className="mt-1 text-xs text-amber-500">
                  {t(`requirements.${tool.requirement}`)}
                </p>
              )}
              {!tool.can_toggle && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('alwaysOnWhy')}
                </p>
              )}
            </div>
          </div>
        ))}

        <p className="pt-1 text-xs text-muted-foreground">{t('absentNote')}</p>
      </CardContent>
    </Card>
  );
}
