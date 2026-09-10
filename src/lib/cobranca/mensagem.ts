import type { CobrancaCompleta } from './store'

// ============================================================
// O texto que o titular recebe.
//
// Puro, e testado, porque é a parte que um cliente pode levar ao Procon.
// A §2.1 do posicionamento lista o que a mensagem PRECISA dizer — quem
// cobra, quanto, quando venceu e como pagar — e o que ela não pode
// fazer: expor, ameaçar ou constranger.
// ============================================================

/** Formata em reais, que é o que o titular lê. */
export function formatarValor(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

/** `2026-09-09` → `09/09/2026`, sem passar por Date e sem fuso no meio. */
export function formatarData(iso: string): string {
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

export interface VariaveisCobranca {
  /** Total de todos os títulos que esta mensagem cobre. */
  valor: string
  /** O vencimento mais antigo em aberto. */
  vencimento: string
  /** Quantos títulos a mensagem cobre. */
  quantidade: string
  /** Lista legível, uma linha por título. */
  titulos: string
  link: string
  pix: string
}

/**
 * As variáveis disponíveis para o template do degrau.
 *
 * Recebe TODOS os títulos do titular, não um: quem tem três vencidos
 * recebe uma mensagem que fala dos três. Uma mensagem por título é
 * assédio por construção — e uma mensagem que fala de um só quando
 * existem três faz o titular pagar um e achar que quitou.
 */
export function variaveisDaCobranca(
  titulos: CobrancaCompleta[],
): VariaveisCobranca {
  const ordenados = [...titulos].sort((a, b) =>
    a.vencimento.localeCompare(b.vencimento),
  )
  const total = ordenados.reduce((soma, t) => soma + t.valor, 0)
  const primeiro = ordenados[0]

  return {
    valor: formatarValor(total),
    vencimento: primeiro ? formatarData(primeiro.vencimento) : '',
    quantidade: String(ordenados.length),
    titulos: ordenados
      .map(
        (t) =>
          `${t.descricao?.trim() || 'Título'} — ${formatarValor(t.valor)} (venc. ${formatarData(t.vencimento)})`,
      )
      .join('\n'),
    // O primeiro que tiver. Mandar o link de um título quando são três
    // seria pior que não mandar nenhum, então quem agrupa deve usar
    // `{{titulos}}` e um link de segunda via da carteira inteira.
    link: ordenados.find((t) => t.linkPagamento)?.linkPagamento ?? '',
    pix: ordenados.find((t) => t.codigoPix)?.codigoPix ?? '',
  }
}

/**
 * Resolve os parâmetros do template a partir da configuração do degrau.
 *
 * A configuração é `{ "1": "{{valor}}", "2": "{{vencimento}}" }` — as
 * chaves são as posições que a Meta espera, e os valores referenciam as
 * variáveis acima. A ordenação posicional é de
 * `whatsapp/template-params.ts`, compartilhada com fluxo e automação.
 */
export function resolverVariaveis(
  template: string,
  vars: VariaveisCobranca,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (todo, chave: string) => {
    const valor = (vars as unknown as Record<string, string>)[chave]
    // Uma variável que não existe fica como está, em vez de virar vazio:
    // um template com `{{nome}}` que chega em branco parece um defeito
    // nosso; chegando literal, o operador vê o que digitou errado.
    return valor ?? todo
  })
}
