# Fase 4 — Módulo de cobrança (a régua)

> Especificação. **Nenhum código escrito.**
>
> Fundamentação em [`../avaliacao-agendas-e-cobranca.md`](../avaliacao-agendas-e-cobranca.md)
> §2 e [`../posicionamento-cobranca.md`](../posicionamento-cobranca.md) §2.
>
> Depende da **fase 1** (template como nó, a ponte, ações de CRM) e da **fase 3**
> (sem contador de mensagem a régua não é precificável). Não depende de nenhuma
> API de terceiro — ver §7.

---

## 1. Objetivo

Transformar "uma lista de quem deve" em mensagens que recuperam dinheiro, dentro
da lei, sem virar assédio, e com número no fim do mês que justifique a
mensalidade.

---

## 2. Por que isso não é uma automação com `wait`

Uma régua é dirigida por uma **data de vencimento que existe fora do CRM** e por
um **estado que muda sozinho** — o associado pagou ontem, e o degrau de D+3 não
pode sair.

O motor de automações é reativo a evento de conversa: `new_message_received`,
`keyword_match`, `tag_added`, `new_contact_created`, `time_based`,
`interactive_reply`. **Não existe gatilho de estado de uma cobrança.**

Modelar a régua como "automação com waits" produz o defeito clássico: o `wait`
não observa nada enquanto espera, e o D+5 sai para quem já quitou.

> **A régua é um motor próprio, e não um quarto motor de conversa.** Ela decide
> *quem* recebe *o quê* e *quando*; o envio e a conversa que vem depois são
> fluxo e automação, pela ponte da fase 1. Ver §5.

---

## 3. Modelo de dados

### R-18 · Espelho das cobranças — `M`

Uma tabela `cobrancas` por conta. É o espelho local do que vem de fora; sem ela
não há como saber a quem, quando, nem parar de cobrar quem pagou.

| Campo | Observação |
|---|---|
| `account_id` | RLS por conta, como todo o resto |
| `contact_id` | quem recebe. Nulo enquanto não casar com um contato — cobrança órfã é visível, não descartada |
| `titular_id` | **quem deve**, que pode não ser quem recebe. Ver R-22 |
| `id_externo` + `origem` | de onde veio (planilha, webhook, Asaas, Clube). Único por `(account_id, origem, id_externo)` |
| `valor`, `vencimento` | o mínimo |
| `status` | `aberta` · `paga` · `cancelada` · `negociando` |
| `pago_em`, `valor_pago` | baixa |
| `descricao`, `link_pagamento`, `codigo_pix`, `linha_digitavel` | o que vai na mensagem |
| `sincronizado_em` | a idade do dado. Aparece na tela |

- **A1** Sem CHECK em `origem` — pela mesma razão do §2 da fase 3: fonte nova não
  pode virar erro de constraint.
- **A2** `status` **tem** CHECK: é vocabulário nosso, não de terceiro.
- **A3** Cobrança sem contato casado não dispara nada e aparece numa fila de
  "não identificados" com o telefone bruto, para o operador resolver.

### R-19 · A régua — `M`

Não uma automação: uma lista de degraus por conta.

| Campo do degrau | Exemplo |
|---|---|
| `offset_dias` | `-3` (aviso), `0` (vencimento), `+2`, `+5` |
| `template_id` | qual template da Meta |
| `hora_do_dia` | `09:00` |
| `ativo` | ligar/desligar um degrau sem apagá-lo |
| `fluxo_id` (opcional) | qual fluxo assume se o cliente responder |

- **B1** Offsets negativos são requisito, não enfeite: o aviso de "vence em 3
  dias" é o que mais reduz inadimplência.
- **B2** Mais de uma régua por conta, escolhida por critério (faixa de valor,
  tag do contato, produto). Uma régua só para toda a carteira não sobrevive ao
  segundo cliente.
- **B3** Ordem por `offset_dias`, e **intervalo mínimo entre degraus** validado
  ao salvar — ver R-21.

### R-20 · Registro de disparo com idempotência — `P`

Uma linha por `(cobranca_id, degrau_id)`, **única**.

- **C1** A unicidade é do banco, não do código. É o que impede o cron de mandar
  duas vezes se rodar duas vezes.
- **C2** Guarda o texto **como foi enviado**, não o template — o template muda, o
  que a pessoa recebeu não. É a trilha de auditoria.
- **C3** Guarda o `message_id` da Meta, ligando ao `whatsapp_message_costs` da
  fase 3. É o que permite responder "quanto custou recuperar este título".
