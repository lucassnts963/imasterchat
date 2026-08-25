# Cobrança do WhatsApp muda em 1º de outubro de 2026 — o que isso faz com a nossa estrutura

> **Prazo: ~5 semanas.** A política gratuita acaba em **30/09/2026**.
>
> **Ressalva de fonte:** `developers.facebook.com` está bloqueado pelo proxy do
> ambiente onde esta análise foi feita, então tudo abaixo vem de fontes
> secundárias que concordam entre si. **Confirme na página oficial de pricing da
> Meta antes de tomar decisão de preço.** A Meta publica a tabela exata até
> **1º/09/2026**.

## 1. O que muda

Hoje, responder um cliente dentro da janela de 24 horas é **grátis**. A partir de
1º de outubro, não é mais.

| | Até 30/09/2026 | A partir de 01/10/2026 |
|---|---|---|
| Resposta livre dentro da janela de 24h (*service message*) | grátis | **cobrada**, por mensagem |
| Template de utilidade dentro da janela | grátis | **cobrado**, por mensagem |
| Template de marketing | cobrado | cobrado (sem mudança) |
| Template de autenticação | cobrado | cobrado (sem mudança) |
| Entrada por anúncio Click-to-WhatsApp / CTA do Facebook | grátis por 72h | **continua grátis por 72h** |

A tarifa de serviço passa a ser **a mesma de utilidade** no país do destinatário.
No Brasil, utilidade está em torno de **US$ 0,0068 por mensagem** (~R$ 0,04).

## 2. Por que isso nos atinge mais do que a média

Somos um CRM de **atendimento receptivo com resposta automática**. O nosso caso de
uso é exatamente o que era gratuito e deixa de ser.

Cada resposta da IA vira uma mensagem cobrada. Não é um aumento percentual sobre
uma conta existente — é uma **linha de custo que hoje é zero**.

Conta rápida, com os padrões atuais do produto (teto de 3 respostas por conversa):

| Conversas/mês | Mensagens de serviço | Custo/mês (BR) |
|---|---|---|
| 500 | 1.500 | ~US$ 10 |
| 2.000 | 6.000 | ~US$ 41 |
| 10.000 | 30.000 | ~US$ 204 |

Sem contar as respostas dos atendentes humanos, que também são mensagens de
serviço.

## 3. O que na nossa estrutura é afetado

### 3.1 Cinco superfícies emitem mensagem de serviço

Todas passam por `engineSendText` → `kind: 'text'`, que é resposta livre:

| Superfície | Arquivo |
|---|---|
| Resposta automática da IA | `src/lib/ai/auto-reply.ts:439` |
| Aviso de transferência | `src/lib/ai/auto-reply.ts:392` |
| Inbox (resposta do atendente) | `src/app/api/whatsapp/send/route.ts` |
| API pública | `src/app/api/v1/messages/route.ts` |
| Automações e fluxos | `src/lib/automations/meta-send.ts`, `src/lib/flows/meta-send.ts` |

### 3.2 O buraco: somos cegos para esse custo

`ai_usage_log` conta **tokens de LLM**. `monthly_budget_usd` limita **gasto de
LLM**. Procurei e **não existe nada** que conte mensagem enviada ou custo de
WhatsApp — nem tabela, nem coluna, nem tela.

A partir de outubro passam a existir **dois custos independentes** por conversa, e
o sistema enxerga só um. O teto de orçamento que o operador configurar vai
continuar sendo respeitado enquanto a fatura da Meta cresce sem ninguém ver.

### 3.3 Coisas que viram decisão de custo, e hoje não são

- **`auto_reply_max_per_conversation`** (padrão **3**) deixa de ser só um freio
  contra spam e passa a ser o **principal controle de custo por conversa**.
- **`handoff_notice_enabled`** manda uma mensagem a mais. Uma transferência com
  aviso ligado custa **duas** mensagens em vez de uma. Nasce desligado, o que
  agora também é uma escolha de dinheiro, não só de UX.
