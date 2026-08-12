# API pública, chaves e webhooks de saída

O iMasterChat tem uma porta de entrada para programas, além da porta de entrada para pessoas. Enquanto o dashboard serve para alguém clicar, a API pública (`/api/v1/…`) serve para um sistema de fora — um site, um ERP, um fluxo do n8n, um Zapier, um agente de IA externo — mandar mensagem no WhatsApp, cadastrar contato, ler conversa, marcar agendamento e disparar campanha, sem que ninguém abra a tela. A credencial disso não é login e senha: é uma **chave de API**, criada em Configurações, presa a exatamente uma conta e limitada aos **escopos** (permissões) que você marcar na hora de criar. O caminho inverso são os **webhooks de saída**: endereços HTTPS que a conta registra para que o iMasterChat avise, por conta própria, quando chega mensagem, quando o status de entrega muda ou quando uma conversa nasce/reabre. Cada aviso vai assinado, para o sistema que recebe conseguir provar que veio mesmo daqui.

---

## Para que serve (visão do cliente)

Em linguagem de dono de negócio, esta parte do sistema permite:

- **Mandar WhatsApp a partir de outro sistema.** O site da ótica confirma um pedido e o iMasterChat manda a mensagem para o cliente, sem ninguém digitar. Basta o número no formato internacional (`+5511999998888`): se o contato ainda não existe, ele é criado; se a conversa ainda não existe, ela é aberta.
- **Manter a base de contatos sincronizada.** O sistema de vendas cria ou atualiza o contato no iMasterChat (nome, e-mail, empresa, etiquetas) sem digitação dupla.
- **Ler o que está acontecendo.** Listar conversas, ler o histórico de mensagens de uma conversa, ver contatos — para montar relatório próprio, painel próprio ou alimentar uma IA de fora.
- **Passar uma conversa para um humano.** Um robô externo que percebe que travou pode empurrar a conversa para a fila de pendentes, deixar uma nota explicando o motivo, opcionalmente já apontando o atendente — e nessa operação a IA do produto realmente fica calada naquela conversa.
- **Marcar, remarcar e cancelar agendamentos.** Útil para quem usa um fluxo externo (n8n) para conversar com o cliente e agendar; o registro fica no CRM do iMasterChat mesmo que o diálogo tenha sido conduzido fora.
- **Disparar campanha em massa por modelo aprovado.** Até mil destinatários por chamada, com acompanhamento de status.
- **Ser avisado em tempo real.** Registrar um endereço HTTPS que recebe um POST assinado a cada mensagem recebida, mudança de status de entrega, conversa criada ou conversa reaberta. É assim que se integra o iMasterChat a um sistema que precisa reagir na hora.

O que o cliente final **não** consegue fazer por aqui: administrar usuários, alterar configuração da conta, mexer em fluxos, automações ou faturamento. A API pública cobre mensagens, contatos, conversas, agendamentos, campanhas e webhooks — nada além disso.

---

## Como se usa, na prática

### 1. Criar a chave de API

1. Abrir **Configurações** e, no trilho lateral, no grupo **Espaço de trabalho**, a seção **Chaves de API**.
2. Clicar em **Nova chave de API**. O botão só aparece para quem é administrador ou dono da conta.
3. Preencher o **Nome** (até 80 caracteres — é só um rótulo, para você saber depois qual integração usa aquela chave, por exemplo "Automação do Zapier").
4. Marcar os **Escopos**. Cada escopo é uma permissão; marque só o que a integração precisa. Uma chave sem nenhum escopo ainda serve para testar a conexão (consegue chamar `GET /api/v1/me`), mas não faz mais nada.
5. Clicar em **Criar chave**. A tela troca para a visão **Copie sua chave de API**, com a chave completa e um botão **Copiar**.

**Esta é a única vez que a chave completa aparece.** Depois de fechar em **Concluir**, a lista mostra apenas o começo dela (por exemplo `wacrm_live_a1b2c3d4…`). Se a chave for perdida, o caminho é revogar e criar outra.

### 2. Usar a chave

O sistema que vai chamar a API manda a chave no cabeçalho HTTP:

```
Authorization: Bearer wacrm_live_XXXXXXXX…
```

O prefixo `Bearer ` é opcional — mandar só a chave crua também funciona.

Teste de fumaça recomendado antes de qualquer coisa: `GET /api/v1/me`. Ele devolve o nome da conta e a lista de escopos da chave. Se responder, a chave está viva e ligada à conta certa.

### 3. Revogar a chave

Na mesma tela **Chaves de API**, botão **Revogar** na linha da chave (também só para administrador/dono). A revogação é imediata e definitiva: a chave para de funcionar na próxima chamada. A linha **continua aparecendo na lista**, com o selo **Revogada** — de propósito, como trilha de auditoria de que aquela chave existiu.

### 4. Registrar um webhook de saída

**Não existe tela para isso.** Webhooks são gerenciados exclusivamente por chamada à própria API, com uma chave que tenha o escopo `webhooks:manage`:

1. `POST /api/v1/webhooks` com `{"url": "https://…", "events": ["message.received"]}`.
2. A resposta 201 traz o campo `secret` (começa com `whsec_`) — o segredo de assinatura, mostrado **uma única vez**. Guarde-o no sistema que vai receber os avisos.
3. A partir daí, cada evento assinado chega por POST naquele endereço, com o cabeçalho `X-Wacrm-Signature`.

A URL precisa ser `https://`. `http://` é recusado com erro 400.

---

## O que dá para configurar

