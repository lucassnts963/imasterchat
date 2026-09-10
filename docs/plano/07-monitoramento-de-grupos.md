# Monitoramento de grupos de obra — análise de limitações e planejamento

> Escrito em 10/09/2026. **Planejamento — nenhuma linha de código.**
>
> Frente nova, fora da sequência das fases 1 a 6. Entra quando o cliente de
> construção existir de verdade.

---

## 1. O pedido, em uma frase

Uma construtora tem **várias obras**, cada uma com seu grupo de WhatsApp. O bot
**assiste** esses grupos, classifica cada mensagem dentro do contexto da obra a
que ela pertence, aprende sobre a obra por uma base de conhecimento em formato
wiki, e **chama ferramentas** a partir do que leu.

**Ele nunca responde.** Isso não é uma configuração: é o modo.

---

## 2. As limitações, antes de qualquer desenho

Esta seção existe porque o resto do documento depende dela. Pesquisado em
10/09/2026.

### 2.1 A API oficial ganhou grupos em 2026 — e ela não serve para este caso

A Meta abriu uma [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
na plataforma. Ela existe, é oficial, e **não atende o pedido**. Quatro razões,
e qualquer uma delas sozinha já basta:

| Limite | O que significa aqui |
|---|---|
| **Máximo de 8 participantes por grupo** | O grupo de uma obra tem engenheiro, mestre, encarregados, segurança, almoxarife, empreiteiros. Quinze a quarenta pessoas é o normal. Oito é a diretoria, não a obra |
| **Exige OBA** (Official Business Account, o nível verificado) | A construtora precisa passar pela verificação da Meta. Semanas, e nem toda empresa passa |
| **Não vale para número do app WhatsApp Business, nem para número em coexistência** | É exatamente o que os nossos clientes usam. O Embedded Signup com coexistência que corrigimos em agosto cai fora |
| **Entrada só por convite, em grupo criado pela própria API** | Não dá para pôr o número da API dentro de um grupo que **já existe** com quarenta pessoas. E é justamente esse grupo que o cliente quer monitorar |

Some-se: grupos não aceitam mensagem interativa (botão, lista) — irrelevante
aqui, porque não vamos responder — e cada campo de webhook de grupo precisa de
**assinatura própria**; nenhum deles vem junto do webhook de mensagem 1:1 que já
usamos.

> **Conclusão da §2.1:** a Groups API oficial serve para uma empresa **criar**
> grupos pequenos com clientes. Não serve para **observar** os grupos
> operacionais que a empresa já tem.

### 2.2 As bibliotecas não oficiais leem, e cobram um preço

Baileys, whatsapp-web.js, Venom, Evolution — todas emulam o WhatsApp Web e
**conseguem** ler grupos existentes, de qualquer tamanho, sem OBA e sem convite
via API. É a única forma técnica de fazer o que o cliente pediu, hoje.

O preço é conhecido e não é hipotético: **violação dos termos de uso e risco de
banimento do número**. A Meta detecta comportamento não humano no WhatsApp Web,
e um número banido é um número perdido.

**Duas coisas mudam essa conta neste caso específico, e vale dizê-las com todas
as letras:**

1. **O modo é só de leitura.** O grosso do banimento vem de disparo em massa —
   um número que nunca envia nada tem um perfil de risco muito menor que um que
   dispara. Menor não é zero.
2. **O número pode ser descartável.** Um chip dedicado, que só serve para
   observar, num aparelho que não é o da empresa. Se cair, cai o observador, e o
   WhatsApp operacional da construtora não é tocado.

### 2.3 O terceiro caminho: ninguém entra no grupo

O grupo continua exatamente como está, e um humano faz a ponte:

- **Encaminhamento**: um participante encaminha para um número monitorado. Alta
  fricção, cobertura parcial, e o encaminhamento perde quem falou.
- **Exportar conversa**: o admin exporta o `.txt` e sobe no sistema. Serve para
  análise histórica, não para acompanhamento.

Baixa fidelidade, mas **risco zero** e nenhuma dependência de terceiro.

---

## 3. As três arquiteturas, e a recomendação

| | A · Groups API oficial | B · Observador não oficial | C · Ponte humana |
|---|---|---|---|
| Lê os grupos que já existem | ❌ | ✅ | parcial |
| Tamanho do grupo | ≤ 8 | qualquer | qualquer |
| Exige OBA | ✅ | ❌ | ❌ |
| Funciona com coexistência | ❌ | ✅ | ✅ |
| Risco de banimento | nenhum | **real** | nenhum |
| Custo de mensagem | zero (não enviamos) | zero | zero |
| Esforço | M | M+ | P |

**Recomendação: B, num número dedicado e descartável — e o sistema construído
de modo que a FONTE seja um adaptador.**

O raciocínio é o mesmo que usamos duas vezes neste repositório, com provedores
de IA e com integrações de cobrança: a parte que muda é a borda, e a borda tem
de ser trocável.

```
src/lib/grupos/
  fontes/
    catalog.ts        ← a lista: id, rótulo, o que consegue, o que arrisca
    types.ts          ← a interface que toda fonte implementa
    ponte/            ← C: importação de export .txt e encaminhamento
    observador/       ← B: a que atende o pedido de verdade
    oficial/          ← A: quando (e se) a Meta subir o limite de 8
```

A interface é pequena de propósito — três coisas, e nenhuma delas é "enviar":

- `listarGrupos()` — quais grupos esta fonte enxerga
- `assinar(grupoId, callback)` — mensagens novas chegam por aqui
- `sincronizarHistorico(grupoId, desde)` — opcional, quando a fonte souber

> **Nenhuma fonte expõe um método de envio.** Não porque a gente confia em não
> chamar: porque a interface não tem onde. Ver §4.

**A trilha de A** fica registrada e não é abandonada: se a Meta subir o limite de
8, a fonte `oficial/` passa a ser a recomendada e o resto do módulo não muda uma
linha. É a mesma aposta do adaptador de cobrança.

---

## 4. "Nunca responde" precisa ser estrutura, não disciplina

Este é o requisito mais importante do módulo e o mais fácil de violar por
acidente. Um bot que responde num grupo de obra com quarenta pessoas não é um
bug: é a construtora explicando para o cliente dela por que o robô falou.

Quatro travas, e cada uma pega o que a anterior deixou passar:

1. **A interface da fonte não tem envio.** Não existe a função a chamar.
2. **O motor de observação é um caminho próprio**, e não uma bifurcação do
   `auto-reply`. O `dispatchInboundToAiReply` nunca é chamado para mensagem de
   grupo.
3. **As ferramentas do modo observação são um catálogo separado.** Nenhuma
   ferramenta de envio entra nele — nem `request_human`, que manda aviso.
4. **Guarda no envio**: `engineSendText` e irmãs recusam um `conversation_id`
   marcado como grupo, com erro explícito. É a rede embaixo das outras três, e é
   a que pega o dia em que alguém apontar uma automação para uma conversa de
   grupo sem perceber.

**Critério de aceite associado:** existe um teste que monta a pilha inteira, faz
o classificador pedir para responder, e prova que nada sai.

---

## 5. A metodologia wiki: o vault da obra

Cada obra tem um **vault** — um conjunto de páginas em markdown que descrevem
aquela obra e que o bot lê para classificar. Não é documentação para gente ler
(embora sirva): é o **contexto que o classificador recebe**.

### 5.1 Por que wiki, e não um formulário

Uma obra não cabe num formulário. O que distingue "atraso da laje" de "atraso da
elétrica" é vocabulário local: o nome do empreiteiro, o apelido do bloco, o
número da etapa no cronograma. Isso muda por obra e muda no meio da obra.

Um vault resolve isso do jeito que já resolvemos a base de conhecimento do
agente: **texto que o operador escreve, indexado, recuperado por semelhança**.
A infraestrutura existe — `ai_knowledge`, `embedTexts`, `match_ai_knowledge_semantic`,
`vector(1024)` — e foi construída na onda de provedores abertos.

### 5.2 A forma de uma página

```markdown
---
obra: residencial-alfa
tipo: cronograma        # cronograma | equipe | fornecedor | planta | risco | glossario
tags: [estrutura, bloco-b]
---

# Cronograma — Bloco B

A concretagem da laje do 4º pavimento está prevista para 12/09...
```

Três coisas fazem o vault funcionar como wiki e não como pasta de arquivos:

- **Links entre páginas** (`[[fornecedor-concreteira-x]]`). Recuperar uma página
  traz as vizinhas — que é como um humano acha contexto.
- **Frontmatter tipado.** `tipo` e `tags` viram filtro na recuperação: uma
  mensagem sobre concreto não precisa carregar a página de segurança do trabalho.
- **Histórico.** Uma página que mudou tem versão anterior; uma classificação de
  três meses atrás foi feita com o texto de três meses atrás, e a auditoria
  precisa disso.

### 5.3 Como o vault entra na classificação

```
mensagem do grupo
  └─ resolve a OBRA (o grupo aponta para uma)
       └─ recupera do vault daquela obra as páginas mais próximas
            └─ classifica com esse contexto
                 └─ chama ferramenta, ou não chama nada
```

O isolamento por obra não é conveniência, é correção: a "laje do bloco B" existe
em três obras da construtora, e classificar com o vault errado produz um
apontamento no lugar errado.

---

## 6. O que a classificação produz

Classificar não é rotular por rotular. Cada categoria existe porque tem
**alguém que age** a partir dela.

| Categoria | Exemplo | O que vira |
|---|---|---|
| **Ocorrência de segurança** | "o cara tá sem cinto na periferia da laje" | apontamento urgente, notifica o técnico de segurança |
| **Atraso / impedimento** | "concreteira não veio, laje parada" | item no diário da obra, com a etapa afetada |
| **Pedido de material** | "acabou arame recozido" | demanda de suprimentos |
| **Qualidade / retrabalho** | "a alvenaria do 3º saiu fora de prumo" | não conformidade |
| **Efetivo** | "hoje vieram 12 dos 18" | registro de mão de obra do dia |
| **Clima** | "chuva forte, paramos 14h" | paralisação, com hora |
| **Conversa** | "bom dia", "kkkk", figurinha | **nada** — e é a categoria mais frequente |

**A última linha é a que decide se o módulo presta.** Um grupo de obra é 80%
ruído. Um classificador que gera apontamento para "bom dia" enche o painel de
lixo em dois dias, e o cliente desliga.

### 6.1 As ferramentas do modo observação

Todas escrevem; nenhuma fala:

- `registrar_ocorrencia(categoria, severidade, resumo, obra, pagina_do_vault)`
- `registrar_efetivo(obra, previsto, presente, data)`
- `registrar_paralisacao(obra, motivo, inicio, fim)`
- `abrir_demanda(obra, item, quantidade, urgencia)`
- `ignorar(motivo)` — explícita de propósito: obriga o modelo a **decidir** que
  não é nada, em vez de inventar uma categoria para não ficar sem resposta

---

## 7. Modelo de dados

| Tabela | Por quê |
|---|---|
| `obras` | id, nome, conta, status, datas. O eixo de tudo |
| `grupos_monitorados` | id externo do grupo, obra, fonte, `is_active`, último sync |
| `mensagens_de_grupo` | espelho do que foi lido: autor, texto, mídia, instante, id externo. **Único** por `(fonte, id_externo)` |
| `vault_paginas` | obra, caminho, tipo, tags, markdown, versão, embedding |
| `classificacoes` | mensagem, categoria, confiança, páginas do vault usadas, ferramenta chamada |
| `ocorrencias` | o produto: o que alguém precisa resolver |

Duas decisões que valem antes de escrever:

- **`mensagens_de_grupo` guarda o texto.** É diferente do que fazemos em fluxos,
  onde o texto do cliente **não** é persistido em `flow_run_events` (um
  `collect_input` que pergunta o cartão deixaria o número lá). Aqui o texto **é**
  o produto, e a construtora é dona dele. Mas isso torna a tabela um alvo: RLS
  por conta, e retenção configurável com expurgo.
- **`classificacoes` guarda quais páginas do vault foram usadas.** Sem isso,
  "por que ele classificou como segurança?" não tem resposta — e a primeira
  classificação errada mata a confiança no módulo inteiro.

---

## 8. Custo, que aqui é uma boa notícia

- **WhatsApp: zero.** Nunca enviamos. A mudança de 1º/10 não toca este módulo.
- **IA: proporcional ao ruído**, e é onde mora o cuidado. Quarenta mensagens por
  dia por obra, dez obras, é 12 mil classificações por mês. A dois passos de
  agente por mensagem isso é caro para classificar "bom dia".

**Três cortes, antes do modelo:**

1. **Filtro barato primeiro.** Figurinha, áudio curto, "ok", "👍", mensagem de
   sistema ("Fulano entrou no grupo") não vão ao modelo. É regra, não IA.
2. **Agrupar em janela.** Cinco mensagens em dois minutos sobre a mesma coisa
   são uma classificação, não cinco.
3. **Modelo pequeno para triagem, grande só para o que passou.** O catálogo de
   provedores aberto (PR #2) é exatamente o que permite pôr um modelo barato na
   triagem e outro na análise.

---

## 9. Requisitos

`P` = 1–2 dias · `M` = 3–7 dias · `G` = 1–2 semanas

### R-40 · O contrato da fonte — `M`
- **A1** `src/lib/grupos/fontes/` com catálogo, interface e o **primeiro**
  adaptador: `ponte/` (importação de export `.txt`). É o que dá para testar o
  módulo inteiro sem depender de nada.
- **A2** A interface **não tem** método de envio (§4, trava 1).
- **A3** Tabela `grupos_monitorados`, ligação grupo → obra, e o espelho
  `mensagens_de_grupo` idempotente por `(fonte, id_externo)`.

### R-41 · O vault — `G`
- **B1** `vault_paginas` com frontmatter, markdown, versão e embedding.
- **B2** Editor de páginas por obra, com histórico.
- **B3** Recuperação por obra + tipo, sobre `match_ai_knowledge_semantic`.
- **B4** Links `[[pagina]]` trazem as vizinhas na recuperação.

### R-42 · O classificador — `G`
- **C1** Filtro barato antes do modelo (§8).
- **C2** Agrupamento por janela.
- **C3** Catálogo de ferramentas do modo observação, **sem nenhuma de envio**.
- **C4** `ignorar` como ferramenta explícita.
- **C5** `classificacoes` registra as páginas do vault usadas.

### R-43 · As travas do silêncio — `P`
- **D1** As quatro travas da §4.
- **D2** O teste que monta a pilha e prova que nada sai.

### R-44 · O painel da obra — `M`
- **E1** Ocorrências por obra, por categoria, por severidade.
- **E2** Diário da obra montado do que foi lido.
- **E3** Link da ocorrência para a **mensagem original**, com autor e hora. Sem
  isso o engenheiro não confia no apontamento.

### R-45 · O observador não oficial — `M+`, e por último
- **F1** Adaptador `observador/`, em processo separado do app.
- **F2** Número dedicado, documentado como descartável.
- **F3** Página de estado: conectado, última leitura, e um aviso claro de que
  esta fonte é não oficial e pode cair.
- **F4** Queda do observador **não** derruba nada: as outras fontes seguem.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| **Banimento do número observador** | número dedicado e descartável; nunca envia; a fonte é um adaptador e o módulo sobrevive à troca |
| **O bot responder num grupo** | as quatro travas da §4, com teste |
| **Ruído virando apontamento** | §8 item 1, e a ferramenta `ignorar` |
| **Classificar na obra errada** | isolamento do vault por obra, e um grupo aponta para **uma** obra |
| **Vazamento do conteúdo dos grupos** | RLS por conta, retenção configurável, expurgo |
| **A Meta mudar as regras** | o catálogo de fontes é o que torna isso uma troca de adaptador |

---

## 11. O que eu ainda não sei

- **Quantas obras, quantos grupos, quantas mensagens por dia.** Muda o desenho
  do corte de custo da §8 inteiro.
- **Quem é o dono do número que hoje está nos grupos.** Se for o celular do
  engenheiro, pôr um observador ali é conversa de RH antes de ser de engenharia.
- **Se a construtora aceita o risco da §2.2.** É decisão dela, escrita, e o
  documento tem de deixar o risco explícito antes de alguém assinar.
- **Se existe um sistema de gestão de obra** (Sienge, UAU, Mega) para onde as
  ocorrências deveriam ir. Se existe, isto vira mais um adaptador no módulo de
  integrações da fase 5, e não uma tela nova.

---

## Fontes

- [Groups API — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
- [Group messaging — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/)
- [WhatsApp Group API 2026: Limits, Endpoints & Alternatives — Unipile](https://www.unipile.com/whatsapp-group-api/)
- [WhatsApp Groups API: The 2026 Business Guide — imBee](https://www.imbee.io/resource/whatsapp-groups-api-business-guide-2026)
- [Grupos na API Oficial do WhatsApp: o estado atual — WhatsApp Founders BR](https://www.whatsappfounders.com.br/artigos/grupos-api-oficial-whatsapp-oba/)
- [Baileys, wwebjs, Venom: riscos das APIs não oficiais — SocialHub](https://www.socialhub.pro/blog/baileys-wwebjs-venom-riscos-apis-whatsapp-nao-oficiais/)
- [API WhatsApp Oficial vs Não-Oficial: os riscos reais de banimento — AraraHQ](https://ararahq.com/blog/api-whatsapp-oficial-vs-nao-oficial-riscos)
