// ============================================================
// O canal de alerta: um bot do Telegram.
//
// Não é WhatsApp, e a razão é estrutural e não preferência. Um alerta
// para o operador é mensagem iniciada pelo negócio, fora de qualquer
// janela de 24h: na Cloud API isso exige template aprovado e é
// cobrado. Além do custo, o texto teria que caber num template
// pré-aprovado com variáveis — não cabe "14 falhas de invalid_key na
// conta X desde as 6h" — e cada tipo novo de alerta viraria uma
// aprovação nova na Meta.
//
// O WhatsApp continua sendo o canal do CLIENTE, onde quem inicia é ele
// e a janela trabalha a favor. Este é o canal da MÁQUINA para o
// operador, e são coisas diferentes.
//
// Há um risco circular a nomear: se o que quebrou fosse o WhatsApp e o
// alerta saísse por WhatsApp, o alerta não chegaria. Telegram é uma
// dependência que falha independente do resto do sistema, e isso é
// mais uma vantagem do que um acaso.
//
// `fetch` cru, como o resto do codebase fala com o mundo (a exceção é
// `web-push`, e por criptografia). A API do Telegram é HTTP e JSON.
// ============================================================

const API = 'https://api.telegram.org'

export function isTelegramConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_ALERT_CHAT_ID?.trim(),
  )
}

/**
 * Manda uma mensagem para o chat de alertas.
 *
 * Nunca lança. Isto roda no caminho de tratamento de erro — se o
 * Telegram estiver fora, o efeito precisa ser "o alerta não chegou",
 * nunca "a falha original virou duas".
 */
export async function sendTelegramAlert(
  text: string,
): Promise<{ sent: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim()
  if (!token || !chatId) return { sent: false, reason: 'not_configured' }

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        // O alerta é para ser lido, não para virar um cartão de link
        // com preview de algum domínio citado na mensagem.
        disable_web_page_preview: true,
      }),
      // Curto de propósito: isto está no caminho de uma requisição que
      // já falhou. Esperar dez segundos por um alerta atrasaria a
      // resposta de erro que o usuário está esperando.
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[telegram] alerta recusado', res.status, body.slice(0, 300))
      return { sent: false, reason: `http_${res.status}` }
    }
    return { sent: true }
  } catch (err) {
    console.error('[telegram] alerta não saiu:', err)
    return { sent: false, reason: 'network_error' }
  }
}

/** Escapa o que vai dentro de uma mensagem em parse_mode HTML. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