| Ajuste | Onde | O que muda | Exige admin |
|---|---|---|---|
| Criar chave de API (nome + escopos) | Tela **Configurações → Chaves de API**, botão **Nova chave de API** | Cria uma credencial nova e mostra o texto dela uma vez | Sim (admin/owner) |
| Revogar chave de API | Tela **Configurações → Chaves de API**, botão **Revogar** | Chave para de autenticar; linha fica na lista com selo Revogada | Sim (admin/owner) |
| Listar chaves da conta | Tela **Configurações → Chaves de API** | Só visualização (nome, prefixo, escopos, datas) | Não — qualquer membro vê a lista |
| Validade da chave (`expiresInDays`, no máximo 365 dias) | Só por chamada direta a `POST /api/account/api-keys` (`src/app/api/account/api-keys/route.ts:112-122`). **A tela nunca envia esse campo** | Chave passa a expirar sozinha na data. Sem o campo, a chave nunca expira | Sim (admin/owner) |
| Registrar / editar / desativar / apagar webhook | Só por API: `POST/GET /api/v1/webhooks`, `GET/PATCH/DELETE /api/v1/webhooks/{id}` com escopo `webhooks:manage`. Não há tela | Quais endereços recebem quais eventos | Não se aplica: a autorização é por escopo da chave, não por papel |
| Vocabulário de escopos (hoje 10) | Código: `src/lib/api-keys/scopes.ts:16-27` (lista) e `:32-43` (descrições da tela) | Quais permissões existem para marcar. Não exige migração de banco | — |
| Vocabulário de eventos de webhook (hoje 4) | Código: `src/lib/webhooks/events.ts:10-15` | Quais eventos podem ser assinados. Não exige migração | — |
| Limite de chamadas da API pública (hoje 120 por minuto, por chave) | Código: `src/lib/rate-limit.ts:156` (`publicApi`) | Quantas chamadas uma chave faz por minuto antes do 429 | — |
| Limite das rotas de gestão de chave (hoje 30 por minuto, por usuário) | Código: `src/lib/rate-limit.ts:149` (`adminAction`) | Quantas chaves um mesmo usuário cria por minuto | — |
| Timeout de entrega do webhook (5000 ms) e falhas consecutivas até desativar (15) | Código: `src/lib/webhooks/deliver.ts:31` e `:34` | Paciência com um endpoint lento; quando o endpoint é desligado sozinho | — |
| Tolerância de defasagem de relógio na verificação da assinatura (300 s) | Código: `src/lib/webhooks/sign.ts:45` | Quanto atraso o verificador de referência aceita antes de considerar replay | — |
| `ENCRYPTION_KEY` (64 caracteres hexadecimais) | Variável de ambiente do app (`deploy/docker-compose.app.yml:50`, `deploy/README.md:122`), lida em `src/lib/whatsapp/encryption.ts:29` | Cifra e decifra o segredo dos webhooks. **Trocá-la quebra todos os endpoints já registrados** | — |
| `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL` | Variáveis de ambiente do app (`deploy/docker-compose.app.yml:49`), lidas em `src/lib/flows/admin-client.ts:11-12` | Sem elas, todo o caminho da API pública não sobe | — |
| `WACRM_BASE_URL` e `WACRM_API_KEY` | `mcp-server/.env`, lidas em `mcp-server/src/config.ts:27-28` | Instância e chave usadas pelo servidor MCP que consome esta API | — |
| `WACRM_ENABLE_WRITES` e `WACRM_ENABLE_BROADCASTS` | `mcp-server/.env`, lidas em `mcp-server/src/config.ts:49-50` | Liberam ferramentas de escrita e de disparo em massa no servidor MCP (padrão: só leitura). Ligar broadcasts sem ligar writes é erro de inicialização | — |

---

## Como funciona por dentro

### O caminho de uma chamada autenticada

Todo endpoint `/api/v1/*` começa igual, em `src/lib/auth/api-context.ts`:

1. **Extrai o portador.** O cabeçalho `Authorization` é aceito com ou sem `Bearer ` (`api-context.ts:62-64`).
2. **Rejeição estrutural barata.** O valor precisa começar com `wacrm_live_` e ter conteúdo depois; senão, 401 sem tocar no banco (`api-context.ts:85`, implementação em `src/lib/api-keys/keys.ts:76-78`).
3. **Resolve a chave pelo hash.** Calcula SHA-256 do texto apresentado e faz `SELECT … WHERE key_hash = …` (`src/lib/api-keys/store.ts:40-41`, chamado em `api-context.ts:89`). O banco nunca guardou o texto da chave — só o digest (`keys.ts:67`, coluna em `026_api_keys.sql:47`).
4. **Descarta revogada/expirada em JavaScript**, depois do SELECT: `store.ts:51-54`. Chave desconhecida, revogada e expirada devolvem o **mesmo 401 indistinguível** (`api-context.ts:90-95`) — de propósito, para não revelar se a chave já existiu.
5. **Aplica o rate limit** com o bucket `apikey:<id da linha>` e o orçamento `publicApi` (`api-context.ts:99`; `src/lib/rate-limit.ts:156` = 120 requisições / 60 000 ms).
6. **Checa o escopo.** Cada rota declara **um** escopo; `hasScope` é literalmente `granted.includes(required)` (`api-context.ts:104-106`, `src/lib/api-keys/scopes.ts:80`). O papel do usuário que criou a chave é irrelevante em tempo de requisição.
7. **Devolve o contexto** com `accountId`, `createdBy` e um cliente Supabase **service-role** (`api-context.ts:112`), ou seja, que ignora RLS. O isolamento entre contas não vem do banco nesse caminho: vem do `account_id` que cada rota coloca na query.

Detalhes que importam para quem for mexer:

- **A geração da chave** é `randomBytes(32).toString('base64url')` prefixado por `wacrm_live_` (`keys.ts:52-53`, prefixo em `:25`). O `key_prefix` guardado para exibição é o prefixo mais os 8 primeiros caracteres do corpo (`keys.ts:57`, `DISPLAY_BODY_CHARS = 8` em `:33`).
- **`timingSafeHexEqual` existe e é exportada em `keys.ts:88`, mas não é chamada por nenhum código de produção** — só pelo arquivo de teste. O caminho real compara por igualdade no SQL. O comentário do arquivo sugere o contrário.
- **`last_used_at` é fire-and-forget**: `void supabaseAdmin().from('api_keys').update(...)` (`store.ts:82`), com falha virando apenas `console.warn` (`store.ts:88-91`). Nunca derruba a requisição, e por isso pode ficar levemente desatualizado.
- **O middleware global não protege `/api/v1`.** A lista de caminhos protegidos em `src/middleware.ts:73` não inclui a API pública, e a única checagem de API cobre `/api/whatsapp/` (`middleware.ts:81`). Toda a autenticação de `/api/v1` é responsabilidade do `requireApiKey` dentro de cada rota — uma rota nova que esquecer de chamá-lo fica aberta.

