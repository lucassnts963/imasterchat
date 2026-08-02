'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

// ============================================================
// What the bot is not allowed to handle.
//
// Two lists, shown apart because they behave differently and the
// operator has to understand the difference to use them well:
//
//   Assunto  — the model reads it and decides. Catches paraphrase,
//              and can be wrong.
//   Palavra  — matched before the model runs. Cannot be talked out of
//              it, and misses anything phrased differently.
//
// The screen says so in as many words, because a guardrail the operator
// misunderstands is worse than none: they will trust it for cases it
// was never going to catch.
// ============================================================

interface Guardrail {
  id: string;
  kind: 'topic' | 'keyword';
  value: string;
  note: string | null;
  is_active: boolean;
  is_builtin: boolean;
}

export function AiGuardrails() {
  const t = useTranslations('Settings.guardrails');
  const { canEditSettings } = useAuth();

  const [rules, setRules] = useState<Guardrail[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<'topic' | 'keyword'>('topic');
  const [newValue, setNewValue] = useState('');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/guardrails');
      const data = await res.json().catch(() => null);
      if (data?.guardrails) setRules(data.guardrails as Guardrail[]);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(rule: Guardrail, active: boolean) {
    setBusyId(rule.id);
    // Optimistic: a switch that waits for a round-trip feels broken.
    setRules((rs) =>
      rs.map((r) => (r.id === rule.id ? { ...r, is_active: active } : r)),
    );
    try {
      const res = await fetch('/api/ai/guardrails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id, is_active: active }),
      });
      if (!res.ok) {
        toast.error(t('saveError'));
        await load();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function remove(rule: Guardrail) {
    setBusyId(rule.id);
    try {
      const res = await fetch(`/api/ai/guardrails?id=${rule.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('saveError'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    if (!newValue.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/ai/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: newKind,
          value: newValue.trim(),
          note: newNote.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveError'));
        return;
      }
      setNewValue('');
      setNewNote('');
      toast.success(t('added'));
      await load();
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  const readOnly = !canEditSettings;
  const topics = rules.filter((r) => r.kind === 'topic');
  const keywords = rules.filter((r) => r.kind === 'keyword');

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <RuleList
        title={t('topicsTitle')}
        description={t('topicsDesc')}
        rules={topics}
        readOnly={readOnly}
        busyId={busyId}
        onToggle={toggle}
        onRemove={remove}
        emptyLabel={t('noTopics')}
      />

      <div className="mt-4">
        <RuleList
          title={t('keywordsTitle')}
          description={t('keywordsDesc')}
          rules={keywords}
          readOnly={readOnly}
          busyId={busyId}
          onToggle={toggle}
          onRemove={remove}
          emptyLabel={t('noKeywords')}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t('addTitle')}</CardTitle>
          <CardDescription>{t('addDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex rounded-lg border border-border p-0.5">
            {(['topic', 'keyword'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setNewKind(k)}
                disabled={readOnly}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs',
                  newKind === k
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {t(k === 'topic' ? 'kindTopic' : 'kindKeyword')}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gr-value">
              {t(newKind === 'topic' ? 'valueTopicLabel' : 'valueKeywordLabel')}
            </Label>
            <Input
              id="gr-value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={t(
                newKind === 'topic' ? 'valueTopicPlaceholder' : 'valueKeywordPlaceholder',
              )}
              disabled={readOnly}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gr-note">{t('noteLabel')}</Label>
            <Input
              id="gr-note"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              disabled={readOnly}
            />
            <p className="text-xs text-muted-foreground">{t('noteHint')}</p>
          </div>

          <Button onClick={add} disabled={readOnly || adding || !newValue.trim()}>
            {adding ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            {t('add')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RuleList({
  title,
  description,
  rules,
  readOnly,
  busyId,
  onToggle,
  onRemove,
  emptyLabel,
}: {
  title: string;
  description: string;
  rules: Guardrail[];
  readOnly: boolean;
  busyId: string | null;
  onToggle: (rule: Guardrail, active: boolean) => void;
  onRemove: (rule: Guardrail) => void;
  emptyLabel: string;
}) {
  const t = useTranslations('Settings.guardrails');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border border-border px-3 py-2',
                !rule.is_active && 'opacity-50',
              )}
            >
              <Switch
                checked={rule.is_active}
                onCheckedChange={(v) => onToggle(rule, v)}
                disabled={readOnly || busyId === rule.id}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  {rule.value}
                  {rule.is_builtin && (
                    <span className="ml-2 rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t('builtin')}
                    </span>
                  )}
                </p>
                {rule.note && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{rule.note}</p>
                )}
              </div>
              {!rule.is_builtin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(rule)}
                  disabled={readOnly || busyId === rule.id}
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
                  aria-label={t('remove')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
