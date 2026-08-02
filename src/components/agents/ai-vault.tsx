'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Loader2, Network, Trash2, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { VaultGraph, type GraphLink, type GraphNode } from './vault-graph';

// ============================================================
// The vault, curated.
//
// Two things share this screen because they answer the same question
// from opposite ends: the graph shows what the business knows, and the
// queue shows what the agent wants to add to it. Approving from the
// queue is the only way a page joins the graph — and the only way it
// reaches a customer.
// ============================================================

interface VaultPage {
  id: string;
  slug: string;
  kind: string;
  title: string;
  content: string;
  status: 'draft' | 'approved' | 'archived';
  contact_id: string | null;
  version: number;
  updated_at: string;
  contacts?: { name: string | null; phone: string | null } | null;
}

type Tab = 'graph' | 'drafts' | 'pages';

export function AiVault() {
  const t = useTranslations('Agents.vault');
  const [tab, setTab] = useState<Tab>('graph');
  const [pages, setPages] = useState<VaultPage[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: [],
    links: [],
  });
  const [showDraftsInGraph, setShowDraftsInGraph] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pagesRes, graphRes] = await Promise.all([
        fetch('/api/ai/vault'),
        fetch(`/api/ai/vault/graph${showDraftsInGraph ? '?drafts=1' : ''}`),
      ]);
      const pagesData = await pagesRes.json().catch(() => null);
      const graphData = await graphRes.json().catch(() => null);
      if (pagesData?.pages) setPages(pagesData.pages as VaultPage[]);
      if (graphData?.nodes) {
        setGraph({
          nodes: graphData.nodes as GraphNode[],
          links: (graphData.links ?? []) as GraphLink[],
        });
      }
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t, showDraftsInGraph]);

  useEffect(() => {
    void load();
  }, [load]);

  const drafts = useMemo(() => pages.filter((p) => p.status === 'draft'), [pages]);
  const approved = useMemo(
    () => pages.filter((p) => p.status === 'approved'),
    [pages],
  );

  async function decide(page: VaultPage, approve: boolean) {
    setBusyId(page.id);
    try {
      const res = await fetch(`/api/ai/vault/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          approve
            ? { status: 'approved' }
            : { status: 'archived', operation: 'rejected' },
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? t('actionError'));
        return;
      }
      toast.success(approve ? t('approved') : t('rejected'));
      await load();
    } catch {
      toast.error(t('actionError'));
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'graph', label: t('tabs.graph') },
    { id: 'drafts', label: t('tabs.drafts'), count: drafts.length },
    { id: 'pages', label: t('tabs.pages'), count: approved.length },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-border p-0.5">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs',
                tab === entry.id
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {entry.label}
              {entry.count !== undefined && entry.count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    entry.id === 'drafts'
                      ? 'bg-amber-500/20 text-amber-500'
                      : 'bg-muted-foreground/15',
                  )}
                >
                  {entry.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'graph' && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showDraftsInGraph}
              onChange={(e) => setShowDraftsInGraph(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            {t('showDrafts')}
          </label>
        )}

        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {tab === 'graph' && (
        <>
          <VaultGraph
            nodes={graph.nodes}
            links={graph.links}
            className="mt-4 h-[60vh] min-h-[420px]"
            onSelect={(node) => {
              setTab(node.status === 'draft' ? 'drafts' : 'pages');
              setExpanded(node.id);
            }}
          />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Network className="h-3.5 w-3.5" />
            {t('graph.hint')}
          </p>
        </>
      )}

      {tab === 'drafts' && (
        <div className="mt-4 space-y-2">
          {drafts.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              {t('noDrafts')}
            </p>
          ) : (
            drafts.map((page) => (
              <PageCard
                key={page.id}
                page={page}
                expanded={expanded === page.id}
                onToggle={() =>
                  setExpanded((id) => (id === page.id ? null : page.id))
                }
                busy={busyId === page.id}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === page.id}
                      onClick={() => decide(page, false)}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> {t('reject')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyId === page.id}
                      onClick={() => decide(page, true)}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> {t('approve')}
                    </Button>
                  </>
                }
              />
            ))
          )}
        </div>
      )}

      {tab === 'pages' && (
        <div className="mt-4 space-y-2">
          {approved.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              {t('noPages')}
            </p>
          ) : (
            approved.map((page) => (
              <PageCard
                key={page.id}
                page={page}
                expanded={expanded === page.id}
                onToggle={() =>
                  setExpanded((id) => (id === page.id ? null : page.id))
                }
                busy={busyId === page.id}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === page.id}
                    onClick={() => decide(page, false)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> {t('archive')}
                  </Button>
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PageCard({
  page,
  expanded,
  onToggle,
  busy,
  actions,
}: {
  page: VaultPage;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  actions: React.ReactNode;
}) {
  const t = useTranslations('Agents.vault');

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {page.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`graph.kind.${page.kind}`)}
            {page.contacts?.name && ` · ${page.contacts.name}`}
            {page.version > 1 && ` · v${page.version}`}
          </p>
        </div>
        {busy && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <p className="whitespace-pre-wrap text-sm text-foreground/90">
            {page.content}
          </p>
          <div className="flex justify-end gap-2">{actions}</div>
        </div>
      )}
    </div>
  );
}