### Envelope, paginação e isolamento

- **Envelope de resposta** (`src/lib/api/v1/respond.ts`): sucesso é `{ data }` (`:86`); erro é `{ error: { code, message } }` (`:113`); qualquer exceção que não seja `ApiError` vira um 500 genérico com `console.error`, para não vazar texto interno (`:128-132`).
- **Paginação keyset** por `(created_at DESC, id DESC)`, limite padrão 50 e teto 100 (`src/lib/api/v1/pagination.ts:20-21`, clamp em `:44-50`, filtro em `:106`). Um cursor malformado é tratado como ausente — volta para a primeira página em vez de dar erro.
- O cursor é revalidado na decodificação (UUID válido + timestamp parseável, `pagination.ts:82-84`) porque seus valores são interpolados crus no `.or()` do PostgREST. É essa validação que impede injeção de sintaxe de filtro por cursor forjado.
- **Isolamento por conta**: toda rota isola, mas por dois mecanismos. A maioria filtra direto com `.eq('account_id', ctx.accountId)` (ex.: `src/app/api/v1/webhooks/[id]/route.ts:31`). Em `GET /api/v1/conversations/{id}/messages` o filtro de conta está no **gate anterior** sobre `conversations` (`messages/route.ts:29-35`); a query de mensagens em si filtra só por `conversation_id` (`:37-43`). O comportamento observável é o mesmo: id de outra conta devolve **404, nunca 403** — por decisão de não revelar existência.
- **Autoria das escritas**: não existe usuário logado numa chamada de API, então as escritas são atribuídas ao dono do `whatsapp_config` da conta; se não houver, ao `owner_user_id` da conta; se nem isso existir, erro 500 (`src/lib/api/v1/contacts.ts:77-94`).

### Rate limit

O limitador é uma **janela fixa em memória do processo Node**: um `Map` de módulo (`src/lib/rate-limit.ts:46`). Não há Redis, tabela nem cookie. A primeira chamada da janela cria a entrada com `count = 1` e `resetAt = agora + windowMs`; ao estourar, devolve falha até o `resetAt` (`rate-limit.ts:74-81`). Não há timer de limpeza — entradas velhas são varridas oportunisticamente a cada 1000 chamadas (`:51`, `:66-70`).

Ordem importante: o limite roda **depois** de resolver a chave e **antes** da checagem de escopo (`api-context.ts:89 → 94 → 99 → 104`). Consequências:
- uma chave válida chamando rota sem o escopo certo **consome** orçamento;
- uma chave inválida ou inexistente **não consome nada e não é limitada de forma alguma** — não há proteção de força bruta por essa via.

O 429 devolve `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset` (este em segundos unix) — `src/lib/api/v1/respond.ts:74-80`.

### Webhooks de saída

- **Segredo**: `whsec_` + 32 bytes de CSPRNG em base64url (`src/lib/webhooks/endpoints.ts:33`, prefixo em `:12`). Diferente da chave de API, é guardado **cifrado** com AES-256-GCM, não hasheado (`src/app/api/v1/webhooks/route.ts:83`; cifra em `src/lib/whatsapp/encryption.ts:37-48`, algoritmo na linha 40) — o servidor precisa dele em texto para assinar cada entrega.
- **Assinatura**: cabeçalho `X-Wacrm-Signature: t=<segundos unix>,v1=<hex>`, onde `v1 = HMAC-SHA256(secret, "${t}.${rawBody}")` sobre o **corpo exato enviado**, não uma re-serialização (`src/lib/webhooks/sign.ts:29-32`). O verificador de referência tolera 300 s de defasagem e compara em tempo constante (`sign.ts:45`, `:59`, `:67`).
- **Cabeçalhos de cada entrega**, além do `Content-Type`: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, `X-Wacrm-Signature` (`src/lib/webhooks/deliver.ts:117-121`).
- **Corpo**: `{ id: <uuid por entrega>, event, occurred_at, account_id, data }` (`deliver.ts:66-72`).
- **Seleção de destinos**: só endpoints da conta com `is_active = true` e que contenham o evento no array `events` (`deliver.ts:55-58`).
- **Guarda SSRF antes de cada POST**: a URL é resolvida por DNS e recusada se qualquer endereço for loopback, privado, link-local (inclui `169.254.169.254`, endereço de metadados de nuvem), ULA, CGNAT, ou se o host for do tipo `localhost` / `.local` / `.internal` (`deliver.ts:96-100`, regras em `src/lib/webhooks/ssrf.ts:29-47` e `:67-74`). O próprio arquivo registra que **não** protege contra DNS rebinding, porque o `fetch` não permite fixar o IP resolvido no socket (`ssrf.ts:16-18`).
- **Uma tentativa só**, timeout de 5 s, redirects não seguidos (`redirect: 'manual'`, para um 3xx não desviar a entrega para um endereço interno). Qualquer status não-ok, incluindo 3xx, conta como falha (`deliver.ts:126-129`, `DELIVERY_TIMEOUT_MS = 5000` em `:31`).
- **Contabilidade de falha**: cada falha consecutiva chama a RPC atômica `record_webhook_failure` (`deliver.ts:151-154`), que incrementa `failure_count` e seta `is_active = false` ao atingir 15 (`MAX_CONSECUTIVE_FAILURES = 15` em `deliver.ts:34`; lógica em `028_webhook_endpoints.sql:97-101`). Uma entrega bem-sucedida zera `failure_count` e carimba `last_delivery_at` (`deliver.ts:132-135`).
- **Nunca lança**: `dispatchWebhookEvent` engole qualquer erro com `console.error` (`deliver.ts:80-83`), para não afetar o 200 devolvido à Meta.
- **Origem dos eventos**: os quatro eventos nascem exclusivamente do webhook de entrada da Meta — `src/app/api/whatsapp/webhook/route.ts:460` (`message.status_updated`), `:634` (`conversation.created`), `:770` (`conversation.reopened`), `:966` (`message.received`). Não há outro emissor no repositório. O `message.received` é **aguardado** dentro do `after()` da rota, deliberadamente, porque uma promise solta poderia ser congelada antes de entregar (`webhook/route.ts:959-966`).

