import { describe, expect, it } from 'vitest'
import { planejarDisparos, degrauDoDia, titulosDoTitular } from './regua'
import type { CobrancaEmAberto, Degrau, DisparoAnterior } from './regua'
import { parseJanela } from './janela'

const SP = 'America/Sao_Paulo'
const em = (iso: string) => new Date(`${iso}-03:00`)

const DEGRAUS: Degrau[] = [
  { id: 'd-3', offsetDias: -3, templateName: 'aviso', horaDoDia: '09:00', isActive: true },
  { id: 'd0', offsetDias: 0, templateName: 'vencimento', horaDoDia: '09:00', isActive: true },
  { id: 'd2', offsetDias: 2, templateName: 'atraso2', horaDoDia: '09:00', isActive: true },
  { id: 'd5', offsetDias: 5, templateName: 'atraso5', horaDoDia: '09:00', isActive: false },
]

function cobranca(over: Partial<CobrancaEmAberto> = {}): CobrancaEmAberto {
  return {
    id: 'c1',
    contactId: 'contact-1',
    titularRef: 'titular-1',
    valor: 80,
    vencimento: '2026-09-09',
    status: 'aberta',
    ...over,
  }
}

function ctx(agora = em('2026-09-09T10:00'), over: Record<string, unknown> = {}) {
  return {
    agora,
    janela: parseJanela({}, SP),
    feriados: new Set<string>(),
    regra: {
      maxContatosPeriodo: 4,
      periodoDias: 30,
      intervaloMinimoDias: 2,
      pausaAposRespostaDias: 3,
    },
    ...over,
  }
}

const plano = (
  cobrancas: CobrancaEmAberto[],
  disparos: DisparoAnterior[] = [],
  contexto = ctx(),
) => planejarDisparos(cobrancas, DEGRAUS, disparos, contexto)

describe('degrauDoDia', () => {
  it('acha o degrau do vencimento', () => {
    expect(degrauDoDia(cobranca(), DEGRAUS, '2026-09-09')?.id).toBe('d0')
  })

  it('acha o aviso de três dias antes', () => {
    expect(degrauDoDia(cobranca(), DEGRAUS, '2026-09-06')?.id).toBe('d-3')
  })

  // Exato, e não "a partir de". Uma régua que dispara tudo o que passou
  // quando o worker fica um dia fora do ar manda quatro mensagens de uma
  // vez para a mesma pessoa — que é assédio por construção.
  it('não dispara degraus atrasados de uma vez', () => {
    expect(degrauDoDia(cobranca(), DEGRAUS, '2026-09-20')).toBeNull()
  })

  it('ignora degrau desligado', () => {
    expect(degrauDoDia(cobranca(), DEGRAUS, '2026-09-14')).toBeNull()
  })
})

describe('planejarDisparos', () => {
  it('manda o degrau do dia', () => {
    const out = plano([cobranca()])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ acao: 'enviar', degrau: { id: 'd0' } })
  })

  // O defeito que o módulo inteiro existe para evitar: reavaliar o
  // estado NO MOMENTO do disparo, não no do agendamento.
  it('não cobra quem já pagou', () => {
    const out = plano([cobranca({ status: 'paga' })])
    expect(out[0]).toMatchObject({ acao: 'suprimir', motivo: 'ja_paga' })
  })

  it('não manda para cobrança órfã, e registra por quê', () => {
    const out = plano([cobranca({ contactId: null })])
    expect(out[0]).toMatchObject({ acao: 'suprimir', motivo: 'sem_contato' })
  })

  // "Pago sexta" reagenda o próximo degrau; repetir a mesma cobrança na
  // quinta é o caminho mais curto para virar reclamação.
  it('respeita uma promessa vigente', () => {
    const out = plano([cobranca({ promessaPara: '2026-09-12' })])
    expect(out[0]).toMatchObject({ acao: 'suprimir', motivo: 'promessa' })
  })

  it('volta a cobrar depois da promessa vencida', () => {
    const out = plano([cobranca({ promessaPara: '2026-09-08' })])
    expect(out[0].acao).toBe('enviar')
  })

  it('pausa quando o titular respondeu', () => {
    const out = plano([cobranca({ respondeuEm: em('2026-09-08T18:00') })])
    expect(out[0]).toMatchObject({ acao: 'suprimir', motivo: 'pausada' })
  })

  it('retoma quando a pausa expira', () => {
    const out = plano([cobranca({ respondeuEm: em('2026-09-01T18:00') })])
    expect(out[0].acao).toBe('enviar')
  })
})

