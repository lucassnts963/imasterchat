import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    reguas: [] as Record<string, unknown>[],
    degraus: [] as Record<string, unknown>[],
    cobrancas: [] as Record<string, unknown>[],
    disparos: [] as Record<string, unknown>[],
    promessas: [] as Record<string, unknown>[],
    conversations: [] as Record<string, unknown>[],
    feriados: [] as Record<string, unknown>[],
    settings: [{ account_id: 'acct-1', timezone: 'America/Sao_Paulo' }] as Record<string, unknown>[],
  },
  sendTemplate: vi.fn(),
  startFlowRun: vi.fn(),
  /** O relógio simulado. O banco de verdade carimba `disparado_em` com
   *  `now()`; aqui ele tem de acompanhar o `agora` do teste, senão um
   *  disparo aparece no FUTURO em relação à rodada e o intervalo mínimo
   *  dispara por um motivo que não existe em produção. */
  agora: new Date(),
}))

vi.mock('@/lib/automations/meta-send', () => ({
  engineSendTemplate: h.sendTemplate,
}))
vi.mock('@/lib/flows/engine', () => ({ startFlowRun: h.startFlowRun }))

import { runReguaForAccount } from './worker'

// ============================================================
// Um duplo de banco COM ESTADO: `regua_disparos` guarda o que foi
// escrito e a unicidade parcial é simulada de verdade. Sem isso não dá
// para provar a propriedade que mais importa — rodar o worker duas vezes
// no mesmo dia não manda a mesma cobrança duas vezes.
// ============================================================
function fakeDb() {
  const state = h.db

  function tabela(nome: string): Record<string, unknown>[] {
    switch (nome) {
      case 'reguas': return state.reguas
      case 'regua_degraus': return state.degraus
      case 'cobrancas': return state.cobrancas
      case 'regua_disparos': return state.disparos
      case 'cobranca_promessas': return state.promessas
      case 'conversations': return state.conversations
      case 'feriados': return state.feriados
      case 'ai_scheduling_settings': return state.settings
      default: return []
    }
  }

  function builder(nome: string) {
    const eqs: [string, unknown][] = []
    const ins: [string, unknown[]][] = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Record<string, unknown> = {}

    const filtrar = () =>
      tabela(nome).filter(
        (row) =>
          eqs.every(([k, v]) => row[k] === v) &&
          ins.every(([k, vs]) => vs.includes(row[k] as never)),
      )

    const settle = () => {
      if (op === 'insert') {
        // A unicidade PARCIAL: um envio por (cobrança, degrau).
        // Supressões podem repetir — é o que deixa um degrau suprimido
        // às 3h por estar fora da janela ser enviado às 9h do mesmo dia.
        if (nome === 'regua_disparos' && payload.resultado === 'enviado') {
          const jaExiste = state.disparos.some(
            (d) =>
              d.cobranca_id === payload.cobranca_id &&
              d.degrau_id === payload.degrau_id &&
              d.resultado === 'enviado',
          )
          if (jaExiste) {
            return { data: null, error: { message: 'duplicate key value 23505' } }
          }
        }
        tabela(nome).push({ ...payload, disparado_em: h.agora.toISOString() })
        return { data: payload, error: null }
      }
      if (op === 'update') {
        const linhas = filtrar()
        for (const row of linhas) Object.assign(row, payload)
        return { data: linhas, error: null }
      }
      return { data: filtrar(), error: null }
    }

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Record<string, unknown>) => ((op = 'insert'), (payload = p), b),
      update: (p: Record<string, unknown>) => ((op = 'update'), (payload = p), b),
      eq: (k: string, v: unknown) => (eqs.push([k, v]), b),
      in: (k: string, v: unknown[]) => (ins.push([k, v]), b),
      gte: () => b,
      or: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => {
        const out = settle()
        const data = Array.isArray(out.data) ? (out.data[0] ?? null) : out.data
        return Promise.resolve({ data, error: out.error })
      },
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(settle()).then(onOk),
    }
    return b
  }

  return { from: (t: string) => builder(t) } as never
}

