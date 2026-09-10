// ============================================================
// O contrato que toda fonte de cobrança implementa — fase 5, R-29.
//
// Pequeno de propósito. É o que mantém a régua IGNORANTE de quem manda
// os dados: ela pergunta "o que está em aberto" e "isto foi pago", e o
// dia em que o cliente trocar de sistema troca-se o adaptador, não o
// módulo.
//
// A mesma forma do catálogo de provedores de IA
// (`src/lib/ai/providers/catalog.ts`), e pela mesma razão: uma lista
// única do que o sistema sabe falar, um adaptador por sistema, e a tela
// lendo da mesma lista que o executor. Duas listas divergem — este
// repositório já provou isso duas vezes.
// ============================================================

/** Uma cobrança como qualquer fonte a descreve. */
export interface CobrancaExterna {
  /** Id no sistema de origem. A chave de deduplicação, junto com a fonte. */
  idExterno: string
  /** Quem deve. Sem isto não há agrupamento por titular. */
  titularRef?: string | null
  /** E.164 quando a fonte souber; é como casamos com um contato. */
  telefone?: string | null
  nome?: string | null
  descricao?: string | null
  valor: number
  /** `YYYY-MM-DD` */
  vencimento: string
  status: 'aberta' | 'paga' | 'cancelada'
  pagoEm?: string | null
  valorPago?: number | null
  linkPagamento?: string | null
  codigoPix?: string | null
  linhaDigitavel?: string | null
}

export interface FonteDeCobranca {
  /** Id do catálogo. */
  id: string
  /** O que está em aberto, opcionalmente só o que mudou desde `desde`. */
  listarCobrancasAbertas(desde?: Date): Promise<CobrancaExterna[]>
  /** Pagou? Null quando a fonte não conhece o id. */
  consultarCobranca(idExterno: string): Promise<CobrancaExterna | null>
  /**
   * Quando o sistema EMPURRA. Opcional — e a diferença entre ter e não
   * ter é a **janela de erro**: com webhook, um pagamento cancela o
   * próximo degrau em segundos; sem ele, existe uma janela igual ao
   * intervalo de varredura, e alguém que pagou às 9h05 ainda pode
   * receber cobrança às 9h30. Aceitável a uma hora, constrangedor a 24 —
   * e é decisão do cliente saber com qual convive.
   */
  verificarWebhook?(request: Request): Promise<CobrancaExterna[] | null>
}

/** Como a tela e o executor enxergam um sistema integrável. */
export interface IntegracaoPreset {
  id: string
  label: string
  /** Uma frase sobre o que ela resolve. */
  descricao: string
  /** `push` chega em segundos; `pull` tem a janela de erro da varredura. */
  entrega: 'push' | 'pull' | 'manual'
  /** O que precisa ser preenchido para conectar. Vazio = nada. */
  campos: Array<{ chave: string; label: string; secreto?: boolean }>
  /** Onde o operador pega a credencial. */
  ondePegar?: string
  /** Falso enquanto o adaptador não existir — a tela mostra como "em
   *  breve" em vez de esconder, porque o catálogo é argumento de venda. */
  disponivel: boolean
}