### Rotas de gestão de chave (dashboard)

`/api/account/api-keys` é o outro caminho, e é diferente do `/api/v1`: usa **sessão por cookie** e o cliente Supabase **com RLS** (`src/lib/auth/account.ts:160`, contexto devolvido em `:236`). Criar exige `requireRole('admin')` na rota **e** passa pela policy `api_keys_insert` (`api-keys/route.ts:73`; `026_api_keys.sql:75-76`). Listar é aberto a qualquer membro (`api-keys/route.ts:49`) e usa `SAFE_COLUMNS`, que omite `key_hash` de propósito (`:42-43`). Revogar é UPDATE de `revoked_at` filtrando por `account_id` e `.is('revoked_at', null)`; zero linhas afetadas vira 404 (`api-keys/[id]/route.ts:45-48`, `:59-65`).

---

## Limites e pegadinhas

**Sobre a chave**

- **A chave completa aparece uma única vez.** Não existe "ver de novo" nem recuperação. Perdeu, revoga e cria outra.
- **Toda chave criada pela tela é sem validade.** O formulário nunca envia `expiresInDays` (`src/components/settings/api-keys-settings.tsx:321`; não há campo de expiração em `:406-453`). Só uma chamada direta ao `POST /api/account/api-keys` consegue definir prazo, e mesmo assim o máximo é 365 dias.
- **Qualquer membro, inclusive viewer, vê a lista de chaves** (nome, prefixo, escopos, datas). Não vê o texto da chave. Criar e revogar é que exigem admin/owner.
- **Revogar não apaga a linha.** A chave revogada continua na lista com selo **Revogada**. Isso é intencional.
- **Uma chave sem escopo nenhum ainda autentica** e consegue chamar `GET /api/v1/me`, porque essa rota chama `requireApiKey` sem exigir escopo (`src/app/api/v1/me/route.ts:22`). Serve como teste de conexão; não serve para mais nada.
- **O escopo é a única autorização.** O papel de quem criou a chave não é reavaliado em tempo de requisição. Uma chave com `broadcasts:send` continua disparando campanha mesmo que o admin que a criou perca o cargo ou saia da conta — enquanto a chave não for revogada.
- **A verificação da chave é um SELECT por igualdade em hash**, não uma comparação em tempo constante em memória. A função de comparação segura existe no código mas não é usada em produção.
- **O banco não restringe o vocabulário de escopos**: a coluna é `text[]` livre (`026_api_keys.sql:48`). Adicionar escopo é mudança de código, não migração.

**Sobre o rate limit**

- **O limite de 120/min existe em memória de um único processo Node.** O próprio arquivo documenta que, com escala horizontal, o limite é silenciosamente derrotado — N instâncias permitem N×120/min — e aponta a troca por Redis/Upstash como solução (`src/lib/rate-limit.ts:9-14`). **Não foi verificado quantas instâncias o deploy real do cliente roda**, nem se o Next empacota o módulo em bundles separados; portanto o limite efetivo em produção é desconhecido.
- **Chave inválida não é limitada.** O limitador só entra depois que a chave é resolvida com sucesso.

**Sobre os webhooks de saída**

- **Não existe tela de webhooks.** Não há entrada no mapa de painéis de Configurações (`src/app/(dashboard)/settings/page.tsx:74-88`) nem na lista de seções (`src/components/settings/settings-sections.ts`). A única forma de criar, listar, editar ou apagar endpoint é chamando `/api/v1/webhooks` com uma chave que tenha `webhooks:manage`. Um tutorial que mande o cliente "ir em Configurações → Webhooks" está errado. (A busca por `webhook_endpoints|api/v1/webhooks` em `src/` também acha `src/lib/automations/engine.ts:593`, mas ali é apenas um comentário do passo `send_webhook` das automações — não toca na tabela.)
- **Não existe retry.** É **uma tentativa por evento**. Se o seu servidor estiver fora do ar por 30 segundos, os eventos daquele intervalo são perdidos — não voltam. Não há fila, não há reenvio manual, não há histórico de entregas armazenado.
- **Timeout curto**: 5 segundos. Um endpoint que processa de forma síncrona e demora mais é contabilizado como falha mesmo que tenha recebido tudo. Responda 200 rápido e processe depois.
- **Redirect conta como falha.** Se a URL registrada responde 301/302 (por exemplo, de `dominio.com` para `www.dominio.com`), a entrega falha. Registre a URL final.
- **15 falhas consecutivas desativam o endpoint sozinho**, e nada o reativa automaticamente. A reativação é manual, por `PATCH /api/v1/webhooks/{id}` com `is_active: true` — o que também zera o contador de falhas (`src/app/api/v1/webhooks/[id]/route.ts:88-91`). Não foi verificado exaustivamente se existe algum cron que reative endpoints; a única reativação encontrada é essa, manual.
- **Alvo interno derruba o endpoint.** A recusa da guarda SSRF conta como falha de entrega. Apontar o webhook para um endereço de rede interna ou `localhost` não dá erro no cadastro — dá 15 falhas silenciosas e o endpoint desativado.
- **Trocar `ENCRYPTION_KEY` quebra todos os webhooks registrados.** O segredo deixa de ser decifrável, cada entrega vira falha, e 15 falhas desativam o endpoint (`deliver.ts:103-111`).
- **`http://` é recusado no cadastro** com 400. Só `https://`.
- **O evento `conversation.reopened` existe e é disparado, mas não está documentado** em `docs/public-api.md` nem no CHANGELOG (a tabela de eventos em `docs/public-api.md:369-373` lista apenas três). Quem escrever tutorial deve incluir os quatro.
- **O comentário do código se contradiz sobre a semântica de entrega**: o cabeçalho diz "at-most-once, single attempt" e o comentário do payload diz "at-least-once and may repeat" (`deliver.ts:11` contra `:64-65`). **O código implementa uma tentativa única (at-most-once).** Ainda assim, tratar o campo `id` do payload como chave de idempotência é a prática correta do lado de quem recebe.
- **Só a Meta gera evento.** Uma mensagem enviada pelo dashboard ou pela própria API não dispara `message.received` — esse evento é só para mensagem **recebida** do cliente.
- **O gate de cobrança não suprime os eventos.** O portão que trava conta `pending`/`blocked` (`webhook/route.ts:797`) desliga fluxos, automações, IA, push e a política de áudio, mas o despacho dos webhooks de saída fica **de fora, por decisão explícita** — o comentário em `webhook/route.ts:792-795` diz que silenciá-los criaria um buraco inexplicado no fluxo de eventos do operador. Uma conta bloqueada continua entregando `message.received`, `conversation.created`, `conversation.reopened` e `message.status_updated`.

