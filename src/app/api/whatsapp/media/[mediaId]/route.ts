import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

// ============================================================
// O tipo do arquivo é decidido AQUI, não pelo remetente.
//
// A Meta repassa o mime que quem enviou declarou. Um cliente qualquer,
// sem conta e sem login, manda um "documento" chamado
// "orcamento-2026.pdf" cujo mime é text/html com <script> dentro. A
// atendente clica no anexo, e o navegador executa aquilo NA ORIGEM DO
// APP, dentro da sessão autenticada dela.
//
// A lista abaixo é o conserto: o que não estiver nela é servido como
// binário e baixado em vez de aberto. `nosniff` fecha a outra metade,
// impedindo o navegador de adivinhar um tipo melhor que o nosso.
// ============================================================
const INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/amr',
  'audio/ogg',
  'audio/opus',
  'video/mp4',
  'video/3gpp',
])

/** PDF é o único não-mídia que vale abrir embutido — é metade dos anexos
 *  de um orçamento, e os navegadores o renderizam num visualizador
 *  próprio, sem executar script na nossa origem. */
const INLINE_DOCUMENT_TYPES = new Set(['application/pdf'])

function safeContentType(raw: string | null | undefined): {
  type: string
  inline: boolean
} {
  // Corta parâmetros ("audio/ogg; codecs=opus") e normaliza.
  const base = (raw ?? '').split(';')[0]!.trim().toLowerCase()

  if (INLINE_TYPES.has(base)) return { type: base, inline: true }
  if (INLINE_DOCUMENT_TYPES.has(base)) return { type: base, inline: true }

  // Tudo o mais — inclusive text/html, image/svg+xml e qualquer coisa
  // que a Meta invente amanhã — baixa como binário.
  return { type: 'application/octet-stream', inline: false }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    const safe = safeContentType(contentType || mediaInfo.mimeType)

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': safe.type,
        // Só imagem, áudio e vídeo abrem na própria página. Todo o resto
        // baixa, e é isso que impede um "documento" de virar página.
        'Content-Disposition': safe.inline ? 'inline' : 'attachment',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
