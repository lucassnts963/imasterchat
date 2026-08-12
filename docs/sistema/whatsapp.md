# WhatsApp: conexão, mensagens, mídia e templates

Este é o pedaço do iMasterChat que fala com a Meta. Ele guarda (cifradas) as credenciais do número de WhatsApp Business da conta, recebe tudo o que a Meta manda — mensagens do cliente, confirmações de entrega e leitura, avisos sobre modelos de mensagem — e manda mensagens de volta: texto, foto, vídeo, documento, áudio, botões, listas, reações e modelos aprovados. Também é aqui que fica o catálogo de modelos (templates) da conta, o download seguro das mídias que o cliente enviou, e o botão "Conectar com o Facebook" que faz a conexão sem o cliente precisar copiar token nenhum. Toda comunicação usa a Graph API da Meta na versão v21.0, fixa em código.

Uma conta = um número de WhatsApp. Não existe suporte a dois números na mesma conta.

## Para que serve (visão do cliente)

O dono do negócio consegue:

- **Ligar o WhatsApp dele ao sistema.** Dois caminhos: entrar com a conta do Facebook que administra o negócio (botão "Conectar com o Facebook", quando a instalação está configurada como Tech Provider), ou colar as credenciais na mão (Phone Number ID, ID da WABA, token de acesso, token de verificação e o PIN de verificação em duas etapas).
- **Receber no sistema tudo o que o cliente manda no WhatsApp**: texto, foto, vídeo, documento, áudio, figurinha, localização, resposta a botão/lista e reação com emoji. Cada mensagem cria ou reabre uma conversa e sobe o contador de não lidas.
- **Responder pela Caixa de entrada**: escrever texto, anexar mídia, mandar uma lista ou botões para o cliente escolher, mandar um modelo aprovado, responder citando uma mensagem anterior e reagir com emoji.
- **Ver se a mensagem foi entregue e lida** — as marcações vêm da Meta e aparecem na conversa.
- **Criar e gerenciar os modelos de mensagem** (os textos que a Meta precisa aprovar antes de você poder iniciar conversa com alguém). Dá para criar, mandar para análise, editar, excluir e importar os modelos que já existem na conta da Meta.
- **Disparar campanhas** usando um modelo aprovado para muitos contatos de uma vez.
- **Baixar as fotos e arquivos que o cliente enviou** direto dentro da conversa, sem sair do sistema.

O que o cliente **não** consegue fazer aqui: usar dois números na mesma conta; escolher uma versão diferente da API da Meta; iniciar conversa por texto livre com quem não falou com ele nas últimas 24 horas (para isso existe modelo aprovado).

## Como se usa, na prática

### Conectar o número

1. Menu lateral → **Configurações** → seção **WhatsApp**.
2. Se aparecer o botão **Conectar com o Facebook**: clique, entre com a conta do Facebook que administra o negócio, escolha a conta do WhatsApp Business e o número na janela do Facebook. Ao fechar a janela, o sistema termina sozinho: guarda o token, inscreve a conta do WhatsApp no app e registra o número. Não há token para copiar.
   - Esse botão só aparece se a instalação foi publicada com `NEXT_PUBLIC_META_APP_ID` e `NEXT_PUBLIC_META_ES_CONFIG_ID`. Sem elas, só existe o caminho manual.
   - Se a conta do Facebook tiver mais de uma WABA ou mais de um número e a janela não indicar qual, o sistema **não adivinha**: devolve erro pedindo para escolher na janela do Facebook ou usar a configuração manual.
3. Caminho manual, no bloco **Credenciais da API**: preencher **Phone Number ID**, **ID da conta do WhatsApp Business (WABA)**, **Token de acesso permanente**, **Token de verificação do webhook** e, para número de produção, o **PIN de verificação em duas etapas** (6 dígitos). Clicar em **Salvar configuração**.
   - O sistema testa as credenciais na Meta **antes** de salvar. Se a Meta recusar, nada é gravado e a tela mostra o erro.
   - Sem PIN, o passo de registro é pulado de propósito (números de teste da Meta não têm PIN). A conexão fica salva, mas o recebimento de mensagens pode não estar ativo.
4. No bloco **Configuração do webhook**, copiar a **URL de callback do webhook** e colar no Painel de Apps da Meta, junto com o mesmo token de verificação digitado aqui. Inscrever o campo `messages`. Para receber avisos sobre modelos, inscrever também `message_template_status_update`, `message_template_quality_update` e `message_template_components_update` — isso é feito à mão no painel da Meta, não tem botão no sistema.
5. Botões de apoio na mesma tela:
   - **Testar conexão com a API**: pergunta à Meta se o token ainda vale.
   - **Verificar com a Meta**: diagnóstico em três checagens — o número existe e responde, a WABA está inscrita no app, e o número consta como registrado localmente. Só mostra "no ar" quando as três passam.
   - **Redefinir configuração**: apaga a configuração da conta para você digitar de novo. É a saída quando o token guardado não pode mais ser lido.

### Conversar

Menu lateral → **Caixa de entrada**. Abra a conversa e use a caixa de escrita: texto, anexo, mensagem com botões/lista, ou modelo. Reação por emoji na própria bolha da mensagem. Para citar, responda a partir da mensagem que quer citar.

A caixa de escrita fica **bloqueada** quando passaram 24 horas desde a última mensagem do cliente naquela conversa, ou quando o seu papel não permite enviar. Nesse estado, o caminho é mandar um modelo aprovado.

Para falar com alguém que ainda não tem conversa aberta: **Contatos** → abrir o contato → enviar por ali. O sistema cria a conversa.

### Modelos de mensagem

Menu lateral → **Configurações** → seção **Modelos**.

- **Novo modelo**: nome (só letras minúsculas, números e `_`), idioma, categoria (Marketing ou Utility), cabeçalho opcional (texto, imagem, vídeo ou documento), corpo, rodapé e botões. Ao salvar, o modelo é enviado para análise da Meta e entra como PENDENTE.
- **Editar**: só é permitido em modelos APROVADO, REJEITADO ou PAUSADO. Toda edição aceita pela Meta joga o modelo de volta para PENDENTE.
- **Excluir**: apaga na Meta e depois aqui.
- **Sincronizar da Meta**: importa para cá os modelos que já existem na conta da Meta (inclusive os criados em outro sistema). Não apaga nada local.
- Modelos de categoria **Autenticação** não podem ser criados nem editados pelo sistema — só pelo Gerenciador do WhatsApp da Meta, e depois trazidos com "Sincronizar da Meta".

