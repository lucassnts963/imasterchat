import type { CobrancaExterna } from './types'

// ============================================================
// De um objeto qualquer para uma cobrança — fase 5, R-31 e R-32.
//
// Puro. É o mesmo caminho para a linha de uma planilha e para o JSON que
// um sistema empurra no webhook genérico, porque os dois problemas são o
// mesmo: alguém mandou campos com os nomes DELE, e o mapeamento é
// configuração da conta.
//
// Ser puro é o que permite a pré-visualização honesta antes de gravar —
// quantas linhas casam, quantas ficam órfãs, quantas são duplicata — sem
// escrever nada.
// ============================================================

/** `{ valor: "vlr_total", vencimento: "dt_venc" }` — nosso campo → dele. */
export type MapaDeCampos = Partial<
  Record<keyof CobrancaExterna | 'nome' | 'telefone', string>
>

export type ErroDeLinha =
  | 'sem_id_externo'
  | 'valor_invalido'
  | 'vencimento_invalido'
  | 'sem_identificacao'

export interface LinhaNormalizada {
  ok: true
  cobranca: CobrancaExterna
}

export interface LinhaRejeitada {
  ok: false
  erro: ErroDeLinha
  /** A linha como veio, para o operador achar o problema na planilha. */
  bruto: Record<string, unknown>
}

export type ResultadoDeLinha = LinhaNormalizada | LinhaRejeitada

/**
 * Converte "1.234,56", "1234.56" e 1234.56 no mesmo número.
 *
 * Uma planilha brasileira usa vírgula decimal e ponto de milhar; uma
 * API, o contrário. Adivinhar errado transforma R$ 1.234,56 em R$ 1,23 —
 * e uma cobrança com o valor errado é uma cobrança contestável.
 */
export function parseValor(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const limpo = raw.replace(/[^\d.,-]/g, '').trim()
  if (!limpo) return null

  const temVirgula = limpo.includes(',')
  const temPonto = limpo.includes('.')

  let normalizado = limpo
  if (temVirgula && temPonto) {
    // O último separador é o decimal; o outro é milhar.
    normalizado =
      limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
        ? limpo.replace(/\./g, '').replace(',', '.')
        : limpo.replace(/,/g, '')
  } else if (temVirgula) {
    normalizado = limpo.replace(',', '.')
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/**
 * Aceita `2026-09-09`, `09/09/2026` e `9/9/26`.
 *
 * Não passa por `new Date`: `new Date('2026-09-09')` é meia-noite UTC,
 * que no Brasil é o dia ANTERIOR — e uma cobrança com a data errada por
 * um dia dispara o degrau errado.
 */
export function parseVencimento(raw: unknown): string | null {
  if (raw instanceof Date) {
    return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`
  }
  if (typeof raw !== 'string') return null
  const s = raw.trim()

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s)
  if (br) {
    const ano = br[3].length === 2 ? `20${br[3]}` : br[3]
    return `${ano}-${pad(Number(br[2]))}-${pad(Number(br[1]))}`
  }
  return null
}

function pad(n: number | string): string {
  return String(n).padStart(2, '0')
}

/** Só dígitos, com o 55 do Brasil quando o número vier sem. */
export function normalizarTelefone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const digitos = String(raw).replace(/\D/g, '')
  if (digitos.length < 10) return null
  return digitos.length <= 11 ? `55${digitos}` : digitos
}

function ler(linha: Record<string, unknown>, mapa: MapaDeCampos, campo: string): unknown {
  const chave = (mapa as Record<string, string | undefined>)[campo] ?? campo
  return linha[chave]
}

export function normalizarLinha(
  linha: Record<string, unknown>,
  mapa: MapaDeCampos = {},
): ResultadoDeLinha {
  const rejeitar = (erro: ErroDeLinha): LinhaRejeitada => ({
    ok: false,
    erro,
    bruto: linha,
  })

  const valor = parseValor(ler(linha, mapa, 'valor'))
  if (valor === null) return rejeitar('valor_invalido')

  const vencimento = parseVencimento(ler(linha, mapa, 'vencimento'))
  if (!vencimento) return rejeitar('vencimento_invalido')

  const telefone = normalizarTelefone(ler(linha, mapa, 'telefone'))
  const nome = strOuNulo(ler(linha, mapa, 'nome'))
  // Antes da chave de deduplicação, e de propósito: o problema que o
  // operador precisa ver primeiro é "não há quem cobrar", não "não
  // consegui deduplicar". Uma linha sem ninguém é inútil de qualquer
  // jeito.
  if (!telefone && !nome) return rejeitar('sem_identificacao')

  const idBruto = ler(linha, mapa, 'idExterno')
  // Sem id externo, a chave é telefone + vencimento + valor. Não é
  // escolha nossa: é o que uma planilha costuma ter, e sem NENHUMA
  // chave reimportar o arquivo do mês duplicaria a carteira.
  const idExterno =
    idBruto !== undefined && idBruto !== null && String(idBruto).trim() !== ''
      ? String(idBruto).trim()
      : telefone
        ? `${telefone}:${vencimento}:${valor}`
        : null
  if (!idExterno) return rejeitar('sem_id_externo')

  const statusBruto = strOuNulo(ler(linha, mapa, 'status'))?.toLowerCase()
  const status: CobrancaExterna['status'] =
    statusBruto === 'paga' || statusBruto === 'pago' || statusBruto === 'paid'
      ? 'paga'
      : statusBruto === 'cancelada' || statusBruto === 'cancelled'
        ? 'cancelada'
        : 'aberta'

  return {
    ok: true,
    cobranca: {
      idExterno,
      titularRef: strOuNulo(ler(linha, mapa, 'titularRef')) ?? telefone,
      telefone,
      nome,
      descricao: strOuNulo(ler(linha, mapa, 'descricao')),
      valor,
      vencimento,
      status,
      pagoEm: parseVencimento(ler(linha, mapa, 'pagoEm')),
      valorPago: parseValor(ler(linha, mapa, 'valorPago')),
      linkPagamento: strOuNulo(ler(linha, mapa, 'linkPagamento')),
      codigoPix: strOuNulo(ler(linha, mapa, 'codigoPix')),
      linhaDigitavel: strOuNulo(ler(linha, mapa, 'linhaDigitavel')),
    },
  }
}

function strOuNulo(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  return s === '' ? null : s
}

export interface ResumoDaImportacao {
  total: number
  validas: number
  rejeitadas: number
  porErro: Record<string, number>
  /** Ids repetidos DENTRO do próprio arquivo. */
  duplicadasNoArquivo: number
}

/**
 * O resumo que a tela mostra ANTES de gravar.
 *
 * Meia carteira importada é pior que nenhuma, então a importação é
 * transacional por arquivo — e um resumo honesto antes disso é o que
 * evita o operador descobrir o problema com as mensagens já saindo.
 */
export function resumirImportacao(linhas: ResultadoDeLinha[]): ResumoDaImportacao {
  const resumo: ResumoDaImportacao = {
    total: linhas.length,
    validas: 0,
    rejeitadas: 0,
    porErro: {},
    duplicadasNoArquivo: 0,
  }
  const vistos = new Set<string>()
  for (const linha of linhas) {
    if (!linha.ok) {
      resumo.rejeitadas += 1
      resumo.porErro[linha.erro] = (resumo.porErro[linha.erro] ?? 0) + 1
      continue
    }
    resumo.validas += 1
    if (vistos.has(linha.cobranca.idExterno)) resumo.duplicadasNoArquivo += 1
    vistos.add(linha.cobranca.idExterno)
  }
  return resumo
}
