# API pública, chaves e webhooks de saída

Este é o pedaço do iMasterChat que permite operar a conta sem abrir o painel. Uma ferramenta de fora (um robô no n8n, um script da empresa, um formulário do site, o servidor MCP que acompanha o repositório) recebe uma chave de API e, com ela, consegue mandar mensagem no WhatsApp, ler e criar contatos, ler conversas, passar uma conversa para um atendente humano, marcar e cancelar agendamentos e disparar campanhas. O caminho de volta são os webhooks de saída: o iMasterChat avisa um endereço HTTPS da empresa toda vez que chega mensagem, muda o status de entrega de uma mensagem enviada ou nasce/reabre uma conversa. Tudo isso vive sob `/api/v1`, com autenticação por chave portadora (`Authorization: Bearer wacrm_live_…`), autorização exclusivamente por escopos e um limite de chamadas por chave.

## Para que serve (visão do cliente)

Com uma chave de API, o dono do negócio consegue amarrar o WhatsApp ao resto das ferramentas dele:

- **Mandar mensagem a partir de outro sistema.** O sistema de vendas, o site ou o robô manda um número de telefone e um texto (ou um modelo aprovado, ou uma imagem/PDF) e a mensagem sai pelo WhatsApp da conta. Se o telefone ainda não existir na base, o contato e a conversa são criados na hora.
- **Cadastrar e atualizar clientes de fora.** Um formulário do site cria o contato com nome, e-mail, empresa e etiquetas. Se o telefone já existir, o sistema reaproveita o contato em vez de duplicar.
- **Ler a base e o histórico.** Listar contatos (com busca e filtro por etiqueta), listar conversas, ler as mensagens de uma conversa.
- **Chamar um humano.** Um robô externo que percebeu que não dá conta pode empurrar a conversa para a fila de pendentes, deixar uma nota explicando o motivo e (opcionalmente) apontar para um atendente específico. Nesse caminho, a IA do aplicativo realmente para de responder naquela conversa.
- **Marcar, remarcar e cancelar agendamentos.** Útil para quem usa um agente de agendamento externo integrado ao Google Calendar.
- **Disparar campanha de modelo (broadcast) por script**, com até 1000 destinatários por chamada, e depois consultar o andamento.
- **Ser avisado do que acontece.** A empresa registra um endereço HTTPS e o iMasterChat faz um POST assinado nesse endereço quando chega mensagem nova, quando uma mensagem enviada muda de status e quando uma conversa é criada ou reaberta. Serve para acender um alerta interno, alimentar um painel próprio, gravar em outro banco.

Duas coisas que o cliente precisa entender antes de vender ou usar isso:

- A chave completa aparece **uma única vez**, na hora em que é criada. Depois disso o sistema só mostra o prefixo. Perdeu, revoga e cria outra.
- Não existe tela para webhooks. Registrar um endereço de webhook só é possível chamando a API com uma chave que tenha o escopo `webhooks:manage`. Isso é trabalho de quem faz a integração, não do dono da ótica.

## Como se usa, na prática

### Criar uma chave de API

1. Abra **Configurações** e, no grupo **Espaço de trabalho**, a seção **Chaves de API**.
2. Clique em **Nova chave de API**. O botão só aparece para quem é administrador ou dono da conta; os demais membros veem a lista e a mensagem "Peça a um administrador para criar uma."
3. No diálogo, preencha **Nome** (até 80 caracteres, algo como "Automação do Zapier") e marque os **Escopos** que a integração precisa. A dica na tela avisa que uma chave sem escopo nenhum ainda consegue chamar `GET /api/v1/me` só para testar se funciona.
4. Clique em **Criar chave**. A tela troca para "Copie sua chave de API", com o texto completo e o botão **Copiar**. Esta é a única vez em que a chave inteira aparece.
5. Clique em **Concluir**. A partir daí a linha na lista mostra apenas o prefixo (por exemplo `wacrm_live_a1b2c3d4…`), os escopos como etiquetas, quando foi criada, quando foi usada pela última vez (ou "nunca usada") e, se houver, a data de expiração.

### Revogar uma chave

Na mesma tela **Chaves de API**, botão **Revogar** na linha da chave (também restrito a admin/dono). A chave para de funcionar imediatamente, mas a linha continua na lista com o selo **Revogada** — é trilha de auditoria, não some.

### Usar a chave

Toda chamada vai para `/api/v1/...` com o cabeçalho `Authorization: Bearer wacrm_live_…`. O primeiro teste recomendado é `GET /api/v1/me`, que devolve o nome da conta e os escopos da chave e não exige escopo nenhum.

### Registrar um webhook de saída

Não há tela. Com uma chave que tenha `webhooks:manage`, faz-se `POST /api/v1/webhooks` informando a `url` (obrigatoriamente `https://`) e a lista de eventos assinados. A resposta 201 traz o **segredo de assinatura** em texto puro — uma única vez. Esse segredo é o que o sistema do cliente usa para conferir o cabeçalho `X-Wacrm-Signature` de cada entrega. Depois disso, nenhuma rota devolve o segredo de novo.

## O que dá para configurar

