import type { MetadataRoute } from 'next'

// ============================================================
// The install manifest.
//
// Deliberately narrow. This makes the app installable — an icon on the
// home screen, a window without browser chrome — and nothing else. No
// offline, no caching: a shared WhatsApp inbox is multi-tenant and
// cookie-authenticated, so a service worker that cached authenticated
// responses could serve one attendant's conversations to whoever picks
// up the device next.
//
// The service worker that ships alongside this exists only to receive
// push notifications and has no fetch handler at all.
// ============================================================

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'iMasterChat',
    short_name: 'iMasterChat',
    description:
      'Atendimento e CRM para WhatsApp — caixa de entrada compartilhada, agenda e agente de IA.',
    start_url: '/inbox',
    // The inbox, not the dashboard: an attendant opening this from the
    // home screen is answering someone, and a notification tap should
    // land where the work is.
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0b',
    theme_color: '#E5484D',
    lang: 'pt-BR',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/pwa-icon?size=192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-icon?size=512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // `maskable` is what stops Android cropping the glyph into a
      // circle and slicing the mark. Same image, padded.
      {
        src: '/pwa-icon?size=512&maskable=1',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
