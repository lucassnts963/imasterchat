# Análise comparativa — imasterchat × DeskcommCRM

> **Objetivo deste documento:** servir de checklist de decisão. Cada item da
> Parte C tem um ID (`M-*`, `C-*`, `V-*`, `P-*`) para você marcar o que entra
> no escopo. Depois disso montamos o plano de implementação.
>
> **Fontes:** `imasterchat @ d94bea2` (branch `claude/modelos-crm-analysis-pfzcq8`,
> idêntica à `main`) × `melgarafael/DeskcommCRM @ main` (clone raso de
> 2026-08-14, v1.0.0+).
>
> **Licença:** DeskcommCRM é MIT, igual à nossa. Reaproveitar código é
> juridicamente possível mantendo o aviso de copyright. Mas veja a §D antes de
> pensar em copiar arquivo.

> ## ⚠️ Revisão — o que a `main` já entregou desde esta análise
>
> Esta lista foi escrita contra a `main` em `d94bea2`. Ela avançou **110
> commits** desde então e entregou, por conta própria, vários itens abaixo.
> Verificado por inspeção do código na `main` em `df90f00`:
>
> | Item | Estado | Onde |
> |---|---|---|
> | `I-3` Guardrails antes de enviar | **feito** | `src/lib/ai/guardrails.ts` |
> | `I-5` Tools no turno do agente | **feito** | `src/lib/ai/agent.ts`, `src/lib/ai/tools/` |
> | `I-6` Transcrição de áudio | **feito** | `src/lib/audio/`, `transcript-stamp.ts` |
> | `I-9` Memória da organização | **feito** | `src/lib/ai/vault/` |
> | `M-6` Custo em dinheiro | **feito** | `pricing.ts`, `cost-projection.ts` |
> | `M-7` Orçamento mensal | **feito** | migration 069, `monthly_budget_usd` |
> | `V-6` Distribuição entre atendentes | **feito** | `src/lib/queues/`, migrations 065–072 |
> | `V-7` Escalação / transbordo | **feito** | migration 071 |
> | `P-13` Português brasileiro | **feito** | `messages/pt-BR.json` |
> | `M-1` `M-2` `M-4` Provedores abertos | **feito nesta branch** | `providers/catalog.ts`, migration 073 |
> | Embeddings em qualquer provedor | **feito nesta branch** | migration 074 |
>
> **Continuam pendentes e valendo:** `I-1`/`I-2` (múltiplos agentes e seletor
> de turno), `I-8` (skills), `C-1` (WhatsApp por QR/WAHA), `M-3`, `M-5`, `M-9`,
> e a maior parte do bloco `P-*` de plataforma. Confirmei a ausência dos três
> primeiros no código da `main`.
>
> `I-5` estar pronto muda o recorte de `I-8`: a metade "pacote instalável"
> daquele item dependia justamente de tool-calling, que agora existe.

---

## A. Estado da branch

`main` e `claude/modelos-crm-analysis-pfzcq8` apontam para o mesmo commit
(`d94bea2`) — não há branch "mais à frente" no `origin`. A branch de trabalho já
parte do ponto mais avançado do repositório; nada a rebasear.

---

## B. O problema dos modelos (seu objetivo nº 1)

### B.1 O que trava hoje

Nosso suporte a modelos é de **um provedor, uma chave, um modelo, por conta**.
Os pontos exatos que precisam mudar:

| Onde | O que está fixo | Arquivo |
|---|---|---|
| Tipo | `type AiProvider = 'openai' \| 'anthropic'` | `src/lib/ai/types.ts:9` |
| Banco | `CHECK (provider IN ('openai','anthropic'))` — em **duas** tabelas | `029_ai_reply.sql:49`, `033_ai_reply_polish.sql:64` |
| Rota | `if (provider !== 'openai' && provider !== 'anthropic') return bad(...)` | `src/app/api/ai/config/route.ts:81` |
| Dispatch | `switch (config.provider)` com dois `case` | `src/lib/ai/generate.ts:37` |
| URL | `const OPENAI_URL = 'https://api.openai.com/...'` — hard-coded | `src/lib/ai/providers/openai.ts:11` |
| UI | `<SelectItem>` só de openai/anthropic | `src/components/settings/ai-config.tsx:280` |
| Defaults | `AI_PROVIDER_DEFAULT_MODEL: Record<AiProvider, string>` | `src/lib/ai/defaults.ts:13` |
| Embeddings | URL da OpenAI hard-coded, `text-embedding-3-small`, `vector(1536)` | `src/lib/ai/embeddings.ts:16`, `030_ai_knowledge.sql:107` |

### B.2 A boa notícia

**DeepSeek, Groq, Together, Fireworks, DeepInfra, Cerebras e OpenRouter são
todos OpenAI-compatíveis.** O adapter `providers/openai.ts` já serve para os
sete — falta apenas tornar a `baseURL` um dado em vez de uma constante. Não é
um provedor novo por integração; é **um** campo `base_url` mais uma lista de
presets.

