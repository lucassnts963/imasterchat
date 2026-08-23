import { describe, expect, it } from 'vitest'
import { evaluateSilence } from './health'

// ============================================================
// O ponto cego que todas as outras verificações deixam passar: se algo
// bloqueia a Meta ANTES do app, a requisição nunca chega, nada é
// gravado, e o token do WhatsApp continua válido — só ninguém está
// usando. A tela fica verde e o sintoma vira "hoje ninguém mandou
// mensagem", indistinguível de um dia parado.
//
// O que estes testes protegem é o equilíbrio da regra: precisa disparar
// quando o webhook cai, e precisa ficar quieta de madrugada, no
// domingo e no feriado. Uma regra que apita à toa é uma regra que se
// aprende a ignorar, e aí não serve para nada.
// ============================================================

const H = 3_600_000
const D = 24 * H

/** Uma ótica: mensagens das 9h às 18h, e silêncio à noite. */
function oticaTipica(dias: number, inicio: number): number[] {
  const marcos: number[] = []
  for (let d = 0; d < dias; d += 1) {
    for (let h = 0; h < 9; h += 1) {
      marcos.push(inicio + d * D + (9 + h) * H)
    }
  }
  return marcos
}

describe('evaluateSilence', () => {
  it('fica quieta durante a noite de um dia normal', () => {
    // O maior silêncio histórico desta conta é a própria noite (15h).
    // Estar há 10h sem mensagem às 4h da manhã é rotina, não falha.
    const inicio = 0
    const marcos = oticaTipica(14, inicio)
    const ultima = marcos[marcos.length - 1]

    const r = evaluateSilence(marcos, ultima + 10 * H)
    expect(r.status).toBe('ok')
  })

  it('fica quieta no fim de semana', () => {
    // Sexta 18h até segunda 9h são 63h. Se o histórico já contém um
    // fim de semana, outro não pode ser novidade.
    const marcos = [
      ...oticaTipica(5, 0),
      // pula o fim de semana
      ...oticaTipica(5, 7 * D),
    ]
    const ultima = marcos[marcos.length - 1]

    // 60h de silêncio, dentro do que esta conta já viveu.
    expect(evaluateSilence(marcos, ultima + 60 * H).status).toBe('ok')
  })

  it('acusa quando o silêncio passa do que a conta já viveu', () => {
    const marcos = oticaTipica(14, 0)
    const ultima = marcos[marcos.length - 1]

    // O maior silêncio histórico é a noite (15h); 30h é o dobro.
    const r = evaluateSilence(marcos, ultima + 30 * H)
    expect(r.status).toBe('failing')
    expect(r.code).toBe('inbound_silence')
    // A mensagem tem que dizer ONDE procurar, senão vira "algo deu
    // errado" e o operador começa do zero.
    expect(r.detail).toContain('webhook')
  })

  it('calibra por conta, não por relógio', () => {
    // Duas contas, o MESMO silêncio de 20h agora. Para a movimentada é
    // falha; para a que recebe pouco, é terça-feira.
    const agora = 100 * D

    const movimentada: number[] = []
    for (let i = 0; i < 200; i += 1) movimentada.push(agora - 20 * H - i * H)
    movimentada.reverse()

    // Esparsa e IRREGULAR — o caso real de uma loja de bairro: alguns
    // dias com movimento, outros sem ninguém. Um vão de 36h no
    // histórico é o que torna 20h de silêncio uma terça-feira comum.
    const esparsa: number[] = []
    let t = agora - 20 * H
    for (let i = 0; i < 25; i += 1) {
      esparsa.push(t)
      t -= (i % 5 === 0 ? 36 : 6) * H
    }
    esparsa.reverse()

    expect(evaluateSilence(movimentada, agora).status).toBe('failing')
    expect(evaluateSilence(esparsa, agora).status).toBe('ok')
  })

  it('não julga conta sem histórico suficiente', () => {
    // Conta nova ou de movimento raro: chutar seria pior que não olhar.
    const r = evaluateSilence([1, 2, 3], 10 * D)
    expect(r.status).toBe('skipped')
    expect(r.detail).toContain('sem histórico')
  })

  it('tem piso, para não disparar por um almoço mais longo', () => {
    // Uma conta que recebe a cada 10 minutos sem falha teria limite de
    // 15 minutos. O piso de 3h evita o alarme por qualquer pausa
    // normal do dia.
    const agora = 100 * D
    const constante: number[] = []
    for (let i = 0; i < 300; i += 1) constante.push(agora - 2 * H - i * 10 * 60_000)
    constante.reverse()

    expect(evaluateSilence(constante, agora).status).toBe('ok')
    expect(evaluateSilence(constante, agora + 4 * H).status).toBe('failing')
  })

  it('conta o silêncio a partir da ÚLTIMA mensagem', () => {
    const marcos = oticaTipica(14, 0)
    const ultima = marcos[marcos.length - 1]
    const r = evaluateSilence(marcos, ultima + 30 * H)
    expect(r.detail).toContain('30h')
  })
})
