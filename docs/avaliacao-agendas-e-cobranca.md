# Avaliação — múltiplas agendas do Google e módulo de régua de cobrança

> Duas frentes novas, avaliadas contra o código em `main @ 52dbf11`. Nenhuma
> linha escrita ainda — isto é o que precisa acontecer, e o que eu não sei.

---

## Parte 1 — Múltiplas agendas do Google

### 1.1 O que existe hoje

Uma agenda por conta, e a decisão está **no banco**, não só no código:

```sql
-- 043_google_calendar.sql
account_id uuid NOT NULL UNIQUE REFERENCES accounts(id)
-- "UNIQUE, not just a FK: one calendar per account is the decision,
--  and the database should be the one enforcing it."
```

`google_calendar_connections` guarda o refresh token, o `calendar_id` (default
`'primary'`) e o e-mail do Google. `ai_scheduling_settings` — também
`account_id UNIQUE` — guarda fuso, duração do slot, antecedência mínima, teto de
dias e os horários de funcionamento por dia da semana.

### 1.2 O trabalho não é o schema. É o seletor.

Tirar o `UNIQUE` é uma linha. A pergunta que precisa de resposta antes de
escrever qualquer coisa é:

> **Quando o cliente pede "quinta às 14h", em qual das agendas isso entra?**

Sem responder isso, N agendas cadastradas viram uma tela que mente — exatamente
o mesmo problema que documentei para múltiplos agentes em
[`analise-multiagente-skills.md`](./analise-multiagente-skills.md) §1.5.

Os seletores possíveis, do mais barato ao mais caro:

| Seletor | Como funciona | Custo | Quando serve |
|---|---|---|---|
| **Por profissional / recurso** | cada agenda é uma pessoa ou sala; o cliente escolhe, ou a IA pergunta | M | consultório, salão, oficina — provavelmente o seu caso |
| **Por serviço** | "corte" cai na agenda A, "coloração" na B | M | quando o serviço determina quem atende |
| **Disponibilidade agregada** | a IA oferece o primeiro horário livre em qualquer agenda e reserva naquela | M+ | maximiza ocupação, mas o cliente não escolhe quem atende |
| **Manual na conversa** | o atendente escolhe ao confirmar | P | fallback honesto enquanto o resto não existe |

**Esta é a decisão de produto que eu preciso de você**, e ela muda o schema:
"por profissional" pede uma tabela de recursos com nome e agenda vinculada;
"por serviço" pede um mapa serviço → agenda; agregada não pede nenhuma das duas.

### 1.3 O que muda, em qualquer cenário

| Peça | O que acontece |
|---|---|
| `google_calendar_connections` | perde o `UNIQUE`, ganha rótulo e `is_active`; passa a ser 1:N |
| `ai_scheduling_settings` | ou vira 1:N também (cada agenda com seu horário e duração), ou fica global com override por agenda. **Horário de funcionamento por profissional é o caso comum**, então eu apostaria em 1:N |
| `availability.ts` | hoje consulta um `freebusy`; passa a consultar N e a saber de qual veio cada slot |
| Tools da IA | `buildSchedulingTools` precisa expor a agenda como argumento, ou a IA nunca saberá escolher |
| Texto do evento | `event-text.ts` deve dizer **com quem** é o compromisso |
| OAuth | o fluxo já pede consentimento por conta Google; conectar a segunda é repetir o fluxo, sem novidade técnica |

### 1.4 Estimativa

- **Schema + conexões múltiplas + tela:** M (3–5 dias)
- **Seletor + disponibilidade multi-agenda + tools:** M (3–5 dias)
- **Total realista:** ~2 semanas, e depende inteiramente da §1.2 estar decidida.

---

## Parte 2 — Módulo de régua de cobrança

### 2.1 O que já existe e serve

Bastante coisa, e isso encurta o caminho:

| Peça | Onde | Serve para |
|---|---|---|
| Motor de automações com passo `wait` (minutos/horas/dias) | `src/lib/automations/` | a espera entre os degraus da régua |
| Cron drenando execuções pendentes | `/api/automations/cron` | fazer a régua andar sem ninguém clicar |
| Envio de template e de texto | `automations/meta-send.ts` | o disparo em si |
| Condições e ramificação | `validate.ts` → `condition` | "se já pagou, pare" |
| Contatos com campos personalizados e tags | `contacts` | onde o associado mora |

### 2.2 O que **não** serve, e por quê

O motor de automações é **reativo a evento de conversa** — os gatilhos são
`new_message_received`, `keyword_match`, `tag_added`, `new_contact_created`,
`time_based`, `interactive_reply`. Não existe gatilho de **estado de uma
cobrança**, e é isso que uma régua precisa.

