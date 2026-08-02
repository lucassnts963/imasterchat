/* eslint-disable no-undef */
// ============================================================
// The service worker.
//
// It exists for exactly one reason: a service worker is the only way a
// browser can be reached while the page is closed, and being reached
// while closed is the whole point of installing this app.
//
// There is NO fetch handler, on purpose. This is a shared, multi-tenant
// inbox authenticated by cookie: a worker that cached authenticated
// responses could hand one attendant's conversations to whoever picks
// up the device next, or keep serving them after logout. It would also
// pin users to a stale JS bundle across deploys, and this bundle
// carries the Supabase URL inlined at build time.
//
// So: no caching, no offline. Push and clicks, nothing else.
// ============================================================

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every tab to close.
  // With no cache there is no old-version state to conflict with, which
  // is exactly what makes this safe here and dangerous elsewhere.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A push we cannot parse is still a push: something happened and
    // the attendant should look. Better a vague notification than
    // silence.
    payload = {}
  }

  const title = payload.title || 'iMasterChat'
  const options = {
    body: payload.body || 'Nova atividade no atendimento.',
    icon: '/pwa-icon?size=192',
    badge: '/pwa-icon?size=192',
    // Collapse by conversation: five messages from one customer while
    // the phone is in a pocket should be one notification that updates,
    // not five that have to be dismissed one by one.
    tag: payload.tag || 'imasterchat',
    renotify: Boolean(payload.renotify),
    data: { url: payload.url || '/inbox' },
    // Handoffs vibrate; ordinary messages do not. The distinction is
    // the point of the "only what needs a human" mode.
    vibrate: payload.urgent ? [120, 60, 120] : undefined,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/inbox'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus a tab that is already open rather than stacking a new
        // one on every notification — an attendant who taps six of
        // these should not end up with six windows.
        for (const client of clients) {
          if ('focus' in client) {
            client.navigate(target)
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      }),
  )
})
