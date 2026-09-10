# Fase 6 — Múltiplas agendas do Google

> Especificação. **Nenhum código escrito.**
>
> Fundamentação em [`../avaliacao-agendas-e-cobranca.md`](../avaliacao-agendas-e-cobranca.md) §1.
>
> **D-1 decidida em 10/09/2026: seletor POR PROFISSIONAL/RECURSO** — o palpite
> que este documento já registrava. Implementada.

---

## 1. O que existe hoje

Uma agenda por conta, e a decisão está **no banco**, não só no código:

```sql
-- 043_google_calendar.sql
account_id uuid NOT NULL UNIQUE REFERENCES accounts(id)
-- "UNIQUE, not just a FK: one calendar per account is the decision,
--  and the database should be the one enforcing it."
```

`google_calendar_connections` guarda o refresh token, o `calendar_id` (padrão
`'primary'`) e o e-mail do Google. `ai_scheduling_settings` — também
`account_id UNIQUE` — guarda fuso, duração do slot, antecedência mínima, teto de
dias e os horários de funcionamento por dia da semana.

---

## 2. A decisão que bloqueia tudo (D-1)

Tirar o `UNIQUE` é uma linha. A pergunta que precisa de resposta **antes de
escrever qualquer coisa** é:

> Quando o cliente pede "quinta às 14h", em qual das agendas isso entra?

Sem responder, N agendas cadastradas viram uma tela que mente — o mesmo problema
documentado para múltiplos agentes em
[`../analise-multiagente-skills.md`](../analise-multiagente-skills.md) §1.5.

| Seletor | Como funciona | Custo | Quando serve |
|---|---|---|---|
| **Por profissional / recurso** *(palpite)* | cada agenda é uma pessoa ou sala; o cliente escolhe, ou o bot pergunta | M | consultório, salão, oficina |
| **Por serviço** | "corte" cai na agenda A, "coloração" na B | M | quando o serviço determina quem atende |
| **Disponibilidade agregada** | oferece o primeiro horário livre em qualquer agenda e reserva naquela | M+ | maximiza ocupação, mas o cliente não escolhe quem atende |
| **Manual na conversa** | o atendente escolhe ao confirmar | P | fallback honesto enquanto o resto não existe |

**A escolha muda o schema:** "por profissional" pede uma tabela de recursos com
nome e agenda vinculada; "por serviço" pede um mapa serviço → agenda; agregada
não pede nenhuma das duas.

### Decidido: por profissional/recurso

E com um desvio do que o parágrafo acima previa: **não precisou de tabela de
recursos**. O recurso é a própria conexão, com um rótulo — "Dra. Ana",
"Sala 2" — e é ele que aparece no menu. Uma tabela separada só ganharia
sentido se um recurso pudesse existir sem agenda, e não pode: um profissional
sem calendário não tem horário para oferecer.

As outras duas continuam construíveis por cima disto, sem outra migração: "por
serviço" é um mapa de serviço → `connection_id`, e "disponibilidade agregada" é
consultar as N e ordenar. Nenhuma das duas foi feita, porque nenhum cliente
pediu.

---

## 3. O que muda em qualquer cenário

### R-33 · Conexões 1:N — `M` — **feito**

- **A1** `google_calendar_connections` perde o `UNIQUE`, ganha `rotulo` e
  `is_active`.
- **A2** Uma conexão marcada como **padrão** por conta. Toda a lógica existente,
  e todo cliente com uma agenda só, continua funcionando sem tocar em nada.
- **A3** Migração preserva a conexão atual como padrão. Zero mudança visível para
  quem já usa.
- **A4** OAuth não muda: conectar a segunda agenda é repetir o fluxo que já
  existe.

### R-34 · Configuração por agenda — `M` — **parcial**

- **B1** `ai_scheduling_settings` vira 1:N — **horário de funcionamento por
  profissional é o caso comum**, e uma agenda com horário global é mentira em
  consultório.
- **B2** Fuso continua **da conta**, não da agenda. Duas agendas em fusos
  diferentes é problema real, mas não é este cliente, e resolver agora custa
  caro em toda a superfície de data.
- **B3** Conta sem configuração por agenda cai na configuração da conta — o
  comportamento de hoje.

### R-35 · Disponibilidade multi-agenda — `M` — **feito**

- **C1** `availability.ts` hoje consulta um `freebusy`; passa a consultar N e a
  **saber de qual veio cada slot**. Slot sem procedência é o que torna a tela
  mentirosa.
- **C2** Consulta em paralelo, com degradação: agenda que não responde é omitida
  **com aviso**, nunca tratada como "totalmente livre".
