import { formatDateInZone } from '@/lib/time/zone'
import { avaliarJanela, type JanelaContato } from './janela'

// ============================================================
// Quem recebe o quê, hoje — fase 4, R-19 a R-25.
//
// Puro de propósito. Recebe a carteira, a régua, o que já foi disparado
// e o relógio; devolve uma lista de decisões. Nada de banco e nada de
// envio — o worker (`worker.ts`) é quem executa.
//
// Isso não é gosto por pureza: é o único jeito de testar "o associado
// que tem três títulos vencidos e prometeu pagar sexta, num sábado à
// tarde de véspera de feriado" sem levantar nada.
// ============================================================

export interface CobrancaEmAberto {
  id: string
  contactId: string | null
  /** Quem DEVE. É a chave do agrupamento — quem tem três títulos
   *  vencidos recebe uma mensagem, não três. */
  titularRef: string | null
  valor: number
  /** `YYYY-MM-DD` */
  vencimento: string
  status: string
  /** `YYYY-MM-DD` da promessa vigente, quando houver. */
  promessaPara?: string | null
  /** Quando o titular respondeu por último. Pausa a régua dele. */
  respondeuEm?: Date | null
}

export interface Degrau {
  id: string
  /** Negativo avisa antes do vencimento; zero é no dia. */
  offsetDias: number
  templateName: string
  /** `HH:MM` no fuso da conta. */
  horaDoDia: string
  isActive: boolean
  flowId?: string | null
}

export interface DisparoAnterior {
  cobrancaId: string
  degrauId: string
  disparadoEm: Date
  resultado: 'enviado' | 'suprimido'
}

export interface RegraDaRegua {
  maxContatosPeriodo: number
  periodoDias: number
  intervaloMinimoDias: number
  pausaAposRespostaDias: number
}

export interface ContextoRegua {
  agora: Date
  janela: JanelaContato
  feriados: ReadonlySet<string>
  regra: RegraDaRegua
}

export type MotivoSupressao =
  | 'ja_paga'
  | 'sem_contato'
  | 'fora_da_janela'
  | 'teto_atingido'
  | 'intervalo_minimo'
  | 'promessa'
  | 'pausada'
  | 'agrupado'

export type Decisao =
  | { acao: 'enviar'; cobranca: CobrancaEmAberto; degrau: Degrau; titular: string }
  | {
      acao: 'suprimir'
      cobranca: CobrancaEmAberto
      degrau: Degrau
      motivo: MotivoSupressao
      /** Em `agrupado`: a cobrança que levou a mensagem. */
      cobertaPor?: string
    }

const DIA_MS = 86_400_000

/** Dias entre duas datas `YYYY-MM-DD`, sem fuso no meio. */
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS)
}

/**
 * O degrau que vence HOJE para esta cobrança, se algum vencer.
 *
 * Um degrau é do dia `vencimento + offset`. Não "a partir de": exato.
 * Uma régua que dispara tudo o que passou quando o worker fica um dia
 * fora do ar manda quatro mensagens de uma vez para a mesma pessoa — que
 * é a definição de assédio por construção.
 */
export function degrauDoDia(
  cobranca: CobrancaEmAberto,
  degraus: Degrau[],
  hoje: string,
): Degrau | null {
  const offsetHoje = diasEntre(cobranca.vencimento, hoje)
  return (
    degraus.find((d) => d.isActive && d.offsetDias === offsetHoje) ?? null
  )
}

/**
 * Monta o plano do dia.
 *
 * A ordem das checagens não é arbitrária — vai da mais barata e mais
 * definitiva para a mais cara:
 *
 *   1. já pagou            nada mais importa
 *   2. sem contato casado  não há para onde mandar
 *   3. promessa vigente    "pago sexta" reagenda, não repete
 *   4. respondeu           virou atendimento humano
 *   5. teto / intervalo    a proteção anti-assédio
 *   6. janela legal        CDC art. 42 + SARB 27/2023
 *   7. agrupamento         um titular, uma mensagem
 */