| Ajuste | Onde | O que muda |
| --- | --- | --- |
| Criar chave de API: nome (até 80 caracteres) e escopos | Tela Configurações → Chaves de API, botão "Nova chave de API" — **exige admin ou dono** | Nasce uma credencial nova; o texto completo aparece uma única vez |
| Revogar chave | Tela Configurações → Chaves de API, botão "Revogar" — **exige admin ou dono** | A chave passa a devolver 401; a linha fica na lista marcada como Revogada |
| Validade da chave (`expiresInDays`, no máximo 365 dias) | Só via `POST /api/account/api-keys`, campo `expiresInDays` do corpo JSON (`src/app/api/account/api-keys/route.ts:112-122`) — **não existe na tela** | Chave criada pela tela nunca expira; só uma chamada direta define prazo |
| Vocabulário de escopos (10 hoje) | `src/lib/api-keys/scopes.ts:16-27` (lista) e `:32-43` (descrições da UI) | Adicionar ou remover uma capacidade da API. Não exige migração: a coluna é `text[]` livre |
| Limite de chamadas da API pública (hoje 120 por minuto, por chave) | `src/lib/rate-limit.ts:156` (`publicApi`) | Quantas requisições uma chave faz por minuto antes de tomar 429 |
| Limite das rotas de gestão de chave (hoje 30 por minuto, por usuário) | `src/lib/rate-limit.ts:149` (`adminAction`) | Quantas chaves um admin cria por minuto |
| Trocar o limitador em memória por um compartilhado (Redis/Upstash) | `src/lib/rate-limit.ts:60-90` (função `checkRateLimit`); instrução no cabeçalho `:9-14` | Faz o limite valer de verdade em deploy com mais de uma instância |
| Tempo limite de entrega do webhook (5000 ms) e falhas consecutivas para desativar (15) | `src/lib/webhooks/deliver.ts:31` e `:34` | Quanto o sistema espera pelo endpoint do cliente e quando desiste dele |
| Tolerância de defasagem na verificação de assinatura (300 s) | `src/lib/webhooks/sign.ts:45` | Janela aceita pelo verificador de referência contra reenvio (replay) |
| Vocabulário de eventos de webhook (4 hoje) | `src/lib/webhooks/events.ts:10-15` | Quais eventos um endpoint pode assinar. Não exige migração |
| Registrar/editar/desativar/apagar endpoint de webhook (`url`, `events`, `is_active`) | Somente pela API: `POST`/`GET /api/v1/webhooks` e `GET`/`PATCH`/`DELETE /api/v1/webhooks/{id}`, com chave de escopo `webhooks:manage`. **Não há tela** | O endereço que recebe os eventos e quais eventos ele recebe |
| `ENCRYPTION_KEY` (64 hex) | `.env` do app (`deploy/docker-compose.app.yml:50`, `deploy/README.md:122`); lido em `src/lib/whatsapp/encryption.ts:29` | Cifra e decifra o segredo do webhook. Trocá-la quebra **todos** os endpoints já registrados: o decrypt falha, conta como falha de entrega e 15 dessas desativam o endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL` | `.env` do app (`deploy/docker-compose.app.yml:49`); lidos em `src/lib/flows/admin-client.ts:11-12` | Sem eles o cliente service-role de todo o caminho da API pública não sobe |
| `WACRM_BASE_URL` e `WACRM_API_KEY` | `mcp-server/.env` (ou o bloco `env` da configuração do cliente MCP); lidos em `mcp-server/src/config.ts:27-28` | Instância e chave usadas pelo servidor MCP que acompanha o repositório |
| `WACRM_ENABLE_WRITES` e `WACRM_ENABLE_BROADCASTS` | `mcp-server/.env`; lidos em `mcp-server/src/config.ts:49-50` | Liberam as ferramentas de escrita e de disparo em massa no servidor MCP. Por padrão ele é somente leitura; `WACRM_ENABLE_BROADCASTS` sem `WACRM_ENABLE_WRITES` derruba o servidor com erro |

## Como funciona por dentro

### O caminho de uma requisição autenticada

1. A rota chama `requireApiKey(request, '<escopo>')` (`src/lib/auth/api-context.ts`).
2. O cabeçalho `Authorization` é lido aceitando com ou sem o prefixo `Bearer ` (`api-context.ts:62-64`).
3. Rejeição estrutural barata antes de qualquer hash ou ida ao banco: o valor precisa começar com `wacrm_live_` e ter algo depois (`api-context.ts:85`, implementação em `src/lib/api-keys/keys.ts:76-78`).
4. O texto é hasheado com SHA-256 hex (`keys.ts:67`) e procurado por igualdade na coluna `key_hash` (`src/lib/api-keys/store.ts:40-41`), usando o cliente **service-role** — ou seja, o lookup ignora RLS (`store.ts:37`). Quem estabelece a conta é o próprio hash.
5. Revogação e expiração são conferidas em JavaScript depois do SELECT, e ambas devolvem `null` (`store.ts:51-54`). Chave inexistente, revogada e expirada produzem o **mesmo 401 indistinguível** (`api-context.ts:90-95`).
6. Rate limit: `checkRateLimit('apikey:<id da linha>', RATE_LIMITS.publicApi)` (`api-context.ts:99`), orçamento `{ limit: 120, windowMs: 60_000 }` (`src/lib/rate-limit.ts:156`).
7. Só então o escopo é conferido: `if (scope && !hasScope(row.scopes, scope)) throw forbidden(...)` (`api-context.ts:104-106`). `hasScope` é literalmente `granted.includes(required)` (`scopes.ts:80`).
8. O contexto devolvido carrega `accountId` e um cliente service-role (`api-context.ts:112`). Cada rota escopa a query por conta na mão.
9. `last_used_at` é atualizado em fire-and-forget: nunca é aguardado e uma falha só gera `console.warn` (`store.ts:82,88-91`).

Consequência da ordem: uma chave válida **sem** o escopo certo consome orçamento de rate limit; uma chave inválida não consome nada e não é limitada de forma alguma.

### Isolamento por conta

Toda rota `/api/v1` isola por conta, mas por dois mecanismos diferentes:

- Na maioria, filtro direto `.eq('account_id', ctx.accountId)` na própria query (ex.: `src/app/api/v1/webhooks/[id]/route.ts:31`).
- Em `GET /api/v1/conversations/{id}/messages`, um portão de posse: a conversa é conferida contra `account_id` antes (`messages/route.ts:29-35`) e só depois as mensagens são buscadas com `.eq('conversation_id', id)` (`messages/route.ts:37-43`) — a tabela `messages` não é filtrada por `account_id` nessa query.

O resultado observável é o mesmo: um id de outra conta devolve **404**, nunca 403, por decisão deliberada de não revelar existência.

### Middleware

O middleware global **não** protege `/api/v1`. A lista de caminhos protegidos (`src/middleware.ts:73`) cobre telas do painel, e a única checagem de API cobre `/api/whatsapp/` (`middleware.ts:81`). A autenticação da API pública é inteiramente responsabilidade do `requireApiKey` de cada rota.

### Paginação e envelope

- Keyset por `(created_at DESC, id DESC)`, limite padrão 50 e teto 100 (`src/lib/api/v1/pagination.ts:20-21,44-50`, filtro em `:106`).
- Cursor malformado é tratado como ausente (volta à primeira página) em vez de erro.
- O cursor é revalidado na decodificação (UUID e timestamp parseável) porque seus valores são interpolados crus no filtro `.or()` do PostgREST — é isso que impede injeção de sintaxe de filtro por cursor forjado (`pagination.ts:82-84`).
- Sucesso: `{ data }` (`src/lib/api/v1/respond.ts:86`). Falha: `{ error: { code, message } }` (`respond.ts:113`). Exceção que não seja `ApiError` vira 500 genérico com `console.error`, para não vazar texto interno (`respond.ts:128-132`).
- O 429 traz `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset` (segundos unix) (`respond.ts:74-80`).

### Autoria das escritas feitas por API

Não existe usuário logado numa chamada de API. `resolveAuditUserId` (`src/lib/api/v1/contacts.ts:77-94`) atribui a escrita ao dono do `whatsapp_config` da conta; se não houver config, ao `owner_user_id` da conta; se nem isso, erro 500. É a mesma convenção do webhook de entrada, então um contato criado por API é indistinguível de um criado pelo webhook.

### Etiquetas via API

`setContactTags` (`src/lib/api/v1/contacts.ts:160-217`) recebe **nomes** de etiqueta, resolve/cria os ids e faz um diff contra as etiquetas atuais (só mexe no que muda). Cada etiqueta adicionada passa por `addContactTagAndDispatch` (`contacts.ts:205-210`) — diferente do caminho de importação de CSV, que não dispara a automação de `tag_added`.

### Geração e guarda da chave

- 32 bytes de CSPRNG em base64url, prefixados por `wacrm_live_` (`keys.ts:52-53`, prefixo em `:25`).
- O banco guarda só o digest SHA-256 hex (`keys.ts:67`, gravado em `src/app/api/account/api-keys/route.ts:133`).
- `key_prefix` é o prefixo literal mais os 8 primeiros caracteres do corpo aleatório (`keys.ts:57`, `DISPLAY_BODY_CHARS = 8` em `:33`) — é o que a tela mostra.
- O texto puro sai uma única vez, no 201 da criação (`api-keys/route.ts:152`); a listagem usa `SAFE_COLUMNS`, que exclui `key_hash` (`api-keys/route.ts:42-43`).
- As rotas de gestão usam o cliente SSR com RLS (sessão do usuário), não service-role (`src/lib/auth/account.ts:160,236`).
- Revogar é soft-delete: `.update({ revoked_at })` filtrando por `account_id` e `.is('revoked_at', null)`; zero linhas afetadas vira 404 "not found or already revoked" (`src/app/api/account/api-keys/[id]/route.ts:45-48,59-65`).

### Entrega dos webhooks de saída

1. `dispatchWebhookEvent(accountId, event, data)` seleciona os endpoints da conta com `is_active = true` **e** que contenham o evento no array `events` (`src/lib/webhooks/deliver.ts:55-58`).
2. Guarda SSRF: a URL é resolvida por DNS e recusada se qualquer endereço for loopback, privado, link-local (inclui `169.254.169.254`, o endereço de metadados), ULA, CGNAT, ou se o host for do tipo `localhost` / `.local` / `.internal` (`deliver.ts:96-100`, regras em `src/lib/webhooks/ssrf.ts:29-47,67-74`). A recusa **conta como falha de entrega**.
3. O segredo é decifrado (`deliver.ts:103-111`). Falha ao decifrar aborta a entrega e conta como falha.
4. O corpo é montado uma vez e é exatamente o que se assina: `{ id: <uuid por entrega>, event, occurred_at, account_id, data }` (`deliver.ts:66-72`).
5. Assinatura: `X-Wacrm-Signature: t=<segundos unix>,v1=<hex>`, onde `v1 = HMAC-SHA256(secret, "${t}.${rawBody}")` sobre o corpo exato enviado, não uma re-serialização (`src/lib/webhooks/sign.ts:29-32`).
6. Cabeçalhos da entrega, além do `Content-Type`: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, `X-Wacrm-Signature` (`deliver.ts:117-121`).
7. POST único, com `redirect: 'manual'` (para um 3xx não desviar a entrega para um endereço interno) e `AbortSignal.timeout(5000)` (`deliver.ts:126-129`, `DELIVERY_TIMEOUT_MS` em `:31`). Qualquer status não-ok, inclusive 3xx, é falha.
8. Sucesso zera `failure_count` e carimba `last_delivery_at` (`deliver.ts:132-135`). Falha chama a RPC atômica `record_webhook_failure` (`deliver.ts:151-154`), que incrementa e desativa o endpoint ao atingir 15 falhas consecutivas (`MAX_CONSECUTIVE_FAILURES` em `:34`; lógica em `supabase/migrations/028_webhook_endpoints.sql:97-101`).
9. `dispatchWebhookEvent` nunca lança: qualquer erro é engolido com `console.error` (`deliver.ts:80-83`), para não afetar o 200 devolvido à Meta.

O verificador de referência (`sign.ts:45,59,67`) tolera 300 segundos de defasagem no timestamp e compara em tempo constante.

Os 4 eventos nascem exclusivamente do webhook de entrada da Meta: `message.status_updated` (`src/app/api/whatsapp/webhook/route.ts:460`), `conversation.created` (`:634`), `conversation.reopened` (`:770`) e `message.received` (`:966`). Este último é **aguardado** (`await`) dentro do `after()` da rota, deliberadamente, porque uma promise solta poderia ser congelada antes de entregar (`webhook/route.ts:959-966`).

### Segredo do webhook

`whsec_` + 32 bytes de CSPRNG em base64url (`src/lib/webhooks/endpoints.ts:33`, prefixo em `:12`). Diferente da chave de API, ele é guardado **cifrado** (AES-256-GCM, `src/lib/whatsapp/encryption.ts:37-48`, algoritmo na linha 40) e não hasheado, porque o servidor precisa dele em texto para assinar cada entrega. O select público (`WEBHOOK_PUBLIC_COLUMNS`, `endpoints.ts:18-19`) não inclui a coluna `secret`.

## Limites e pegadinhas

**Chaves de API**

- A tela de criação **nunca envia `expiresInDays`** (`src/components/settings/api-keys-settings.tsx:321`; não há campo de validade em lugar nenhum do formulário, `:406-453`). Toda chave criada pelo painel é **sem expiração**. Só uma chamada direta ao `POST /api/account/api-keys` consegue definir prazo. Não prometa "chave que expira sozinha" com base na interface.
- Qualquer membro, inclusive viewer, **vê a lista de chaves** (nome, prefixo, escopos, datas). Só criar e revogar exigem admin/dono.
- O papel de quem criou a chave é irrelevante em tempo de requisição. A autorização é 100% por escopo. Uma chave criada por um admin que depois vira viewer continua fazendo tudo que os escopos dela permitem, até ser revogada.
- Uma chave **sem nenhum escopo** ainda autentica e consegue chamar `GET /api/v1/me`, porque essa rota chama `requireApiKey` sem argumento de escopo (`src/app/api/v1/me/route.ts:22`).
- A função `timingSafeHexEqual` existe e é exportada (`keys.ts:88`), mas **não é chamada por nenhum código de produção** — só pelo arquivo de teste. A verificação real é um SELECT por igualdade em `key_hash`. O comentário do arquivo sugere o contrário.
- O banco **não restringe** o vocabulário de escopos: a coluna é `text[]` livre (`026_api_keys.sql:48`). Uma linha com escopo inventado é aceita pelo Postgres; quem valida é a aplicação.

**Rate limit**

- O estado mora em **memória do processo Node**, um `Map` de módulo (`src/lib/rate-limit.ts:46`). Não há Redis, tabela nem cookie.
- Com mais de uma instância o limite é silenciosamente derrotado: cada processo tem seu próprio `Map`, então N instâncias permitem N × 120/min. O próprio arquivo documenta isso e aponta a troca por Redis/Upstash como solução (`rate-limit.ts:9-14`). **Quantas instâncias o deploy do cliente roda é desconhecido** — sem essa informação não dá para afirmar qual é o teto real.
- É janela fixa, não token bucket (`rate-limit.ts:74-81`). Não há timer de limpeza: entradas expiradas são varridas oportunisticamente a cada 1000 chamadas (`rate-limit.ts:51,66-70`).

**Webhooks de saída**

- **Não existe tela.** Nem em Configurações nem em outro lugar: o mapa de painéis (`src/app/(dashboard)/settings/page.tsx:74-88`) e a lista de seções (`src/components/settings/settings-sections.ts:26-40`) não têm entrada de webhooks. Uma busca por `webhook_endpoints|api/v1/webhooks` em `src/` (fora de testes) encontra quatro arquivos: as duas rotas, o entregador, e `src/lib/automations/engine.ts:593`, que é apenas um comentário do passo `send_webhook` das automações, sem acesso à tabela.
- **Não existe retry.** Uma tentativa por evento, timeout de 5 segundos. Se o endpoint do cliente estiver fora do ar por 30 segundos, os eventos daquele intervalo estão perdidos, ponto. Não prometa reenvio.
- 15 falhas consecutivas **desativam o endpoint sozinho** e nada o reativa automaticamente (não verifiquei exaustivamente a existência de cron/scheduler no repositório; a única reativação encontrada é manual, via `PATCH /api/v1/webhooks/{id}` com `is_active: true`, que também zera o contador — `src/app/api/v1/webhooks/[id]/route.ts:88-91`).
- Um endpoint apontando para endereço interno é recusado pela guarda SSRF, e **essa recusa conta como falha**. Um alvo mal configurado acaba se autodesativando depois de 15 eventos.
- Trocar `ENCRYPTION_KEY` quebra todos os endpoints registrados: o decrypt falha, cada evento vira falha e em 15 eventos o endpoint é desativado.
- A guarda SSRF **não** protege contra DNS rebinding — o IP resolvido não é fixado no socket; o próprio arquivo declara isso como risco residual (`src/lib/webhooks/ssrf.ts:16-18`).
- O evento `conversation.reopened` existe no código e é disparado, mas **não está documentado** em `docs/public-api.md` (a tabela de eventos em `:369-373` lista só os outros três) nem no CHANGELOG.
- Os comentários do entregador se contradizem sobre a semântica: o cabeçalho diz "at-most-once, single attempt" e o comentário do payload diz "at-least-once and may repeat" (`deliver.ts:11` contra `:64-65`). O código implementa **uma tentativa única**.
- `GET /api/v1/webhooks` devolve a lista inteira e `next_cursor` é sempre `null` (`webhooks/route.ts:38-43`). Não paginar aqui é intencional.

**Rotas de dados**

- `POST /api/v1/broadcasts` responde **202 imediatamente** e faz o fan-out dentro de `after()`, com `maxDuration = 60` (`broadcasts/route.ts:37,80`). Uma audiência perto do teto de 1000 (`src/lib/whatsapp/broadcast-core.ts:77,104`) pode passar de 60 segundos e ser **cortada no meio**, deixando destinatários pendentes e o broadcast preso em "sending". O próprio comentário da rota admite isso e recomenda dividir envios muito grandes em várias chamadas.
- `PATCH /api/v1/appointments/{id}` exige `starts_at` e `ends_at` **juntos** para remarcar (`[id]/route.ts:73-80`). **Não existe DELETE de agendamento**: cancelar é `PATCH` com `{"status":"cancelled"}`.
- Agendamento criado pela API recebe `created_via = 'n8n'` por padrão; a única alternativa aceita é `'native'`. **Nunca** `'manual'` (`appointments/route.ts:173`).
- Três índices únicos parciais geram 409 com mensagens distintas: horário já ocupado, contato já tem agendamento marcado, evento do Google já registrado (`appointments/route.ts:188-205`).
- `parseSlot` recusa data malformada, fim antes do início, duração acima de 8 horas e início no passado (`src/lib/api/v1/appointments.ts:97-131`). A API **não consulta disponibilidade** — isso é do Google Calendar; ela só registra.
- `POST /api/v1/conversations/{id}/handoff` **não manda mensagem ao cliente**. Ele muda o status para `pending`, desliga o auto-reply da IA naquela conversa, grava a nota (`reason`, obrigatório, truncado em 500 caracteres) e opcionalmente atribui a alguém via `assign_to`. Avisar o cliente que "já vou chamar alguém" é trabalho de quem chamou a rota. Vale contrastar: responder pelo inbox **não** assume a conversa nem cala a IA; esta rota da API, sim, desliga o auto-reply da thread.
- `POST /api/v1/contacts` é find-or-create por telefone: 200 se já existia, 201 se criou (`contacts/route.ts:138`). O campo `tags` do `PATCH` **substitui** o conjunto de etiquetas, não adiciona.
- O filtro `?tag=` da listagem de contatos é por **id** da etiqueta (`contacts/route.ts:62`), enquanto o campo `tags` do POST/PATCH é por **nome**. É fácil errar isso.
- Nenhuma rota `/api/v1` declara `export const runtime` ou `export const dynamic`; a única configuração de segmento do subsistema é o `maxDuration` do broadcast.

**Servidor MCP**

`mcp-server/` é um cliente da API pública que acrescenta uma segunda trava, do lado do cliente: por padrão registra só ferramentas de leitura, e as de escrita/broadcast exigem flags de ambiente explícitos (`mcp-server/src/config.ts:49-56`). Não foi confirmado se ele é efetivamente distribuído ao cliente ou se é apenas um extra do repositório.

**Limites do que foi verificado**

- Nada disto foi testado em execução: nenhuma requisição real foi emitida contra `/api/v1`.
- O texto de RLS abaixo é o que os arquivos de migração declaram. Não foi verificado se 026, 028 e 041/043 estão de fato aplicadas na instância do cliente, nem se alguém alterou policies ou colunas por fora das migrações.
- Não foi lido o corpo completo de `src/app/api/whatsapp/webhook/route.ts` (mais de 1000 linhas) — só os quatro trechos ao redor das chamadas a `dispatchWebhookEvent`. Pode existir caminho (por exemplo, um gate de cobrança manual visto perto da linha 780) em que um evento deixe de ser emitido; isso não foi seguido até o fim.
- Não foi procurado se existe um modo sandbox com prefixo `wacrm_test_`; a busca cobriu apenas `wacrm_live_`.
- O comportamento de `api_keys` e `webhook_endpoints` na exclusão de conta não foi auditado além do que a DDL declara (`ON DELETE CASCADE` em `account_id`).

## Referência

### Tabelas

| Tabela | Migração de origem | Papel |
| --- | --- | --- |
| `api_keys` | `supabase/migrations/026_api_keys.sql` | Credencial de máquina do `/api/v1`. Colunas notáveis: `account_id` (026:43), `created_by` (026:44, só auditoria), `name` (026:45), `key_prefix` (026:46), `key_hash` UNIQUE (026:47), `scopes text[]` (026:48), `last_used_at` (026:49), `expires_at` (026:50, NULL = nunca expira), `revoked_at` (026:51, NULL = ativa), `created_at` (026:52). Índices: `api_keys_account_id_idx` (026:56), `api_keys_key_hash_idx` (026:61). Nenhuma migração posterior a 026 altera esta tabela |
| `webhook_endpoints` | `supabase/migrations/028_webhook_endpoints.sql` | Endpoints HTTPS que recebem os eventos. Colunas: `account_id` (028:44), `created_by` (028:45), `url` (028:46), `secret` cifrado AES-256-GCM (028:47), `events text[]` (028:48), `is_active` (028:49), `last_delivery_at` (028:50), `failure_count` de falhas **consecutivas** (028:51), `created_at` (028:52). Índice `webhook_endpoints_account_id_idx` (028:56-57). A migração também cria `public.record_webhook_failure(endpoint_id uuid, max_failures int)`, `SECURITY DEFINER`, que incrementa e desativa em um único UPDATE (028:91-103). Nenhuma migração posterior altera a tabela |
| `appointments` | `supabase/migrations/041_appointments.sql`, alterada por `supabase/migrations/043_google_calendar.sql` | Registro CRM da reserva, tocado por `/api/v1/appointments`. Colunas: `account_id` (041:34), `contact_id` ON DELETE CASCADE (041:35), `conversation_id` ON DELETE SET NULL (041:39), `starts_at`/`ends_at` (041:41-42), `status` (041:43), `google_event_id`/`google_calendar_id` (041:49-50), `created_via` CHECK IN ('manual','n8n','native') (041:55-56), `cancellation_reason text` (043:169). CHECK `appointments_ends_after_starts` (041:61). Três índices únicos parciais que geram os 409: `idx_appointments_one_per_slot` (041:74-76), `idx_appointments_one_live_per_contact` (041:81-83), `idx_appointments_google_event` (041:87-89). 043 é a última migração que altera a tabela |

RLS declarada nas migrações:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `api_keys` | `is_account_member(account_id)` — qualquer membro (026:68-69) | admin+ (026:75-76) | admin+ (026:79-80) | admin+ (026:83-84) |
| `webhook_endpoints` | qualquer membro (028:63-64) | admin+ (028:68-69) | admin+ (028:72-73) | admin+ (028:76-77) |
| `appointments` | qualquer membro (041:99-100) | agent+ (041:103-104) | agent+ (041:107-109) | admin+ (041:112-113) |

`is_account_member` é `SECURITY DEFINER` e compara `auth.uid()` contra `profiles`, com hierarquia owner > admin > agent > viewer (`017_account_sharing.sql:136-164`). **Atenção:** o caminho da API pública não passa por essas policies — lê e escreve com o cliente service-role, que ignora RLS, e escopa por `account_id` na própria query. As policies só valem para as telas e para as rotas de sessão.

### Escopos (`src/lib/api-keys/scopes.ts:16-27`)

| Escopo | O que libera | Rotas |
| --- | --- | --- |
| `messages:send` | Enviar mensagens WhatsApp | `POST /api/v1/messages` |
| `messages:read` | Ler mensagens e status de entrega | `GET /api/v1/conversations/{id}/messages` |
| `contacts:read` | Listar e ler contatos | `GET /api/v1/contacts`, `GET /api/v1/contacts/{id}` |
| `contacts:write` | Criar e atualizar contatos | `POST /api/v1/contacts`, `PATCH /api/v1/contacts/{id}` |
| `conversations:read` | Listar e ler conversas | `GET /api/v1/conversations`, `GET /api/v1/conversations/{id}` |
| `conversations:handoff` | Passar conversa a um humano | `POST /api/v1/conversations/{id}/handoff` |
| `appointments:read` | Listar e ler agendamentos | `GET /api/v1/appointments`, `GET /api/v1/appointments/{id}` |
| `appointments:write` | Criar, remarcar e cancelar agendamentos | `POST /api/v1/appointments`, `PATCH /api/v1/appointments/{id}` |
| `broadcasts:send` | Disparar campanhas | `POST /api/v1/broadcasts`, `GET /api/v1/broadcasts/{id}` |
| `webhooks:manage` | Registrar e gerenciar webhooks de saída | todas as rotas `/api/v1/webhooks` |

### Rotas da API pública (`/api/v1`)

Todas exigem `Authorization: Bearer wacrm_live_…`. O "papel exigido" não se aplica: a autorização é por escopo, não por papel do usuário.

| Método | Caminho | Escopo exigido | Arquivo | O que faz |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/me` | nenhum | `src/app/api/v1/me/route.ts` | Sonda de identidade: `{ account: {id, name}, key: {id, scopes} }` (`me/route.ts:22-27`) |
| POST | `/api/v1/messages` | `messages:send` | `src/app/api/v1/messages/route.ts` | Envia mensagem por número E.164; resolve-ou-cria contato e conversa e chama o núcleo compartilhado de envio. Valida o payload **antes** de criar contato (`:90-96`). Responde 201 com `message_id`, `whatsapp_message_id`, `conversation_id`, `contact_id`, `contact_created` |
| GET | `/api/v1/contacts` | `contacts:read` | `src/app/api/v1/contacts/route.ts` | Lista contatos, keyset. `?search=` (sanitizado, `:31-33`) e `?tag=<id da etiqueta>` (inner join aliasado, `:49-63`) |
| POST | `/api/v1/contacts` | `contacts:write` | `src/app/api/v1/contacts/route.ts` | Find-or-create por telefone: 200 se já existia, 201 se criou (`:138`). Aceita `tags` por nome |
| GET | `/api/v1/contacts/{id}` | `contacts:read` | `src/app/api/v1/contacts/[id]/route.ts` | Lê um contato; 404 se for de outra conta (`:28`) |
| PATCH | `/api/v1/contacts/{id}` | `contacts:write` | `src/app/api/v1/contacts/[id]/route.ts` | Atualiza só os campos presentes (`name`/`email`/`company`); tipo inválido vira 400 (`:60-68`). `tags` **substitui** o conjunto |
| GET | `/api/v1/conversations` | `conversations:read` | `src/app/api/v1/conversations/route.ts` | Lista conversas; `?status=` e `?contact_id=` (`:36-37`) |
| GET | `/api/v1/conversations/{id}` | `conversations:read` | `src/app/api/v1/conversations/[id]/route.ts` | Lê uma conversa; 404 fora da conta (`:34`) |
| GET | `/api/v1/conversations/{id}/messages` | `messages:read` | `src/app/api/v1/conversations/[id]/messages/route.ts` | Mensagens da conversa, mais novas primeiro, paginado. Confere a posse da conversa antes de devolver qualquer mensagem (`:29-35`) |
| POST | `/api/v1/conversations/{id}/handoff` | `conversations:handoff` | `src/app/api/v1/conversations/[id]/handoff/route.ts` | Status → `pending`, desliga o auto-reply da IA na thread, grava a nota; `reason` obrigatório e truncado em 500 (`:35,54-57`), `assign_to` opcional. Não envia mensagem ao cliente |
| GET | `/api/v1/appointments` | `appointments:read` | `src/app/api/v1/appointments/route.ts` | Lista agendamentos; `?contact_id=`, `?status=`, `?from=`, `?to=` sobre `starts_at` (`:47-73`) |
| POST | `/api/v1/appointments` | `appointments:write` | `src/app/api/v1/appointments/route.ts` | Cria agendamento; confere que `contact_id` e `conversation_id` são da conta (`:121-149`); colisões de índice único viram 409 com mensagens distintas (`:188-205`) |
| GET | `/api/v1/appointments/{id}` | `appointments:read` | `src/app/api/v1/appointments/[id]/route.ts` | Lê um agendamento; 404 fora da conta (`:46`) |
| PATCH | `/api/v1/appointments/{id}` | `appointments:write` | `src/app/api/v1/appointments/[id]/route.ts` | Remarca (`starts_at` e `ends_at` juntos, senão 400 — `:73-80`) ou cancela. Não existe DELETE |
| POST | `/api/v1/broadcasts` | `broadcasts:send` | `src/app/api/v1/broadcasts/route.ts` | Cria broadcast e destinatários sincronamente e dispara o fan-out em `after()` (`:80`). Responde 202. `maxDuration = 60` (`:37`). Teto de 1000 destinatários (`src/lib/whatsapp/broadcast-core.ts:77,104`) |
| GET | `/api/v1/broadcasts/{id}` | `broadcasts:send` | `src/app/api/v1/broadcasts/[id]/route.ts` | Status e contadores do broadcast; 404 fora da conta (`:35`) |
| GET | `/api/v1/webhooks` | `webhooks:manage` | `src/app/api/v1/webhooks/route.ts` | Lista endpoints da conta com `WEBHOOK_PUBLIC_COLUMNS`, que não inclui `secret` (`:27`; `endpoints.ts:18-19`). `next_cursor` sempre null (`:38-43`) |
| POST | `/api/v1/webhooks` | `webhooks:manage` | `src/app/api/v1/webhooks/route.ts` | Registra endpoint. Valida `https://` e a lista de eventos; gera o segredo, grava cifrado e devolve o texto puro uma única vez no 201 (`:75,83,95-98`) |
| GET | `/api/v1/webhooks/{id}` | `webhooks:manage` | `src/app/api/v1/webhooks/[id]/route.ts` | Lê um endpoint, sem o segredo; 404 fora da conta (`:38`) |
| PATCH | `/api/v1/webhooks/{id}` | `webhooks:manage` | `src/app/api/v1/webhooks/[id]/route.ts` | Atualiza `url` / `events` / `is_active`. Reativar zera `failure_count` (`:91`). Corpo sem campo atualizável → 400 (`:94-96`) |
| DELETE | `/api/v1/webhooks/{id}` | `webhooks:manage` | `src/app/api/v1/webhooks/[id]/route.ts` | Remove o endpoint; 404 fora da conta (`:140`) |

