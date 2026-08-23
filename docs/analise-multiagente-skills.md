# Multi-agente e skills — como funciona lá, o que custa aqui

> Aprofundamento dos itens `I-1`, `I-2`, `I-8` e `M-9` de
> [`analise-deskcommcrm.md`](./analise-deskcommcrm.md), feito lendo o código do
> DeskcommCRM (`@ c9f368d`), não a documentação deles.

> **Revisão:** a `main` entregou `I-5` (tools no turno do agente) desde que este
> documento foi escrito — veja `src/lib/ai/agent.ts` e `src/lib/ai/tools/`. Isso
> destrava `I-8b` (pacotes de skill e references), que dependia dele. `I-1`,
> `I-2` e `I-8` seguem inexistentes na `main`, confirmado por inspeção.

---

## 0. A primeira coisa: são três eixos, não dois

O maior risco de planejamento aqui é tratar "multi-agente por finalidade" como
uma coisa só. No DeskcommCRM são três mecanismos separados, com tabelas
separadas e ciclos de vida separados:

| Eixo | Pergunta que responde | Onde mora | Item |
|---|---|---|---|
| **Pontos de IA** | *Qual **modelo** roda cada lugar do sistema que chama LLM?* | `ai_purpose_bindings` | `M-9` |
| **Agentes** | *Qual **persona** atende esta conversa, com qual prompt, quais capacidades e qual teto de gasto?* | `ai_agents` + `ai_agent_versions` | `I-1` |
| **Skills** | *Qual **playbook situacional** entra no prompt agora, nesta mensagem?* | `skill_versions` + `skill_pointers` | `I-8` |

São ortogonais de verdade. Um agente escolhe seu modelo (eixo 1); um turno
escolhe seu agente (eixo 2); uma mensagem ativa suas skills (eixo 3). Misturar
os três numa tabela só é o erro que o próprio repositório deles descreve ter
cometido e desfeito — `lib/ai/pontos/registro.ts` abre com o relato de quando a
escolha de modelo estava espalhada por três pilhas que não se falavam, e o
sintoma era um tenant mandando `gpt-5-mini` para o endpoint da Anthropic.

---

## 1. Agentes

### 1.1 O modelo de dados

Duas tabelas, com papéis bem separados:

**`ai_agents`** — a *identidade*, mutável: `name`, `description`, `kind`
(`rag_bot` ou `mcp_agent`), `is_active`, `is_default`, `priority`,
`archived_at`, `published_version_id`.

**`ai_agent_versions`** — a *configuração*, imutável e versionada. É onde está o
que interessa:

| Campo | O que faz |
|---|---|
| `system_prompt` | 10 a 20.000 caracteres |
| `provider` + `model` + `credential_id` | o agente escolhe seu próprio modelo e sua própria chave |
| `tool_ids[]` | as capacidades daquele agente |
| `channel_session_id` | a qual número de WhatsApp ele está preso |
| `trigger_config` (jsonb) | eventos, filtros (ignorar grupos, ignorar self, regex de palavra-chave, horário comercial) e concorrência (`one_per_conversation` \| `one_per_contact`) |
| `max_steps` | 1 a 25 — teto de passos do laço agêntico |
| `token_budget` | 1.000 a 500.000 |
| `cost_budget_cents` | 1 a 10.000 — teto de gasto **por turno** |
| `history_message_window` / `history_token_window` | quanto de histórico entra |
| `handoff_keywords[]` | default `{falar com humano, atendente, pessoa real}` |
| `status` | `draft` → `published` → `superseded` → `archived` |

O ponto de design: **a versão é um retrato completo e imutável**. Trocar de
modelo, de prompt ou de capacidade não edita nada — cria versão nova.

### 1.2 O que torna isso publicável e reversível

