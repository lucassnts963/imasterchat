# Plano geral — do sistema atual ao produto de cobrança

> Escrito em 02/09/2026 contra `main @ 52dbf11`. **Documento de planejamento —
> nenhuma linha de código foi escrita.**
>
> Consolida e sequencia o que foi levantado em cinco análises anteriores. Cada
> fase aponta para o documento que a fundamenta; nada é repetido aqui.

---

## 1. O princípio que organiza tudo

O sistema tem **três motores que conversam com o cliente** — agente de IA,
fluxos e automações — e eles cresceram separados. Hoje cada capacidade está
implementada em **um** deles, às vezes em dois, quase nunca nos três.

O pedido é que tudo funcione em qualquer um. Isso é a coisa certa, mas tem uma
armadilha: implementar cada capacidade três vezes triplica a manutenção para
sempre e garante que as três versões divirjam — que é exatamente o defeito que
já corrigimos duas vezes neste repositório (o catálogo de provedores e a lista
de modelos).

**A regra desta fase, então, não é "copiar capacidade para os três".** É:

> Uma capacidade tem **uma** implementação, num módulo de domínio, e cada motor
> é um **adaptador fino** por cima dela.

A boa notícia é que o repositório já faz isso onde importa mais:
`src/lib/scheduling/` contém disponibilidade, regras, persistência e recusa
como lógica pura — só o invólucro de ferramenta é da IA. Trazer agendamento
para fluxo e automação **não é construir agendamento duas vezes**; é escrever
dois adaptadores sobre o que já existe.

---

## 2. As fases

| Fase | O que é | Por que nesta ordem | Fundamentação |
|---|---|---|---|
| **1. Paridade e conexão** | fechar as arestas entre os três motores; agendamento em todos; ida e volta entre fluxo e automação | é a base de tudo que vem depois. A régua de cobrança **é** uma composição de fluxo + automação; sem a ponte ela nasce torta | [`01-fase-1-paridade.md`](./01-fase-1-paridade.md) |
| **2. Fluxos para GA** | tirar do beta | depende de itens da fase 1 (template e agendamento como nós). Sai quase de graça depois dela | [`../posicionamento-cobranca.md`](../posicionamento-cobranca.md) §4 |
| **3. Custo de mensagem** | contador + tela + orçamento cobrindo os dois custos | **único item com prazo: 1º/10**. O PR #3 já entregou a captura | [`../cobranca-whatsapp-out-2026.md`](../cobranca-whatsapp-out-2026.md) |
| **4. Módulo de cobrança** | régua, janela legal, agrupamento por titular, métricas por degrau | precisa da fase 1 pronta e do contador da fase 3 para ser precificável | [`../posicionamento-cobranca.md`](../posicionamento-cobranca.md) §2 |
| **5. Integrações** | catálogo, planilha + webhook genérico, Asaas, depois Clube de Associados | o genérico atende todo cliente sem API — tira o roteiro da dependência de terceiros | [`../posicionamento-cobranca.md`](../posicionamento-cobranca.md) §3 |
| **6. Múltiplas agendas** | várias agendas do Google | independente das outras; entra quando o cliente pedir | [`../avaliacao-agendas-e-cobranca.md`](../avaliacao-agendas-e-cobranca.md) §1 |

### Por que a fase 3 não vem primeiro, se tem prazo

A captura já está feita (PR #3) e é o que tinha valor antes de outubro — cada
mensagem que hoje chega como `free_customer_service` já está sendo gravada como
previsão. A tela e o orçamento podem entrar em outubro sem perda: o dado já
está sendo acumulado.

---

## 3. Especificação: até onde detalhar agora

Só a **fase 1** está especificada em requisito. As demais têm escopo e
fundamentação, e ganham especificação própria quando a anterior fechar.

Isso é deliberado. Especificar a fase 4 hoje é escrever requisito sobre um
sistema que a fase 1 vai mudar — e a régua de cobrança em particular depende de
decisões que só ficam claras depois que fluxo e automação se compuserem de
verdade.

---

## 4. Decisões que preciso de você

Três, e a primeira muda a fase 1 inteira.

### 4.1 Dois motores ou um?

Fluxo e automação estão convergindo. Depois da fase 1 o fluxo faz quase tudo que
a automação faz, **mais** conversar.

| Caminho | O que significa |
|---|---|
| **Dois motores que se compõem** (recomendado agora) | a ponte é permanente; automação continua sendo o jeito simples de fazer coisa simples; fluxo é para conversa |
| **Um motor só** | automação vira um fluxo linear; menos conceito para o operador, mas é migração de dados e de telas em produção |

Recomendo **dois**, por ora — mas registrado como escolha, não como acidente,
para não construirmos a mesma coisa duas vezes.

### 4.2 O agendamento no fluxo é nó ou é ponte?

Duas formas de "agendamento no fluxo":

- **Nós dedicados** (`consultar_horarios`, `agendar`) — o operador desenha o
  agendamento no roteiro. Mais trabalho, e o resultado é um menu de horários.
- **Ponte para a IA** — o fluxo entrega a conversa ao agente só para agendar.
  Barato, mas volta a custar IA, que é o que o cliente quer evitar.

Recomendo **nós dedicados**, porque o objetivo declarado é ter caminho sem IA.

### 4.3 Quanto de paridade é paridade

A fase 1 propõe encher a matriz **onde faz sentido**, e resolver por ponte três
células onde duplicar pioraria o produto. A §4 do documento da fase 1 lista
quais e por quê. Precisa do seu aval.

---

## 5. O que já está pronto e entra nesta conta

- Provedores de IA abertos, embeddings em qualquer provedor (PR #2, na `main`)
- Correções do Embedded Signup e o botão "Conectar WhatsApp" (na `main`)
- Captura do custo por mensagem da Meta (PR #3, aberto)