- **Templates de utilidade em automações e fluxos** perdem a carona gratuita
  dentro da janela.

### 3.4 O que não muda

Broadcasts já eram cobrados como template de marketing — nada muda ali. E a
janela gratuita de 72h por anúncio Click-to-WhatsApp **sobrevive**, o que é uma
alavanca real de produto: conversa que entra por anúncio continua saindo de graça.

## 4. O que eu recomendo construir

Em ordem de urgência, considerando as 5 semanas:

1. **Contador de mensagens cobráveis por conta** — uma linha por envio, com
   categoria (serviço / utilidade / marketing / autenticação) e país. Sem isso não
   dá para estimar nem cobrar do cliente final. É a base de tudo abaixo.
2. **Custo de WhatsApp na mesma tela do custo de IA** — o operador precisa ver os
   dois lados antes da fatura, não depois.
3. **Estender o orçamento**, ou criar um segundo teto. Hoje `budget_exceeded_action`
   protege só o gasto de LLM.
4. **Expor o teto de respostas por conversa como o que ele agora é** — um controle
   de custo, com o número na tela em vez de escondido na configuração.
5. **Aproveitar a janela de 72h dos anúncios** — se o CRM souber que a conversa
   entrou por Click-to-WhatsApp, dá para tratar diferente.

## 6. Respondido: a Meta **manda** a categoria cobrada

A pergunta que estava em aberto na §5 tem resposta, e é a melhor possível.

O webhook de status já traz um objeto `pricing` junto de cada `statuses[]`:

```json
"pricing": {
  "billable": false,
  "pricing_model": "PMP",
  "type": "free_customer_service",
  "category": "utility"
}
```

| Campo | O que é |
|---|---|
| `billable` | a decisão da **própria Meta** sobre cobrar ou não |
| `category` | `marketing` · `utility` · `service` · `authentication` |
| `type` | `regular` (cobrada) · `free_customer_service` · `free_entry_point` |
| `pricing_model` | `PMP` — per-message pricing |

Três consequências:

**1. O contador pode ser exato, não estimado.** Não precisamos inferir categoria
nem aplicar tabela de preço para saber *o que foi cobrado* — a Meta diz. A tabela
de preço serve só para converter em dinheiro.

**2. Já estamos recebendo isso e jogando fora.** O tipo em
`src/app/api/whatsapp/webhook/route.ts:93` declara quatro campos
(`id`, `status`, `timestamp`, `recipient_id`) e `handleStatusUpdate` lê os mesmos
quatro. O `pricing` chega e é descartado.

**3. Dá para começar a medir hoje, e isso muda o valor do trabalho.** Toda
mensagem que hoje chega como `type: "free_customer_service"` é exatamente uma
mensagem que **passa a custar** em 1º de outubro. Capturando agora, o operador
chega em outubro com um número real do que vai pagar, em vez de descobrir na
fatura. E quando a virada acontecer, ela aparece nos nossos próprios dados: as
mesmas mensagens deixam de vir `free_customer_service` e passam a vir `regular`
com `category: service`.

O `type: "free_entry_point"` é o que identifica a janela de 72h por anúncio — a
alavanca da §4, item 5, também sai de graça daqui.

> **Ressalva:** confirmado em duas fontes secundárias que concordam no formato,
> porque `developers.facebook.com` está bloqueado neste ambiente. O formato é
> fácil de verificar em produção: basta registrar um payload de status bruto uma
> vez e olhar.

## 5. O que ainda não sei

- **A tarifa exata de serviço** — a Meta publica até 1º/09/2026. Usei a de
  utilidade porque as fontes dizem que serão iguais.
- ~~Se a Meta expõe a categoria cobrada por mensagem no webhook de status.~~
  **Respondido na §6: expõe.** O contador pode ser exato.
- **Markup do BSP.** Quem usa a Cloud API direto paga a tarifa da Meta; quem passa
  por BSP paga mais. Isso é por instalação, não nosso.