Publicar é uma função Postgres atômica, `fn_publish_ai_agent_version`, chamada
por `lib/ai/agents/publish.ts`. Ela devolve códigos de erro tipados
(`PUBLISH_ERROR_CODES`) que a rota mapeia para 422, e a validação de referência
cruzada roda **duas vezes** — antes de salvar, em `validateVersionReferences`, e
de novo dentro da função Postgres. O comentário deles chama isso de defesa em
profundidade, e o que está sendo validado é exatamente o que quebraria em
produção: a credencial tem `validated_at`?, a sessão de canal está viva?, o
modelo existe no catálogo?

Rollback é apontar `published_version_id` para a versão anterior. Sem restart,
sem deploy.

### 1.3 Capacidades: por que elas vêm agrupadas

`lib/mcp/tools/pacotes.ts` é o arquivo que eu recomendo ler mesmo que a gente
não faça tools tão cedo. Ele agrupa ~60 tools do CRM em seis pacotes por
trabalho-a-ser-feito — *Atender e responder*, *Vender e mover o funil*, *Não
perder o cliente*, *Escalar*, *Organizar*, *Evoluir* — cada um com uma
explicação em português de gente e um nível de risco (`seguro`, `atencao`,
`critico`).

As duas razões que eles dão para agrupar são boas e valem para nós:

1. **Modelo:** 60 tools num prompt degradam a escolha do LLM — erra a tool,
   gasta contexto, alucina argumento. O teto por agente é 20.
2. **Tela:** 60 checkboxes destroem a configuração para um leigo. O checkbox por
   tool sobrevive em "modo avançado"; o pacote é o caminho padrão.

E `lib/ai/agents/uso-de-capacidades.ts` fecha o ciclo: cada capacidade ligada
recebe um sinal derivado do uso real — `nunca_usada`, `so_falha`, `falhando`,
`recem_ligada`, `so_em_teste`, `saudavel`, `fora_da_configuracao` — com
recomendação em texto. O princípio declarado: número cru na tela é ruído, todo
dado exibido tem de responder "por que estou vendo isto e o que faço a seguir".

### 1.4 Quem atende o turno: o Intent Router

Um `ai_router` pluga num `channel_session` (índice parcial único garante **um
router ativo por sessão** — dois disputando o mesmo número seria ambiguidade de
roteamento). Cada `ai_router_member` declara `intent_name`,
`intent_description` e `examples[]`, apontando para um agente.

A ordem de decisão está em `lib/agent-engine/agent/resolve-turn-agent.ts`, e as
decisões finas são o que dá qualidade:

- **Sticky não impede classificar.** Mesmo com agente grudado na conversa, ele
  classifica de novo — é barato e é o que detecta troca de assunto. Só troca se
  a intenção vier diferente **e** a confiança passar do mínimo.
- **Classificador que falhou não derruba a stickiness.** Um `null` do
  classificador é informação *mais pobre* que "sem sinal", então mantém o agente
  atual em vez de reclassificar.
- **Sem match nunca vira silêncio** — cai no agente de fallback, e se não houver,
  no agente genérico.
- **Telemetria não mente.** Se o agente casado não tiver versão publicada, o
  resultado *não* é registrado como sucesso com config nula; é reclassificado
  honestamente como `fallback` ou `no_match`, com `log.warn`. Está escrito no
  código que isso veio de um achado de revisão.
- **O router é estritamente aditivo.** Qualquer erro inesperado — banco fora,
  shape quebrado — cai no caminho antigo. "Um lead real está esperando
  resposta."

A stickiness mora em três colunas de `conversations`: `active_ai_agent_id`,
`active_intent`, `active_agent_set_at`. E `ai_router_decisions` guarda a
telemetria **sem PII** — o texto do lead nunca entra ali.

### 1.5 O que isso significa para nós

Aqui está o achado que muda o plano.

**Eles selecionam agente por canal; nós não temos canal para selecionar.** Cada
`ai_agent_version` deles é presa a um `channel_session_id`, porque eles têm
multi-número. Nós temos **uma** `whatsapp_config` por conta. Consequência
direta:

> Para nós, o Intent Router (`I-2`) não é polimento opcional em cima do
> multi-agente — é o **único** seletor possível. Sem ele, N agentes configurados
> e apenas um jamais deixa de responder.