### Campanhas

Menu lateral → **Disparos em massa** → nova campanha. A tela monta os destinatários e as variáveis por contato e dispara em lotes, sempre com modelo aprovado.

## O que dá para configurar

| Ajuste | Onde | O que muda | Exige admin |
| --- | --- | --- | --- |
| Phone Number ID, WABA ID, Token de acesso, Token de verificação, PIN de 6 dígitos | Configurações → WhatsApp | É a conexão do número. Salvar valida na Meta antes de gravar | Sim (POST exige papel admin) |
| Botão "Conectar com o Facebook" (Embedded Signup) | Configurações → WhatsApp | Conecta sem digitar credencial. Só aparece se `NEXT_PUBLIC_META_APP_ID` e `NEXT_PUBLIC_META_ES_CONFIG_ID` existirem no build | Sim |
| URL de callback do webhook (copiar) | Configurações → WhatsApp | É derivada do endereço aberto no navegador; se você acessa por um domínio diferente do público, a URL copiada sai errada | Não |
| Testar conexão / Verificar com a Meta | Configurações → WhatsApp | Só diagnóstico, não altera nada | Não |
| Redefinir configuração | Configurações → WhatsApp | Apaga a linha de configuração da conta | O botão não checa papel; quem barra é a regra de banco, que exige admin |
| Criar, editar, excluir modelo e "Sincronizar da Meta" | Configurações → Modelos | Catálogo de modelos e o que existe na Meta | Criar e sincronizar exigem admin. Editar e excluir **não checam papel na rota** — ver "Limites e pegadinhas" |
| Assinatura dos campos `message_template_status_update`, `_quality_update`, `_components_update` | Painel de Apps da Meta → WhatsApp → Configuration → Webhooks | Sem isso, aprovação/reprovação de modelo não chega sozinha; só o "Sincronizar da Meta" atualiza | Passo manual fora do sistema |
| `ENCRYPTION_KEY` (variável de ambiente) | Ambiente do servidor — 64 caracteres hexadecimais (32 bytes) | Cifra o token de acesso e o token de verificação. Trocar a chave torna ilegíveis todos os tokens já salvos | Operador da instalação |
| `META_APP_SECRET` | Ambiente do servidor | Valida a assinatura do webhook e é usada na troca de código do Embedded Signup. **Sem ela, 100% das chamadas ao webhook são recusadas** | Operador |
| `META_APP_ID` | Ambiente do servidor | Necessária para modelo com cabeçalho de imagem (o upload é vinculado ao app) e para o Embedded Signup | Operador |
| `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID` | Ambiente do servidor, lidas em tempo de **build** | Mostram ou escondem o botão de Embedded Signup. Mudar depois do build não tem efeito sem reconstruir | Operador |
| `WHATSAPP_TEMPLATES_DRY_RUN=true|1` | Ambiente do servidor | Pula toda chamada à Meta nas rotas de modelo (criar/editar/excluir). Uso em desenvolvimento e CI. No envio, grava `meta_template_id` sintético `dry-run-<uuid>` | Operador |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Ambiente do servidor | O webhook e o Embedded Signup só funcionam com o cliente de serviço | Operador |
| Versão da Graph API (v21.0) | Código: `src/lib/whatsapp/meta-api.ts:12`, `src/lib/whatsapp/embedded-signup.ts:18`, e a versão do SDK JS em `src/components/settings/embedded-signup-button.tsx:88` | Mudar exige editar código em três lugares | Desenvolvedor |
| Limites das mensagens interativas (3 botões, 10 linhas, tamanhos) | Código: `src/lib/whatsapp/meta-api.ts:723-733` | Validados antes de chamar a Meta | Desenvolvedor |
| Limites de modelo (corpo 1024, rodapé 60, cabeçalho de texto 60, 10 botões, 2 URL, 1 telefone, 1 código de cópia, regex do nome) | Código: `src/lib/whatsapp/template-validators.ts:24-35` | Validados antes de chamar a Meta | Desenvolvedor |
| Limites de uso por usuário: envio 60/min, campanha 5/min, reação 120/min, ação de admin 30/min | Código: `src/lib/rate-limit.ts:116-149` | Contagem em memória, **por instância do servidor** | Desenvolvedor |
| Teto de 1000 destinatários por chamada de campanha da API pública; teto de 20 páginas no sync de modelos | Código: `src/lib/whatsapp/broadcast-core.ts:77`, `src/app/api/whatsapp/templates/sync/route.ts:170` | Corta o excedente / sinaliza `truncated` | Desenvolvedor |
| Janela de 24h e o bloqueio da caixa de escrita | Código: `src/components/inbox/message-thread.tsx:249,:255` e `message-composer.tsx:201` | **Só no navegador** — o servidor não checa | Desenvolvedor |
| Tempo máximo do webhook (60s) e cache do proxy de mídia (86400s) | Código: `src/app/api/whatsapp/webhook/route.ts:30` e `src/app/api/whatsapp/media/[mediaId]/route.ts:80` | Duração do processamento e cache do arquivo | Desenvolvedor |

## Como funciona por dentro

### Credenciais e cifragem

`whatsapp_config` guarda uma linha por conta (`account_id` é UNIQUE desde `017_account_sharing.sql:181,:326`). `access_token` e `verify_token` são sempre ciphertext produzido por `encrypt()` (`src/lib/whatsapp/encryption.ts:37-48`): AES-256-GCM, IV de 12 bytes, formato `<iv-hex>:<ct-hex>:<tag-hex>`. `decrypt()` (`:51-102`) reconhece o formato pelo número de partes — 3 partes é GCM, 2 partes é o CBC legado, só leitura; qualquer outro número lança. A chave vem de `process.env.ENCRYPTION_KEY` lida uma vez e interpretada como hex (`:29`, `:41`).

Ciphertexts CBC legados são reescritos em GCM oportunisticamente, em dois pontos, sempre em fire-and-forget: no envio de mensagem (`src/lib/whatsapp/send-message.ts:268-281`) e na verificação GET do webhook (`src/app/api/whatsapp/webhook/route.ts:146-159`).