- **C4** Guarda também os disparos **suprimidos**, com o motivo (fora da janela,
  teto atingido, já pago, agrupado em outro). Supressão silenciosa é
  indepurável.

---

## 4. As regras que o worker impõe

Este é o §2.1 de [`../posicionamento-cobranca.md`](../posicionamento-cobranca.md)
virando requisito. **Nada disto é sugestão de tela: é o worker que recusa.**

### R-21 · Janela legal e teto anti-assédio — `M`

| Regra | Origem | Requisito |
|---|---|---|
| Nada de madrugada, fim de semana ou feriado | CDC art. 42 + SARB 27/2023 | **D1** janela de contato por conta: padrão seg–sex 8h–20h, sáb 8h–14h, e uma **tabela de feriados** nacional com acréscimos por conta |
| Sem contato repetido em curto intervalo | CDC art. 42 | **D2** teto de contatos por título por período, e intervalo mínimo entre degraus, ambos configuráveis com padrão conservador |
| Sem expor, ameaçar ou constranger | CDC art. 42 | **D3** revisão dos templates-modelo entregues com o produto; nada de negativação como ameaça |
| Nunca falar da dívida com terceiros | CDC | **D4** a régua só fala com o **titular**. Nunca com outro número da conta, nunca com contato secundário |
| Identificar credor, valor, vencimento e como pagar | boas práticas | **D5** campos obrigatórios validados **ao salvar o degrau**, não no disparo |

- **D6** Degrau que cairia fora da janela é **adiado para a próxima abertura**,
  não descartado — e o adiamento fica registrado.
- **D7** A janela é do **fuso da conta**, o mesmo de `ai_scheduling_settings`.
  Sem segunda configuração de fuso no produto.

> Um degrau que dispara domingo às 22h não é bug de UX: é exposição jurídica do
> cliente. E "a régua respeita CDC e horário legal" é argumento comercial direto
> contra quem manda mensagem por script de planilha.

### R-22 · Agrupamento por titular — `M`

Quem tem três títulos vencidos recebe **uma** mensagem, não três. Sem isso a
régua vira assédio por construção.

- **E1** O worker agrupa por `titular_id` dentro da mesma janela de disparo.
- **E2** O template do degrau aceita **lista de títulos** como variável, com
  total. Um template para um título e outro para vários.
- **E3** Suprimidos por agrupamento ficam registrados apontando para o disparo
  que os cobriu (R-20 C4).

### R-23 · Parar na resposta — `P`

Cliente respondeu — negociando, contestando ou avisando que pagou — a régua
**pausa** e vira atendimento humano. Continuar disparando por cima é o caminho
mais rápido para virar reclamação.

- **F1** Resposta do titular pausa a régua **daquele titular**, não só daquele
  título.
- **F2** A pausa tem prazo configurável; vencido, a régua retoma de onde parou.
- **F3** Pausa e retomada aparecem na conversa, não só no log.

### R-24 · Promessa de pagamento — `P`

"Pago sexta" precisa reagendar o próximo degrau, não repetir a mesma cobrança
quinta.

- **G1** Campo `promessa_para` na cobrança, com quem registrou e quando.
- **G2** Enquanto a promessa não vence, a régua não dispara para aquele título.
- **G3** Promessa quebrada tem degrau próprio, opcional, na régua.
- **G4** Registrável pelo atendente na inbox **e** por nó de fluxo — o cliente que
  responde "3" no menu de "quando você consegue pagar?" registra sozinho.

### R-25 · Baixa e parada automática — `P`

- **H1** Cobrança que vira `paga` sai da régua imediatamente.
- **H2** O worker **reavalia o estado no momento do disparo**, não no momento do
  agendamento. É o que resolve o §2 deste documento.
- **H3** Com fonte que empurra (webhook), a baixa é em segundos. Com fonte que só
  é varrida, existe uma **janela de erro igual ao intervalo de varredura** — o
  produto exibe essa janela na tela da integração, para o cliente saber com qual
  ele convive.

---

## 5. Como a régua usa os outros motores

A régua não conversa. Ela decide e delega — e é aqui que a fase 1 se paga.

```
worker diário
  └─ escolhe (cobrança, degrau) elegível hoje
       └─ envia o TEMPLATE do degrau          ← ação de domínio, fase 1 R-7
            └─ cliente responde
                 └─ inicia o FLUXO do degrau  ← a ponte, fase 1 R-1
                      ├─ "1 · já paguei"      → registra promessa/contestação, pausa (R-23)
                      ├─ "2 · quero negociar" → handoff, com retomada (fase 2 R-12)
                      └─ "3 · segunda via"    → devolve link/PIX
```