### Rotas de gestão de chave (sessão do painel, não API pública)

| Método | Caminho | Papel exigido | Arquivo | O que faz |
| --- | --- | --- | --- | --- |
| GET | `/api/account/api-keys` | qualquer membro (sessão por cookie, cliente SSR com RLS) | `src/app/api/account/api-keys/route.ts` | Lista as chaves com `SAFE_COLUMNS`; `key_hash` é deliberadamente omitido (`:42-43,49-55`) |
| POST | `/api/account/api-keys` | **admin ou dono** (`requireRole('admin')`, `:73`) + policy `api_keys_insert` | `src/app/api/account/api-keys/route.ts` | Cria a chave e devolve o texto puro uma única vez (`:124-155`). Rate limit `adminAction` 30/min por usuário (`:75-79`). Nome ≤ 80 caracteres; `expiresInDays` clampado em 365 (`:35,38,118`) |
| DELETE | `/api/account/api-keys/{id}` | **admin ou dono** (`requireRole('admin')`, `:29`) + policy `api_keys_update` | `src/app/api/account/api-keys/[id]/route.ts` | Revogação soft: seta `revoked_at` filtrando por conta e `revoked_at IS NULL`; zero linhas → 404 (`:43-65`) |

### Origem dos eventos de saída

| Método | Caminho | Autenticação | Arquivo | O que faz |
| --- | --- | --- | --- | --- |
| POST/GET | `/api/whatsapp/webhook` | webhook da Meta (fora deste subsistema) | `src/app/api/whatsapp/webhook/route.ts` | Única origem dos eventos de saída. Chama `dispatchWebhookEvent` em quatro pontos: `message.status_updated` (`:460`), `conversation.created` (`:634`), `conversation.reopened` (`:770`), `message.received` (`:966`) |