### Webhook de entrada

`GET /api/whatsapp/webhook` é o handshake da Meta. Não usa sessão: exige `hub.mode=subscribe`, `hub.challenge` e `hub.verify_token` (`:106`), lê **todas** as linhas de `whatsapp_config` com o cliente de serviço (`:114-116`) e aceita se `decrypt(config.verify_token)` bater com o token recebido em alguma delas (`:131-141`, linhas indecifráveis são puladas em silêncio). Devolve o challenge como `text/plain` 200 (`:161-164`) ou 403 (`:167-170`).

`POST /api/whatsapp/webhook` autentica por HMAC-SHA256 do corpo **cru** no header `x-hub-signature-256`, com `META_APP_SECRET` (`src/lib/whatsapp/webhook-signature.ts:38-46`). O corpo é lido como texto antes de qualquer parse (`route.ts:184`) justamente para o HMAC bater com os bytes assinados. Sem `META_APP_SECRET` a função devolve false e tudo é recusado (`webhook-signature.ts:25-33`). Assinatura inválida devolve 401 de propósito (`route.ts:192`), para a falha aparecer no painel de entregas da Meta. A rota responde 200 `{status:'received'}` na hora e processa dentro de `after()` (`:216-224`), com `maxDuration = 60` (`:30`).

Fluxo de um `change` (`processWebhook`, `:226`):

1. Se `change.field` começa com `message_template_`, o evento é desviado para `handleTemplateWebhookChange` e o resto é pulado (`:237-243`).
2. `value.statuses` é processado primeiro (`:245-249`).
3. `if (!value.messages || !value.contacts) continue` (`:255`) — é **ou**: basta faltar um dos dois arrays para o bloco de mensagens ser abandonado. Um payload com `messages` mas sem `contacts` perde o conteúdo.
4. Roteamento por `value.metadata.phone_number_id` contra `whatsapp_config`, sem `.single()` (`:264-267`), para distinguir 0 linhas de 2+. Zero linhas: mensagem descartada e evento crítico `unknown_phone_number_id` com `accountId` nulo (`:278-293`). Duas ou mais: descartada e evento `duplicate_phone_number_id` (`:295-317`).
5. Mensagens e contatos são pareados por índice: `value.contacts[i] || value.contacts[0]` (`:323-325`).

Por mensagem (`processMessage`):

- Reação dá short-circuit antes do parse (`:643-646`): não vira mensagem, não incrementa não lidas, não toca em `last_message_text`. Emoji vazio apaga a linha; com emoji faz upsert em `message_reactions` com `onConflict 'message_id,actor_type,actor_id'` e `actor_type='customer'` (`:563-591`). Se a mensagem alvo não existe localmente, a reação é ignorada com um warn (`:551-561`).
- `parseMessageContent` por tipo: texto (`:1020-1021`); imagem (`:1023-1032`) e vídeo (`:1034-1043`) usam a legenda como texto e `media_url = /api/whatsapp/media/<id>` **só depois** de a URL ser verificada com a Meta (`verifyAndBuildUrl`, `:995-1008`) — falhou a verificação, `media_url` fica nulo; documento usa legenda ou, na falta dela, o nome do arquivo (`:1045-1055`); áudio **não extrai texto nenhum** (`:1057-1065`) — o texto só aparece se a política de áudio da conta for transcrever (`:713-723`); figurinha é gravada como `image` (`:1067-1078`, `:686-690`); localização vira um texto único juntando nome, endereço e `lat,long` com ` - ` (`:1080-1088`); interativo grava o título do botão/linha tocado em `content_text` e o id em `interactive_reply_id` (`:1093-1110`); qualquer tipo desconhecido vira `[Unsupported message type: X]` como texto (`:1112-1116`).
- O tipo gravado passa por uma allow-list em código que espelha o CHECK da tabela (`:682-690`).
- `created_at` vem do timestamp da Meta, não do relógio do servidor (`:733`). A mensagem entra com `status='delivered'` (`:732`).
- O `mime_type` recebido **não é persistido** — não existe coluna para ele (`:673-675`).
- Resposta com citação: `context.id` da Meta é traduzido para o UUID interno com escopo na mesma conversa (`:654-666`, `lookupInternalIdByMetaId` em `:518-533`); pai inexistente grava nulo.
- Contato e conversa são find-or-create (`:1163-1171`, `:1227-1233`), com `account_id` da configuração e `user_id` do admin dono dela (auditoria). Violação de unicidade por reentrega da Meta é tratada re-resolvendo a linha vencedora (`:1174-1185`, `:1237-1253`). A busca de conversa usa `order created_at ASC limit 1`, nunca `.single()` (`:1208-1222`).
- A conversa é atualizada num único update com `last_message_text` (ou `[<tipo>]`), `last_message_at`, `unread_count + 1` e o patch de reabertura (`:753-763`). Reabertura emite `conversation.reopened`; abertura emite `conversation.created` antes do short-circuit de reação (`:767-774`, `:633-638`).
- Gate de cobrança (`:797-802`): contas com billing `pending` ou `blocked` continuam recebendo e **gravando** contato, conversa e mensagem, mas perdem fluxos, automações, IA, push e as respostas da política de áudio. O envio de webhooks para o endpoint do próprio operador fica fora do gate, por decisão explícita (`:792-795`, `:966-972`).
- Se o runner de Fluxos consumiu a mensagem, os gatilhos `new_message_received` e `keyword_match` são suprimidos; `new_contact_created` e `first_inbound_message` continuam (`:862-879`). O auto-reply de IA só roda para texto não consumido por Fluxo, que não seja toque em botão e não esteja vazio (`:945-957`).

### Status de entrega

`RECIPIENT_STATUS_LADDER` e `isValidStatusTransition` (`:353-384`) definem `pending → sent → delivered → read → replied`, só para frente; `failed` só é aceito vindo de `pending` ou `sent` e é terminal. Essa escada protege **apenas** `broadcast_recipients` (`:424-443`). Em `messages`, o status da Meta é escrito verbatim para **todas** as linhas com aquele `message_id` (que não é único), sem guarda (`:397-404`). Os carimbos `sent_at`/`delivered_at`/`read_at` vêm do timestamp da Meta (`:414`, `:430-433`). Uma mensagem recebida marca como `replied` o destinatário de campanha mais recente daquele contato ainda em sent/delivered/read, escopado por conta, best-effort, com erro engolido (`:482-511`).

