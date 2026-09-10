import type { IntegracaoPreset } from './types'

// ============================================================
// A lista única do que o sistema sabe falar — fase 5, R-29.
//
// A tela lê daqui, e o executor também. Uma lista, não duas: o defeito
// de manter o catálogo em dois lugares já apareceu duas vezes neste
// repositório (provedores de IA e lista de modelos), e nas duas as
// cópias divergiram.
//
// Os itens `disponivel: false` ficam VISÍVEIS. O catálogo é argumento
// comercial antes de ser recurso técnico — "integra com Asaas, Iugu,
// Superlógica" vende, e esconder o que ainda não existe transforma um
// roteiro público num segredo interno.
// ============================================================

export const INTEGRACOES: IntegracaoPreset[] = [
  {
    id: 'planilha',
    label: 'Planilha (CSV/XLSX)',
    descricao:
      'Importa a carteira de um arquivo, com mapeamento de colunas na tela. Atende qualquer cliente cujo sistema não tem API — que é a maioria.',
    entrega: 'manual',
    campos: [],
    disponivel: true,
  },
  {
    id: 'webhook',
    label: 'Webhook genérico',
    descricao:
      'Um endereço nosso que qualquer sistema chama para empurrar cobranças e baixas. Idempotente por id externo.',
    entrega: 'push',
    campos: [],
    ondePegar: 'Gere uma chave de API com o escopo cobrancas:write',
    disponivel: true,
  },
  {
    id: 'asaas',
    label: 'Asaas',
    descricao:
      'Cobranças e webhooks de gerada, paga, falha e cancelada. Documentação pública, e enorme entre PMEs brasileiras.',
    entrega: 'push',
    campos: [{ chave: 'api_key', label: 'Chave de API', secreto: true }],
    ondePegar: 'https://docs.asaas.com/',
    disponivel: false,
  },
  {
    id: 'clube-associados',
    label: 'Clube de Associados',
    descricao:
      'Gestão para clubes e associações. Aguardando a documentação da API do fornecedor.',
    entrega: 'pull',
    campos: [{ chave: 'api_key', label: 'Chave de API', secreto: true }],
    disponivel: false,
  },
  {
    id: 'iugu',
    label: 'Iugu',
    descricao: 'Recorrência e assinaturas, com webhooks documentados.',
    entrega: 'push',
    campos: [{ chave: 'api_key', label: 'Chave de API', secreto: true }],
    disponivel: false,
  },
  {
    id: 'superlogica',
    label: 'Superlógica',
    descricao: 'Forte em condomínio e imobiliária.',
    entrega: 'pull',
    campos: [
      { chave: 'app_token', label: 'App token', secreto: true },
      { chave: 'access_token', label: 'Access token', secreto: true },
    ],
    disponivel: false,
  },
]

export function getIntegracao(id: string): IntegracaoPreset | undefined {
  return INTEGRACOES.find((i) => i.id === id)
}

/** As que dá para conectar hoje. */
export function integracoesDisponiveis(): IntegracaoPreset[] {
  return INTEGRACOES.filter((i) => i.disponivel)
}
