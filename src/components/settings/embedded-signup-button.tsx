'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { WhatsAppIcon } from '@/components/ui/whatsapp-icon';
import { readSignupMessage } from '@/lib/whatsapp/embedded-signup';

// ============================================================
// Embedded Signup — the one-click WhatsApp connection.
//
// Under the Tech Provider model the client never creates a Meta app or
// copies a token: they authorise through Meta's popup and we finish the
// wiring server-side (POST /api/whatsapp/embedded-signup).
//
// Two channels come back from that popup and we need BOTH:
//
//   1. `code`  — from the FB.login callback. Traded for the business
//      token server-side (it needs the app secret).
//   2. `session info` — a postMessage carrying which WABA and phone
//      number the user actually picked. Without it, a client whose WABA
//      hosts several numbers would have us guess, and guessing wrong
//      routes another number's messages into this account.
//
// The message listener therefore has to be installed BEFORE FB.login
// runs, and torn down after — a listener that outlives the flow would
// keep accepting messages from any origin claiming to be Facebook.
// ============================================================

interface SessionInfo {
  phoneNumberId?: string;
  wabaId?: string;
}

/** What Meta said when the dialog ended without handing us a code. */
interface CancelInfo {
  step?: string;
  errorMessage?: string;
}

interface EmbeddedSignupButtonProps {
  appId: string;
  configId: string;
  /** Called after a successful connection so the parent can refetch. */
  onConnected: () => void;
}

declare global {
  interface Window {
    FB?: {
      init: (opts: Record<string, unknown>) => void;
      login: (
        cb: (res: { authResponse?: { code?: string } }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_ELEMENT_ID = 'facebook-jssdk';

export function EmbeddedSignupButton({
  appId,
  configId,
  onConnected,
}: EmbeddedSignupButtonProps) {
  const t = useTranslations('Settings.whatsapp.embeddedSignup');
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // Written by the postMessage listener, read by the FB.login callback.
  // A ref (not state) because the callback closes over it and must see
  // the value the listener wrote moments earlier, not a stale render.
  const sessionInfo = useRef<SessionInfo>({});
  // Same reason as sessionInfo: written by the listener, read by the
  // FB.login callback moments later.
  const cancelInfo = useRef<CancelInfo>({});

  // Load the Facebook JS SDK once. Deliberately not a next/script tag:
  // this component only renders when the deployment is configured as a
  // Tech Provider, and pulling Meta's SDK into every page load for
  // everyone else would be a gratuitous third-party request.
  useEffect(() => {
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    if (document.getElementById(SDK_ELEMENT_ID)) return;

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v21.0',
      });
      setSdkReady(true);
    };

    const script = document.createElement('script');
    script.id = SDK_ELEMENT_ID;
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    document.body.appendChild(script);
  }, [appId]);

  const finish = useCallback(
    async (code: string) => {
      setConnecting(true);
      try {
        const res = await fetch('/api/whatsapp/embedded-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            phoneNumberId: sessionInfo.current.phoneNumberId,
            wabaId: sessionInfo.current.wabaId,
          }),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          // The server distinguishes these because they need different
          // fixes from the user, not just "try again".
          const reason = data?.error as string | undefined;
          if (reason === 'phone_number_already_claimed') {
            toast.error(t('errorNumberClaimed'));
          } else if (reason === 'multiple_wabas' || reason === 'multiple_phone_numbers') {
            toast.error(t('errorAmbiguous'));
          } else if (reason === 'server_not_configured') {
            toast.error(t('errorNotConfigured'));
          } else if (reason === 'no_waba_shared') {
            // Both of these used to fall through to "try again", which is
            // the one thing that does not help: nothing about repeating
            // the flow changes what the token was granted.
            toast.error(t('errorNoWaba'));
          } else if (reason === 'no_phone_number') {
            toast.error(t('errorNoNumber'));
          } else {
            toast.error(data?.message || t('errorGeneric'));
          }
          return;
        }

        // Connected, but Meta didn't accept the webhook wiring — the
        // client can send but won't receive, and silently "working"
        // is the worst outcome here.
        if (!data.subscribed || !data.registered) {
          toast.warning(t('connectedNoInbound'));
        } else {
          toast.success(
            data.verifiedName
              ? t('connectedTo', { name: data.verifiedName })
              : t('connected'),
          );
        }
        onConnected();
      } catch {
        toast.error(t('errorGeneric'));
      } finally {
        setConnecting(false);
      }
    },
    [onConnected, t],
  );

  const launch = useCallback(() => {
    if (!window.FB) return;
    sessionInfo.current = {};
    cancelInfo.current = {};

    const onMessage = (event: MessageEvent) => {
      // Origin check first — this listener is open to the whole page
      // while the popup is up.
      if (
        event.origin !== 'https://www.facebook.com' &&
        event.origin !== 'https://web.facebook.com'
      ) {
        return;
      }
      const message = readSignupMessage(event.data);
      if (!message) return;

      if (message.kind === 'finish') {
        sessionInfo.current = {
          phoneNumberId: message.phoneNumberId,
          wabaId: message.wabaId,
        };
        return;
      }

      // Meta's own dialog refused — a restricted business portfolio, an
      // ineligible number. FB.login then calls back with no code, which
      // is indistinguishable from "the user closed the window" unless we
      // keep what was said here. Without this the screen stayed silent
      // and the only way to see the reason was a photo of the popup.
      cancelInfo.current = { step: message.step, errorMessage: message.errorMessage };
      console.error('[embedded signup] Meta ended the dialog without a code:', message);
    };

    window.addEventListener('message', onMessage);

    window.FB.login(
      (response) => {
        window.removeEventListener('message', onMessage);
        const code = response?.authResponse?.code;
        if (!code) {
          const { step, errorMessage } = cancelInfo.current;
          if (errorMessage) {
            toast.error(t('errorFromMeta', { message: errorMessage }));
          } else if (step) {
            toast.error(t('errorCancelledAt', { step }));
          }
          // No cancel payload at all means the user simply closed the
          // popup or declined — not an error worth a red toast.
          return;
        }
        void finish(code);
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        // Estes `extras` precisam BATER com a configuração de Embedded
        // Signup criada no painel da Meta — o `config_id` sozinho não
        // basta. Os valores abaixo são os que a Meta gera no link de
        // onboarding da nossa configuração; se você recriar a
        // configuração lá, confira o link de novo antes de mexer aqui.
        //
        // `featureType: 'whatsapp_business_app_onboarding'` é o fluxo de
        // COEXISTÊNCIA: o cliente continua usando o WhatsApp Business no
        // celular, mantém o histórico, e a Meta sincroniza as duas
        // pontas. Vazio seria a migração pura para a Cloud API, em que o
        // app do celular deixa de funcionar — inaceitável para uma loja
        // que atende pelo aparelho do balcão.
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
          version: 'v4',
        },
      },
    );
  }, [configId, finish, t]);

  return (
    <div className="space-y-2">
      <Button onClick={launch} disabled={!sdkReady || connecting}>
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('connecting')}
          </>
        ) : (
          <>
            <WhatsAppIcon className="h-4 w-4" />
            {t('cta')}
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  );
}