export function planejarDisparos(
  cobrancas: CobrancaEmAberto[],
  degraus: Degrau[],
  disparos: DisparoAnterior[],
  ctx: ContextoRegua,
): Decisao[] {
  const hoje = formatDateInZone(ctx.agora, ctx.janela.timezone)
  const decisoes: Decisao[] = []

  // Quem já levou mensagem hoje, por titular. É o que faz o agrupamento
  // funcionar sem precisar de uma segunda passada.
  const jaEnviadoParaTitular = new Map<string, string>()
  const janela = avaliarJanela(ctx.janela, ctx.agora, ctx.feriados)

  // Ordem estável: vencimento mais antigo primeiro. Quando um titular
  // tem três títulos, a mensagem sai pelo mais atrasado — que é o que um
  // cobrador humano faria.
  const fila = [...cobrancas].sort((a, b) =>
    a.vencimento === b.vencimento ? a.id.localeCompare(b.id) : a.vencimento.localeCompare(b.vencimento),
  )

  for (const cobranca of fila) {
    const degrau = degrauDoDia(cobranca, degraus, hoje)
    if (!degrau) continue

    const suprimir = (motivo: MotivoSupressao, cobertaPor?: string): void => {
      decisoes.push({ acao: 'suprimir', cobranca, degrau, motivo, cobertaPor })
    }

    if (cobranca.status !== 'aberta') {
      suprimir('ja_paga')
      continue
    }
    if (!cobranca.contactId) {
      suprimir('sem_contato')
      continue
    }
    if (cobranca.promessaPara && diasEntre(hoje, cobranca.promessaPara) >= 0) {
      suprimir('promessa')
      continue
    }
    if (
      cobranca.respondeuEm &&
      ctx.agora.getTime() - cobranca.respondeuEm.getTime() <
        ctx.regra.pausaAposRespostaDias * DIA_MS
    ) {
      suprimir('pausada')
      continue
    }

    const doTitulo = disparos.filter(
      (d) => d.cobrancaId === cobranca.id && d.resultado === 'enviado',
    )
    const noPeriodo = doTitulo.filter(
      (d) =>
        ctx.agora.getTime() - d.disparadoEm.getTime() <
        ctx.regra.periodoDias * DIA_MS,
    )
    if (noPeriodo.length >= ctx.regra.maxContatosPeriodo) {
      suprimir('teto_atingido')
      continue
    }
    const ultimo = doTitulo.reduce<Date | null>(
      (max, d) => (max === null || d.disparadoEm > max ? d.disparadoEm : max),
      null,
    )
    if (
      ultimo &&
      ctx.agora.getTime() - ultimo.getTime() <
        ctx.regra.intervaloMinimoDias * DIA_MS
    ) {
      suprimir('intervalo_minimo')
      continue
    }

    if (!janela.dentro) {
      // Adiado, não descartado: como não há disparo gravado, o worker de
      // amanhã reencontra a cobrança no mesmo degrau. Perder o degrau
      // seria perder a cobrança.
      suprimir('fora_da_janela')
      continue
    }

    // Agrupamento por titular. Sem `titularRef` cada cobrança é o próprio
    // titular — é o que acontece com uma fonte que não informa isso, e o
    // pior caso é o comportamento anterior, não um agrupamento errado.
    const titular = cobranca.titularRef ?? `cobranca:${cobranca.id}`
    const jaCoberto = jaEnviadoParaTitular.get(titular)
    if (jaCoberto) {
      suprimir('agrupado', jaCoberto)
      continue
    }

    jaEnviadoParaTitular.set(titular, cobranca.id)
    decisoes.push({ acao: 'enviar', cobranca, degrau, titular })
  }

  return decisoes
}

/**
 * Os títulos que a mensagem de um titular deve listar.
 *
 * Genérica no tipo para o worker poder passar a carteira completa — com
 * descrição, link e pix — e receber de volta o mesmo tipo, sem um cast
 * que esconderia um erro real de campo faltando.
 */
export function titulosDoTitular<T extends CobrancaEmAberto>(
  titular: string,
  cobrancas: T[],
): T[] {
  return cobrancas.filter(
    (c) =>
      c.status === 'aberta' &&
      (c.titularRef ?? `cobranca:${c.id}`) === titular,
  )
}