// Quem tem três títulos vencidos recebe UMA mensagem, não três. Sem
// isso a régua vira assédio por construção.
describe('agrupamento por titular', () => {
  it('manda uma mensagem e registra as outras como cobertas', () => {
    const out = plano([
      cobranca({ id: 'c1', vencimento: '2026-09-09' }),
      cobranca({ id: 'c2', vencimento: '2026-09-09' }),
      cobranca({ id: 'c3', vencimento: '2026-09-09' }),
    ])
    const enviados = out.filter((d) => d.acao === 'enviar')
    expect(enviados).toHaveLength(1)
    const agrupados = out.filter(
      (d) => d.acao === 'suprimir' && d.motivo === 'agrupado',
    )
    expect(agrupados).toHaveLength(2)
    expect(agrupados[0]).toMatchObject({ cobertaPor: enviados[0].cobranca.id })
  })

  it('não agrupa titulares diferentes', () => {
    const out = plano([
      cobranca({ id: 'c1', titularRef: 'titular-1' }),
      cobranca({ id: 'c2', titularRef: 'titular-2' }),
    ])
    expect(out.filter((d) => d.acao === 'enviar')).toHaveLength(2)
  })

  // Uma fonte que não informa titular cai no pior caso ANTERIOR — uma
  // mensagem por título — e não num agrupamento errado.
  it('trata cobrança sem titular como titular próprio', () => {
    const out = plano([
      cobranca({ id: 'c1', titularRef: null }),
      cobranca({ id: 'c2', titularRef: null }),
    ])
    expect(out.filter((d) => d.acao === 'enviar')).toHaveLength(2)
  })

  it('lista todos os títulos do titular para a mensagem', () => {
    const carteira = [
      cobranca({ id: 'c1' }),
      cobranca({ id: 'c2' }),
      cobranca({ id: 'c3', titularRef: 'outro' }),
    ]
    expect(titulosDoTitular('titular-1', carteira)).toHaveLength(2)
  })
})

describe('proteção anti-assédio', () => {
  const enviado = (dias: number): DisparoAnterior => ({
    cobrancaId: 'c1',
    degrauId: 'x',
    disparadoEm: new Date(em('2026-09-09T10:00').getTime() - dias * 86_400_000),
    resultado: 'enviado',
  })

  it('para no teto de contatos do período', () => {
    const out = plano([cobranca()], [enviado(3), enviado(6), enviado(9), enviado(12)])
    expect(out[0]).toMatchObject({ acao: 'suprimir', motivo: 'teto_atingido' })
  })

  it('respeita o intervalo mínimo entre degraus', () => {
    const out = plano([cobranca()], [enviado(1)])
    expect(out[0]).toMatchObject({ acao: 'suprimir', motivo: 'intervalo_minimo' })
  })

  it('não conta supressões contra o teto', () => {
    const suprimido = { ...enviado(3), resultado: 'suprimido' as const }
    const out = plano([cobranca()], [suprimido, suprimido, suprimido, suprimido])
    expect(out[0].acao).toBe('enviar')
  })

  it('esquece disparos de fora do período', () => {
    const out = plano([cobranca()], [enviado(40), enviado(50), enviado(60), enviado(70)])
    expect(out[0].acao).toBe('enviar')
  })
})

describe('a janela legal manda no worker', () => {
  it('suprime domingo à noite em vez de mandar', () => {
    const out = plano([cobranca({ vencimento: '2026-09-13' })], [], ctx(em('2026-09-13T22:00')))
    expect(out[0]).toMatchObject({ acao: 'suprimir', motivo: 'fora_da_janela' })
  })

  // Suprimido sem gravar disparo: o worker de amanhã reencontra a
  // cobrança no mesmo degrau. Perder o degrau seria perder a cobrança.
  it('deixa o mesmo degrau disponível para o dia seguinte', () => {
    const cedo = plano([cobranca()], [], ctx(em('2026-09-09T03:00')))
    expect(cedo[0]).toMatchObject({ acao: 'suprimir', motivo: 'fora_da_janela' })
    const dentro = plano([cobranca()], [], ctx(em('2026-09-09T09:00')))
    expect(dentro[0].acao).toBe('enviar')
  })
})
