// ============================================================
// Transcrição de áudio — dois provedores, uma porta.
//
// A escolha entre eles é do cliente, e não é só de preço:
//
//   local        o Whisper da própria VPS. Não cobra por minuto, e o
//                áudio do cliente NÃO SAI DAQUI — que para conversa de
//                paciente ou de contrato pode ser o argumento inteiro.
//                Em troca, gasta CPU da máquina e é mais lento.
//   elevenlabs   a API deles. Mais rápida e mais precisa, sobretudo com
//                áudio ruim de celular. Cobra por minuto e o áudio sai
//                para um terceiro.
//
// Nenhum dos dois lança: falha de transcrição não pode derrubar o
// webhook nem sumir com a mensagem do cliente. Devolve `null`, e quem
// chama decide (hoje: cai no aviso, para o cliente não ficar no vácuo).
// ============================================================

export type TranscriptionProvider = 'elevenlabs' | 'local'

export interface TranscribeInput {
  provider: TranscriptionProvider
  /** Os bytes do áudio, já baixados da Meta. */
  audio: ArrayBuffer
  mimeType: string
  /** Chave da ElevenLabs, decifrada. Ignorada no provedor local. */
  apiKey?: string | null
  /** Origem do serviço local. Ignorada na ElevenLabs. */
  localUrl?: string
  /** Dica de idioma. O Whisper detecta sozinho, mas errar em áudio
   *  curto é comum — "oi" pode virar inglês. */
  language?: string
  /**
   * Vocabulário esperado, para enviesar a decodificação.
   *
   * Só o provedor local usa: é o `initial_prompt` do faster-whisper. A
   * ElevenLabs não expõe equivalente, e a precisão dela já é outra —
   * foi ela que motivou a existência das duas opções.
   */
  prompt?: string
}

/** Teto de tamanho. Um áudio de WhatsApp raramente passa de 16 MB, e
 *  aceitar mais só cria uma forma de a transcrição travar o ciclo. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** Nem a ElevenLabs nem o Whisper local devem segurar o webhook. */
const TIMEOUT_MS = 120_000

export async function transcribeAudio(
  input: TranscribeInput,
): Promise<string | null> {
  if (input.audio.byteLength === 0) return null
  if (input.audio.byteLength > MAX_AUDIO_BYTES) {
    console.error(
      `[audio] arquivo grande demais para transcrever: ${input.audio.byteLength} bytes`,
    )
    return null
  }

  try {
    const text =
      input.provider === 'elevenlabs'
        ? await viaElevenLabs(input)
        : await viaLocal(input)
    const trimmed = (text ?? '').trim()
    return trimmed || null
  } catch (err) {
    // Alto no log e null para quem chamou. A mensagem do cliente já
    // está gravada; o que se perde é o texto dela.
    console.error('[audio] transcrição falhou:', err)
    return null
  }
}

// ------------------------------------------------------------
// ElevenLabs
// ------------------------------------------------------------

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
/** Modelo de transcrição deles. Fica aqui, e não em configuração, para
 *  o cliente não precisar acompanhar o catálogo de um fornecedor. */
const ELEVENLABS_MODEL = 'scribe_v1'

async function viaElevenLabs(input: TranscribeInput): Promise<string | null> {
  if (!input.apiKey?.trim()) {
    console.error('[audio] ElevenLabs escolhida sem chave configurada')
    return null
  }

  const form = new FormData()
  form.append('model_id', ELEVENLABS_MODEL)
  form.append(
    'file',
    new Blob([input.audio], { type: input.mimeType || 'audio/ogg' }),
    'audio.ogg',
  )
  if (input.language) form.append('language_code', input.language)

  const res = await fetch(ELEVENLABS_URL, {
    method: 'POST',
    // `xi-api-key`, não `Authorization: Bearer` — é o esquema deles.
    headers: { 'xi-api-key': input.apiKey.trim() },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text ?? null
}

// ------------------------------------------------------------
// Whisper local
// ------------------------------------------------------------

/**
 * O serviço na própria VPS.
 *
 * Fala com a API do `openai-whisper-asr-webservice`, que é `POST /asr`
 * com o arquivo em multipart. Sem chave: ele não está publicado na
 * internet — vive na rede interna do Docker e só o app o alcança.
 */
async function viaLocal(input: TranscribeInput): Promise<string | null> {
  const base = (input.localUrl || process.env.WHISPER_URL || '').trim()
  if (!base) {
    console.error('[audio] provedor local escolhido sem WHISPER_URL')
    return null
  }

  const url = new URL('/asr', base)
  url.searchParams.set('output', 'text')
  url.searchParams.set('task', 'transcribe')
  if (input.language) url.searchParams.set('language', input.language)
  if (input.prompt) url.searchParams.set('initial_prompt', input.prompt)

  const form = new FormData()
  form.append(
    'audio_file',
    new Blob([input.audio], { type: input.mimeType || 'audio/ogg' }),
    'audio.ogg',
  )

  const res = await fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`whisper ${res.status}: ${body.slice(0, 300)}`)
  }

  return await res.text()
}
