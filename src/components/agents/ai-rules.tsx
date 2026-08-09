'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

// ============================================================
// Os números que governam como o agente conversa.
//
// Existiam como constantes em arquivos .ts, e dois deles foram
// escolhidos numa terça-feira porque o bot despejou 42 horários numa
// mensagem. Ajustar exigia rebuild da imagem — o que torna cada ajuste
// um deploy, e cada deploy uma decisão de engenharia em vez de uma
// decisão do negócio.
//
// A tela é deliberadamente CRUA: rótulo, número, e uma frase dizendo o
// que quebra se for mudado demais. Cada campo é um trade-off, e
// esconder o trade-off atrás de um controle bonito faria alguém mexer
// sem saber o que está pagando.
//
// Salva em dois lugares (as regras de conversa vivem em `ai_configs`,
// as de agenda em `ai_scheduling_settings`) porque é onde o resto do
// código já as lê. A divisão é da máquina; para quem usa, é uma tela.
// ============================================================

interface Rules {
  new_session_hours: number;
  lookahead_days: number;
  slot_fetch_limit: number;
  offer_slots_max: number;
}

const DEFAULTS: Rules = {
  new_session_hours: 8,
  lookahead_days: 7,
  slot_fetch_limit: 12,
  offer_slots_max: 3,
};

/** Espelha os CHECK da migração 059 — o `min`/`max` do input avisa
 *  antes de o servidor precisar corrigir. */
const BOUNDS: Record<keyof Rules, { min: number; max: number }> = {
  new_session_hours: { min: 1, max: 168 },
  lookahead_days: { min: 1, max: 90 },
  slot_fetch_limit: { min: 3, max: 60 },
  offer_slots_max: { min: 1, max: 10 },
};

export function AiRules() {
  const t = useTranslations('Agents.rules');
  const { canEditSettings } = useAuth();
  const [rules, setRules] = useState<Rules | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [aiRes, schedRes] = await Promise.all([
        fetch('/api/ai/config'),
        fetch('/api/scheduling/settings'),
      ]);
      const ai = await aiRes.json().catch(() => null);
      const sched = await schedRes.json().catch(() => null);
      setRules({
        new_session_hours: ai?.new_session_hours ?? DEFAULTS.new_session_hours,
        lookahead_days:
          sched?.settings?.lookahead_days ?? DEFAULTS.lookahead_days,
        slot_fetch_limit:
          sched?.settings?.slot_fetch_limit ?? DEFAULTS.slot_fetch_limit,
        offer_slots_max:
          sched?.settings?.offer_slots_max ?? DEFAULTS.offer_slots_max,
      });
    } catch {
      setRules(DEFAULTS);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!rules) return;
    setSaving(true);
    try {
      // PATCH parcial nos dois endpoints. Ambos tratam campo ausente
      // como "não mexer", então esta tela não precisa conhecer nem
      // reenviar o resto da configuração — que é o que a faria
      // sobrescrever o que outra tela acabou de salvar.
      const [aiRes, schedRes] = await Promise.all([
        fetch('/api/ai/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_session_hours: rules.new_session_hours }),
        }),
        fetch('/api/scheduling/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lookahead_days: rules.lookahead_days,
            slot_fetch_limit: rules.slot_fetch_limit,
            offer_slots_max: rules.offer_slots_max,
          }),
        }),
      ]);
      if (!aiRes.ok || !schedRes.ok) {
        toast.error(t('saveError'));
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

  if (!rules) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </p>
    );
  }

  const field = (key: keyof Rules) => (
    <div key={key} className="space-y-1.5 rounded-lg border border-border p-3">
      <Label htmlFor={`rule-${key}`}>{t(`fields.${key}.label`)}</Label>
      <Input
        id={`rule-${key}`}
        type="number"
        min={BOUNDS[key].min}
        max={BOUNDS[key].max}
        value={rules[key]}
        disabled={!canEditSettings}
        onChange={(e) =>
          setRules({ ...rules, [key]: Number(e.target.value) })
        }
        className="w-28"
      />
      <p className="text-xs text-muted-foreground">
        {t(`fields.${key}.hint`)}
      </p>
      {/* O custo vem separado da explicação: é o que a pessoa precisa
          ler ANTES de aumentar o número, não depois. */}
      <p className="text-xs text-amber-500/90">{t(`fields.${key}.cost`)}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-xs text-muted-foreground">
        {t('description')}
      </p>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t('sections.conversation')}
        </h3>
        {field('new_session_hours')}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t('sections.scheduling')}
        </h3>
        {field('offer_slots_max')}
        {field('lookahead_days')}
        {field('slot_fetch_limit')}
      </section>

      {canEditSettings && (
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('save')}
        </Button>
      )}
    </div>
  );
}
