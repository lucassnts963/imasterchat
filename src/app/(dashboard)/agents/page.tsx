'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bot,
  Eye,
  Sparkles,
  Settings2,
  BarChart3,
  Network,
  ShieldAlert,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiCostProjection } from '@/components/agents/ai-cost-projection';
import { AiVault } from '@/components/agents/ai-vault';
import { AiGuardrails } from '@/components/agents/ai-guardrails';
import { AiContext } from '@/components/agents/ai-context';
import { AiConfig } from '@/components/settings/ai-config';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'playground' | 'vault' | 'guardrails' | 'context' | 'setup' | 'usage';

// A ordem da fita numa lista só, como o rail de Configurações faz com
// SETTINGS_SECTIONS: acrescentar uma aba passa a ser uma linha aqui e um
// <TabsContent> lá embaixo, sem repetir a marcação do chip cinco vezes.
const TABS = [
  { value: 'playground', icon: Sparkles, labelKey: 'tabPlayground' },
  { value: 'vault', icon: Network, labelKey: 'vaultTab' },
  { value: 'guardrails', icon: ShieldAlert, labelKey: 'guardrailsTab' },
  { value: 'context', icon: Eye, labelKey: 'tabContext' },
  { value: 'setup', icon: Settings2, labelKey: 'tabSetup' },
  { value: 'usage', icon: BarChart3, labelKey: 'tabUsage' },
] as const satisfies ReadonlyArray<{
  value: Tab;
  icon: typeof Bot;
  labelKey: string;
}>;

export default function AgentsPage() {
  const t = useTranslations('Agents.page');
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('playground');
  const [decided, setDecided] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);

  // A fita rola, então a aba ativa pode nascer fora da vista — é o caso
  // de quem cai em "Configurar" na primeira visita, que é o último chip
  // visível. Mesmo gesto do rail de Configurações. `block: 'nearest'`
  // porque `scrollIntoView` também mexeria no scroll vertical do
  // `<main>`, e a página não deve pular por causa de uma aba.
  useEffect(() => {
    if (!decided) return;
    activeRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [tab, decided]);

  // Land first-time users on Setup, returning users on the Playground.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setTab(data?.configured ? 'playground' : 'setup');
      } catch {
        if (!cancelled) setTab('setup');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('description')}
      </p>

      {decided && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="mt-6"
        >
          <TabsList variant="rail" aria-label={t('title')}>
            {TABS.filter((item) => item.value !== 'usage' || canViewUsage).map(
              ({ value, icon: Icon, labelKey }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  ref={value === tab ? activeRef : undefined}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{t(labelKey)}</span>
                </TabsTrigger>
              ),
            )}
          </TabsList>

          <TabsContent value="playground" className="mt-4">
            <AiPlayground onGoToSetup={() => setTab('setup')} />
          </TabsContent>

          <TabsContent value="vault" className="mt-4">
            <AiVault />
          </TabsContent>

          <TabsContent value="guardrails" className="mt-4">
            <AiGuardrails />
          </TabsContent>

          <TabsContent value="context" className="mt-4">
            <AiContext />
          </TabsContent>

          <TabsContent value="setup" className="mt-4">
            <AiConfig />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="usage" className="mt-4 space-y-4">
              <AiUsageCard />
              <AiCostProjection />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
