# Plano geral — do sistema atual ao produto de cobrança

> Escrito em 02/09/2026 contra `main @ 52dbf11`, decisões fechadas em 03/09.
> **Documento de planejamento — nenhuma linha de código foi escrita.**
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

| Fase | O que é | Por que nesta ordem | Especificação |
|---|---|---|---|
| **1. Paridade e conexão** | fechar as arestas entre os três motores; agendamento em todos; ida e volta entre fluxo e automação | é a base de tudo que vem depois. A régua de cobrança **é** uma composição de fluxo + automação; sem a ponte ela nasce torta | [`01-fase-1-paridade.md`](./01-fase-1-paridade.md) |
| **2. Fluxos para GA** | tirar o rótulo de beta, com o motor à altura dele | depende de itens da fase 1 (template e agendamento como nós). Sai quase de graça depois dela | [`02-fase-2-fluxos-ga.md`](./02-fase-2-fluxos-ga.md) |
| **3. Custo de mensagem** | contador + tela + orçamento cobrindo os dois custos | **único item com prazo: 1º/10**. O PR #3 já entregou a captura | [`03-fase-3-custo-mensagem.md`](./03-fase-3-custo-mensagem.md) |
| **4. Módulo de cobrança** | régua, janela legal, agrupamento por titular, métricas por degrau | precisa da fase 1 pronta e do contador da fase 3 para ser precificável | [`04-fase-4-cobranca.md`](./04-fase-4-cobranca.md) |
| **5. Integrações** | catálogo, planilha + webhook genérico, Asaas, depois Clube de Associados | o genérico atende todo cliente sem API — tira o roteiro da dependência de terceiros | [`05-fase-5-integracoes.md`](./05-fase-5-integracoes.md) |
| **6. Múltiplas agendas** | várias agendas do Google | independente das outras; entra quando o cliente pedir | [`06-fase-6-multiplas-agendas.md`](./06-fase-6-multiplas-agendas.md) |

### Por que a fase 3 não vem primeiro, se tem prazo

A captura já está feita (PR #3) e é o que tinha valor antes de outubro — cada
mensagem que hoje chega como `free_customer_service` já está sendo gravada como
previsão. A tela e o orçamento podem entrar em outubro sem perda: o dado já
está sendo acumulado.

### As fases 4 e 5 se atravessam de propósito

A régua (fase 4) precisa de dados de cobrança para funcionar, e o importador de
planilha + webhook genérico (fase 5, item 1) é a fonte mais barata desses dados.
Na prática o importador entra **junto** com o núcleo da régua, e o resto do
catálogo de integrações vem depois. Está escrito assim nos dois documentos.

---

## 3. Ordem de execução, em uma linha

```
Fase 1 bloco A (a ponte)
  └─ Fase 1 bloco B (agendamento nos três)
  └─ Fase 1 bloco C (encher a matriz)  ──┐
                                          ├─ Fase 2 (GA dos fluxos)
     Fase 3 (custo)  ─── prazo 1º/10 ────┘
                                          └─ Fase 4 (régua) + Fase 5 item 1
                                               └─ Fase 5 restante (Asaas, Clube)
Fase 6 (agendas) — solta, entra quando o cliente pedir
```

---

## 4. Decisões — tomadas

### 4.1 Dois motores ou um? → **dois motores que se compõem**

Depois da fase 1 o fluxo faz quase tudo que a automação faz, **mais** conversar
— o que levanta a pergunta de por que manter dois.

**Decidido: dois.** A razão, nas palavras de quem decidiu: *automação é para
rodar uma vez e pronto, sem memória; o fluxo é que tem de ter memória.* Isso não
é uma acomodação ao que já existe — é a distinção que dá sentido aos dois:

| | Automação | Fluxo |
|---|---|---|
| Natureza | reação sem estado | conversa com estado |
| Gatilho → fim | sequência reta, termina no mesmo processo | suspende e retoma em `flow_runs.current_node_key` |
| O `wait` dela é | um relógio | o fluxo **também** espera pessoa |
| Pergunta ao cliente? | nunca | é a razão de existir |

**Consequências que valem para todas as fases:**

- A ponte (`iniciar_fluxo`, R-1) é **peça permanente de arquitetura**, não
  remendo. Ela é documentada como recurso de produto e aparece na tela dos dois
  motores.
- Não haverá migração de automações para fluxos. As automações em produção ficam
  onde estão.
- A porta para unificar depois continua aberta de graça, porque a fase 1 tira as
  capacidades de dentro dos motores (`src/lib/actions/`). Se um dia a fusão fizer
  sentido, será trabalho de tela e migração, não de reescrever regra de negócio.

### 4.2 O agendamento no fluxo é nó ou é ponte? → **nós dedicados**

Decidido por recomendação, e a razão é um requisito seu: o cliente que recusa o
custo da IA precisa conseguir agendar. Uma ponte "fluxo entrega para o agente só
para agendar" é mais barata de construir e mata exatamente esse caso.

Fica como está em R-4: `consultar_horarios`, `agendar`, `remarcar`, `cancelar`
como nós, todos sobre `src/lib/actions/scheduling.ts`, mesma fonte de
configuração da IA (`ai_scheduling_settings`).

### 4.3 Quanto de paridade é paridade → **aprovado**

As três células da §4 da fase 1 (coletar entrada na automação; botões/lista como
ferramenta da IA; espera de relógio na IA) são atendidas por composição, não por
duplicação. Aprovado em 03/09.

---

## 5. Decisões que continuam abertas

Não bloqueiam a fase 1. Cada uma bloqueia a sua fase.

| # | Pergunta | Bloqueia | Onde está detalhada |
|---|---|---|---|
| **D-1** | Qual o seletor de agenda: por profissional, por serviço, ou disponibilidade agregada? | fase 6 inteira — muda o schema | [`06-fase-6-multiplas-agendas.md`](./06-fase-6-multiplas-agendas.md) §2 |
| **D-2** | O Clube de Associados tem API? Como autentica? Empurra ou a gente puxa? | só o adaptador do Clube — **não** o núcleo da régua | [`05-fase-5-integracoes.md`](./05-fase-5-integracoes.md) §5 |
| **D-3** | Qual o ticket e o volume da carteira do cliente? | o desenho de agrupamento e de horário de disparo da régua | [`04-fase-4-cobranca.md`](./04-fase-4-cobranca.md) §8 |
| **D-4** | A tarifa exata de serviço da Meta (prometida para 1º/09) | a precificação da régua, não a construção | [`03-fase-3-custo-mensagem.md`](./03-fase-3-custo-mensagem.md) §6 |

---

## 6. O que já está pronto e entra nesta conta

- Provedores de IA abertos, embeddings em qualquer provedor (PR #2, na `main`)
- Correções do Embedded Signup e o botão "Conectar WhatsApp" (na `main`)
- Captura do custo por mensagem da Meta (PR #3, aberto)
- Fluxos já estão em **soft-GA**: o gate por conta foi removido no PR #134; o
  que resta de "beta" é o rótulo na tela. Ver fase 2.
