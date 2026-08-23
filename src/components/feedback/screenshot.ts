// ============================================================
// O print — sem `html2canvas`, e por bons motivos.
//
// O feedget original rasteriza o DOM com html2canvas: ~200KB de
// dependência que re-implementa a renderização do navegador em canvas.
// Ela erra com frequência (fontes que não carregam, sombras, imagens
// de outra origem que "sujam" o canvas), e um print ERRADO num relato
// de bug é pior que print nenhum — manda quem for corrigir atrás de um
// problema que não existe.
//
// `getDisplayMedia` pega o quadro real, renderizado pelo próprio
// navegador. Zero dependências, fidelidade perfeita, e uma terceira
// vantagem que aqui não é detalhe: quem reporta VÊ e ESCOLHE, num
// diálogo nativo do sistema, exatamente o que vai ser capturado.
//
// Isso importa porque um print da caixa de entrada carrega a conversa
// de um cliente da ótica — dado de terceiro, e existe uma política de
// privacidade publicada. Consentimento explícito deixa de ser um custo
// e vira a implementação.
//
// O preço: não existe no Safari do iPhone nem nos navegadores móveis
// em geral. Assumido — quem reporta bug está no computador da loja, e
// no celular o campo de texto continua lá.
// ============================================================

/** Largura máxima antes de virar JPEG. Um monitor 5K viraria seis
 *  megabytes de base64 num INSERT; 1600px ainda deixa ler o texto de
 *  qualquer tela do app. */
const MAX_WIDTH = 1600
const JPEG_QUALITY = 0.75

export function canCaptureScreen(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  )
}

export type CaptureFailure = 'unsupported' | 'cancelled' | 'failed'

/**
 * Abre o seletor nativo, pega um quadro, devolve um data URL JPEG.
 *
 * Devolve `null` quando a pessoa cancela — cancelar é uma resposta
 * legítima e não um erro para mostrar em vermelho.
 */
export async function captureScreen(): Promise<
  { ok: true; dataUrl: string } | { ok: false; reason: CaptureFailure }
> {
  if (!canCaptureScreen()) return { ok: false, reason: 'unsupported' }

  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      // Sem o cursor: ele não ajuda a entender o bug e às vezes tapa
      // justamente o que a pessoa queria mostrar.
      // @ts-expect-error — nem todo lib.dom declara esta opção ainda.
      cursor: 'never',
      preferCurrentTab: true,
    })

    const track = stream.getVideoTracks()[0]
    if (!track) return { ok: false, reason: 'failed' }

    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()

    // Um quadro só chega depois que o vídeo tem dimensão. Sem esta
    // espera o canvas sai 0x0 em telas mais lentas.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const sw = video.videoWidth
    const sh = video.videoHeight
    if (!sw || !sh) return { ok: false, reason: 'failed' }

    const scale = Math.min(1, MAX_WIDTH / sw)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw * scale)
    canvas.height = Math.round(sh * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, reason: 'failed' }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    video.pause()
    video.srcObject = null

    return { ok: true, dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY) }
  } catch (err) {
    // `NotAllowedError` é a pessoa fechando o seletor. Não é falha.
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { ok: false, reason: 'cancelled' }
    }
    console.error('[feedback] captura falhou:', err)
    return { ok: false, reason: 'failed' }
  } finally {
    // Sem isto o navegador continua mostrando "esta aba está sendo
    // compartilhada" para sempre.
    stream?.getTracks().forEach((t) => t.stop())
  }
}