### Envio

O core é `src/lib/whatsapp/send-message.ts`, compartilhado pelo painel (`POST /api/whatsapp/send`) e pela API pública (`POST /api/v1/messages`). Tipos aceitos: text, template, interactive, image, video, document, audio (`send-message.ts:48-54`).

- `reply_to_message_id` só é aceito se o pai for da mesma conversa; senão 400 (`:286-309`).
- Legenda de mídia acima de 1024 caracteres é recusada antes de qualquer chamada; áudio não recebe legenda (`:168-180`).
- Envio de modelo busca a linha por `(account_id, name, language || 'en_US')`; se ela existir mas estiver malformada, o envio falha com `template_malformed` pedindo "Sincronizar da Meta", em vez de estourar (`:313-330`, guard em `src/lib/whatsapp/template-row-guard.ts`).
- Erro 131030 da Meta ("recipient not in allowed list") dispara tentativa com variantes do telefone — inserindo/removendo o 0 de tronco depois do código de país de 1 a 3 dígitos (`phone-utils.ts:64-95`) — e, se uma funcionar, **grava o telefone corrigido no contato** (`send-message.ts:404-441`). Qualquer outro erro da Meta aborta o loop e vira `SendMessageError('meta_error', …, 502)` (`:413-418`, `:426-431`).
- Mensagem interativa persiste o body em `content_text` (para o preview da lista) e o payload inteiro em `interactive_payload` (`:448-462`).
- Depois de gravar, o envio atualiza `last_message_text`/`last_message_at` da conversa (`:483-490`) e pausa todos os `flow_runs` ativos daquele contato com `status='paused_by_agent'` e `end_reason='agent_replied'`, usando o cliente de serviço (`:494-513`).

`src/lib/whatsapp/meta-api.ts` concentra toda chamada à Graph API v21.0 (`:12-13`) e toda função recebe **um objeto de parâmetros nomeados**, decisão tomada depois de quatro bugs de argumentos trocados (`:1-10`). Detalhes que mordem: em áudio não vai caption nem filename, a Meta devolveria 400 (`:300-302`); o id da mensagem é lido sempre como `data.messages[0].id`, sem checagem de existência (`:259`, `:325`, `:443`, `:703`, `:833`, `:965`); erros são desembrulhados de `data.error.message` quando o corpo é JSON, com fallback `Meta API error: <status>` (`:30-39`).

Os motores de Fluxos (`src/lib/flows/meta-send.ts`) e de Automações (`src/lib/automations/meta-send.ts`) enviam por caminhos próprios com cliente de serviço, reusando `meta-api`, `encryption` e `phone-utils` — **não** passam por `/api/whatsapp/send` nem pelo core acima.

### Mídia

`GET /api/whatsapp/media/[mediaId]` faz proxy em dois passos: `getMediaUrl` pega a URL de CDN da Meta (`meta-api.ts:1006-1019`) e `downloadMedia` baixa os bytes com o Bearer da conta (`:1030-1044`); a rota devolve o binário com `Cache-Control: public, max-age=86400` (`media/[mediaId]/route.ts:68-82`). Na interface, `message-bubble.tsx:68-75` detecta o prefixo `/api/whatsapp/media/` e faz fetch autenticado convertendo em blob URL, porque a rota exige sessão e um `<img src>` cru não passaria.

### Modelos

Submissão (`POST /api/whatsapp/templates/submit`): recusa categoria Authentication (`:111-119`), valida com `validateTemplatePayload` (`:122`), curto-circuita em modo dry-run (`:130-139`), resolve o `header_handle` de imagem via Resumable Upload (`:172`) e chama `POST /{waba_id}/message_templates` (`:182-186`). Falha da Meta grava a linha local como DRAFT com `submission_error` para permitir retry, e mensagem contendo 429 vira HTTP 429 com o texto do limite de 100 criações por hora (`:191-209`). O upsert conflita por `(user_id, name, language)` (`:75`).

O `header_handle` de imagem é obtido por `src/lib/whatsapp/template-header-handle.ts`: guard de SSRF, fetch sem seguir redirects, timeout de 10s, só `image/jpeg` e `image/png`, até 5 MB (`:19-20`, `:43-45`, `:51-57`, `:65-78`). O Resumable Upload é em dois passos e o segundo usa o esquema `OAuth` (não `Bearer`) mais o header `file_offset: 0` (`meta-api.ts:483-512`).

Sync (`POST /api/whatsapp/templates/sync`): `GET /{waba_id}/message_templates?limit=100` paginado com teto de 20 páginas (`:169-196`), casando por `(account_id, name, language)` com select-then-insert/update (`:242-286`). Normaliza categoria (`:58-65`), `quality_score` (`:67-77`), botões QUICK_REPLY/URL/PHONE_NUMBER/COPY_CODE (descarta OTP e FLOW em silêncio, `:109-110`) e status. Não apaga nada local (`:21-22`, sem DELETE no loop `:202-287`). Devolve `total/inserted/updated/errors/truncated`.

Edição (`PATCH /api/whatsapp/templates/[id]`): substitui os `components` inteiros na Meta e reescreve a linha local como PENDING, limpando `submission_error` e `rejection_reason` (`:186-205`). Exige `meta_template_id` (`:102-110`) e status em {APPROVED, REJECTED, PAUSED} (`:32`, `:112-119`); recusa Authentication (`:121-129`).

Exclusão (`DELETE /api/whatsapp/templates/[id]`): passa `hsm_id = meta_template_id` (`meta-api.ts:648`) — sem isso a Meta apagaria todas as variantes de idioma daquele nome; 404 da Meta é tratado como no-op para a linha local ainda cair (`:656`). Linhas nunca submetidas pulam a chamada externa.

