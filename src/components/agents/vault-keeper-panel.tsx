'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Loader2, MessageSquareOff, Play, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/time/format';

// ============================================================
// O que o keeper andou fazendo — e um botão para fazer agora.
//
// O keeper roda de madrugada, pelo sidecar de cron. Sem esta tela, a
// única evidência de que ele existe é uma página aparecendo na fila —
// e quando ele decide que não há nada a guardar, que é a resposta certa
// na maioria das conversas, ele não deixa evidência nenhuma.
//
// O resultado disso foi um diagnóstico errado: "não rodou nada e já
// temos conversas". Ele tinha rodado duas vezes e concluído, das duas,
// que a conversa não trazia nada durável — com a justificativa gravada
// e invisível.
//
// Daí esta tela mostrar as decisões de NÃO fazer com o mesmo destaque
// das de fazer. Um keeper silencioso e um keeper quebrado precisam
// parecer diferentes.
// ============================================================

interface VaultRun {
  id: string;
  operation: 'proposed' | 'no_action' | 'finished';
  page_id: string | null;
  note: string | null;
  created_at: string;
}

interface SweepResponse {
  considered: number;
  ran: number;
  pages_proposed: number;
  skipped: { tooRecent: number; alreadyRead: number };
}

const OPERATION_ICON = {
  proposed: Sparkles,
  no_action: MessageSquareOff,
  finished: FileText,
} as const;

export function VaultKeeperPanel({ onPagesProposed }: { onPagesProposed: () => void }) {
  const t = useTranslations('Agents.vault.keeper');
  const locale = useLocale();
  const [runs, setRuns] = useState<VaultRun[] | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/vault/runs');
      const data = await res.json().catch(() => null);
      setRuns(res.ok ? ((data?.runs ?? []) as VaultRun[]) : []);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch('/api/ai/vault/keeper', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as SweepResponse | null;
      if (!res.ok || !data) {
        toast.error(t('runError'));
        return;
      }

      // O caso comum é zero, e um zero mudo foi o que gerou a confusão
      // que este painel existe para desfazer. Cada zero vem com o
      // motivo — e são motivos diferentes, com consertos diferentes.
      if (data.pages_proposed > 0) {
        toast.success(t('runProposed', { count: data.pages_proposed }));
        onPagesProposed();
      } else if (data.considered > 0) {
        toast.success(t('runNothingDurable', { count: data.considered }));
      } else if (data.skipped.tooRecent > 0) {
        toast.info(t('runTooRecent', { count: data.skipped.tooRecent }));
      } else if (data.skipped.alreadyRead > 0) {
        toast.info(t('runAlreadyRead', { count: data.skipped.alreadyRead }));
      } else {
        toast.info(t('runNoConversations'));
      }
      await load();
    } catch {
      toast.error(t('runError'));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-xs text-muted-foreground">
          {t('description')}
        </p>
        <Button size="sm" onClick={runNow} disabled={running}>
          {running ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {running ? t('running') : t('runNow')}
        </Button>
      </div>

      {runs === null ? (
        <p className="text-xs text-muted-foreground">{t('loading')}</p>
      ) : runs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => {
            const Icon = OPERATION_ICON[run.operation] ?? FileText;
            return (
              <li
                key={run.id}
                className="flex gap-3 rounded-lg border border-border p-3"
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    run.operation === 'proposed'
                      ? 'text-primary'
                      : 'text-muted-foreground',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    {t(`operation.${run.operation}`)}
                  </p>
                  {run.note && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {run.note}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {formatDateTime(run.created_at, locale)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
