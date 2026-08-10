import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import {
  decideAudioAction,
  isAudioPolicy,
  type AudioAction,
  type AudioPolicy,
} from './policy'
import { transcribeAudio, type TranscriptionProvider } from './transcribe'

// ============================================================
// O áudio que chega, do webhook até a decisão.
//
// Roda ANTES do insert da mensagem, de propósito. Quando a política é
// transcrever, o texto entra como `content_text` da própria linha — e
// daí para frente o áudio deixa de ser um caso especial: o contexto
// inclui, `keyword_match` casa, os guardrails valem, o agente responde.
// Nada disso precisou de alteração.
//
// Gravar depois, num segundo update, teria dado o mesmo resultado no
// banco e um resultado pior no produto: a atendente veria a bolha de
// áudio sem texto até a transcrição chegar, e o gatilho de automação
// já teria disparado com a string vazia.
// ============================================================

interface AudioConfigRow {
  audio_policy: string
  audio_transcription_provider: string
  elevenlabs_api_key: string | null
}

export interface InboundAudioOutcome {
  policy: AudioPolicy
  action: AudioAction
}

/**
 * Decide — e, se for o caso, transcreve.
 *
 * Best-effort de ponta a ponta: qualquer falha vira `ignore`, porque a
 * mensagem do cliente já vai ser gravada de qualquer jeito e derrubar o
 * webhook por causa de áudio seria trocar um problema pequeno por um
 * grande.
 */
export async function handleInboundAudio(args: {
  db: SupabaseClient
  accountId: string
  mediaId: string
  accessToken: string
}): Promise<InboundAudioOutcome> {
  const IGNORE: InboundAudioOutcome = {
    policy: 'ignore',
    action: { action: 'none' },
  }

  try {
    const { data } = await args.db
      .from('ai_configs')
      .select(
        'audio_policy, audio_transcription_provider, elevenlabs_api_key',
      )
      .eq('account_id', args.accountId)
      .maybeSingle<AudioConfigRow>()

    const policy = isAudioPolicy(data?.audio_policy)
      ? data.audio_policy
      : 'ignore'

    // Só a transcrição custa: baixar o áudio e chamar um provedor. As
    // outras políticas decidem sem tocar em rede.
    if (policy !== 'transcribe') {
      return { policy, action: decideAudioAction({ policy }) }
    }

    const provider: TranscriptionProvider =
      data?.audio_transcription_provider === 'elevenlabs'
        ? 'elevenlabs'
        : 'local'

    let apiKey: string | null = null
    if (provider === 'elevenlabs' && data?.elevenlabs_api_key) {
      try {
        apiKey = decrypt(data.elevenlabs_api_key)
      } catch (err) {
        // ENCRYPTION_KEY trocada, tipicamente. Sem chave, a transcrição
        // falha e a política cai no aviso — que é melhor que o silêncio.
        console.error('[audio] chave da ElevenLabs indecifrável:', err)
      }
    }

    const media = await getMediaUrl({
      mediaId: args.mediaId,
      accessToken: args.accessToken,
    })
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: media.url,
      accessToken: args.accessToken,
    })

    const transcript = await transcribeAudio({
      provider,
      audio: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
      mimeType: contentType || media.mimeType,
      apiKey,
      // Português como dica: o Whisper detecta sozinho, mas erra em
      // áudio curto — um "oi" de dois segundos vira inglês com
      // frequência incômoda.
      language: 'pt',
    })

    return { policy, action: decideAudioAction({ policy, transcript }) }
  } catch (err) {
    console.error('[audio] tratamento do áudio falhou:', err)
    return IGNORE
  }
}