Eventos de ciclo de vida (`src/lib/whatsapp/template-webhook.ts`): `message_template_status_update` grava o status normalizado e, só quando REJECTED, o `rejection_reason` com default `Rejected by Meta`; qualquer outro status limpa `rejection_reason` e `submission_error`; o casamento é por `meta_template_id`, **sem filtro de conta** (`:120-138`). `message_template_quality_update` grava `quality_score` só se for GREEN/YELLOW/RED, senão nulo (`:178-187`). `message_template_components_update` **não altera nada** no banco — só escreve um log pedindo "Sincronizar da Meta" (`:208-215`). Qualquer status desconhecido, venha de onde vier, é normalizado para PENDING, assim como PENDING_REVIEW (`template-status-normalize.ts:22-28`).

Montagem do envio (`src/lib/whatsapp/template-send-builder.ts`): `header_handle` **nunca** é usado como media id — ele só vale como amostra na criação (`:101-113`); cabeçalho de texto sem variável não gera componente, com `{{1}}` exige o texto (`:79-95`); cabeçalho de mídia exige link ou id em todo envio, caindo em `header_media_url` quando o chamador não sobrescreve (`:106-123`); valores de corpo sobrando são descartados em silêncio e faltando lançam com a contagem exata (`:130-144`); botão URL com `{{1}}` exige o parâmetro (`:173-186`); botão COPY_CODE sempre gera parâmetro usando o example como padrão e botão PHONE_NUMBER nunca gera (`:155-163`, `:188-211`).

### Embedded Signup

`POST /api/whatsapp/embedded-signup` troca o `code` por token de negócio **sem** `redirect_uri` — mandar um faz a Meta recusar por redirect mismatch (`embedded-signup.ts:50-66`). Descobre a WABA por `debug_token` com app token `<appId>|<appSecret>`, lendo `granular_scopes` de `whatsapp_business_management`/`whatsapp_business_messaging` (`:102-126`). Com mais de uma WABA ou mais de um número e sem a dica do popup, devolve 409 em vez de adivinhar (`route.ts:114-122`, `:152-157`). Se outra conta já reivindicou o número, 409 `phone_number_already_claimed` (`:167-178`). Assinar a WABA e registrar o número são **não fatais**: a configuração é salva de todo jeito e a resposta traz `subscribed`/`registered` para a interface avisar (`:185-207`, `:240-249`). O upsert usa `onConflict: 'account_id'` (`:226-232`), para reconectar com outro número atualizar a linha existente.

Na interface, `embedded-signup-button.tsx` carrega o SDK do Facebook sob demanda (`:93-99`), instala um listener de `postMessage` que só aceita `https://www.facebook.com` e `https://web.facebook.com` e é removido assim que o `FB.login` retorna (`:159-186`), e chama `FB.login` com `config_id`, `response_type: 'code'` e `featureType: 'whatsapp_business_app_onboarding'` — o fluxo de **coexistência**, em que o cliente continua usando o app WhatsApp Business no celular (`:196-217`).

### Campanhas

`POST /api/whatsapp/broadcast` (painel) **não escreve nada no banco** (`:66-74`): lê a configuração e a linha do modelo, chama a Meta em loop com retry por variantes de telefone (`:187-212`) e devolve `results[]` por telefone. Aceita a forma nova `recipients:[{phone, params, messageParams}]` e a legada `phone_numbers[] + template_params[]` (`:96-114`).

`POST /api/v1/broadcasts` (API pública) usa `src/lib/whatsapp/broadcast-core.ts`: `createBroadcast` valida, aplica o teto de 1000 destinatários, deduplica por contato e grava `broadcasts` + `broadcast_recipients` como `pending`, escrevendo `total_recipients` à mão (`:205`); `deliverBroadcast` faz o fan-out e carimba `whatsapp_message_id` em cada linha (`:295-305`) — é isso que faz o webhook de status atualizar delivered/read dessas campanhas. As cinco colunas de contagem em `broadcasts` são derivadas pelo trigger, nunca escritas pelo código.

## Limites e pegadinhas

**Responder pelo inbox não assume a conversa nem cala a IA.** O envio pausa os `flow_runs` ativos do contato (`send-message.ts:494-513`), e é só isso: não escreve responsável na conversa e não desliga o auto-reply de IA. Na próxima mensagem do cliente, a IA volta a responder por cima do atendente. Quem assume de verdade é o botão "Atribuir"/"Assumir" da Caixa de entrada.

**A janela de 24 horas não é checada no servidor.** O único cálculo está no navegador, a partir da última mensagem com `sender_type='customer'` (`message-thread.tsx:242-262`), e o efeito é desabilitar a caixa de escrita (`message-composer.tsx:201`). Qualquer chamada direta às rotas de envio passa pelo servidor sem essa verificação — quem recusa, se recusar, é a Meta.

**O proxy de mídia devolve o Content-Type que veio do remetente.** `media/[mediaId]/route.ts:79` repassa o tipo sem lista de permitidos e sem `X-Content-Type-Options`, e ainda marca a resposta como `public, max-age=86400`. Um arquivo malicioso enviado por um contato pode ser servido pelo domínio do sistema com um tipo que o navegador executa (XSS armazenado). É defeito conhecido, não comportamento desejado.

**O proxy de mídia não checa a quem o arquivo pertence.** Entre a resolução do `account_id` e a chamada à Meta não há nenhuma consulta a `messages`/`conversations` (`route.ts:52-74`). Qualquer sessão com conta configurada faz proxy de qualquer `mediaId` que a Meta aceite com aquele token.

**Editar e excluir modelo não exigem papel na rota.** `PATCH` e `DELETE` de `/api/whatsapp/templates/[id]` não chamam `requireRole`; o que barra papéis abaixo de admin é a política de RLS no UPDATE/DELETE local — e a chamada à Meta acontece **antes** disso (`:167-171` antes de `:186`). Na prática, um usuário com papel viewer consegue disparar a exclusão do modelo na Meta. Defeito conhecido.

**Qualquer membro da conta lê o token cifrado.** A política `whatsapp_config_select` permite SELECT a qualquer membro, inclusive viewer (`017_account_sharing.sql:421`), e a linha inclui o ciphertext do `access_token`. A cifragem é a única barreira.

**Reconexão manual depois de um Embedded Signup deixa a origem desatualizada.** O `POST /api/whatsapp/config` não escreve `onboarded_via`, `meta_business_id`, `waba_name` nem `onboarded_at` (`config/route.ts:351-362`), então a linha continua marcada como `embedded_signup` mesmo tendo sido reconfigurada na mão.