Ou seja: `I-1` sozinho entrega uma tela que mente. O par mínimo viável é
`I-1 + I-2`, ou então um seletor mais simples que a gente desenhe (por
atribuição de conversa, por tag do contato, por palavra-chave determinística) —
que é bem mais barato que um classificador por LLM e talvez suficiente.

Outro ponto: parte do schema de versão deles **só passa a valer depois de outros
itens**. `max_steps` pressupõe laço agêntico com ferramentas (`I-5`) — nosso
`generateReply` é uma chamada única sem tools, então `max_steps` não significa
nada hoje. `cost_budget_cents` pressupõe `M-6` (custo em dinheiro); hoje só
temos contagem de tokens em `ai_usage_log`.

E a migração em si não é pequena: nossa `ai_configs` é uma linha por conta com
`provider`, `model`, `api_key`, `system_prompt` e os flags de auto-reply.
Virar agente + versão toca todos os pontos de chamada — o draft do inbox
(`/api/ai/draft`), o auto-reply (`src/lib/ai/auto-reply.ts`) e o playground.

---

## 2. Skills

Este é o mais interessante dos dois, e o mais barato do que parece.

### 2.1 A ideia central: disclosure progressivo

Uma skill é um **playbook situacional** — objeção de preço, reativação D+30,
agendamento, STOP ambíguo. Corpo em markdown, teto de **200 linhas** validado no
código (`MAX_SKILL_BODY_LINES`).

O mecanismo:

- **Só o ÍNDICE mora no prompt.** `renderSkillIndex()` produz uma linha por
  skill — `- nome: descrição` — e isso vai no prefixo estável, org-wide.
- **O CORPO carrega só quando o matcher dispara**, no sufixo por-conversa, depois
  do breakpoint de cache.
- **Situação neutra ⇒ zero corpos injetados.** Economia de tokens por construção,
  não por otimização.

É a mesma lógica de "carregar sob demanda" que uma boa engine de contexto usa: o
modelo sabe que a skill existe (índice) e o conteúdo dela só ocupa espaço quando
a situação pede.

### 2.2 O matcher é determinístico — e isso é a decisão de projeto

`matchSkills()` opera sobre substring normalizada (minúsculas + remoção de
acentos) da **última mensagem inbound** do cliente. Nunca um LLM.

O comentário no código explica por quê, e são duas razões independentes:
**mesmo sinal ⇒ mesmo conjunto de skills**, o que mantém o comportamento
testável; e o **prefixo de cache continua estável**, o que mantém o custo baixo.

Duas listas de palavras-chave por skill:

- `any_keywords` — hard match, injeta o corpo;
- `probe_keywords` — sinal fraco.

### 2.3 O near-miss vira material de melhoria

Quando um `probe_keyword` dispara **sem** hard match, isso é um *near-miss*: a
situação parecia pedir a skill e ela não entrou. O runtime grava o trace num
diretório de candidatos para curadoria humana — é assim que o conjunto de
palavras-chave melhora com o tempo, sem adivinhação.

Detalhe de privacidade que vale copiar: o sinal (texto do lead, com PII) vai
para o **arquivo de curadoria**, nunca para o log.

### 2.4 Versão imutável + ponteiro

Mesmo padrão dos agentes, e é o que torna a operação segura:

- `skill_versions` é imutável — um trigger no banco (`fn_agent_versions_immutable`)
  veta `UPDATE`;
- `skill_pointers` mapeia `(organization_id, name) → version_id`;
- **deploy e rollback são a mesma operação**: mover o ponteiro. Segundos, sem
  restart.

`organization_id NULL` significa skill de **plataforma** (global). Dois índices
parciais únicos separam os dois escopos. Na resolução, `loadSkills()` carrega
plataforma + org e **a skill da org vence** no mesmo nome — override local. A
ordenação final é estável por nome, de propósito: o índice injetado precisa ser
byte-determinístico para o cache de prefixo funcionar.

Sem cache de processo: ponteiro movido, próximo turno já vê a versão nova.

### 2.5 O pacote instalável (a metade "marketplace")

