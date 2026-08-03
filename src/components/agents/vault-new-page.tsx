'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VAULT_PAGE_KINDS } from '@/lib/ai/vault/schema';

// ============================================================
// A página que a pessoa escreve.
//
// Até aqui o vault só crescia pelo keeper: ele lia conversas encerradas
// e propunha. Isso deixa de fora tudo que o negócio sabe e nunca foi
// dito numa conversa — a política de troca, o que a equipe não pode
// prometer, o horário de um feriado.
//
// A rota já existia (`POST /api/ai/vault`) e até grava a nota humana
// como FONTE da página, para o histórico não fingir que o agente
// descobriu sozinho. Faltava só a porta.
//
// Nasce aprovada, ao contrário das do keeper: uma fila de aprovação
// para o que o próprio dono acabou de escrever é cerimônia sem juiz.
// ============================================================

export function VaultNewPage({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('Agents.vault.newPage');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>('rule');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && content.trim().length > 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ai/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          content: content.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? t('error'));
        return;
      }
      toast.success(t('created'));
      setTitle('');
      setContent('');
      setKind('rule');
      setOpen(false);
      onCreated();
    } catch {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="size-4" />
        {t('button')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vault-kind">{t('kind')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(String(v))}>
              <SelectTrigger id="vault-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VAULT_PAGE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`kindHints.${kind}`)}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vault-title">{t('pageTitle')}</Label>
            <Input
              id="vault-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('pageTitlePlaceholder')}
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vault-content">{t('content')}</Label>
            <Textarea
              id="vault-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('contentPlaceholder')}
              rows={6}
            />
            <p className="text-xs text-muted-foreground">{t('contentHint')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
