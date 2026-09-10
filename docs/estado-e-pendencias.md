# Estado e pendências — visão única

> Consolida cinco documentos que hoje contam pedaços da mesma história:
> `analise-deskcommcrm.md`, `analise-multiagente-skills.md`,
> `analise-embeddings.md`, `plano-provedores.md` e
> `cobranca-whatsapp-out-2026.md`.
>
> Estado verificado por inspeção do código em `main @ 52dbf11`, não por
> memória de commit.

---

## 1. O que está pronto

### 1.1 Entregue nesta frente (PR #2, mergeado)

| | Onde |
|---|---|
| Provedor como vocabulário aberto — sem CHECK no banco | migration `073` |
| Dispatch por **formato de fio**, não por nome do provedor | `providers/catalog.ts`, `agent.ts` |
| `base_url` configurável — gateway próprio e modelo self-hosted | migration `073` |
| Cinco provedores: OpenAI, Anthropic, DeepSeek, OpenRouter, custom | `providers/catalog.ts` |
| Validação de chave separando "chave ruim" de "modelo ruim" | `providers/validate-key.ts` |
| Embeddings em qualquer provedor, independentes do chat | migration `074` |
| Base de conhecimento em 1024 dims — libera `bge-m3` e multilíngues | migration `074` |
| Guarda de dimensão no salvamento | `embeddings.ts` |

### 1.2 Entregue pela `main` por conta própria

Nove itens da lista original saíram enquanto esta frente corria:

`I-3` guardrails · `I-5` tools no turno do agente · `I-6` transcrição de áudio ·
`I-9` memória da organização · `M-6` custo de LLM em dinheiro · `M-7` orçamento
mensal · `V-6` distribuição entre atendentes · `V-7` escalação e transbordo ·
`P-13` português brasileiro.

### 1.3 Correções de conexão (já em produção)

Evento de conclusão da coexistência, `CANCEL` deixando de ser engolido, botão
"Conectar WhatsApp", e as duas mensagens de erro que mandavam repetir o que
repetir não resolve.

---

## 2. O que falta

### 2.1 Cobrança do WhatsApp — **tem prazo**

**30/09/2026.** É o único item da lista com data. Detalhe em
[`cobranca-whatsapp-out-2026.md`](./cobranca-whatsapp-out-2026.md).

| | Estado |
|---|---|
| Contador de mensagens cobráveis por conta | **não existe** |
| Custo de WhatsApp na tela | **não existe** |
| Orçamento cobrindo mensagem (hoje só cobre LLM) | **não existe** |
| Teto de respostas por conversa exposto como controle de custo | existe a coluna, não a leitura |
| Aproveitamento da janela grátis de 72h por anúncio | **não existe** |

Confirmado por busca: nenhuma ocorrência de `message_cost`, `billable`,
`service_message` ou `whatsapp_cost` no código.

### 2.2 Camada de modelos — o que sobrou

| ID | O que é | Esforço |
|---|---|---|
| `M-3` | Múltiplas credenciais por conta | M |
| `M-5` | Catálogo de modelos sincronizado da OpenRouter | M |
| `M-9` | Modelo por ponto de uso | G |

`M-9` depende de `M-3`. Nenhum tem prazo.

### 2.3 Agentes e skills

| ID | O que é | Esforço |
|---|---|---|
| `I-8a` | Skills: versões, ponteiros, matcher determinístico | M |
| `I-8b` | Skills: pacote instalável e references | G |
| `I-1a` | Múltiplos agentes | M |
| `I-1b` | Versionamento imutável e publish | M |
| `I-2` | Seletor de agente do turno | M |

Duas notas que mudam o recorte:

- **`I-8b` destravou.** Dependia de tool-calling, que a `main` entregou.
- **`I-1` sozinho entrega uma tela que mente.** Eles selecionam agente por canal
  e nós temos um número só, então o seletor (`I-2`) não é polimento — é o único
  jeito de mais de um agente fazer sentido aqui.

### 2.4 Canal e plataforma

`C-1` WhatsApp por QR (WAHA) · `C-6` webhooks de entrada · `V-1` a `V-5` e `V-8`,
`V-9` (leads como entidade, scoring, cadências, casos) · o bloco `P-*` de
plataforma, menos o que já saiu.

Nada disso tem prazo.

---

## 3. Ordem que faz sentido agora

1. **Contador de mensagens cobráveis.** Único item com data, e base de todo o
   resto do bloco de cobrança. Sem ele, a primeira fatura de outubro chega sem
   número nenhum para conferir.
2. **Custo de WhatsApp na tela + orçamento cobrindo os dois custos.**
3. **`I-8a` (skills).** Melhor retorno da lista sem prazo: não depende de nada,
   e entrega uma capacidade que não existe de forma nenhuma.
4. **`M-3` → `M-9`**, se e quando a operação pedir modelo diferente por tarefa.
5. **`I-1a` + `I-1b` + `I-2` como bloco**, nunca `I-1` sozinho.

---

## 4. O que ainda não sei, e afeta a ordem

- **A tarifa exata de serviço** — a Meta publica até 1º/09/2026.
- **Se o webhook de status expõe a categoria cobrada.** Se expuser, o contador
  fica exato; se não, é estimativa. Isso muda o desenho, não só a precisão, e é
  a primeira coisa a verificar.