A diferença não é cosmética. Uma régua de cobrança é dirigida por uma **data de
vencimento que existe fora do CRM** e por um **estado que muda sozinho** (o
associado pagou ontem, e o disparo de D+3 não pode sair). Modelar isso como
"automação com waits" produz o defeito clássico: a régua dispara D+5 para quem
já quitou, porque o `wait` não observa nada enquanto espera.

### 2.3 O que precisa ser construído

**a) Espelho das cobranças.** Uma tabela `cobrancas` por conta: id externo,
contato, valor, vencimento, status (`aberta` · `paga` · `cancelada`), data de
pagamento, e a marca de sincronização. É o espelho local do que vem do Clube de
Associados — sem ele não há como saber a quem, quando, nem parar de cobrar quem
pagou.

**b) Régua configurável.** Não uma automação: uma lista de degraus por conta —
offset em dias relativo ao vencimento (`-3`, `0`, `+2`, `+5`), qual template,
em que horário do dia, e se aquele degrau está ligado. Offsets negativos são o
aviso de "vence em 3 dias", que costuma ser o que mais reduz inadimplência.

**c) Registro de disparo, com idempotência.** Uma linha por (cobrança, degrau),
única. É o que impede o cron de mandar a mesma cobrança duas vezes se rodar
duas vezes — e cobrar duas vezes um associado que já pagou é o erro que custa
cliente.

**d) Worker diário.** Lê cobranças abertas, calcula qual degrau vence hoje,
confere se já disparou, envia. **Reavalia o estado no momento do disparo**, não
no momento do agendamento — é o que resolve a §2.2.

**e) Sincronização com o Clube de Associados.** Ver §2.4.

### 2.4 O risco real está aqui

O cliente diz que o Clube de Associados tem API aberta. **Eu não consegui
confirmar.** O produto existe — [clubesassociados.com.br](https://clubesassociados.com.br/),
sistema de gestão para clubes e associações, mais de 65 mil associados
segundo o próprio site — mas não há documentação pública de API nos resultados
de busca, e o site está bloqueado pelo proxy deste ambiente.

**Antes de estimar esta parte, preciso de três respostas do cliente:**

1. **A documentação da API.** URL, ou o PDF que o fornecedor mandou.
2. **Como autentica** — chave fixa, OAuth, token por sessão?
3. **Ela empurra ou a gente puxa?** Tem webhook de "pagamento recebido", ou
   vamos ter de varrer periodicamente?

A terceira muda o desenho inteiro. Com webhook, um pagamento cancela o próximo
degrau em segundos. Sem webhook, existe uma **janela de erro igual ao intervalo
de varredura** — varrer de hora em hora significa que alguém que pagou às 9h05
ainda pode receber cobrança às 9h30. Isso é aceitável a 1h, constrangedor a 24h,
e é decisão do cliente saber com qual ele convive.

> **Recomendação de contrato:** independente da resposta, a sincronização deve
> ser **um adaptador isolado** (`src/lib/integrations/clube-associados/`) com
> uma interface própria — "me dê as cobranças abertas", "me diga se esta foi
> paga". Assim a régua não sabe de quem vêm os dados, e o dia em que este
> cliente trocar de sistema, ou o próximo cliente usar outro, troca-se o
> adaptador e não o módulo.

### 2.5 Estimativa

| Parte | Esforço | Depende de |
|---|---|---|
| Espelho + régua + registro de disparo + worker | M (5–7 dias) | nada |
| Tela de configuração da régua | M (3–4 dias) | acima |
| Adaptador do Clube de Associados | **não estimável ainda** | §2.4 |

O núcleo (a–d) **não depende da API**. Dá para construir e testar com cobranças
inseridas à mão, e plugar o adaptador quando a documentação chegar. Recomendo
fazer exatamente nessa ordem, para o prazo do cliente não ficar refém de um
fornecedor terceiro.

---

## Parte 3 — A interação com a mudança de outubro

Uma régua de cobrança é uma **máquina de gerar mensagens cobradas**. Cada degrau
é um template de utilidade — hoje grátis dentro da janela de 24h, cobrado a
partir de 1º/10 (ver [`cobranca-whatsapp-out-2026.md`](./cobranca-whatsapp-out-2026.md)).

Uma régua de 4 degraus para 500 associados é 2.000 mensagens cobráveis por mês
que hoje não existem. Não é impeditivo — é barato perto do que a inadimplência
custa — mas o contador de mensagens (PR #3) passa de "bom ter" a **pré-requisito
para vender isso com preço**. Vale fechá-lo antes.

---

## O que eu preciso de você para seguir

1. **Agendas:** qual seletor da §1.2? (Meu palpite: por profissional.)
2. **Cobrança:** as três respostas da §2.4 sobre a API.
3. **Ordem:** faço o núcleo da régua sem a API em paralelo, ou espero a
   documentação?