`lib/ai/skills/package.ts` recebe um `.zip` de terceiro e trata tudo como
entrada não confiável. Vale listar as defesas porque são um bom checklist:

- **Frontmatter lido à mão**, só as 4 chaves conhecidas (`name`, `description`,
  `matcher.any_keywords`, `matcher.probe_keywords`) — deliberadamente *não* uma
  lib de YAML genérica, para reduzir superfície de ataque;
- **Guard de zip-bomb** que recusa pelo tamanho *declarado* no header, antes de
  inflar, com os checks pós-unzip mantidos como defesa em profundidade;
- **Path traversal**: recusa caminho absoluto, `..` e separador de Windows;
- **Tetos**: 64 arquivos, 5 MB no total, 1 MB por arquivo, extensões de asset em
  allowlist;
- **Todo erro é erro de ensino** em pt-BR (`{ok:false, error}`), nunca throw.

Arquivos que não cabem nas 200 linhas do corpo viram *references*: entram num
manifesto, vão para um bucket `skill-assets`, e o modelo os pede sob demanda pela
tool `read_skill_reference`. Duas invariantes checadas **antes** de tocar o
storage: só lê reference de skill que casou *neste turno*, e o caminho pedido tem
de estar no manifesto como `kind: 'reference'`.

`installPlatformSkill` é **fork-on-install** — copia a skill do catálogo de
plataforma para o catálogo da org, com `forked_from_version_id` guardando a
origem. É o padrão de marketplace feito direito: instalar não cria dependência
viva de um catálogo remoto.

A ordem de escrita em `importSkillPackage` também é deliberada: insere a versão →
sobe os arquivos → **só então** move o ponteiro. A versão só fica visível ao
runtime depois que todo o conteúdo está no bucket. Upload que falha limpa o que
já subiu; a versão órfã fica no banco, inofensiva, porque nenhum ponteiro aponta
para ela.

Por fim, `skill_activations` registra qual skill disparou, se por `hard` ou por
`probe`, e em qual job.

### 2.6 O que isso significa para nós

**A boa notícia: o núcleo de skills encaixa quase sem atrito no que já temos.**

Nosso `buildSystemPrompt()` em `src/lib/ai/defaults.ts` já monta o prompt como um
array de partes e **já injeta trechos recuperados** da base de conhecimento, com
o mesmo formato de bloco. Adicionar "índice de skills" e "corpos casados neste
turno" é exatamente a mesma costura, no mesmo arquivo. Duas tabelas, um matcher
de ~60 linhas e uma função de render.

**Três ressalvas honestas:**

1. **O argumento de cache não vale para nós hoje.** Metade da elegância do
   índice-no-prefixo/corpo-no-sufixo é preservar o prefixo cacheável. Nós não
   usamos prompt caching em lugar nenhum — nossos adapters são `fetch` puro, sem
   `cache_control`. A economia de tokens continua real; a de cache, não, até a
   gente adotar caching.

2. **Skill não é base de conhecimento — e é fácil construir a segunda por
   engano.** Nossa KB responde *pergunta* por recuperação semântica ou lexical.
   Uma skill muda *comportamento* por gatilho determinístico. Se a gente
   implementar skill como "mais um tipo de documento na KB", perde as duas
   propriedades que a fazem valer: o determinismo e o custo zero na situação
   neutra.

3. **A metade "pacote instalável" depende de tool-calling**, que não temos. As
   *references* só existem porque o modelo pode chamar `read_skill_reference` no
   meio do turno. Sem `I-5`, dá para importar pacote e usar o corpo, mas os
   arquivos anexos ficam inertes.

Uma coisa que **não** copiaria: gravar candidatos de near-miss em diretório do
sistema de arquivos. No nosso deploy isso é filesystem de container, que some.
Para nós é tabela.

---

## 3. Revisão das estimativas

Depois de ler o código, duas estimativas do documento anterior estavam grossas
demais. A correção muda o que vale a pena escolher:

| Item | Antes | Agora | Por quê |
|---|---|---|---|
| `I-8` Skills | G | **`I-8a` núcleo = M** · `I-8b` pacotes + references = G | O núcleo é 2 tabelas + matcher + render, e encaixa no `buildSystemPrompt` que já existe. O que é grande é a metade de marketplace, que depende de `I-5` |
| `I-1` Multi-agente | G | **`I-1a` agentes = M** · `I-1b` versionamento + publish = M | Separáveis. Agentes sem versionamento já é útil; versionamento imutável + ponteiro é um segundo passo autocontido |

Decomposição sugerida:

| ID | Escopo | Esforço | Depende de |
|---|---|---|---|
| `I-8a` | Skills: versões, ponteiros, matcher determinístico, índice + corpos no prompt, telemetria de ativação | M | — |
| `I-8b` | Skills: pacote `.zip`, manifesto, bucket, `read_skill_reference`, fork-on-install | G | `I-5` |
| `I-1a` | Múltiplos agentes: identidade + config, capacidades por pacote, tela | M | `M-3` (credencial por agente) |
| `I-1b` | Versionamento imutável, publish atômico, rollback por ponteiro | M | `I-1a` |
| `I-2` | Seletor de agente do turno (router por intenção, ou seletor determinístico mais simples) | M | `I-1a` |
| `M-9` | Modelo por ponto de uso | G | `M-1`…`M-4` |

---

## 4. Ordem e dependências

```
M-1 ─┬─ M-2 ─── M-4 ─── M-3 ──┬── I-1a ── I-1b
     │                        │     │
     │                        │     └── I-2   (obrigatório p/ I-1 fazer sentido aqui)
     │                        │
     │                        └── M-9  (depois de M-6, se quiser custo por ponto)
     │
I-8a ── (independente de tudo acima) ── I-8b ── depende de I-5
```

`I-8a` é o único item de peso da lista inteira que **não depende de nada**. Pode
entrar em paralelo com a primeira onda de modelos.

---

## 5. Riscos

1. **Agente sem seletor = tela que mente.** Já dito, e é o risco número um: se
   `I-1a` for sozinho ao ar, o operador configura três agentes e um só responde,
   para sempre, sem erro visível.

2. **Skill e KB competindo.** Se as duas coisas puderem responder a mesma
   pergunta com conteúdos diferentes, ninguém sabe qual venceu. A separação tem
   de estar no produto, não só no código: KB = fato; skill = procedimento.

3. **Matcher por palavra-chave envelhece calado.** É o preço do determinismo. O
   `probe_keywords` + curadoria de near-miss existe exatamente para isso — se a
   gente implementar o matcher sem o laço de melhoria, em três meses ele está
   desafinado e ninguém percebe.

4. **Skill de plataforma é superfície de confiança.** Uma skill global entra no
   prompt de todas as orgs. Quem pode escrever uma precisa ser um papel
   privilegiado de verdade, e o `.zip` importado é entrada não confiável mesmo
   vindo de dentro.

5. **Imutabilidade sem tela de histórico frustra.** Versão imutável só compensa
   se o operador conseguir ver as versões e voltar com um clique. O trigger no
   banco é a parte fácil; a tela é a que faz a feature existir.

---

## 6. Recomendação

**Comece por `I-8a`.** É o melhor retorno da lista inteira: não depende de nada,
encaixa num arquivo que já tem a costura certa, e entrega uma capacidade que hoje
não existe de forma nenhuma — a IA seguir procedimento diferente conforme a
situação, sem inchar o prompt.

**Trate multi-agente como um bloco de três** (`I-1a + I-1b + I-2`), não como um
item. E antes de começá-lo, decida o seletor: router por intenção com
classificador, ou algo determinístico (tag do contato, palavra-chave, atribuição
da conversa). Um classificador por LLM é mais caro em latência e em dinheiro do
que parece, e para muitas operações o seletor determinístico resolve.

**Deixe `M-9` por último** entre esses. Ele é o mais profundo e o que mais paga,
mas só depois que houver mais de um provedor cadastrado — que é a primeira onda
já acordada.