**Se o registro falhar, a configuração é salva mesmo assim** — com `status='disconnected'`, `connected_at` e `registered_at` nulos, `last_registration_error` preenchido, e HTTP 200 com `success:false` (`:351-362`, `:399-410`). A tela mostra "não registrado"; a impressão de "salvou, então funcionou" é falsa.

**Sem PIN o registro é pulado de propósito** e a resposta traz `registration_skipped:true` (`:294-307`, `:412-422`). Isso é certo para número de teste da Meta, e é a causa mais comum de "conectei mas não chega mensagem" em número de produção.

**O registro não é refeito quando é o mesmo número e nenhum PIN novo foi enviado** (`:276-278`, `:294`) — refazer com PIN velho derrubaria a assinatura ativa.

**"Já registrado" é detectado por texto.** `registerPhoneNumber` trata como sucesso qualquer erro cuja mensagem case `/already.*registered/i` (`meta-api.ts:145-154`). Se a Meta mudar o texto do erro, isso quebra em silêncio.

**Aprovação de modelo não chega sozinha se os campos não estiverem assinados na Meta.** E `message_template_components_update` nunca atualiza o banco — mudança de conteúdo feita no WhatsApp Manager só aparece aqui depois de "Sincronizar da Meta".

**O webhook de status de modelo casa por `meta_template_id` sem filtro de conta** (`template-webhook.ts:120-138`). Em instalação multi-conta, o casamento depende de o id da Meta ser globalmente único.

**Dois critérios de unicidade para modelo.** A submissão faz upsert por `(user_id, name, language)` (`submit/route.ts:68-77`, com TODO explícito no código) e o sync casa por `(account_id, name, language)` (`sync/route.ts:242-248`). Dois membros da mesma conta podem criar linhas separadas com o mesmo nome e idioma.

**Modelos locais sem contrapartida na Meta não somem no sync** — permanecem visíveis, de propósito. Botões de tipo OTP e FLOW vindos da Meta são descartados em silêncio na importação.

**O sync trunca em 20 páginas de 100.** Acima disso a resposta vem com `truncated` e o catálogo fica incompleto.

**Um número reivindicado por mais de uma conta faz a mensagem ser descartada**, com evento crítico `duplicate_phone_number_id` (`webhook/route.ts:295-317`). Um número que não pertence a nenhuma conta também é descartado, com `unknown_phone_number_id` (`:278-293`). O sintoma para o cliente é idêntico: "parou de chegar mensagem".

**Áudio recebido não tem texto por padrão.** Sem a política de transcrição ligada, a conversa mostra só o player.

**Figurinha vira imagem** no histórico. **Localização vira uma linha de texto**, não um mapa.

**Reação não é mensagem**: não conta como não lida, não muda o resumo da conversa e não reabre nada.

**O `mime_type` da mídia recebida não é guardado.** Não existe coluna para ele.

**Um mesmo `message_id` da Meta pode existir em mais de uma linha de `messages`** — o índice não é único (`001_initial_schema.sql:178`), e o update de status escreve em todas elas.

**Conta com cobrança pendente ou bloqueada continua gravando tudo**, mas perde fluxos, automações, IA, push e transcrição de áudio (`webhook/route.ts:797-802`). O cliente vê mensagens entrando e nenhuma resposta automática.

**Os limites de uso são por instância do servidor**, contados em memória (`src/lib/rate-limit.ts:116-149`). Com mais de uma instância, o limite efetivo é maior.

**A URL do webhook mostrada na tela vem do endereço aberto no navegador** (`whatsapp-config.tsx:104-107`). Acessar por `localhost` ou por um domínio interno gera uma URL que a Meta não consegue chamar.

**`NEXT_PUBLIC_META_APP_ID` e `NEXT_PUBLIC_META_ES_CONFIG_ID` são lidas no build.** Definir depois, no ambiente de execução, não faz o botão aparecer.

**Trocar `ENCRYPTION_KEY` órfã todos os tokens salvos.** O sintoma é `token_corrupted` com `needs_reset: true` no health check (`config/route.ts:78-151`) e `credentials_unreadable` no monitoramento (`src/lib/observability/health.ts:157-181`); a saída é "Redefinir configuração" e digitar as credenciais de novo.

**A campanha disparada pelo painel não escreve destinatários no banco** (`broadcast/route.ts:66-74`). Como o casamento do webhook de status é por `whatsapp_message_id` gravado em `broadcast_recipients`, o caminho da API pública é o que produz o acompanhamento completo de entregue/lido.

O que **não existe** neste subsistema: dois números por conta; seleção de versão da Graph API pela interface; renovação automática do token do Embedded Signup (não há código de refresh no repositório); bloqueio no servidor para envio fora da janela de 24h; verificação de posse do `mediaId`; exclusão automática, no sync, de modelos que sumiram da Meta.

### O que ficou desconhecido

Estes pontos não foram confirmados e não devem virar afirmação em tutorial:

- O formato real do payload que a Meta envia: o que está documentado vem das interfaces TypeScript declaradas no repositório, não de captura de tráfego. Campos que a Meta manda e o código não declara (por exemplo `errors[]` dentro de `statuses`, `pricing`, `conversation`) não aparecem em lugar nenhum.
- Se a Meta pode mandar em `statuses` um valor fora de sending/sent/delivered/read/failed. Se mandar, o UPDATE em `messages` violaria o CHECK e só sobraria um log de erro (`webhook/route.ts:398`, `:403`).
- Se o token de negócio obtido pelo Embedded Signup expira. A migração 038 afirma que é long-lived e que a coluna de expiração foi omitida de propósito (`038:26-31`), mas não há código de renovação e a política da Meta não foi confirmada.
- Se as políticas de RLS descritas estão de fato aplicadas no banco em uso — foram lidas nos arquivos de migração, não consultadas no servidor.
- Se o índice único de `message_templates` continua por `user_id` em todas as migrações posteriores (o TODO no código diz que sim, mas não houve varredura exaustiva do DDL).
- Se um usuário com papel agent ou viewer consegue de fato disparar a edição/exclusão na Meta antes de a RLS barrar o update local — a ordem do código indica que sim, mas não foi testado em execução.
- Se existe alguma checagem de posse do `mediaId` em middleware global — `src/middleware.ts` não foi lido.
- O que exatamente a tela de campanhas grava em `broadcasts`/`broadcast_recipients` no caminho do painel, já que a rota não grava nada — a escrita tem que estar em `src/hooks/use-broadcast-sending.ts`, lido só parcialmente.
- Se a coluna `messages.ai_generated` existe (é escrita por `src/lib/flows/meta-send.ts`); a migração que a cria não foi localizada.
- Se o endereço usado como `header_media_url` de modelo é publicamente acessível pela Meta — o código só garante que não é endereço privado e que responde 2xx.

