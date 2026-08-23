'use client';

import { useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';

import { AgendaBoard } from '@/components/agenda/agenda-board';

export default function AgendaPage() {
  const t = useTranslations('Agenda');

  return (
    <div>
      <div className="flex items-center gap-2">
        <CalendarDays className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>

      <div className="mt-6">
        <AgendaBoard />
      </div>
    </div>
  );
}