- **I1** O degrau aponta para um fluxo opcional (`fluxo_id`, R-19). Sem fluxo, o
  degrau é só o template.
- **I2** O fluxo recebe o contexto da cobrança (valor, vencimento, link) como
  variáveis do run.
- **I3** Nenhum passo desse desenho exige IA. Com IA ligada, o agente pode ser o
  destino do handoff — é opção, não requisito.

> **Isto é a resposta concreta ao "como os dois se interligam para resolver o
> que um sozinho não resolve".** A automação não sabe esperar resposta; o fluxo
> não sabe ser disparado por data de vencimento; a régua não sabe conversar. Os
> três juntos fazem cobrança.

---

## 6. Tela e números

### R-26 · Configuração da régua — `M`

- **J1** Editor de degraus com pré-visualização do texto renderizado com dados
  reais de uma cobrança de exemplo.
- **J2** A janela legal e o teto aparecem como **estado**, não como campo
  escondido: "seg–sex 8h–20h · máx. 4 contatos por título por mês".
- **J3** Simulação: "com a carteira de hoje, esta régua dispara N mensagens nos
  próximos 30 dias, custando ~US$ X" — usando a tabela de preços da fase 3.
- **J4** Lista de cobranças com filtro por status, vencimento e degrau atual.

### R-27 · Métrica por degrau — `M`

É o relatório que justifica a mensalidade, e o que permite ao cliente cortar o
degrau que só gasta.

- **K1** Por degrau: disparos, respostas, promessas, pagamentos nas 72h
  seguintes, valor recuperado.
- **K2** Custo por degrau, vindo de `whatsapp_message_costs` (fase 3, R-20 C3).
- **K3** **Retorno por degrau** = valor recuperado ÷ custo. É o número que vende.
- **K4** Ressalva honesta na tela: atribuição por janela temporal não é prova de
  causalidade. Quem pagaria de qualquer jeito também entra na conta.

### R-28 · Trilha de auditoria — `P`

- **L1** Exportação de tudo que foi enviado a um titular: quando, qual texto,
  por qual degrau, com qual resultado.
- **L2** É a defesa do cliente se for questionado. Requisito de produto, não
  relatório opcional.

---

## 7. O que esta fase **não** depende

Deliberadamente:

- **Não depende da API do Clube de Associados** (D-2). O núcleo é construído e
  testado com cobranças inseridas à mão e por planilha.
- **Não depende do Asaas.** O adaptador entra na fase 5.
- **Depende só** do importador de planilha + webhook genérico, que é o item 1 da
  fase 5 e entra junto com esta.

Era exatamente o risco a tirar do caminho crítico: o prazo do cliente não pode
ficar refém de um fornecedor terceiro.

---

## 8. O que ainda não sei

- **Ticket e volume da carteira** (D-3). Cinquenta associados e cinco mil pedem
  decisões diferentes de agrupamento, de horário e de lote por minuto. Sem isso,
  R-22 e R-21 são desenhados no escuro e vão ser ajustados depois do primeiro
  cliente real.
- **Se o cliente quer cobrar por PIX no fluxo** ou só mandar link. Muda R-25 e o
  que a régua precisa saber sobre baixa.

---

## 9. Critérios de aceite

1. Uma cobrança inserida à mão, vencendo amanhã, dispara o degrau `-1` no horário
   configurado e não dispara fora da janela.
2. Rodar o worker duas vezes no mesmo dia **não** envia duas mensagens.
3. Um titular com três títulos vencidos recebe **uma** mensagem, com os três
   listados.
4. Marcar a cobrança como paga entre o agendamento e o disparo **impede** o
   disparo.
5. Cliente responde ao template e a régua daquele titular pausa.
6. Um degrau que cairia num domingo é adiado para segunda, com registro.
7. A exportação de auditoria de um titular mostra o texto exato de cada mensagem.
8. A tela de métrica mostra custo e valor recuperado por degrau.

---

## 10. Estimativa

| Bloco | Requisitos | Esforço |
|---|---|---|
| Dados | R-18, R-19, R-20 | ~1 semana |
| Regras do worker | R-21 a R-25 | ~2 semanas |
| Composição com fluxo | R-19 B-fluxo, §5 | ~3 dias |
| Tela e números | R-26, R-27, R-28 | ~1,5 semana |

**Total ~5 semanas**, com o bloco de dados + worker mínimo já disparando de
verdade na segunda.