## Referência

### Tabelas

| Tabela | Para que serve | Migração de origem | Regras de acesso (estado final, 017) |
| --- | --- | --- | --- |
| `whatsapp_config` | Credenciais do número da conta: `phone_number_id`, `waba_id`, `access_token` e `verify_token` cifrados, estado de conexão/registro, origem do onboarding | `001_initial_schema.sql:190`; alterada por `013`, `015`, `017`, `038`. UNIQUE de `phone_number_id` em `013:80-82`; `account_id` UNIQUE em `017:181,:326`; `registered_at`/`subscribed_apps_at`/`last_registration_error` em `015:39-41`; `onboarded_via`/`meta_business_id`/`waba_name`/`onboarded_at` em `038:38-41,:44-47` | SELECT: qualquer membro (inclusive viewer). INSERT/UPDATE/DELETE: admin. `017:421-424` |
| `message_templates` | Catálogo local dos modelos, espelhando o estado na Meta | `001_initial_schema.sql:211`; `014_message_templates_meta_integration.sql` (colunas Meta, CHECK de status em `014:108-119`, default DRAFT em `014:124`, índice único `(user_id,name,language)` em `014:190-191`, índice parcial de `meta_template_id` em `014:196-198`); `017` (account_id + policies) | SELECT: qualquer membro. INSERT/UPDATE/DELETE: admin. `017:428-431` |
| `messages` | Uma linha por mensagem. `customer` vem do webhook, `agent` do core de envio, `bot` dos motores de fluxos/automações | `001_initial_schema.sql:163` (`sender_type` em `:166`, `status` em `:173`, índice **não único** de `message_id` em `:178`); `009_message_actions.sql:30-32` (`reply_to_message_id`); `010_flows.sql:61-66` (CHECK final de `content_type`) e `:71-72` (`interactive_reply_id`); `035_interactive_messages.sql:20-21` (`interactive_payload`) | SELECT via junção com `conversations` e membro da conta; escrita exige agent. Webhook escreve com cliente de serviço, que ignora RLS. `017:509-519` |
| `message_reactions` | Uma linha por (mensagem, ator). Reação não vira mensagem | `009_message_actions.sql:42` (tabela), `:45` (`conversation_id`), `:50` (UNIQUE `message_id, actor_type, actor_id`), `:105-114` (bloco que adiciona à publicação do Realtime, `ADD TABLE` em `:112`); policies finais em `017:572-597` | SELECT via junção com mensagem/conversa; escrita exige agent |
| `conversations` | Thread por (conta, contato). O webhook cria, reabre e atualiza resumo, data e não lidas | `001_initial_schema.sql`; `017:414-417` (policies); `036_conversation_contact_dedup.sql` (dedupe — conteúdo não lido, o índice único `(account_id, contact_id)` é citado no comentário do webhook em `route.ts:1240-1242`) | SELECT: qualquer membro. Escrita: agent |
| `contacts` | Contato do cliente. Find-or-create por telefone a cada mensagem recebida | `001_initial_schema.sql`; `017:386-389`; `022_contact_phone_dedup.sql` (conteúdo não lido) | SELECT: qualquer membro. Escrita: agent |
| `broadcasts` | Campanha por modelo. As cinco contagens são derivadas por trigger; `total_recipients` é escrito pela aplicação (`broadcast-core.ts:205`) | `001_initial_schema.sql:294`; `003_broadcast_recipient_wamid.sql` (função de recálculo `:41-63`, função do gatilho `:65-79`, trigger `:81-84`); `017:449-452` | SELECT: qualquer membro. Escrita: agent |
| `broadcast_recipients` | Destinatário de campanha; o webhook de status avança sent → delivered → read e marca `replied` | `001_initial_schema.sql:321`; `003_broadcast_recipient_wamid.sql:27-32` (`whatsapp_message_id` + índice único parcial); `017:533-541` | SELECT/escrita via junção com `broadcasts`; escrita exige agent |

### Rotas

| Método e caminho | Quem pode chamar | O que faz |
| --- | --- | --- |
| `GET /api/whatsapp/webhook` | Nenhuma sessão — autentica pelo `verify_token` cifrado de alguma configuração | Handshake de verificação da Meta; devolve o challenge em `text/plain` |
| `POST /api/whatsapp/webhook` | Nenhuma sessão — HMAC-SHA256 com `META_APP_SECRET` | Recebe mensagens, status e eventos de modelo; responde 200 na hora e processa em background |
| `GET /api/whatsapp/config` | Sessão, sem papel | Health check da conexão; devolve 200 com motivo (`no_account`, `db_error`, `no_config`, `token_corrupted`, `meta_api_error`) |
| `POST /api/whatsapp/config` | **admin** | Salva/atualiza a configuração manual; valida na Meta antes de gravar, registra o número e assina a WABA |
| `DELETE /api/whatsapp/config` | Sessão; papel admin garantido pela RLS, não pela rota | "Redefinir configuração" — apaga a linha da conta |
| `GET /api/whatsapp/config/verify-registration` | Sessão, sem papel | Diagnóstico em três checagens; sempre 200 |
| `POST /api/whatsapp/embedded-signup` | **admin** + limite de 30 ações de admin/min | Fecha o onboarding Tech Provider e grava a configuração |
| `GET /api/whatsapp/media/[mediaId]` | Sessão, sem papel e **sem checagem de posse do arquivo** | Proxy autenticado de download da mídia |
| `POST /api/whatsapp/send` | **agent** + limite de 60/min | Envio pelo painel: text, template, interactive, image, video, document, audio |
| `POST /api/whatsapp/react` | **agent** + limite de 120/min | Reação (ou remoção, com emoji vazio); recusa 400 se a mensagem alvo ainda não tem id da Meta |
| `POST /api/whatsapp/broadcast` | **agent** + limite de 5/min | Fan-out síncrono de modelo; não grava nada no banco, devolve `results[]` |
| `POST /api/whatsapp/templates/submit` | **admin** | Submete o modelo à Meta e faz upsert local |
| `POST /api/whatsapp/templates/sync` | **admin** | Importa os modelos da Meta (até 20 páginas de 100) |
| `PATCH /api/whatsapp/templates/[id]` | Sessão; **não checa papel** — a RLS só barra o update local, depois da chamada à Meta | Edita o modelo na Meta e volta o status local para PENDING |
| `DELETE /api/whatsapp/templates/[id]` | Sessão; **não checa papel** — mesma observação | Apaga na Meta (com `hsm_id`) e depois a linha local |
| `POST /api/v1/messages` | Chave de API com escopo `messages:send` | Envio pela API pública, reusando o mesmo core; resolve contato e conversa por telefone E.164 |
| `POST /api/v1/broadcasts` | Chave de API com escopo `broadcasts:send` | Campanha pela API; grava `broadcasts` + `broadcast_recipients` e carimba o id da mensagem |

