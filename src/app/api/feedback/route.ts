import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/admin/client'
import { esc, isTelegramConfigured, sendTelegramAlert } from '@/lib/observability/telegram'

// ============================================================
// POST /api/feedback — o cliente diz o que quebrou
// GET  /api/feedback — o que ele já mandou, e no que deu
//
// O widget do feedget original recebe um texto solto e um print. Aqui
// ele está DENTRO de uma sessão autenticada, e isso muda o que a
// mensagem vale: dá para saber a conta, o usuário, a tela e o build
// sem perguntar nada. É o que transforma "não funcionou" em algo
// acionável.
//
// E é o mesmo lugar onde as falhas detectadas pelo código caem. Quando
// a cliente escreve "o bot parou", o alerta que chega no Telegram já
// vem com quantos erros a conta dela acumulou na última hora. Esse
// cruzamento é o ponto inteiro de guardar as duas coisas juntas.
// ============================================================

const KINDS = ['bug', 'idea', 'other'] as const
type Kind = (typeof KINDS)[number]

const LABEL: Record<Kind, string> = {
  bug: '🐛 Problema',
  idea: '💡 Ideia',
  other: '💬 Outro',
}

/** Teto do print. Um JPEG de 1600px de largura a 75% fica bem abaixo
 *  disto; o limite existe para um cliente com monitor 5K não mandar
 *  seis megabytes de base64 num INSERT. */
const MAX_SCREENSHOT_BYTES = 3_000_000

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    // Autenticado não quer dizer sem teto: cada relato pode carregar
    // ~3 MB de imagem, e uma sessão comprometida — ou um clique nervoso
    // — encheria a tabela de eventos rapidinho.
    const limit = checkRateLimit(`feedback:${userId}`, RATE_LIMITS.feedback)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as {
      kind?: unknown
      comment?: unknown
      screenshot?: unknown
      context?: unknown
    } | null

    const kind = KINDS.includes(body?.kind as Kind) ? (body!.kind as Kind) : null
    const comment =
      typeof body?.comment === 'string' ? body.comment.trim() : ''

    if (!kind) {
      return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 })
    }
    if (comment.length < 3) {
      return NextResponse.json(
        { error: 'Conte o que aconteceu.' },
        { status: 400 },
      )
    }

    let screenshot: string | null = null
    if (typeof body?.screenshot === 'string' && body.screenshot) {
      if (!/^data:image\/(png|jpeg);base64,/.test(body.screenshot)) {
        return NextResponse.json(
          { error: 'Formato de imagem inválido.' },
          { status: 400 },
        )
      }
      if (body.screenshot.length > MAX_SCREENSHOT_BYTES) {
        return NextResponse.json(
          { error: 'A imagem ficou grande demais.' },
          { status: 413 },
        )
      }
      screenshot = body.screenshot
    }

    // O que o cliente manda sobre si mesmo é dica, não verdade: `url` e
    // `userAgent` vêm do navegador dele e vão para o `context` como
    // texto cortado. Conta e usuário vêm da sessão, e são esses que
    // valem.
    const raw = (body?.context ?? {}) as Record<string, unknown>
    const context = {
      url: str(raw.url, 500),
      userAgent: str(raw.userAgent, 300) || request.headers.get('user-agent'),
      viewport: str(raw.viewport, 30),
      locale: str(raw.locale, 20),
      standalone: raw.standalone === true,
      // O último erro que o próprio navegador registrou. Muitas vezes é
      // literalmente a resposta, e é grátis de coletar.
      lastConsoleError: str(raw.lastConsoleError, 500),
    }

    const { data, error } = await supabase
      .from('platform_events')
      .insert({
        account_id: accountId,
        user_id: userId,
        kind: 'report',
        // Um relato de cliente não é uma falha detectada: nunca é
        // 'critical' e nunca dispara o caminho de alerta automático de
        // `recordEvent`. O aviso abaixo é outro, com outro texto.
        severity: kind === 'bug' ? 'error' : 'info',
        status: 'open',
        source: 'app',
        code: kind,
        message: comment.slice(0, 2000),
        context,
        screenshot,
      })
      .select('id, created_at')
      .single<{ id: string; created_at: string }>()

    if (error) {
      console.error('[feedback] insert falhou:', error)
      return NextResponse.json(
        { error: 'Não foi possível enviar. Tente de novo.' },
        { status: 500 },
      )
    }

    void notify({ id: data.id, kind, comment, accountId, context })

    return NextResponse.json({ id: data.id, created_at: data.created_at })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET() {
  try {
    const { supabase, userId } = await getCurrentAccount()

    // Sem a coluna `screenshot`: a listagem não precisa dela e
    // arrastá-la faria cada abertura do widget baixar megabytes.
    const { data, error } = await supabase
      .from('platform_events')
      .select('id, code, message, status, resolution_note, created_at, resolved_at')
      .eq('kind', 'report')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json({ reports: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v ? v.slice(0, max) : null
}

/**
 * O aviso no Telegram — e o cruzamento que justifica a tabela única.
 *
 * Roda com service role porque precisa ler o nome da conta e contar os
 * eventos de erro dela, e nenhuma das duas coisas é visível para o
 * usuário que reportou.
 */
async function notify(args: {
  id: string
  kind: Kind
  comment: string
  accountId: string
  context: Record<string, unknown>
}): Promise<void> {
  if (!isTelegramConfigured()) return

  try {
    const db = supabaseAdmin()

    const [{ data: account }, { count }] = await Promise.all([
      db
        .from('accounts')
        .select('name')
        .eq('id', args.accountId)
        .maybeSingle<{ name: string }>(),
      db
        .from('platform_events')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', args.accountId)
        .eq('kind', 'error')
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    ])

    const lines = [
      `${LABEL[args.kind]} — <b>${esc(account?.name ?? args.accountId)}</b>`,
      '',
      esc(args.comment.slice(0, 800)),
    ]

    if (args.context.url) {
      lines.push('', `<b>Tela:</b> <code>${esc(args.context.url)}</code>`)
    }
    if (args.context.lastConsoleError) {
      lines.push(
        `<b>Último erro no console:</b> <code>${esc(args.context.lastConsoleError)}</code>`,
      )
    }

    // A frase que faz o operador já saber a causa antes de responder.
    if (count && count > 0) {
      lines.push(
        '',
        `⚠️ <b>Esta conta acumulou ${count} falha(s) na última hora.</b> Veja em /admin → Eventos.`,
      )
    }

    lines.push('', `<code>${esc(args.id)}</code>`)
    await sendTelegramAlert(lines.join('\n'))
  } catch (err) {
    console.error('[feedback] aviso não saiu:', err)
  }
}