const em = (iso: string) => new Date(`${iso}-03:00`)

beforeEach(() => {
  h.db.reguas = [
    {
      id: 'r1',
      account_id: 'acct-1',
      nome: 'Padrão',
      is_active: true,
      janela: {},
      max_contatos_periodo: 4,
      periodo_dias: 30,
      intervalo_minimo_dias: 2,
      pausa_apos_resposta_dias: 3,
    },
  ]
  h.db.degraus = [
    {
      id: 'd0',
      regua_id: 'r1',
      offset_dias: 0,
      template_name: 'cobranca_d0',
      template_language: 'pt_BR',
      template_vars: { 1: '{{valor}}', 2: '{{vencimento}}' },
      hora_do_dia: '09:00:00',
      flow_id: null,
      is_active: true,
    },
  ]
  h.db.cobrancas = [
    {
      id: 'c1',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      titular_ref: 'titular-1',
      valor: 80,
      vencimento: '2026-09-09',
      status: 'aberta',
      descricao: 'Mensalidade',
      link_pagamento: null,
      codigo_pix: null,
      linha_digitavel: null,
    },
  ]
  h.db.disparos = []
  h.db.promessas = []
  h.db.conversations = [
    { id: 'conv-1', account_id: 'acct-1', contact_id: 'contact-1', last_message_at: null },
  ]
  h.db.feriados = []
  h.sendTemplate.mockReset()
  h.sendTemplate.mockResolvedValue({ whatsapp_message_id: 'wam-1' })
  h.startFlowRun.mockReset()
  h.startFlowRun.mockResolvedValue({ started: true, flowRunId: 'run-1' })
})

const rodar = (agora = em('2026-09-09T10:00')) => {
  h.agora = agora
  return runReguaForAccount(fakeDb(), 'acct-1', { agora, userId: 'user-1' })
}

describe('runReguaForAccount', () => {
  it('manda o degrau do dia com as variáveis resolvidas', async () => {
    const out = await rodar()

    expect(out.enviados).toBe(1)
    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
    const args = h.sendTemplate.mock.calls[0][0]
    expect(args.templateName).toBe('cobranca_d0')
    expect(args.origin).toBe('cobranca')
    expect(args.params[0]).toContain('80,00')
    expect(args.params[1]).toBe('09/09/2026')
  })

  // A propriedade que a fase inteira existe para garantir. Cobrar duas
  // vezes um associado que já pagou é o erro que custa cliente.
  it('rodar duas vezes no mesmo dia não manda duas vezes', async () => {
    await rodar()
    const segunda = await rodar()

    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
    expect(segunda.enviados).toBe(0)
    // Quem pega é o intervalo mínimo entre degraus, antes de a trava do
    // banco precisar entrar em ação — que é a ordem certa: barato e
    // explicável primeiro.
    expect(segunda.porMotivo.intervalo_minimo).toBe(1)
  })

  // A trava do banco é a última linha, para o caso que nenhuma regra
  // pega: dois workers rodando ao mesmo tempo.
  it('a unicidade do banco segura a corrida entre dois workers', async () => {
    h.db.reguas[0].intervalo_minimo_dias = 0
    await rodar()
    const segunda = await rodar()

    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
    expect(segunda.porMotivo.ja_disparado).toBe(1)
  })

  // A marca é gravada ANTES do envio. Na ordem inversa, dois workers
  // simultâneos mandariam duas vezes e só o segundo insert falharia —
  // depois de o cliente já ter recebido duas cobranças.
  it('grava a marca antes de mandar', async () => {
    h.sendTemplate.mockImplementation(async () => {
      expect(h.db.disparos).toHaveLength(1)
      return { whatsapp_message_id: 'wam-1' }
    })
    await rodar()
    expect.assertions(1)
  })

  it('liga o disparo ao id da mensagem, para o custo poder ser somado', async () => {
    await rodar()
    expect(h.db.disparos[0].message_id).toBe('wam-1')
  })

  it('não cobra quem pagou entre uma rodada e outra', async () => {
    h.db.cobrancas[0].status = 'paga'
    const out = await rodar()
    expect(h.sendTemplate).not.toHaveBeenCalled()
    expect(out.enviados).toBe(0)
  })

  it('não faz nada sem régua ativa', async () => {
    h.db.reguas[0].is_active = false
    await expect(rodar()).resolves.toMatchObject({ enviados: 0 })
  })
})