É exatamente a conclusão a que o DeskcommCRM chegou: a migration `0127` deles
**removeu os CHECKs de provider do banco** e moveu a lista para código
(`lib/ai/pontos/provedores.ts`), justamente porque "cada provedor novo viraria
uma migration". A coluna `base_url` na tabela `ai_purpose_bindings` existe com a
justificativa literal: *"nasce para endpoint compatível com a API da OpenAI —
OpenRouter hoje, modelo local depois"*.

### B.3 A ressalva séria: embeddings

Nosso `ai_knowledge_chunks.embedding` é `vector(1536)`, fixo, com índice HNSW.
Modelos abertos de embedding têm outras dimensões (bge-m3 = 1024, bge-base =
768). Trocar o provedor de embeddings **exige** decidir entre:

1. Manter embeddings sempre na OpenAI (ou compatível de 1536 dims) e liberar só
   o chat — caminho barato, resolve 90% do seu pedido;
2. Guardar a dimensão por documento e criar colunas/índices por dimensão —
   caminho correto, migration não-trivial;
3. Re-indexar tudo ao trocar de modelo de embedding — caminho simples de
   codificar, caro de operar.

O DeskcommCRM escolheu o (1) — a ficha do provedor OpenAI deles diz explicitamente
que ela é *"necessária para transcrever áudio e para indexar o seu material —
esses dois pontos usam tecnologia da OpenAI mesmo quando o resto está em outro
provedor"*.

### B.4 O que eles têm nessa camada que nós não temos

Ver itens `M-1` a `M-10` na Parte C.

---

## C. Lista de decisão — o que não temos

Legenda de esforço: **P** = pequeno (1–2 dias) · **M** = médio (3–7 dias) ·
**G** = grande (2+ semanas)

### C.1 — Camada de modelos e custo (`M-*`) · o seu objetivo declarado

| ID | O que é | Como está lá | Esforço |
|---|---|---|---|
| **M-1** | **Provider como vocabulário aberto** — sem CHECK no banco, lista dos suportados em código, com rótulo, "quando usar" e link de onde pegar a chave | `lib/ai/pontos/provedores.ts` + migration 0127 | P |
| **M-2** | **`base_url` configurável** — habilita DeepSeek, Groq, Together, Fireworks, DeepInfra, OpenRouter e modelo local com o mesmo adapter | coluna `base_url` em `ai_purpose_bindings` | P |
| **M-3** | **Múltiplas credenciais por org** — várias chaves, várias por provedor, cada uma com rótulo, últimos-4, `validated_at`, `validation_error`, `models_available`, ativo/inativo | tabela `ai_provider_credentials` | M |
| **M-4** | **Validação de chave por ping ao provedor** — `GET /v1/models`, 5s, distingue 401 de erro de rede, e já traz a lista de modelos disponíveis daquela chave | `lib/ai/provider-validators.ts` | P |
| **M-5** | **Catálogo de modelos sincronizado** — ~400 modelos da OpenRouter puxados de API pública, com preço, janela de contexto, `supports_tools`, `supports_vision`; modelo que some é depreciado, nunca apagado | `lib/ai/catalogo/openrouter.ts` + tabela `ai_models` | M |
| **M-6** | **Custo em dinheiro, não só tokens** — tabela de preços versionada, custo por chamada; `null` para preço desconhecido, nunca `0` | `ai_pricing`, `llm_calls.cost_cents`, `lib/ai/cost.ts` | M |
| **M-7** | **Orçamento mensal por org** — teto em centavos, alarme em % configurável, ação ao estourar (`throttle` ou `disable`), consumo do período corrente | tabela `ai_budgets` + `lib/ai/budget/check.ts` | M |
| **M-8** | **Rate limit no dispatcher de IA** — janela fixa em Redis (Upstash) com fallback em memória | `lib/ai/dispatcher/rate-limit.ts` | P |
| **M-9** | **Modelo por ponto de uso** — 23 pontos do sistema que chamam LLM, cada um com provedor/modelo/credencial próprios (chat caro para atender, modelo barato para classificar, Whisper para áudio). Hoje temos **um** modelo global | `ai_purpose_bindings` + `lib/ai/pontos/registro.ts` | G |
| **M-10** | **Teste que impede ponto oculto** — varre o código e reprova nos dois sentidos: chamada de LLM que não está no registro, e entrada no registro que nenhum código usa | `tests/unit/pontos-de-ia-completude.test.ts` | P |

> **Recomendação de recorte mínimo para o seu pedido:** `M-1 + M-2 + M-4`
> entregam DeepSeek e os serverless abertos com risco baixo e sem migration
> complexa. `M-3` logo em seguida (chave de chat separada da de embeddings já é
> uma necessidade hoje). `M-5/M-6/M-7` formam um bloco coerente de
> custo — só valem juntos.