- **C3** Teto de agendas consultadas por chamada, para uma conta com vinte
  agendas não estourar a cota do Google numa pergunta.

### R-36 · O seletor nos três motores — `M` — **feito**

Depende de D-1. Em qualquer cenário:

- **D1** `buildSchedulingTools` expõe a agenda como argumento — sem isso a IA
  nunca saberá escolher.
- **D2** Os nós de agendamento do fluxo (fase 1, R-4) ganham o mesmo argumento,
  e o menu de escolha de profissional é um `send_list` comum.
- **D3** Os passos de automação (fase 1, R-5) recebem a agenda como parâmetro
  fixo — automação não pergunta.
- **D4** `event-text.ts` passa a dizer **com quem** é o compromisso. Confirmação
  que não diz o profissional é confirmação incompleta.
- **D5** A ação de domínio `src/lib/actions/scheduling.ts` (fase 1, R-3) é o
  único lugar onde o seletor é implementado. Os três motores só passam adiante.

---

## 4. Critérios de aceite

1. Uma conta com uma agenda só continua funcionando sem nenhuma alteração de
   configuração.
2. Duas agendas conectadas, e o cliente escolhe pelo menu de um fluxo — sem IA.
3. Uma agenda fora do ar é omitida com aviso, e **nunca** oferece horário que não
   existe.
4. A confirmação diz o nome do profissional.
5. O agendamento entra na agenda certa do Google, verificável na conta do
   cliente.

---

## 5. Riscos

| Risco | Mitigação |
|---|---|
| **Tela que mente** | C2: agenda que falha é omitida com aviso, nunca "livre" |
| **Regressão para quem tem uma agenda** | A2 e A3: conexão padrão, migração preserva |
| **Cota do Google** | C3: teto por chamada |
| **Construir antes de decidir o seletor** | §2: a fase não começa sem D-1 |

---

## 6. Estimativa

| Requisito | Esforço |
|---|---|
| R-33 conexões 1:N + tela | ~3 dias |
| R-34 configuração por agenda | ~3 dias |
| R-35 disponibilidade multi-agenda | ~3 dias |
| R-36 seletor nos três motores | ~4 dias |

**Total ~2 semanas**, e depende inteiramente de D-1 estar decidida.

---

## 7. Como ficou

### O achado que a implementação trouxe

O documento previa mexer em `availability.ts` para consultar N `freebusy`. O
problema real era outro, e mais grave: **`loadBusyIntervals` contava TODOS os
compromissos da conta como ocupados**, independentemente da agenda. Isso estava
certo enquanto havia uma agenda; com duas, a reserva da Dra. Ana bloquearia o
horário do Dr. Bruno — e o consultório perderia metade da agenda sem entender
por quê.

A correção é uma cláusula: compromisso com `connection_id` da agenda consultada
sempre conta; `connection_id IS NULL` — anterior à migração 082, ou marcado sem
agenda — conta só para a **padrão**, que é onde ele de fato está.

### O seletor, motor a motor

| Motor | Como escolhe |
|---|---|
| **Agente** | argumento `agenda` nas quatro ferramentas, com os rótulos como enum — e **só** quando a conta tem duas ou mais. Um argumento com uma opção é ruído no schema, custa tokens em toda chamada e é mais uma chance de o modelo preencher errado |
| **Fluxo** | `connection_id` fixo no nó `offer_slots`. O roteiro pergunta "com quem?" num `send_buttons` comum, e cada resposta leva a um `offer_slots` próprio — um nó que perguntasse sozinho seria um segundo jeito de fazer menu |
| **Automação** | a agenda é parâmetro do passo. Automação não pergunta |

O nó que oferece guarda a agenda em `vars._offered_agenda`, e o nó que marca lê
de lá. Sem isso o fluxo reservaria na agenda errada e o profissional certo
continuaria com o horário aberto.

### O que ficou parcial

**R-34** (horário de funcionamento por agenda): o schema aceita — a linha de
`ai_scheduling_settings` com `connection_id` é a da agenda, e a com nulo é a da
conta. O que falta é a **tela** para editar por agenda; hoje as duas agendas
compartilham o expediente da conta. É o próximo passo natural, e a única coisa
que ainda torna "Dra. Ana de manhã, Dr. Bruno à tarde" indizível.

**A tela de conexões** ainda conecta uma agenda e a marca como padrão. Conectar
a segunda funciona (o fluxo de OAuth não mudou), mas rotular e escolher a padrão
é SQL por enquanto.