### Eventos de webhook (`src/lib/webhooks/events.ts:10-15`)

| Evento | Quando dispara |
| --- | --- |
| `message.received` | Chegou uma mensagem do contato |
| `message.status_updated` | Uma mensagem enviada mudou de status (enviada/entregue/lida/falhou) |
| `conversation.created` | Uma nova conversa foi aberta para um contato |
| `conversation.reopened` | Uma conversa fechada voltou a receber mensagem do cliente. Existe no código, é disparado, mas não está em `docs/public-api.md` |

### Telas

| Tela (nome no menu) | Rota | Arquivo | Observações |
| --- | --- | --- | --- |
| Configurações → Espaço de trabalho → **Chaves de API** | `/settings?tab=api` | `src/components/settings/api-keys-settings.tsx` | Única tela do subsistema. Lista nome, prefixo, escopos como etiquetas, criada em / última vez usada / expira em, selos "Revogada" e "Expirada". Botões "Nova chave de API" e "Revogar" ficam dentro de `<RequireRole min="admin">` (`:146-151, :243-258`). O diálogo tem nome (maxLength 80) e checkboxes de escopo montados a partir de `API_SCOPES` (`:423-444`), e depois troca para a visão de revelação única com botão "Copiar" (`:357-393`) |
| Configurações (roteador de painéis) | `/settings` | `src/app/(dashboard)/settings/page.tsx` | Mapeia a seção `api` para `<ApiKeysSettings />` (`page.tsx:87`). O mapa de painéis (`page.tsx:74-88`) não tem nenhuma entrada de webhooks |
| Configurações (trilho lateral) | `/settings` | `src/components/settings/settings-sections.ts` | Registra a seção `api` no grupo `workspace` com ícone `KeyRound` (`settings-sections.ts:39,71`); rótulo pt-BR "Chaves de API". Não existe seção de webhooks |