### C.2 — Inteligência do agente (`I-*`)

| ID | O que é | Esforço |
|---|---|---|
| **I-1** | **Múltiplos agentes de IA, versionados** — publicar, duplicar, validar; hoje temos um único `system_prompt` por conta | G |
| **I-2** | **Intent Router** — classifica a intenção da mensagem e entrega para o agente certo, com aderência por conversa (*stickiness*), confiança mínima e agente de fallback | M |
| **I-3** | **Guardrails antes de enviar** — camadas por org que barram promessa/preço/prazo que a empresa não pode cumprir, com rastro do que foi barrado | M |
| **I-4** | **Anonimização de PII antes de mandar ao modelo** — inclusive dicionário de nomes pt-BR | M |
| **I-5** | **Tools MCP no turno do agente** — o agente age no CRM (cria lead, move etapa, agenda) durante a conversa. Nosso MCP server é para o operador usar de fora, não para o agente usar por dentro | G |
| **I-6** | **Transcrição de áudio + descrição de imagem** — worker de mídia derivada | M |
| **I-7** | **Análise de sentimento** por worker | P |
| **I-8** | **Skills instaláveis** para agentes (empacotar, instalar, ativar) | G |
| **I-9** | **Memória da organização** — entradas versionadas que o agente carrega entre conversas | M |
| **I-10** | **Flywheel de melhoria contínua** — LLM-as-judge avalia turnos, destila propostas de melhoria de prompt, com *pool* de alinhamento do juiz | G |
| **I-11** | **RAG mais rico** — ingestão de conversas passadas, FAQ e políticas como fontes distintas; extractors de PDF e Markdown; KB versionada; *debounce* de reindexação; telemetria de busca | M |
| **I-12** | **Ritmo humano de resposta** (*pacing*) — não responder instantaneamente, com registro | P |

### C.3 — Canal WhatsApp (`C-*`)

| ID | O que é | Esforço |
|---|---|---|
| **C-1** | **WhatsApp via QR code (WAHA)** além do canal oficial da Meta — número comum, sem aprovação da Meta, sem custo por conversa. Hoje só temos Cloud API oficial | G |
| **C-2** | **Multi-número / multi-sessão** por organização, com health check e reconexão | M |
| **C-3** | **Anti-banimento** — limite diário por sessão, aquecimento progressivo de número novo (*warmup*), throttle de envio com registro | M |
| **C-4** | **Detecção de STOP / opt-out** automática | P |
| **C-5** | **Janela de 24h explícita** como regra de domínio (hoje é implícita) | P |
| **C-6** | **Webhooks de entrada** para captação de lead (fonte + HMAC + token no path). Nossos webhooks são só de saída | M |

### C.4 — CRM e vendas (`V-*`)

| ID | O que é | Esforço |
|---|---|---|
| **V-1** | **Lead como entidade separada de contato**, com máquina de estados e transições auditadas. Hoje temos `deals` presos ao pipeline | G |
| **V-2** | **Lead scoring** com faixas | M |
| **V-3** | **Estado de risco + reativação** de leads parados | M |
| **V-4** | **Linha do tempo de atividades do lead** com autoria explícita (humano × agente) e vocabulário controlado | M |
| **V-5** | **Motor de follow-up / cadências** — inscrição em fluxo, gatilho por etapa ou por caso, editor de grafo, versionamento, dossiê do follow-up. É mais forte que nossos `flows`, que são reativos a mensagem | G |
| **V-6** | **Distribuição de conversas entre atendentes** — fila, elegibilidade, disponibilidade do atendente, decisão registrada | M |
| **V-7** | **Escalação e continuidade** de atendimento (retomada por outro atendente sem perder contexto) | M |
| **V-8** | **Fila de casos do agente** — quando a IA abre um caso para o humano, ele entra numa caixa própria, não some no inbox | M |
| **V-9** | **Fila de merge de duplicados** + propostas de campo do contato geradas pela IA para aprovação humana | M |

### C.5 — Plataforma, operação e deploy (`P-*`)