**Sobre as demais rotas**

- **`POST /api/v1/messages` cria contato e conversa se não existirem.** Um número digitado errado gera um contato novo na base. A validação do formato da mensagem acontece **antes** disso (`messages/route.ts:90-96`), então payload inválido não deixa contato órfão — mas número válido e errado, deixa.
- **`POST /api/v1/contacts` é find-or-create**: 200 quando o contato já existia, 201 quando foi criado. Quem consome precisa olhar o status para saber o que aconteceu.
- **`PATCH /api/v1/contacts/{id}` com `tags` substitui o conjunto inteiro de etiquetas**, não adiciona. Mandar `tags: []` remove todas.
- **`POST /api/v1/broadcasts` responde 202 imediatamente** e faz o disparo real em segundo plano, com `maxDuration = 60` (`broadcasts/route.ts:37,80`). O teto é 1000 destinatários (`src/lib/whatsapp/broadcast-core.ts:77,104`), e o próprio comentário do código admite que uma audiência perto do teto pode passar de 60 segundos e **ser cortada no meio** — deixando destinatários pendentes e a campanha travada em "enviando". Divida audiências grandes em várias chamadas.
- **Agendamentos criados pela API recebem `created_via = 'n8n'` por padrão**; a única alternativa aceita é `'native'`. Nunca `'manual'` (`appointments/route.ts:173`). Relatórios que separam "manual" de "automático" vão contar tudo que veio da API como automático.
- **Três índices únicos parciais produzem 409 no agendamento**, com mensagens distintas: horário já ocupado na conta, contato que já tem um agendamento ativo, e evento do Google já registrado (`appointments/route.ts:188-205`). Um workflow que repete a mesma chamada vai receber 409 — é o caso esperado, não um defeito.
- **Não existe DELETE de agendamento.** Cancelar é `PATCH` com `{"status": "cancelled"}`.
- **Remarcar exige `starts_at` e `ends_at` juntos**; mandar um só dá 400 (`appointments/[id]/route.ts:73-80`). A duração máxima aceita é 8 horas e o início não pode estar no passado (`src/lib/api/v1/appointments.ts:125-131`).
- **O handoff pela API não manda mensagem ao cliente.** Ele muda o status para pendente, desliga a resposta automática da IA naquela conversa, grava a nota (prefixada com um marcador de robô) e, se `assign_to` for informado, atribui o atendente. Avisar o cliente que "já vou chamar alguém" é responsabilidade de quem chama a API. `reason` é obrigatório e é truncado em 500 caracteres.
- **Este handoff, sim, cala a IA na conversa** (`ai_autoreply_disabled`) — diferente do que acontece quando um atendente simplesmente responde pelo inbox, que **não** assume a conversa nem cala a IA (só "Atribuir"/"Assumir" fazem isso, `send-message.ts:483-504`), e diferente do nó de handoff dos **fluxos**, que não desliga a IA.
- **404, nunca 403, para recurso de outra conta.** Quem depura integração não deve interpretar 404 como "o registro não existe" — pode ser "não é seu".
- **401 é indistinguível** entre chave inexistente, revogada e expirada. Na hora de investigar, olhe a tela **Chaves de API**: o selo (Revogada / Expirada) e a data de última utilização dizem o que o 401 não diz.
- **`GET /api/v1/webhooks` não pagina**: devolve a lista inteira e `next_cursor` sempre `null` (`webhooks/route.ts:38-43`).
- **Nenhuma rota `/api/v1` foi testada em execução** durante o mapeamento — toda a descrição acima vem de leitura de código.

**Sobre o banco**

- Todo o texto de RLS deste documento é o que os arquivos de migração **declaram**, não o estado verificado do catálogo do Postgres na instância do cliente. Não foi confirmado se as migrações 026, 028, 041 e 043 foram efetivamente aplicadas, nem se alguém alterou policies ou colunas manualmente.
- Na prática, as policies de `api_keys` e `webhook_endpoints` quase não atuam no caminho da API pública: ele usa service-role, que ignora RLS. Elas valem para o caminho do dashboard.

---

## Referência

### Tabelas

| Tabela | Migração de origem | Para que serve |
|---|---|---|
| `api_keys` | `supabase/migrations/026_api_keys.sql` | Credencial de máquina do `/api/v1` |
| `webhook_endpoints` | `supabase/migrations/028_webhook_endpoints.sql` | Endereços HTTPS que recebem os eventos de saída |
| `appointments` | `supabase/migrations/041_appointments.sql`, alterada por `043_google_calendar.sql` | Registro CRM de agendamento, tocado por `/api/v1/appointments` |

**`api_keys`** (`026_api_keys.sql`)

| Coluna | Notas |
|---|---|
| `id uuid` | PK |
| `account_id uuid NOT NULL` | REFERENCES `accounts(id)` ON DELETE CASCADE (`026:43`) |
| `created_by uuid` | REFERENCES `auth.users(id)` ON DELETE SET NULL — só auditoria (`026:44`) |
| `name text NOT NULL` | Rótulo exibido (`026:45`) |
| `key_prefix text NOT NULL` | Só exibição, ex. `wacrm_live_a1b2c3d4` (`026:46`) |
| `key_hash text NOT NULL UNIQUE` | SHA-256 hex do texto completo (`026:47`) |
| `scopes text[] NOT NULL DEFAULT '{}'` | Vocabulário **não** restringido pelo banco (`026:48`) |
| `last_used_at timestamptz` | Atualizado fire-and-forget (`026:49`) |
| `expires_at timestamptz` | NULL = nunca expira (`026:50`) |
| `revoked_at timestamptz` | NULL = ativa (`026:51`) |
| `created_at timestamptz NOT NULL DEFAULT now()` | (`026:52`) |

