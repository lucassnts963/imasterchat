'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Info,
  Lightbulb,
  Loader2,
  MessageSquare,
  RotateCcw,
  Siren,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { HealthStrip } from './health-strip';

// ============================================================
// A tela que responde "quem está quebrado agora".
//
// Uma lista só, ordenada por tempo, com falhas e relatos misturados de
// propósito — separá-los obrigaria a fazer na cabeça, toda vez, o
// cruzamento que é o motivo de a tela existir: a cliente escreveu "o
// bot parou" às 9h12, e três linhas acima estão as catorze falhas de
// chave inválida na conta dela desde as 6h.
//
// Agrupada por (conta, código) para o que é ruído virar uma linha:
// duzentas mensagens falhando pelo mesmo motivo na mesma conta são um
// problema, não duzentos.
// ============================================================

interface EventRow {
  id: string;
  account_id: string | null;
  kind: 'error' | 'report';
  severity: 'info' | 'warning' | 'error' | 'critical';
  status: 'open' | 'ack' | 'resolved';
  source: string;
  code: string;
  message: string;
  context: Record<string, unknown> | null;
  alerted_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

type Filter = 'open' | 'error' | 'report' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Em aberto' },
  { id: 'error', label: 'Falhas' },
  { id: 'report', label: 'Relatos' },
  { id: 'all', label: 'Tudo' },
];

const SEVERITY_STYLE: Record<EventRow['severity'], string> = {
  info: 'text-muted-foreground',
  warning: 'text-amber-500',
  error: 'text-orange-500',
  critical: 'text-destructive',
};

function SeverityIcon({ row }: { row: EventRow }) {
  const cls = cn('h-4 w-4 shrink-0', SEVERITY_STYLE[row.severity]);
  if (row.kind === 'report') {
    if (row.code === 'bug') return <Bug className={cls} />;
    if (row.code === 'idea') return <Lightbulb className={cls} />;
    return <MessageSquare className={cls} />;
  }
  if (row.severity === 'critical') return <Siren className={cls} />;
  if (row.severity === 'info') return <Info className={cls} />;
  return <AlertTriangle className={cls} />;
}

/** Data curta em português. Um horário ISO numa tela operacional é
 *  mais um passo de tradução mental na hora errada. */
function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins}min`;
  if (mins < 60 * 24) return `há ${Math.round(mins / 60)}h`;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EventsPanel() {
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<EventRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<(EventRow & { screenshot?: string }) | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: '14' });
      if (filter === 'open') params.set('status', 'open');
      if (filter === 'error') params.set('kind', 'error');
      if (filter === 'report') params.set('kind', 'report');

      const res = await fetch(`/api/admin/events?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Falha ao carregar');
      setRows(data.events ?? []);
      setNames(data.accountNames ?? {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    try {
      const res = await fetch(`/api/admin/events?id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Falha ao abrir');
      setDetail(data.event);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao abrir');
    }
  }

  async function setStatus(id: string, status: EventRow['status']) {
    try {
      const res = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar');
      setDetail(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao atualizar');
    }
  }

  // Agrupa repetições do mesmo problema na mesma conta. A lista mostra
  // a mais recente e conta o resto — é a diferença entre uma tela que
  // se lê e um log que se rola.
  const grouped = groupRuns(rows);

  return (
    <div className="space-y-4">
      {/* Estado atual antes da história: num dia ruim a primeira
          pergunta não é "o que aconteceu", é "está quebrado agora, e
          em qual cliente". */}
      <HealthStrip />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              filter === f.id
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            {f.label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          className="ml-auto"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-foreground">Nada aqui.</p>
          {/* Silêncio é ambíguo por natureza, e dizer isso em voz alta
              é mais honesto que deixar a tela vazia sugerir saúde. */}
          <p className="max-w-sm text-xs text-muted-foreground">
            Nos últimos 14 dias, nenhum evento com este filtro. Vale
            lembrar que uma lista vazia também é o que se vê quando a
            gravação de eventos parou.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {grouped.map(({ row, count }) => (
            <button
              key={row.id}
              onClick={() => void open(row.id)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
            >
              <span className="mt-0.5">
                <SeverityIcon row={row} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono text-xs text-foreground">
                    {row.code}
                  </span>
                  {count > 1 && (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                      ×{count}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {row.account_id
                      ? (names[row.account_id] ?? row.account_id.slice(0, 8))
                      : 'sem conta'}
                  </span>
                  {row.status === 'resolved' && (
                    <span className="text-[11px] text-emerald-500">
                      resolvido
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  {row.message}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {when(row.created_at)}
              </span>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <EventDetail
          event={detail}
          accountName={
            detail.account_id ? names[detail.account_id] : undefined
          }
          onClose={() => setDetail(null)}
          onStatus={setStatus}
        />
      )}
    </div>
  );
}

function EventDetail({
  event,
  accountName,
  onClose,
  onStatus,
}: {
  event: EventRow & { screenshot?: string };
  accountName?: string;
  onClose: () => void;
  onStatus: (id: string, status: EventRow['status']) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="mt-8 w-full max-w-2xl space-y-4 rounded-xl border border-border bg-popover p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <SeverityIcon row={event} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm text-foreground">{event.code}</p>
            <p className="text-xs text-muted-foreground">
              {event.source} · {accountName ?? event.account_id ?? 'sem conta'}{' '}
              · {when(event.created_at)}
              {event.alerted_at && ' · alertado'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm text-foreground">
          {event.message}
        </p>

        {event.context && Object.keys(event.context).length > 0 && (
          <dl className="space-y-1 rounded-lg border border-border p-3 text-xs">
            {Object.entries(event.context)
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-all font-mono text-foreground">
                    {String(v)}
                  </dd>
                </div>
              ))}
          </dl>
        )}

        {event.screenshot && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={event.screenshot}
            alt="Imagem enviada por quem reportou"
            className="w-full rounded-lg border border-border"
          />
        )}

        {event.resolution_note && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-muted-foreground">
            {event.resolution_note}
          </p>
        )}

        <div className="flex gap-2">
          {event.status !== 'resolved' ? (
            <>
              <Button size="sm" onClick={() => onStatus(event.id, 'resolved')}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Resolvido
              </Button>
              {event.status !== 'ack' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onStatus(event.id, 'ack')}
                >
                  Estou nisso
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStatus(event.id, 'open')}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" /> Reabrir
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Colapsa ocorrências consecutivas do mesmo (conta, código). Só
 *  consecutivas: se outro problema aconteceu no meio, os dois blocos
 *  aparecem separados e a linha do tempo continua sendo verdade. */
function groupRuns(rows: EventRow[]): { row: EventRow; count: number }[] {
  const out: { row: EventRow; count: number }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (
      last &&
      last.row.code === row.code &&
      last.row.account_id === row.account_id &&
      last.row.kind === 'error'
    ) {
      last.count += 1;
      continue;
    }
    out.push({ row, count: 1 });
  }
  return out;
}
