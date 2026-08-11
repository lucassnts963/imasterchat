'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AUDIO_POLICIES, type AudioPolicy } from '@/lib/audio/policy';

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
  context_message_limit: number;
  new_session_hours: number;
  lookahead_days: number;
  slot_fetch_limit: number;
  offer_slots_max: number;
}

const DEFAULTS: Rules = {
  context_message_limit: 20,
  new_session_hours: 8,
  lookahead_days: 7,
  slot_fetch_limit: 12,
  offer_slots_max: 3,
};

/** Espelha os CHECK da migração 059 — o `min`/`max` do input avisa
 *  antes de o servidor precisar corrigir. */
const BOUNDS: Record<keyof Rules, { min: number; max: number }> = {
  context_message_limit: { min: 4, max: 60 },
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
  // Áudio fica fora de `Rules` porque não é número: é uma escolha entre
  // quatro comportamentos, mais o texto e a chave que só um deles usa.
  const [audioPolicy, setAudioPolicy] = useState<AudioPolicy>('ignore');
  const [audioProvider, setAudioProvider] = useState<'local' | 'elevenlabs'>('local');
  const [audioNotice, setAudioNotice] = useState('');
  const [elevenKey, setElevenKey] = useState('');
  const [vocabulary, setVocabulary] = useState('');
  const [hasElevenKey, setHasElevenKey] = useState(false);

  const load = useCallback(async () => {
    try {
      const [aiRes, schedRes] = await Promise.all([
        fetch('/api/ai/config'),
        fetch('/api/scheduling/settings'),
      ]);
      const ai = await aiRes.json().catch(() => null);
      const sched = await schedRes.json().catch(() => null);
      setRules({
        // Nulo na coluna quer dizer "usa o do servidor". A tela mostra o
        // valor efetivo, não o nulo — o operador quer ver quantas
        // mensagens vão, não descobrir que a resposta está noutro lugar.
        context_message_limit:
          ai?.context_message_limit ?? DEFAULTS.context_message_limit,
        new_session_hours: ai?.new_session_hours ?? DEFAULTS.new_session_hours,
        lookahead_days:
          sched?.settings?.lookahead_days ?? DEFAULTS.lookahead_days,
        slot_fetch_limit:
          sched?.settings?.slot_fetch_limit ?? DEFAULTS.slot_fetch_limit,
        offer_slots_max:
          sched?.settings?.offer_slots_max ?? DEFAULTS.offer_slots_max,
      });
      setAudioPolicy((ai?.audio_policy as AudioPolicy) ?? 'ignore');
      setAudioProvider(
        ai?.audio_transcription_provider === 'elevenlabs' ? 'elevenlabs' : 'local',
      );
      setAudioNotice(ai?.audio_notice_text ?? '');
      setHasElevenKey(ai?.has_elevenlabs_key === true);
      setVocabulary(ai?.transcription_vocabulary ?? '');
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
          body: JSON.stringify({
            new_session_hours: rules.new_session_hours,
            context_message_limit: rules.context_message_limit,
            audio_policy: audioPolicy,
            audio_transcription_provider: audioProvider,
            audio_notice_text: audioNotice.trim() || null,
            transcription_vocabulary: vocabulary.trim() || null,
            // Só manda a chave quando o operador digitou algo. Mandar
            // string vazia APAGARIA a chave salva — e ele digitaria
            // vazio toda vez que salvasse qualquer outra regra.
            ...(elevenKey.trim() ? { elevenlabs_api_key: elevenKey.trim() } : {}),
          }),
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
      setElevenKey('');
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
        {field('context_message_limit')}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t('sections.audio')}
        </h3>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="audio-policy">{t('audio.policyLabel')}</Label>
            <Select
              value={audioPolicy}
              onValueChange={(v) => setAudioPolicy(v as AudioPolicy)}
            >
              <SelectTrigger id="audio-policy" className="w-full sm:w-72">
                <SelectValue>
                  {(v) => t(`audio.policies.${String(v)}.label`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {AUDIO_POLICIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`audio.policies.${p}.label`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`audio.policies.${audioPolicy}.hint`)}
            </p>
          </div>

          {(audioPolicy === 'notice' || audioPolicy === 'transcribe') && (
            <div className="space-y-1.5">
              <Label htmlFor="audio-notice">{t('audio.noticeLabel')}</Label>
              <Textarea
                id="audio-notice"
                value={audioNotice}
                onChange={(e) => setAudioNotice(e.target.value)}
                placeholder={t('audio.noticePlaceholder')}
                maxLength={300}
                rows={2}
                disabled={!canEditSettings}
              />
              <p className="text-xs text-muted-foreground">
                {t('audio.noticeHint')}
              </p>
            </div>
          )}

          {audioPolicy === 'transcribe' && (
            <div className="space-y-3 rounded-md bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="audio-provider">{t('audio.providerLabel')}</Label>
                <Select
                  value={audioProvider}
                  onValueChange={(v) =>
                    setAudioProvider(v === 'elevenlabs' ? 'elevenlabs' : 'local')
                  }
                >
                  <SelectTrigger id="audio-provider" className="w-full sm:w-72">
                    <SelectValue>
                      {(v) => t(`audio.providers.${String(v)}.label`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">
                      {t('audio.providers.local.label')}
                    </SelectItem>
                    <SelectItem value="elevenlabs">
                      {t('audio.providers.elevenlabs.label')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(`audio.providers.${audioProvider}.hint`)}
                </p>
              </div>

              {audioProvider === 'local' && (
                <div className="space-y-1.5">
                  <Label htmlFor="vocab">{t('audio.vocabLabel')}</Label>
                  <Textarea
                    id="vocab"
                    value={vocabulary}
                    onChange={(e) => setVocabulary(e.target.value)}
                    placeholder={t('audio.vocabPlaceholder')}
                    maxLength={500}
                    rows={3}
                    disabled={!canEditSettings}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('audio.vocabHint')}
                  </p>
                  <p className="text-xs text-amber-500/90">
                    {t('audio.vocabCost')}
                  </p>
                </div>
              )}

              {audioProvider === 'elevenlabs' && (
                <div className="space-y-1.5">
                  <Label htmlFor="eleven-key">{t('audio.keyLabel')}</Label>
                  <Input
                    id="eleven-key"
                    type="password"
                    value={elevenKey}
                    onChange={(e) => setElevenKey(e.target.value)}
                    placeholder={
                      hasElevenKey ? t('audio.keySaved') : t('audio.keyPlaceholder')
                    }
                    disabled={!canEditSettings}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('audio.keyHint')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
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