Índices: `api_keys_account_id_idx` (`026:56`), `api_keys_key_hash_idx` (`026:61`). RLS habilitada (`026:63`): SELECT para qualquer membro (`026:68-69`); INSERT, UPDATE e DELETE exigem `is_account_member(account_id, 'admin')` (`026:75-76`, `:79-80`, `:83-84`). `is_account_member` é `SECURITY DEFINER` e compara `auth.uid()` com hierarquia owner > admin > agent > viewer (`017_account_sharing.sql:136-164`). Nenhuma migração posterior a 026 altera esta tabela.

**`webhook_endpoints`** (`028_webhook_endpoints.sql`)

| Coluna | Notas |
|---|---|
| `id uuid` | PK |
| `account_id uuid NOT NULL` | ON DELETE CASCADE (`028:44`) |
| `created_by uuid` | ON DELETE SET NULL (`028:45`) |
| `url text NOT NULL` | Endpoint HTTPS (`028:46`) |
| `secret text NOT NULL` | Segredo HMAC **cifrado** AES-256-GCM, não hash (`028:47`) |
| `events text[] NOT NULL DEFAULT '{}'` | Validado só na aplicação (`028:48`) |
| `is_active boolean NOT NULL DEFAULT true` | (`028:49`) |
| `last_delivery_at timestamptz` | Última entrega bem-sucedida (`028:50`) |
| `failure_count integer NOT NULL DEFAULT 0` | Falhas **consecutivas**; zerado no sucesso (`028:51`) |
| `created_at timestamptz NOT NULL DEFAULT now()` | (`028:52`) |

Índice: `webhook_endpoints_account_id_idx` (`028:56-57`). RLS habilitada (`028:59`): SELECT para qualquer membro (`028:63-64`); INSERT/UPDATE/DELETE exigem admin (`028:68-69`, `:72-73`, `:76-77`). A migração também cria `public.record_webhook_failure(endpoint_id uuid, max_failures int)`, `LANGUAGE sql SECURITY DEFINER`, que incrementa `failure_count` e desativa o endpoint no mesmo UPDATE quando o novo valor atinge `max_failures` (`028:91-103`). Nenhuma migração posterior altera esta tabela.

**`appointments`** (`041_appointments.sql`, com acréscimo em `043_google_calendar.sql`)

| Coluna | Notas |
|---|---|
| `account_id uuid NOT NULL` | (`041:34`) |
| `contact_id uuid NOT NULL` | ON DELETE CASCADE (`041:35`) |
| `conversation_id uuid` | ON DELETE SET NULL (`041:39`) |
| `starts_at` / `ends_at timestamptz NOT NULL` | (`041:41-42`) |
| `status appointment_status_enum DEFAULT 'scheduled'` | Valores aceitos pela API: `scheduled`, `completed`, `no_show`, `cancelled` (`src/lib/api/v1/appointments.ts:11-16`) |
| `google_event_id` / `google_calendar_id text` | (`041:49-50`) |
| `created_via text NOT NULL DEFAULT 'manual'` | CHECK IN (`manual`, `n8n`, `native`) (`041:55-56`) |
| `cancellation_reason text` | Acrescentada por `043_google_calendar.sql:169` |

Constraint `appointments_ends_after_starts CHECK (ends_at > starts_at)` (`041:61`). Três índices únicos parciais, que são a origem dos 409 da API: `idx_appointments_one_per_slot (account_id, starts_at) WHERE status='scheduled'` (`041:74-76`); `idx_appointments_one_live_per_contact (contact_id) WHERE status='scheduled'` (`041:81-83`); `idx_appointments_google_event (google_event_id) WHERE NOT NULL` (`041:87-89`). RLS habilitada (`041:91`): SELECT para membro (`041:99-100`), INSERT e UPDATE exigem `agent`+ (`041:103-104`, `:107-109`), DELETE exige admin (`041:112-113`). `043` é a última migração que altera esta tabela; índices, constraints e policies de `041` continuam válidos.

### Escopos (10)

| Escopo | Permite |
|---|---|
| `messages:send` | Enviar mensagens de WhatsApp |
| `messages:read` | Ler mensagens e seu status de entrega |
| `contacts:read` | Listar e ler contatos |
| `contacts:write` | Criar e atualizar contatos |
| `conversations:read` | Listar e ler conversas |
| `conversations:handoff` | Passar uma conversa para um atendente humano |
| `appointments:read` | Listar e ler agendamentos |
| `appointments:write` | Criar, remarcar e cancelar agendamentos |
| `broadcasts:send` | Disparar campanhas em massa |
| `webhooks:manage` | Registrar e gerenciar webhooks de saída |

Fonte: `src/lib/api-keys/scopes.ts:16-27` (lista) e `:32-43` (descrições exibidas na tela).

### Eventos de webhook (4)

| Evento | Quando dispara | Origem |
|---|---|---|
| `message.received` | Chegou mensagem do cliente | `src/app/api/whatsapp/webhook/route.ts:966` |
| `message.status_updated` | Mensagem enviada mudou de status (enviada/entregue/lida/falhou) | `webhook/route.ts:460` |
| `conversation.created` | Nova conversa aberta para um contato | `webhook/route.ts:634` |
| `conversation.reopened` | Conversa fechada voltou porque o cliente escreveu de novo. **Não documentado em `docs/public-api.md`** | `webhook/route.ts:770` |

Vocabulário em `src/lib/webhooks/events.ts:11-14`.

### Rotas da API pública (`/api/v1`) — autenticação por chave

