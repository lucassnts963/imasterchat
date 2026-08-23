'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Share, MoreVertical, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  DISMISS_KEY,
  SNOOZE_KEY,
  detectPlatform,
  shouldOffer,
  type Platform,
} from './install-rules';

// ============================================================
// O convite para instalar o app na tela de início.
//
// Instalar não é enfeite aqui: notificação push só alcança quem está
// com o app FECHADO, e no iOS o navegador só entrega push depois que o
// site virou ícone na tela de início. Quem não instala fica sem o aviso
// que faz o atendimento acontecer fora do horário em que a aba está
// aberta.
//
// ------------------------------------------------------------
// POR QUE NEM SEMPRE TEM BOTÃO DE UM TOQUE
//
// O caminho ideal é o `beforeinstallprompt`: o navegador avisa que o
// app é instalável, a gente guarda o evento e um clique abre o diálogo
// nativo. Só que o Chrome ainda exige um `fetch` handler no service
// worker para DISPARAR esse evento — a exigência caiu para a instalação
// pelo menu (Chrome 108 no mobile, 112 no desktop) mas continua de pé
// para o prompt programático.
//
// O `public/sw.js` deste app não tem `fetch` handler de propósito: é
// uma caixa de entrada multi-inquilino autenticada por cookie, e um
// worker que cacheasse resposta autenticada poderia entregar a conversa
// de uma atendente para quem pegasse o aparelho depois. A escolha está
// documentada lá, e não é este card que vai desfazê-la.
//
// Então o card degrada: se o evento chegar (hoje, outros navegadores;
// amanhã, o Chrome, se relaxar a regra), aparece o botão de um toque.
// Se não chegar, aparecem as instruções da plataforma — que funcionam
// em todo lugar, inclusive no iOS, onde o `beforeinstallprompt` nunca
// existiu.
// ------------------------------------------------------------
//
// A recusa é POR APARELHO (localStorage), não por usuário no banco.
// Instalar é um ato do aparelho: quem dispensou no computador da loja
// continua sendo convidado no próprio celular, que é justamente onde
// instalar importa.
// ============================================================

/** Não existe em `lib.dom`: é uma extensão só do Chromium. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Já está rodando instalado? Então não há o que oferecer. */
function isInstalled(): boolean {
  // `standalone` é o sinal do iOS, anterior ao padrão e ainda o único
  // que o Safari dá.
  const iosStandalone = (
    navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return (
    iosStandalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  );
}

export function PwaInstallCard() {
  const t = useTranslations('Pwa.install');
  // `null` enquanto não decidiu — o servidor não tem localStorage nem
  // matchMedia, e renderizar o card no HTML para escondê-lo depois
  // daria um piscar em toda visita.
  const [show, setShow] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<Platform>('desktop');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [never, setNever] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints));

    let dismissedForever = false;
    let snoozed = false;
    try {
      dismissedForever = localStorage.getItem(DISMISS_KEY) === '1';
      snoozed = sessionStorage.getItem(SNOOZE_KEY) === '1';
    } catch {
      // Navegação privada com storage bloqueado: sem memória da recusa,
      // o card aparece. Preferível a sumir para quem quer instalar.
    }
    setShow(shouldOffer({ dismissedForever, snoozed, installed: isInstalled() }));

    const onPrompt = (event: Event) => {
      // Sem isto o Chrome mostra a própria barrinha, e o convite
      // apareceria duas vezes dizendo a mesma coisa.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    // Instalou por qualquer caminho — pelo botão daqui, pelo menu do
    // navegador, por outra aba. Convidar de novo seria conversar com
    // quem já disse sim.
    const onInstalled = () => {
      try {
        localStorage.setItem(DISMISS_KEY, '1');
      } catch {}
      setShow(false);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Marcar já grava. Quem marca e sai da página sem fechar o card
  // também está dizendo "não me pergunte mais", e a caixa marcada tem
  // que valer por si.
  const toggleNever = useCallback((checked: boolean) => {
    setNever(checked);
    try {
      if (checked) localStorage.setItem(DISMISS_KEY, '1');
      else localStorage.removeItem(DISMISS_KEY);
    } catch {}
  }, []);

  const close = useCallback(() => {
    if (!never) {
      try {
        sessionStorage.setItem(SNOOZE_KEY, '1');
      } catch {}
    }
    setShow(false);
  }, [never]);

  async function install() {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      // O evento é de uso único: depois de `prompt()` ele não serve
      // mais, e guardá-lo daria um botão que não faz nada.
      setDeferred(null);
      if (outcome === 'accepted') setShow(false);
    } catch {
      setDeferred(null);
    } finally {
      setBusy(false);
    }
  }

  if (show !== true) return null;

  return (
    <Card className="border-primary/25 bg-primary-soft/40">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Download className="size-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t('title')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('description')}
            </p>
          </div>

          {deferred ? (
            <Button size="sm" onClick={install} disabled={busy}>
              <Download className="size-4" />
              {busy ? t('installing') : t('action')}
            </Button>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-foreground/80">
              {platform === 'ios' ? (
                <>
                  <Share className="size-4 shrink-0" />
                  {t('stepsIos')}
                </>
              ) : platform === 'android' ? (
                <>
                  <MoreVertical className="size-4 shrink-0" />
                  {t('stepsAndroid')}
                </>
              ) : (
                <>
                  <Download className="size-4 shrink-0" />
                  {t('stepsDesktop')}
                </>
              )}
            </p>
          )}

          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={never} onCheckedChange={toggleNever} />
            {t('never')}
          </label>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={close}
          aria-label={t('close')}
          className="-mt-1 -mr-1 shrink-0 self-start text-muted-foreground"
        >
          <X className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