describe('a janela legal, no worker', () => {
  it('não manda de madrugada', async () => {
    const out = await rodar(em('2026-09-09T03:00'))
    expect(h.sendTemplate).not.toHaveBeenCalled()
    expect(out.porMotivo.fora_da_janela).toBe(1)
  })

  // Gravar a supressão de janela transformaria a proteção legal numa
  // cobrança perdida: o degrau é do dia, e às 9h ele ainda tem de sair.
  it('não grava a supressão de janela, para o degrau sair mais tarde', async () => {
    await rodar(em('2026-09-09T03:00'))
    expect(h.db.disparos).toHaveLength(0)

    await rodar(em('2026-09-09T09:00'))
    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
  })

  it('grava as outras supressões, que são auditoria', async () => {
    h.db.cobrancas[0].contact_id = null
    await rodar()
    expect(h.db.disparos[0]).toMatchObject({
      resultado: 'suprimido',
      motivo: 'sem_contato',
    })
  })
})

describe('quando o envio falha', () => {
  // A linha não pode mentir dizendo que a mensagem saiu: a trilha de
  // auditoria é a defesa do cliente se ele for questionado.
  it('vira supressão com o motivo, e não fica como enviado', async () => {
    h.sendTemplate.mockRejectedValue(new Error('template não aprovado'))
    const out = await rodar()

    expect(out.enviados).toBe(0)
    expect(h.db.disparos[0]).toMatchObject({ resultado: 'suprimido', motivo: 'erro' })
    expect(String(h.db.disparos[0].texto_enviado)).toContain('não aprovado')
  })
})

describe('o fluxo do degrau', () => {
  it('assume a conversa depois do template', async () => {
    h.db.degraus[0].flow_id = 'flow-cobranca'
    await rodar()

    expect(h.startFlowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        flowId: 'flow-cobranca',
        contactId: 'contact-1',
        startedBy: 'automation',
      }),
    )
  })

  // Uma recusa do fluxo não desfaz o envio: a mensagem já saiu, e o
  // cliente estar em outro fluxo é motivo legítimo.
  it('não desfaz o envio quando o fluxo recusa', async () => {
    h.db.degraus[0].flow_id = 'flow-cobranca'
    h.startFlowRun.mockResolvedValue({ started: false, reason: 'active_run_exists' })
    const out = await rodar()
    expect(out.enviados).toBe(1)
  })
})

describe('agrupamento por titular', () => {
  it('manda uma mensagem para quem tem três títulos', async () => {
    h.db.cobrancas.push(
      { ...h.db.cobrancas[0], id: 'c2' },
      { ...h.db.cobrancas[0], id: 'c3' },
    )
    const out = await rodar()

    expect(h.sendTemplate).toHaveBeenCalledTimes(1)
    expect(out.enviados).toBe(1)
    expect(out.porMotivo.agrupado).toBe(2)
  })

  it('e a mensagem fala dos três', async () => {
    h.db.cobrancas.push(
      { ...h.db.cobrancas[0], id: 'c2', valor: 20 },
      { ...h.db.cobrancas[0], id: 'c3', valor: 45.5 },
    )
    await rodar()
    expect(h.sendTemplate.mock.calls[0][0].params[0]).toContain('145,50')
  })
})