| Método | Rota | Escopo exigido | O que faz | Arquivo |
|---|---|---|---|---|
| GET | `/api/v1/me` | **nenhum** (só chave válida) | Devolve `{ account: {id, name}, key: {id, scopes} }`. Sonda de identidade | `src/app/api/v1/me/route.ts:22-27` |
| POST | `/api/v1/messages` | `messages:send` | Envia mensagem por número E.164; resolve-ou-cria contato e conversa; 201. Aceita `type` text/template/image/video/document/audio, `text`, `media_url`, `filename`, `template{name,language,params}`, `reply_to_message_id`, `name` | `src/app/api/v1/messages/route.ts:46`, validação em `:90-96` |
| GET | `/api/v1/contacts` | `contacts:read` | Lista contatos, paginação keyset, filtros `?search=` (sanitizado, `:31-33`) e `?tag=` (inner join aliasado, `:49-63`) | `src/app/api/v1/contacts/route.ts:37` |
| POST | `/api/v1/contacts` | `contacts:write` | Find-or-create por telefone: 200 se já existia, 201 se criou. Aceita `name`, `email`, `company`, `tags` (por nome) | `src/app/api/v1/contacts/route.ts:98`, status em `:138` |
| GET | `/api/v1/contacts/{id}` | `contacts:read` | Lê um contato; 404 fora da conta | `src/app/api/v1/contacts/[id]/route.ts:25,28` |
| PATCH | `/api/v1/contacts/{id}` | `contacts:write` | Atualiza só os campos presentes (`name`/`email`/`company`); tipo inválido vira 400. `tags` **substitui** o conjunto | `src/app/api/v1/contacts/[id]/route.ts:40,60-68` |
| GET | `/api/v1/conversations` | `conversations:read` | Lista conversas paginadas; filtros `?status=` e `?contact_id=` | `src/app/api/v1/conversations/route.ts:25,36-37` |
| GET | `/api/v1/conversations/{id}` | `conversations:read` | Lê uma conversa; 404 fora da conta | `src/app/api/v1/conversations/[id]/route.ts:20,34` |
| GET | `/api/v1/conversations/{id}/messages` | `messages:read` | Lista mensagens da conversa, mais novas primeiro, paginado. Verifica a posse da conversa antes de devolver qualquer mensagem | `src/app/api/v1/conversations/[id]/messages/route.ts:24,29-35` |
| POST | `/api/v1/conversations/{id}/handoff` | `conversations:handoff` | Status → `pending`, desliga a resposta automática da IA na thread, grava a nota, atribui `assign_to` se informado. `reason` obrigatório, truncado em 500. Não manda mensagem ao cliente | `src/app/api/v1/conversations/[id]/handoff/route.ts:42,35,54-57` |
| GET | `/api/v1/appointments` | `appointments:read` | Lista agendamentos; filtros `?contact_id=`, `?status=`, `?from=`, `?to=` (sobre `starts_at`) | `src/app/api/v1/appointments/route.ts:38,47-73` |
| POST | `/api/v1/appointments` | `appointments:write` | Cria agendamento. Confere que `contact_id` e `conversation_id` são da conta; colisões de índice único viram 409 com mensagens distintas | `src/app/api/v1/appointments/route.ts:101,121-149,188-205` |
| GET | `/api/v1/appointments/{id}` | `appointments:read` | Lê um agendamento; 404 fora da conta | `src/app/api/v1/appointments/[id]/route.ts:32,46` |
| PATCH | `/api/v1/appointments/{id}` | `appointments:write` | Remarca (`starts_at` **e** `ends_at` juntos, senão 400) ou cancela (`{"status":"cancelled"}`). Não existe DELETE | `src/app/api/v1/appointments/[id]/route.ts:59,73-80` |
| POST | `/api/v1/broadcasts` | `broadcasts:send` | Cria campanha + destinatários sincronamente e faz o fan-out em `after()`; responde 202. `maxDuration = 60`. Teto de 1000 destinatários | `src/app/api/v1/broadcasts/route.ts:48,80,37`; teto em `src/lib/whatsapp/broadcast-core.ts:77,104` |
| GET | `/api/v1/broadcasts/{id}` | `broadcasts:send` | Status e contadores da campanha; 404 fora da conta | `src/app/api/v1/broadcasts/[id]/route.ts:19,35` |
| GET | `/api/v1/webhooks` | `webhooks:manage` | Lista os endpoints da conta, sem o segredo; `next_cursor` sempre `null` | `src/app/api/v1/webhooks/route.ts:23,27,38-43` |
| POST | `/api/v1/webhooks` | `webhooks:manage` | Registra endpoint. Valida `url` https e `events`; gera o segredo, grava cifrado e devolve o texto puro **uma única vez** no 201 | `src/app/api/v1/webhooks/route.ts:51,75,83,95-98` |
| GET | `/api/v1/webhooks/{id}` | `webhooks:manage` | Lê um endpoint (sem o segredo); 404 fora da conta | `src/app/api/v1/webhooks/[id]/route.ts:24,38` |
| PATCH | `/api/v1/webhooks/{id}` | `webhooks:manage` | Atualiza `url` / `events` / `is_active`. Reativar zera `failure_count`. Corpo sem campo atualizável → 400 | `src/app/api/v1/webhooks/[id]/route.ts:51,91,94-96` |
| DELETE | `/api/v1/webhooks/{id}` | `webhooks:manage` | Remove o endpoint; 404 fora da conta | `src/app/api/v1/webhooks/[id]/route.ts:125,140` |

### Rotas de gestão de chave e origem dos eventos — autenticação por sessão

| Método | Rota | Papel exigido | O que faz | Arquivo |
|---|---|---|---|---|
| GET | `/api/account/api-keys` | Qualquer membro (sessão por cookie, cliente com RLS) | Lista as chaves com `SAFE_COLUMNS`; `key_hash` deliberadamente omitido | `src/app/api/account/api-keys/route.ts:42-43,49-55` |
| POST | `/api/account/api-keys` | **admin** (`requireRole('admin')` + policy `api_keys_insert`) | Cria a chave e devolve o texto puro uma única vez. Rate limit 30/min por usuário. Nome ≤ 80 caracteres; `expiresInDays` clampado em 365 | `src/app/api/account/api-keys/route.ts:73,75-79,35,38,118,124-155` |
| DELETE | `/api/account/api-keys/{id}` | **admin** (`requireRole('admin')` + policy `api_keys_update`) | Revogação soft: seta `revoked_at` filtrando por conta e `revoked_at IS NULL`; zero linhas → 404 "not found or already revoked" | `src/app/api/account/api-keys/[id]/route.ts:29,43-65` |
| POST/GET | `/api/whatsapp/webhook` | Webhook da Meta (fora deste subsistema) | Única origem dos eventos de saída: chama `dispatchWebhookEvent` em quatro pontos | `src/app/api/whatsapp/webhook/route.ts:460,634,770,966` |