### Arquivos-chave

| Arquivo | Papel |
| --- | --- |
| `src/lib/api-keys/keys.ts` | Geração, hashing e checagem estrutural da chave. Puro, sem I/O |
| `src/lib/api-keys/store.ts` | Acesso a dados do caminho de auth (service-role): `findActiveKeyByHash`, `getAccountName`, `touchLastUsed` |
| `src/lib/api-keys/scopes.ts` | Os 10 escopos, descrições da UI, `normalizeScopes` e `hasScope` |
| `src/lib/auth/api-context.ts` | `requireApiKey`: bearer, formato, hash, rate limit, escopo, contexto com cliente service-role |
| `src/lib/api/v1/respond.ts` | Envelope público: `ApiError`, `ok`/`okList`/`fail`, `unauthorized`/`forbidden`/`badRequest`/`rateLimited`, `toApiErrorResponse` |
| `src/lib/api/v1/pagination.ts` | Keyset: `parseListParams`, `encodeCursor`/`decodeCursor` (com validação anti-injeção), `keysetFilter`, `buildPage` |
| `src/lib/api/v1/contacts.ts` | Serializador de contato, `resolveAuditUserId`, `findOrCreateContact`, `setContactTags` |
| `src/lib/api/v1/conversations.ts` | Serializadores públicos de conversa e mensagem (renomeia `message_id` → `whatsapp_message_id`) |
| `src/lib/api/v1/appointments.ts` | Serializador, status válidos, `parseSlot` e `SLOT_ERROR_MESSAGE` |
| `src/lib/rate-limit.ts` | Limitador de janela fixa em memória + `rateLimitResponse` + catálogo `RATE_LIMITS` |
| `src/lib/webhooks/deliver.ts` | `dispatchWebhookEvent` / `deliverOne`: seleção, assinatura, POST único com timeout, contabilidade de falha |
| `src/lib/webhooks/sign.ts` | `buildSignatureHeader` e `verifySignatureHeader` (esquema `t=…,v1=…`) |
| `src/lib/webhooks/ssrf.ts` | `isDeliverableUrl` / `isPrivateOrReservedIp` |
| `src/lib/webhooks/events.ts` | Vocabulário dos 4 eventos + `normalizeEvents` |
| `src/lib/webhooks/endpoints.ts` | `generateWebhookSecret`, `WEBHOOK_PUBLIC_COLUMNS`, `serializeWebhookEndpoint`, `normalizeWebhookUrl` |
| `src/lib/whatsapp/encryption.ts` | `encrypt`/`decrypt` AES-256-GCM do segredo do webhook; lê `process.env.ENCRYPTION_KEY` (`:29`) |
| `src/lib/flows/admin-client.ts` | `supabaseAdmin()` — cliente service-role usado por todo o caminho da API pública |
| `src/middleware.ts` | Relevante por omissão: não bloqueia `/api/v1` (`:73,81`) |
| `docs/public-api.md` | Documentação voltada ao integrador (460 linhas). Confere no rate limit (`:86`) e no esquema de assinatura (`:423-424`); não menciona `conversation.reopened` |
| `mcp-server/src/config.ts` | Servidor MCP consumidor da API: `WACRM_BASE_URL`, `WACRM_API_KEY` e os dois flags de opt-in para escrita |
| `mcp-server/src/client.ts` | Cliente HTTP fino do `/api/v1` usado pelo servidor MCP |
| `supabase/migrations/026_api_keys.sql` | DDL e RLS de `api_keys` |
| `supabase/migrations/028_webhook_endpoints.sql` | DDL e RLS de `webhook_endpoints` e a função `record_webhook_failure` |
