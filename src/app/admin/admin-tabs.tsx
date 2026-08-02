'use client';

import { useState } from 'react';
import { Building2, DollarSign } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminAccountsPanel } from './admin-panel';
import { PricingPanel } from './pricing-panel';

// ============================================================
// Two unrelated jobs on one screen, so they get tabs rather than a
// stack.
//
// Stacked, the accounts table filled the viewport on its own and the
// pricing panel started 1150px down — present in the DOM, invisible in
// practice, and impossible to find without knowing it was there. A
// screen you have to be told to scroll is a screen that does not have
// the thing on it.
// ============================================================

type Tab = 'accounts' | 'pricing';

export function AdminTabs() {
  const [tab, setTab] = useState<Tab>('accounts');

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList>
        <TabsTrigger value="accounts">
          <Building2 className="mr-1.5 h-4 w-4" /> Contas
        </TabsTrigger>
        <TabsTrigger value="pricing">
          <DollarSign className="mr-1.5 h-4 w-4" /> Preços e câmbio
        </TabsTrigger>
      </TabsList>

      <TabsContent value="accounts" className="mt-4">
        <AdminAccountsPanel />
      </TabsContent>

      <TabsContent value="pricing" className="mt-4">
        <PricingPanel />
      </TabsContent>
    </Tabs>
  );
}
