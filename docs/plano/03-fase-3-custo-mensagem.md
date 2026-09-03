# Fase 3 — Custo de mensagem do WhatsApp

> Especificação. **Nenhum código escrito.** O único item do plano com **prazo
> externo: 1º de outubro de 2026**.
>
> Fundamentação em [`../cobranca-whatsapp-out-2026.md`](../cobranca-whatsapp-out-2026.md).

---

## 1. Objetivo

A partir de 1º/10 o sistema passa a ter **dois custos independentes por
conversa** — tokens de LLM e mensagens da Meta — e hoje enxerga só um. O teto de
orçamento que o operador configura continua sendo respeitado enquanto a fatura
da Meta cresce sem ninguém ver.

Esta fase fecha esse olho cego.

---

## 2. O que já está pronto (PR #3, aberto)

| Peça | Onde |
|---|---|
| Tabela `whatsapp_message_costs`, uma linha por mensagem por conta, única em `(account_id, message_id)` | `supabase/migrations/075_whatsapp_message_costs.sql` |
| `parseMessagePricing` — lê `{billable, pricing_model, type, category}` do webhook de status | `src/lib/whatsapp/message-cost.ts` |
| `recordMessageCost` — upsert idempotente, avisa uma vez sobre valor de enum desconhecido | idem |
| Resolução da conta pela mensagem, com fallback por `broadcast_recipients → broadcasts` | `src/app/api/whatsapp/webhook/route.ts` |
| Escotilha `WHATSAPP_LOG_PRICING` — registra os campos de preço, nunca o destinatário | `message-cost.ts` |

**Duas decisões desse PR que se mantêm nesta fase:**

- **Sem CHECK em `category`/`type`.** A Meta acrescenta valores; uma constraint
  transformaria isso numa atualização de status descartada.
- **`pricing` ausente significa "nada a registrar", nunca "grátis".** Do
  contrário a previsão leria zero exatamente no dia em que mais importa.

### O que falta no próprio PR #3

- Verificação em produção com `WHATSAPP_LOG_PRICING=true` por alguns dias contra
  tráfego real, antes de marcar a caixa de verificação do PR.
- Merge.

---

## 3. O que falta construir

### R-14 · Tabela de preços do WhatsApp — `P`

O contador sabe **o que** a Meta cobrou; não sabe **quanto**.

- **A1** Tabela `whatsapp_message_prices`: país, categoria, preço em USD,
  vigência. Mesmo padrão de `ai_model_prices` — override de admin sobre uma
  tabela no código.
- **A2** Fallback para a constante em código quando a tabela estiver vazia ou
  inacessível. Mostrar preço levemente defasado é melhor que mostrar erro onde
  deveria haver número — a mesma regra de `loadPriceOverrides`.
- **A3** Preço por **vigência**, não único: a virada de 1º/10 muda a tarifa de
  serviço, e o histórico anterior tem de continuar sendo lido pelo preço da
  época.
- **A4** Semente com a tarifa brasileira de utilidade (~US$ 0,0068). Trocar
  quando a Meta publicar a tabela definitiva (D-4).

### R-15 · Os dois custos na mesma tela — `M`

Hoje `/api/ai/costs` responde só o gasto de LLM, e o card do painel mostra só ele.

- **B1** `GET /api/whatsapp/costs`: gasto do mês por categoria (marketing ·
  utilidade · serviço · autenticação), contagem de mensagens, e quanto foi
  **cobrável** segundo a própria Meta.
- **B2** O card de custo do painel passa a mostrar **os dois lados** e o total.
  Não dois cards distantes: o operador precisa ver a soma antes da fatura.
- **B3** Uma linha de **previsão**: quanto do mês corrente teria sido cobrado
  sob as regras de outubro. É o que o dado já acumulado desde o PR #3 permite
  responder, e é o argumento comercial da fase.
- **B4** Quebra por superfície de origem (IA, inbox, automação, fluxo, broadcast,
  API pública) — sem isso o operador vê o total e não sabe o que cortar.

### R-16 · Orçamento cobrindo os dois custos — `M`

`monthly_budget_usd` e `budget_exceeded_action` protegem só o gasto de LLM.

- **C1** Segundo teto, para custo de mensagem, com a mesma mecânica e as mesmas
  duas ações (`block_and_handoff` · `notify_only`).
- **C2** Aviso ao aproximar-se do teto, como já existe para IA.
- **C3** Estourar o teto de mensagem **não** pode bloquear resposta de atendente
  humano na inbox nem mensagem de sessão de suporte — só automação, fluxo,
  broadcast e resposta automática de IA. Calar o atendente para economizar
  R$ 0,04 é o pior resultado possível.
- **C4** O bloqueio é registrado com motivo, e aparece na tela. Mensagem que não
  saiu por orçamento nunca pode sumir em silêncio.

### R-17 · Os controles que viraram controle de custo — `P`

Três configurações deixaram de ser só de UX e passaram a ser de dinheiro. A tela
tem de dizer isso.

- **D1** `auto_reply_max_per_conversation` (padrão 3) — mostrar o custo estimado
  por conversa ao lado do número.
- **D2** `handoff_notice_enabled` — deixar explícito que ligar custa **uma
  mensagem a mais por transferência**.
- **D3** Marcar as conversas que entraram por **Click-to-WhatsApp** (o
  `type: free_entry_point` do webhook já identifica) e mostrar a janela de 72h
  na conversa. É a única entrada que continua gratuita depois de outubro, e o
  operador precisa saber que está dentro dela.

---

## 4. Critérios de aceite

1. Uma mensagem enviada hoje aparece na tela de custo com categoria, preço e
   superfície de origem em até um minuto.
2. A previsão "sob as regras de outubro" bate com a soma manual das mensagens
   `free_customer_service` do mês.
3. Estourar o teto de mensagem bloqueia automação e resposta de IA, e **não**
   bloqueia o atendente humano.
4. Toda mensagem bloqueada por orçamento tem registro com motivo.
5. Uma conversa vinda de anúncio é identificável como tal na inbox.

---

## 5. Riscos

| Risco | Mitigação |
|---|---|
| **A Meta muda o formato de `pricing`** | já tratado: sem CHECK, aviso uma vez, e o campo ausente não vira "grátis" |
| **Tarifa errada na tabela** | A3 (vigência) permite corrigir sem reescrever histórico; A2 mantém a tela viva |
| **O teto calar o atendimento** | C3 é requisito, não recomendação |
| **Prazo de 1º/10** | a captura já corre desde o PR #3; tela e teto podem entrar em outubro sem perder dado |

---

## 6. O que ainda não sei

- **A tarifa exata de serviço** (D-4). A Meta prometia publicar até 1º/09/2026.
  Muda o número da tabela, não o desenho.
- **Markup do BSP.** Quem usa a Cloud API direto paga a tarifa da Meta; quem
  passa por BSP paga mais. Isso é por instalação — A1 precisa aceitar um
  multiplicador por conta.

---

## 7. Estimativa

| Requisito | Esforço |
|---|---|
| R-14 tabela de preços | ~2 dias |
| R-15 tela dos dois custos | ~4 dias |
| R-16 segundo orçamento | ~4 dias |
| R-17 controles de custo | ~2 dias |

**Total ~2,5 semanas.** Fase independente das outras — pode correr em paralelo
com a fase 1 se houver mais de uma pessoa.
