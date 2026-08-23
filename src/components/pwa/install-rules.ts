// ============================================================
// As decisões do convite de instalação, sem DOM.
//
// Separadas do componente porque são a parte que não pode quebrar em
// silêncio — "o usuário marcou não exibir mais" é uma promessa, e
// promessa merece teste. O componente lê `localStorage`, `matchMedia` e
// o `userAgent`; tudo o que ele DECIDE a partir disso está aqui, em
// funções que a suíte roda no ambiente `node`.
// ============================================================

/** "Nunca mais" — atravessa sessões, e é o que o usuário marcou. */
export const DISMISS_KEY = 'imasterchat:pwa-install:never';
/** "Agora não" — só até fechar o navegador, para não virar nag. */
export const SNOOZE_KEY = 'imasterchat:pwa-install:snoozed';

export type Platform = 'ios' | 'android' | 'desktop';

export interface OfferInput {
  /** Marcou "não exibir novamente" alguma vez neste aparelho. */
  dismissedForever: boolean;
  /** Fechou o card nesta sessão do navegador. */
  snoozed: boolean;
  /** Já está rodando como app instalado. */
  installed: boolean;
}

/**
 * Oferecer a instalação?
 *
 * A recusa vem primeiro e é absoluta: nada — nem estar fora do app
 * instalado, nem uma sessão nova — reabre um convite que a pessoa
 * dispensou de vez. É o ponto inteiro da caixa de seleção.
 */
export function shouldOffer({
  dismissedForever,
  snoozed,
  installed,
}: OfferInput): boolean {
  if (dismissedForever) return false;
  if (snoozed) return false;
  if (installed) return false;
  return true;
}

/**
 * Que instruções mostrar quando o navegador não oferece o diálogo
 * nativo.
 *
 * O iPad moderno se apresenta como Macintosh; o que o entrega é a tela
 * sensível ao toque, que Mac nenhum tem. Sem essa checagem o usuário de
 * iPad receberia a instrução de desktop ("ícone na barra de endereço"),
 * que no Safari do iPad não existe.
 */
export function detectPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): Platform {
  const iPadOS = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(userAgent) || iPadOS) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'desktop';
}
