'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

// ============================================================
// O que o modelo lê antes de responder.
//
// Esta tela existe por causa de um chamado concreto: o bot recusou um
// horário, o dono abriu a agenda, viu vago, e concluiu que estava
// quebrado. Não estava — a antecedência mínima da conta derrubou o
// horário. A resposta estava no contexto, e não havia por onde ver o
// contexto sem ler código.
//
// Daí as duas decisões desta tela:
//
//   1. Mostra o TEXTO, não um resumo. Uma tela que descreve o prompt
//      com outras palavras vira mais uma coisa para desconfiar.
//   2. Cada seção diz ONDE se muda aquilo, com link. Ver sem poder
//      mexer é metade do problema — e a metade que não resolve chamado.
// ============================================================

type Source =
  | 'scaffold'
  | 'agent_settings'
  | 'scheduling_settings'
  | 'vault'
  | 'guardrails'
  | 'knowledge'
  | 'conversation'
  | 'tools';

interface Section {
  key: string;
  text: string;
  tokens: number;
  source: Source;
  empty: boolean;
}

interface Preview {
  configured: boolean;
  sections?: Section[];
  totalTokens?: number;
  timestampsEnabled?: boolean;
}

/** Para onde o botão "onde muda isso" leva. Null = não se configura. */
const SOURCE_HREF: Record<Source, string | null> = {
  scaffold: null,
  agent_settings: '/agents?tab=setup',
  scheduling_settings: '/settings?tab=scheduling',
  vault: '/agents?tab=vault',
  guardrails: '/agents?tab=guardrails',
  knowledge: '/settings?tab=whatsapp',
  conversation: '/inbox',
  tools: '/agents?tab=setup',
};

export function AiContext() {
  const t = useTranslations('Agents.context');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/context');
      setPreview(await res.json());
    } catch {
      setPreview({ configured: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </p>
    );
  }

  if (!preview?.configured || !preview.sections) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t('notConfigured')}
      </p>
    );
  }

  const { sections, totalTokens = 0 } = preview;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-xs text-muted-foreground">
          {t('description')}
        </p>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {totalTokens.toLocaleString()}
          </p>
          <p className="text-[11px] text-muted-foreground">{t('totalTokens')}</p>
        </div>
      </div>

      <ul className="space-y-2">
        {sections.map((section) => {
          const isOpen = open === section.key;
          const href = SOURCE_HREF[section.source];
          const share = totalTokens > 0 ? section.tokens / totalTokens : 0;
          return (
            <li
              key={section.key}
              className="overflow-hidden rounded-lg border border-border"
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : section.key)}
                className="flex w-full items-center gap-3 p-3 text-left"
              >
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform',
                    isOpen && 'rotate-180',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {t(`sections.${section.key}`)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {section.empty
                      ? t('sectionEmpty')
                      : t(`hints.${section.key}`)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs tabular-nums text-foreground">
                    {section.tokens.toLocaleString()}
                  </p>
                  {/* A barra é o que faz a conversa mudar de "está caro"
                      para "o vault está caro". */}
                  <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border bg-muted/40 p-3">
                  {section.empty ? (
                    <p className="text-xs text-muted-foreground">
                      {t('emptyDetail')}
                    </p>
                  ) : (
                    <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap text-foreground">
                      {section.text}
                    </pre>
                  )}
                  {href && (
                    <Link
                      href={href}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <ExternalLink className="size-3.5" />
                      {t('editAt')}
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">{t('knowledgeNote')}</p>
    </div>
  );
}