### Telas

| Nome no menu | Rota | Arquivo | O que faz aqui |
| --- | --- | --- | --- |
| Configurações → WhatsApp | `/settings?tab=whatsapp` | `src/components/settings/whatsapp-config.tsx` | Formulário manual, testar conexão, verificar registro, redefinir configuração, URL do webhook, botão de Embedded Signup |
| Configurações → WhatsApp (botão) | `/settings?tab=whatsapp` | `src/components/settings/embedded-signup-button.tsx` | Carrega o SDK do Facebook, abre o popup de coexistência e envia o `code` para o servidor |
| Configurações → Modelos | `/settings?tab=templates` | `src/components/settings/template-manager.tsx` | Criar, editar, excluir e "Sincronizar da Meta" |
| Configurações (roteador) | `/settings` | `src/app/(dashboard)/settings/page.tsx` | Rail à esquerda; a seção ativa vem de `?tab=`; seções em `src/components/settings/settings-sections.ts:26-40` |
| Configurações → Visão geral | `/settings?tab=overview` | `src/components/settings/settings-overview.tsx` | Mostra o estado da conexão consultando o health check sem cache |
| Caixa de entrada (thread) | `/inbox` | `src/components/inbox/message-thread.tsx` | Envia texto, mídia, interativo e modelo; reações; calcula o timer da janela de 24h |
| Caixa de entrada (caixa de escrita) | `/inbox` | `src/components/inbox/message-composer.tsx` | Bloqueia a entrada quando o papel não permite enviar ou a janela expirou |
| Caixa de entrada (bolha) | `/inbox` | `src/components/inbox/message-bubble.tsx` | Baixa a mídia do proxy com sessão e mostra como blob |
| Disparos em massa (nova campanha) | `/broadcasts/new` | `src/hooks/use-broadcast-sending.ts` | Monta os destinatários com variáveis por contato e dispara em lotes |
| Contatos (detalhe) | `/contacts` | `src/components/contacts/contact-detail-view.tsx` | Envio a partir do contato, sem conversa prévia (usa `contact_id`) |

### Arquivos-chave

| Arquivo | Papel |
| --- | --- |
| `src/lib/whatsapp/encryption.ts` | Cifragem AES-256-GCM dos tokens e leitura do formato CBC legado |
| `src/lib/whatsapp/webhook-signature.ts` | Verificação HMAC do webhook, fail-closed sem `META_APP_SECRET` |
| `src/app/api/whatsapp/webhook/route.ts` | Webhook inteiro: verificação, roteamento por número, parse por tipo, status, reações, find-or-create, disparo de fluxos/automações/IA/push/webhooks externos |
| `src/lib/whatsapp/meta-api.ts` | Todas as chamadas à Graph API v21.0 e as constantes `INTERACTIVE_LIMITS` |
| `src/lib/whatsapp/send-message.ts` | Core de envio compartilhado pelo painel e pela API pública |
| `src/lib/whatsapp/embedded-signup.ts` | Troca de code por token, descoberta de WABA e de números |
| `src/lib/whatsapp/template-webhook.ts` | Handlers dos três eventos de ciclo de vida de modelo |
| `src/lib/whatsapp/template-status-normalize.ts` | Normalização de status (desconhecido e PENDING_REVIEW viram PENDING) |
| `src/lib/whatsapp/template-validators.ts` | Validação de modelo antes da Meta |
| `src/lib/whatsapp/template-components.ts` | Monta os componentes de criação do modelo |
| `src/lib/whatsapp/template-send-builder.ts` | Monta os componentes de envio do modelo |
| `src/lib/whatsapp/template-header-handle.ts` | Upload da amostra de cabeçalho de imagem, com guard de SSRF |
| `src/lib/whatsapp/template-row-guard.ts` | Impede que uma linha malformada derrube o construtor de componentes |
| `src/lib/whatsapp/phone-utils.ts` | Normalização de telefone, variantes com/sem 0 de tronco, detecção do erro 131030 |
| `src/lib/whatsapp/interactive.ts` | Tipos, validação e texto de preview das mensagens com botões e listas |
| `src/lib/whatsapp/broadcast-core.ts` | Criação e entrega de campanha pela API pública |
| `src/lib/whatsapp/resolve-conversation.ts` | Telefone E.164 para contato + conversa, na API pública |
| `src/lib/audio/inbound.ts` | Baixa e transcreve o áudio recebido conforme a política de áudio da conta |
| `src/lib/flows/meta-send.ts` | Envio pelo motor de Fluxos, com cliente de serviço |
| `src/lib/automations/meta-send.ts` | Envio pelo motor de Automações |
| `src/lib/observability/health.ts` | `checkWhatsApp`: distingue credencial ilegível de token recusado pela Meta |
| `supabase/migrations/017_account_sharing.sql` | Estado final da RLS deste subsistema e a troca de UNIQUE por `account_id` em `whatsapp_config` |
| `docs/tech-provider.md` | Fluxo de Embedded Signup e as variáveis de ambiente da Meta (`:57-83`) |