| ID | O que é | Esforço | Nota |
|---|---|---|---|
| **P-1** | **Instalador de VPS em 1 comando** — sobe app + banco + WhatsApp, gera segredos sozinho, HTTPS automático (Caddy/Traefik), detecta proxy reverso pré-existente, idempotente | M | **Diretamente relevante ao seu deploy em VPS dedicada** |
| **P-2** | **Auto-atualização** — versão do sistema em tabela, execuções de update registradas, botão "Atualizar agora" na tela | M | idem |
| **P-3** | **Backup / restore / diagnóstico / healthcheck** como scripts de operação | P | idem |
| **P-4** | **Multi-tenant real** — organizações, usuário em várias orgs, admin de plataforma, impersonate, suspensão de conta. Nós temos `accounts` com papéis, mas um usuário pertence a uma conta | G |
| **P-5** | **Audit log** de toda mutação, correlacionado por `X-Request-Id` | M |
| **P-6** | **Event log + fila de jobs + workers + watchdog** — event sourcing leve, com idempotência por `unique(org, external_id)`. Nossos crons de automations/flows não têm fila genérica | G |
| **P-7** | **Chaves de idempotência** em POSTs de criação | P |
| **P-8** | **LGPD completo** — pedidos de titular, exportação em PDF assinado (PAdES), *redaction* em cascata, SLA com feriados brasileiros, fila de anonimização no storage | G |
| **P-9** | **MFA TOTP obrigatório para admin** + códigos de recuperação + script de reset | M |
| **P-10** | **Sentry com scrubbing de PII** (CPF, e-mail, telefone) no `beforeSend` | P |
| **P-11** | **Métricas, incidentes e "radar" de operação** — telas de saúde do negócio, não só do sistema | M |
| **P-12** | **Testes E2E (Playwright) + acessibilidade (axe-core)** — hoje só temos vitest unitário | M |
| **P-13** | **Português brasileiro** — nossas traduções são `en` e `ko`. Não há pt-BR | P |
| **P-14** | **Onboarding guiado** na primeira entrada | M |
| **P-15** | **E-mail transacional** (Resend) — hoje o convite de time depende de link copiado | P |
| **P-16** | **Integração e-commerce** (Nuvemshop: pedidos, produtos, webhooks) | G |
| **P-17** | **Páginas de erro dedicadas** 403/500/503 + error boundaries por segmento | P |

---

## D. O que **nós** temos que eles não têm (não jogue fora)

Nem tudo é dívida. O nosso repositório tem peças que o DeskcommCRM não tem, e
elas devem ser preservadas em qualquer plano:

- **Canal oficial da Meta bem resolvido** — templates com componentes,
  *header handle*, guarda de linhas, normalização de status por webhook,
  registro de número. O DeskcommCRM é primariamente WAHA (não-oficial); o
  suporte Meta deles é secundário.
- **Broadcasts com templates aprovados** + tracking por destinatário e
  substituição de variáveis — eles não têm equivalente direto.
- **Construtor visual de automações e de flows** (React Flow + dagre), com
  templates, execuções, logs e mídia.
- **Mensagens interativas** (botões e listas).
- **API pública `/api/v1` com chaves escopadas e revogáveis** — a deles é
  interna/MCP.
- **Servidor MCP publicável** (`mcp-server/`) para pilotar o CRM de fora.
- **Importação de CSV de contatos com dedupe e resolução de tags.**
- **Presença de membros e reações a mensagens.**
- **Respostas rápidas.**

---

## E. Ressalvas de método

1. **Não copie arquivo.** O DeskcommCRM é multi-tenant por `organization_id`,
   nosso modelo é `account_id`; eles usam `pnpm`, `@ai-sdk/*` e Vercel AI
   Gateway, nós usamos `fetch` direto sem SDK; eles têm `proxy.ts` e workers em
   processo separado. Copiar um módulo traz o modelo de dados junto. O valor
   aqui é o **desenho**, não o código.

2. **O código-fonte deles é em português** (identificadores, comentários e nomes
   de arquivo: `pontos`, `provedores`, `escalacao`, `gatilho-caso`). O nosso é em
   inglês. Misturar os dois dentro do mesmo repo cobra caro depois — escolha uma
   convenção antes de começar.

3. **A camada de IA deles é maior que a nossa por um fator grande**, mas parte
   dela é infraestrutura para uma operação que talvez você não tenha (flywheel,
   skills, judge). Escala de esforço realista: os 103 objetos de banco e 169
   route handlers deles são ~3× o nosso.

4. **`M-9` (modelo por ponto de uso) é o item de maior alavancagem a médio
   prazo**, mas depende de `M-1` a `M-4`. Não comece por ele.

5. **O estado declarado deles é auto-relatado.** O próprio
   `docs/current-state.md` do DeskcommCRM avisa que o progresso por épico vem de
   documentos de handoff não re-verificados. Antes de assumir que um recurso da
   lista está pronto lá, vale abrir o código daquele recurso.

---

## F. Próximo passo

Marque os IDs que entram no escopo. Com a lista fechada, monto o plano de
implementação — ordem de dependência, migrations necessárias, recorte por PR e
o que dá para entregar antes do deploy na VPS.

Minha sugestão de primeira onda, se quiser um ponto de partida:
**`M-1`, `M-2`, `M-4`, `M-3`** (destrava DeepSeek + serverless abertos, que é o
pedido original) e **`P-13`** (pt-BR, barato e imediato).