### Telas

| Tela (nome no menu) | Rota | Arquivo | O que tem |
|---|---|---|---|
| Configurações → **Chaves de API** | `/settings?tab=api` | `src/components/settings/api-keys-settings.tsx` | Lista das chaves (nome, prefixo, escopos como etiquetas, criada em / última utilização / expira em, selos **Revogada** e **Expirada**), botão **Nova chave de API** e botão **Revogar**, ambos dentro de `<RequireRole min="admin">` (`:146-151`, `:243-258`). Diálogo de criação com Nome (máx. 80) e checkboxes montados a partir de `API_SCOPES` (`:423-444`), seguido da visão de revelação única com botão **Copiar** (`:357-393`) |
| Configurações (roteador de painéis) | `/settings` | `src/app/(dashboard)/settings/page.tsx` | Mapeia a seção `api` para `<ApiKeysSettings />` (`page.tsx:87`); o mapa de painéis vai de `page.tsx:74` a `:88` e **não tem nenhuma entrada de webhooks** |
| Configurações (trilho lateral) | `/settings` | `src/components/settings/settings-sections.ts` | Registra a seção `api` no grupo **Espaço de trabalho** com ícone `KeyRound`. **Não existe seção de webhooks** |

### Arquivos-chave

| Arquivo | Papel |
|---|---|
| `src/lib/api-keys/keys.ts` | Geração, hashing e checagem estrutural da chave. Puro, sem I/O |
| `src/lib/api-keys/store.ts` | Acesso a dados do caminho de auth (service-role): `findActiveKeyByHash`, `getAccountName`, `touchLastUsed` |
| `src/lib/api-keys/scopes.ts` | Vocabulário dos 10 escopos, descrições da tela, `normalizeScopes`, `hasScope` |
| `src/lib/auth/api-context.ts` | `requireApiKey`: extrai o portador, valida formato, resolve o hash, aplica rate limit, checa escopo, devolve o contexto |
| `src/lib/api/v1/respond.ts` | Envelope público: `ApiError`, `ok`/`okList`/`fail`, `unauthorized`/`forbidden`/`badRequest`/`rateLimited`, `toApiErrorResponse` |
| `src/lib/api/v1/pagination.ts` | Paginação keyset: `parseListParams`, `encodeCursor`/`decodeCursor` (com validação anti-injeção), `keysetFilter`, `buildPage` |
| `src/lib/api/v1/contacts.ts` | Serializador de contato, `resolveAuditUserId`, `findOrCreateContact`, `setContactTags` |
| `src/lib/api/v1/conversations.ts` | Serializadores públicos de conversa e mensagem (renomeia `message_id` → `whatsapp_message_id`) |
| `src/lib/api/v1/appointments.ts` | Serializador, status válidos, `parseSlot` e `SLOT_ERROR_MESSAGE` |
| `src/lib/rate-limit.ts` | Limitador de janela fixa em memória + `rateLimitResponse` + catálogo `RATE_LIMITS` |
| `src/lib/webhooks/deliver.ts` | `dispatchWebhookEvent` / `deliverOne`: seleção de endpoints, assinatura, POST único com timeout, contabilidade de falha |
| `src/lib/webhooks/sign.ts` | `buildSignatureHeader` e `verifySignatureHeader` (esquema `t=…,v1=…`) |
| `src/lib/webhooks/ssrf.ts` | `isDeliverableUrl` / `isPrivateOrReservedIp` — guarda SSRF do alvo de entrega |
| `src/lib/webhooks/events.ts` | Vocabulário dos 4 eventos + `normalizeEvents` |
| `src/lib/webhooks/endpoints.ts` | `generateWebhookSecret`, `WEBHOOK_PUBLIC_COLUMNS`, `serializeWebhookEndpoint`, `normalizeWebhookUrl` |
| `src/lib/whatsapp/encryption.ts` | `encrypt`/`decrypt` AES-256-GCM do segredo do webhook; lê `process.env.ENCRYPTION_KEY` em `:29`, algoritmo em `:40` |
| `src/lib/flows/admin-client.ts` | `supabaseAdmin()` — cliente service-role usado por todo o caminho da API pública |
| `src/middleware.ts` | Middleware global; relevante por omissão: **não** cobre `/api/v1` |
| `docs/public-api.md` | Documentação voltada ao integrador (460 linhas). Confere no rate limit e no esquema de assinatura; **não** lista `conversation.reopened` |
| `mcp-server/src/config.ts` / `client.ts` | Servidor MCP do repositório, consumidor desta API. Por padrão só registra ferramentas de leitura; escrita e broadcast exigem `WACRM_ENABLE_WRITES` e `WACRM_ENABLE_BROADCASTS` (`config.ts:49-56`) |

### O que não foi verificado

- O estado real do banco na instância do cliente: se as migrações 026, 028, 041 e 043 foram aplicadas e se policies ou colunas foram alteradas por fora.
- Quantas instâncias o deploy real roda — o que decide se o rate limit de 120/min tem algum efeito prático.
- Nenhuma rota `/api/v1` foi exercitada em execução; tudo aqui vem de leitura de código.
- Se existe um modo sandbox com prefixo `wacrm_test_`: só o prefixo `wacrm_live_` foi procurado.
- Se algum cron reativa endpoints de webhook auto-desativados (a única reativação encontrada é o PATCH manual).
- O que acontece com `api_keys` e `webhook_endpoints` na exclusão de uma conta, além do `ON DELETE CASCADE` declarado na DDL.
- Se há rota `/api/v1` adicionada ou removida por reescrita em `next.config.ts` (o arquivo não foi aberto).
- As policies de RLS das demais tabelas tocadas pelas rotas `/api/v1` (`contacts`, `conversations`, `messages`, `broadcasts`, `broadcast_recipients`) — irrelevantes neste caminho, que usa service-role, mas não transcritas.
