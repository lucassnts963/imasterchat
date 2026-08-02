'use client';

import { useState } from 'react';
import { Activity, Building2, DollarSign } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminAccountsPanel } from './admin-panel';
import { PricingPanel } from './pricing-panel';
import { EventsPanel } from './events-panel';

// ============================================================
// Três trabalhos sem relação numa tela só, então abas em vez de
// empilhar.
//
// "Eventos" abre primeiro porque é a razão de alguém entrar aqui num
// dia ruim. Contas e preços são consulta; eventos é plantão.
//
// Stacked, the accounts table filled the viewport on its own and the
// pricing panel started 1150px down — present in the DOM, invisible in
// practice, and impossible to find without knowing it was there. A
// screen you have to be told to scroll is a screen that does not have
// the thing on it.
// ============================================================

type Tab = 'events' | 'accounts' | 'pricing';

export function AdminTabs() {
  const [tab, setTab] = useState<Tab>('events');

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList>
        <TabsTrigger value="events">
          <Activity className="mr-1.5 h-4 w-4" /> Eventos
        </TabsTrigger>
        <TabsTrigger value="accounts">
          <Building2 className="mr-1.5 h-4 w-4" /> Contas
        </TabsTrigger>
        <TabsTrigger value="pricing">
          <DollarSign className="mr-1.5 h-4 w-4" /> Preços e câmbio
        </TabsTrigger>
      </TabsList>

      <TabsContent value="events" className="mt-4">
        <EventsPanel />
      </TabsContent>

      <TabsContent value="accounts" className="mt-4">
        <AdminAccountsPanel />
      </TabsContent>

      <TabsContent value="pricing" className="mt-4">
        <PricingPanel />
      </TabsContent>
    </Tabs>
  );
}
