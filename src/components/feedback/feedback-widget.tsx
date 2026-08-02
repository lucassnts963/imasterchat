'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Bug,
  Camera,
  Check,
  Lightbulb,
  Loader2,
  MessageSquare,
  MessageSquareHeart,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { canCaptureScreen, captureScreen } from './screenshot';

// ============================================================
// "Isso aqui está quebrado" — em dois cliques, de dentro do app.
//
// A ideia vem do Feedget: botão flutuante, três tipos, print opcional,
// um POST. O que muda por estar dentro de uma sessão autenticada é o
// que vai junto sem ninguém digitar — conta, usuário, tela, viewport,
// e o último erro que o console registrou. É a diferença entre "não
// funcionou" e um chamado que dá para trabalhar.
//
// Fica fora do fluxo de atendimento de propósito: canto inferior
// direito, discreto, e some ao abrir. Uma atendente com o cliente
// esperando não pode ter um botão de feedback competindo por atenção
// com a conversa.
// ============================================================

type Kind = 'bug' | 'idea' | 'other';
type Stage = 'type' | 'compose' | 'sent';

const KINDS: { id: Kind; icon: typeof Bug }[] = [
  { id: 'bug', icon: Bug },
  { id: 'idea', icon: Lightbulb },
  { id: 'other', icon: MessageSquare },
];

export function FeedbackWidget() {
  const t = useTranslations('Feedback');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [cramped, setCramped] = useState(false);
  const [stage, setStage] = useState<Stage>('type');
  const [kind, setKind] = useState<Kind>('bug');
  const [comment, setComment] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const [sending, setSending] = useState(false);
  const lastError = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Guarda o último erro do console para mandar junto. Muitas vezes é
  // literalmente a resposta, e custa nada coletar. Só o último: um
  // buffer seria memória crescendo numa aba que fica aberta o dia
  // inteiro, para um dado que ninguém lê depois do primeiro.
  useEffect(() => {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      try {
        lastError.current = args
          .map((a) => (a instanceof Error ? a.message : String(a)))
          .join(' ')
          .slice(0, 500);
      } catch {
        // Nunca deixar a captura quebrar o console de quem está usando.
      }
      original(...args);
    };
    const onError = (e: ErrorEvent) => {
      lastError.current = `${e.message} @ ${e.filename}:${e.lineno}`.slice(0, 500);
    };
    window.addEventListener('error', onError);
    return () => {
      console.error = original;
      window.removeEventListener('error', onError);
    };
  }, []);

  // No celular, a caixa de entrada põe a barra de composição no
  // rodapé e o botão de enviar no canto inferior direito — exatamente
  // onde este botão flutuante fica. Uma atendente com o cliente
  // esperando não pode errar o "enviar" e abrir um formulário de
  // feedback.
  //
  // Some só ali, e só no estreito: em qualquer outra tela, e em
  // qualquer tela larga, ele continua ao alcance.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setCramped(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const reset = useCallback(() => {
    setStage('type');
    setComment('');
    setShot(null);
  }, []);

  function close() {
    setOpen(false);
    // Espera a saída antes de limpar, senão o painel pisca vazio.
    setTimeout(reset, 200);
  }

  function pick(next: Kind) {
    setKind(next);
    setStage('compose');
    setTimeout(() => textarea.current?.focus(), 50);
  }

  async function grab() {
    setShooting(true);
    // O seletor nativo cobre a tela, e um painel de feedback por cima
    // do que a pessoa quer mostrar é exatamente o print errado.
    setOpen(false);
    const result = await captureScreen();
    setOpen(true);
    setShooting(false);

    if (result.ok) {
      setShot(result.dataUrl);
      return;
    }
    if (result.reason === 'cancelled') return; // resposta legítima
    toast.error(
      result.reason === 'unsupported' ? t('shotUnsupported') : t('shotFailed'),
    );
  }

  async function send() {
    if (comment.trim().length < 3) return;
    setSending(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          comment,
          screenshot: shot,
          context: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            locale: navigator.language,
            standalone: window.matchMedia('(display-mode: standalone)').matches,
            lastConsoleError: lastError.current,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('sendError'));
        return;
      }
      setStage('sent');
    } catch {
      toast.error(t('sendError'));
    } finally {
      setSending(false);
    }
  }

  if (cramped && pathname.startsWith('/inbox')) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={t('open')}
        className="group fixed bottom-4 right-4 z-40 flex h-11 items-center rounded-full bg-primary px-3 text-primary-foreground shadow-lg transition-all hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <MessageSquareHeart className="h-5 w-5 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm transition-all duration-300 group-hover:max-w-[10rem]">
          <span className="pl-2">{t('open')}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-xl border border-border bg-popover p-4 shadow-xl">
      <button
        onClick={close}
        aria-label={t('close')}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      {stage === 'sent' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-5 w-5 text-primary" />
          </span>
          <p className="text-sm font-medium text-foreground">{t('thanks')}</p>
          <p className="text-xs text-muted-foreground">{t('thanksHint')}</p>
          <Button variant="outline" size="sm" onClick={reset}>
            {t('sendAnother')}
          </Button>
        </div>
      ) : stage === 'type' ? (
        <>
          <p className="pr-6 text-sm font-medium text-foreground">
            {t('title')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('subtitle')}</p>
          <div className="mt-3 flex gap-2">
            {KINDS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => pick(id)}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/30 py-3 text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus-visible:border-primary"
              >
                <Icon className="h-5 w-5 text-muted-foreground" />
                {t(`kind.${id}`)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="pr-6 text-sm font-medium text-foreground">
            {t(`kind.${kind}`)}
          </p>
          <textarea
            ref={textarea}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder={t(`placeholder.${kind}`)}
            className="mt-2 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {shot ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shot}
                alt=""
                className="h-10 w-16 rounded object-cover object-left-top"
              />
              <span className="flex-1 text-xs text-muted-foreground">
                {t('shotAttached')}
              </span>
              <button
                onClick={() => setShot(null)}
                aria-label={t('shotRemove')}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            canCaptureScreen() && (
              <button
                onClick={grab}
                disabled={shooting}
                className="mt-2 flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                {shooting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                {t('shotAdd')}
              </button>
            )
          )}

          {/* Um print da caixa de entrada leva a conversa de um cliente
              da ótica junto. Quem manda precisa saber disso ANTES, não
              depois — e por isso o aviso fica visível sempre, não só
              quando já anexou. */}
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {shot ? t('shotWarningAttached') : t('shotWarning')}
          </p>

          <div className="mt-3 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStage('type')}
              disabled={sending}
            >
              {t('back')}
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={send}
              disabled={sending || comment.trim().length < 3}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('send')
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
