# Checklist de teste de ponta a ponta — produção

Sistema: **iMasterChat** (Next.js 16 App Router, Supabase self-hosted, multi-tenant por `account_id`).
Uso: rodar **depois de cada deploy** e **antes de entregar a um cliente novo**.
Público: uma pessoa, com um celular com WhatsApp e acesso ao painel.

---

## Como usar este documento

**Legenda dos marcadores**

| Marcador | Significa |
|---|---|
| ⚡ | Faz parte do **smoke test de 25 minutos** — o subconjunto mínimo para rodar em todo deploy |
| 🔴 | **DESTRUTIVO ou visível para cliente real** — manda mensagem, escreve no banco, ou aparece na conversa de alguém. Leia a caixa "Como testar sem incomodar ninguém" antes |
| 🌐 | **Depende de terceiro** — pode falhar por fora (Meta, Google, provedor de IA, ElevenLabs, AwesomeAPI, Telegram, serviço de push do navegador). Uma falha aqui não é necessariamente bug do sistema |
| ❓ | **Não foi possível confirmar por leitura de código** — o comportamento esperado abaixo é o que o código sugere, mas ninguém observou funcionando. Trate o resultado como descoberta, não como regressão |

**Tempo total**

| | |
|---|---|
| Smoke test (só os ⚡) | **~25 min** |
| Checklist completo, primeira vez | **~4h30** |
| Checklist completo, já acostumado | **~3h** |
| Espera passiva adicional | até **1h** para a ronda de saúde fechar um ciclo (`HEALTH_EVERY_TICKS: ${HEALTH_EVERY_TICKS:-12}` × `CRON_INTERVAL_SECONDS: ${CRON_INTERVAL_SECONDS:-300}` = 1h — `deploy/docker-compose.app.yml:157` e `:146`). Comece a Fase 0 e deixe rodar enquanto faz o resto |

**Preparação obrigatória (faça antes de começar)**

- [ ] Uma **conta de teste** própria no sistema, separada da conta do cliente. Toda a Fase 4 em diante roda nela.
- [ ] Um **contato de teste**: o seu próprio celular, ou um segundo chip. Toda mensagem enviada por este checklist vai para ele.
- [ ] O celular com WhatsApp em mãos, com o número da conta de teste salvo nos contatos.
- [ ] Acesso ao servidor por SSH (as Fases 0 e 16 são de terminal).
- [ ] Acesso a `/admin` com um usuário que tenha `profiles.is_platform_admin = true` (migração 037; o link no menu só aparece quando essa flag é verdadeira — `src/components/layout/sidebar.tsx:280-295`, gate cosmético, a página e as rotas recheçam no servidor).

---

## Fase 0 — Infra: o que tem que estar de pé antes de o painel significar alguma coisa

**~10 min.** Nada abaixo depende do painel. Se algo aqui falhar, pare: o resto do checklist vai dar falso negativo.

- [ ] **⚡ Os contêineres subiram**
  **Fazer:** `docker compose -f supabase/docker/docker-compose.yml -f deploy/docker-compose.app.yml ps`
  **Esperar:** `app`, `cron` e a stack do Supabase em `running`; `app` com healthcheck `healthy` (leva ~15s).
  **Se falhar:** `docker compose logs app --tail 100`.

- [ ] **⚡ As migrações aplicaram**
  **Fazer:** `bash deploy/apply-migrations.sh`
  **Esperar:** `✓ N migrations applied`, e a última listada é a de número mais alto em `supabase/migrations/`.
  **Se falhar:** o script é quem cria a tabela `applied_migrations` (`deploy/apply-migrations.sh:92` aplica em ordem alfabética por nome de arquivo). Sem ela, a verificação de saúde `migrations` acusa `ledger_unreadable` — corretamente.

- [ ] **⚡ O cron está falando com o app** — *é a falha mais silenciosa do deploy inteiro*
  **Fazer:** `docker compose -f deploy/docker-compose.app.yml logs cron --tail 20`
  **Esperar:** a linha `[cron] every 300s; keeper every 6; health every 12` (`deploy/docker-compose.app.yml:166`).
  **Não pode aparecer:** `AUTOMATION_CRON_SECRET is empty` — quando a variável está vazia o contêiner não tenta nada, só imprime o aviso e dorme em laço de 3600s (`deploy/docker-compose.app.yml:161-165`). Nem `[cron] automations failed` / `[cron] flows failed` repetido (`:172,174`).
  **Por que importa:** `/api/flows/cron` é o **único** lugar do código que escreve `status='timed_out'` em `flow_runs` (`src/app/api/flows/cron/route.ts:90`). Sem cron, um flow abandonado segura o índice `idx_one_active_run_per_contact` e bloqueia todo gatilho futuro daquele contato; e passos `wait` de automação nunca retomam (`src/app/api/automations/cron/route.ts:34-40`).
  **Se falhar:** `AUTOMATION_CRON_SECRET` no `.env`, e `docker-compose.app.yml:57` (serviço `app`) e `:144` (serviço `cron`) precisam ler a **mesma** variável.

- [ ] **As cinco variáveis sem as quais nada funciona estão definidas**
  **Fazer:** conferir no `.env` do deploy.
  **Esperar:** `ENCRYPTION_KEY` (64 hex), `AUTOMATION_CRON_SECRET` (64 hex), `META_APP_SECRET`, `META_APP_ID`, `NEXT_PUBLIC_SITE_URL`.
  **Onde olhar:** `deploy/README.md:118-135` explica cada uma. Sem `META_APP_SECRET` o webhook rejeita **todo** POST (fail closed — `src/lib/whatsapp/webhook-signature.ts:26-33`). Sem `ENCRYPTION_KEY` correta, todo token de WhatsApp e chave de IA volta como lixo.

- [ ] **🌐 O alerta do Telegram está armado**
  **Fazer:** conferir `TELEGRAM_BOT_TOKEN` e `TELEGRAM_ALERT_CHAT_ID` (`deploy/docker-compose.app.yml:86-87`).
  **Esperar:** as duas preenchidas. Sem elas, `isTelegramConfigured()` é falso (`src/lib/observability/telegram.ts:29-30`) e nenhuma falha vira aviso — os eventos ainda vão para `platform_events`, mas ninguém é avisado.

---

## Fase 1 — Cadastro, cobrança e login

**~15 min.** Este é o caminho que **o cliente novo percorre**. Ele termina numa tela de bloqueio, por desenho.

- [ ] **⚡ 🔴 Criar uma conta nova pelo `/signup`**
  **Fazer:** abrir `/signup` numa janela anônima, com um e-mail que você controla. Marcar a caixa dos Termos.
  **Esperar:** o botão de cadastrar fica **desabilitado** enquanto a caixa não é marcada (`src/app/(auth)/signup/page.tsx:262-296`). Depois de criar a sessão, a página dispara `POST /api/terms/accept` (`:113`) e redireciona.
  **Se falhar:** `platform_events` em `/admin` → Eventos; tabela `profiles` (o trigger `handle_new_user` engole exceções — uma falha de permissão aparece como **usuário sem perfil, sem erro visível no cadastro**, `supabase/migrations/017:685`).
  **🔴 Destrutivo:** cria linha em `auth.users`, `profiles`, `accounts` e `terms_acceptances`. Não há rota nem tela para apagar uma conta — a limpeza é SQL manual (ver Fase 17).
  **❓ Não confirmado:** se o Supabase self-hosted deste ambiente exige confirmação de e-mail. `supabase/config.toml:226` tem `enable_confirmations = false`, mas esse arquivo é do stack local do CLI, não do serviço `auth` em produção. O código do signup trata os dois caminhos (`signup/page.tsx:107` e `:131`). **Confira aqui, no ambiente real.**

- [ ] **⚡ A conta nova cai na tela `/blocked`**
  **Fazer:** logo depois do cadastro, tentar abrir `/dashboard`.
  **Esperar:** redirecionamento para `/blocked`. Toda conta nova nasce com `billing_status = 'pending'` (`supabase/migrations/037_manual_billing.sql:62`) e `pending` é um dos dois estados que barram (`src/lib/billing/status.ts:35`). Quem redireciona é o layout do grupo `(dashboard)`, capturando o `PaymentRequiredError` (`src/app/(dashboard)/layout.tsx:40`).
  **Esperar na tela:** **apenas** o texto de espera e o canal de contato. **A chave PIX e o QR NÃO aparecem para conta `pending`** — só quando o status é `blocked` (`src/app/blocked/blocked-view.tsx:89`, condição `{!pending && (pixKey || qrSrc) ? (`). Se você vende dizendo "o cliente se cadastra e paga pelo PIX da tela", **isso não é o que a tela faz hoje**.
  **Se falhar:** coluna `accounts.billing_status`; `src/lib/auth/account.ts:226`.

- [ ] **⚡ Liberar a conta pelo `/admin` → aba Contas**
  **Fazer:** com o usuário platform-admin, abrir `/admin` → **Contas**, achar a conta nova, trocar o select de status para `active`.
  **Esperar:** o `PATCH /api/admin/accounts/{id}` responde ok e o cliente, ao recarregar, entra no `/dashboard`.
  **Se falhar:** essa é a **única** porta de aplicação para essas colunas — um trigger recusa qualquer escrita em `billing_status`/`paid_until`/`billing_notes` que não venha de `service_role` (`supabase/migrations/037_manual_billing.sql:114`). Se o PATCH der 403, o usuário não é platform admin (`src/app/api/admin/accounts/[accountId]/route.ts:36`).

- [ ] **⚡ Login com e-mail e senha**
  **Fazer:** sair, entrar em `/login` com a conta liberada.
  **Esperar:** cai no `/dashboard`. A navegação é de página inteira, de propósito, para os cookies novos chegarem ao middleware (`src/app/(auth)/login/page.tsx:64-75`).

- [ ] **🌐 ❓ "Esqueci a senha" — item de resultado esperado NEGATIVO**
  **Fazer:** `/forgot-password`, pedir o link.
  **Esperar hoje: NÃO CHEGA E-MAIL.** O SMTP está com os valores falsos do upstream e o fluxo falha em silêncio (`docs/pendencias.md:151-152`). Além disso, a página aponta o `redirectTo` para `/auth/callback?next=/reset-password` (`src/app/(auth)/forgot-password/page.tsx:33`) e **nenhuma dessas duas rotas existe no repositório**.
  **O que fazer:** trocar a senha do cliente pelo Supabase Studio. **Não prometa recuperação de senha por e-mail ao cliente novo** até isto ser consertado.

- [ ] **Trocar a própria senha pelo painel**
  **Fazer:** `/settings?tab=security` → trocar senha.
  **Esperar:** o formulário reautentica com a senha atual antes de chamar `updateUser` (`src/components/settings/password-form.tsx:56-67`).

- [ ] **Encerrar sessões em todos os aparelhos**
  **Fazer:** `/settings?tab=security` → encerrar sessões.
  **Esperar:** `signOut` com escopo `global` derruba a sessão de outro navegador (`src/components/settings/sessions-card.tsx:38`). Teste com dois navegadores abertos.

- [ ] **A landing e as páginas legais respondem e são indexáveis**
  **Fazer:** abrir `/`, `/termos`, `/privacidade` sem estar logado.
  **Esperar:** as três carregam. São as únicas com `robots: { index: true, follow: true }` (`src/app/termos/page.tsx:19`, `src/app/privacidade/page.tsx:20`, `src/app/page.tsx:41`). `/privacidade` tem a âncora `#exclusao-de-dados` que a Meta exige. O rodapé da landing traz razão social e CNPJ (`src/app/page.tsx:34-35`) — a Meta usa isso na verificação de negócio.

---

## Fase 2 — Equipe: convites e papéis

**~10 min.** Depende da Fase 1 (precisa de uma conta ativa e de um owner logado).

- [ ] **🔴 Criar um convite**
  **Fazer:** `/settings?tab=members` → Convidar, escolher papel `agent`, validade 7 dias.
  **Esperar:** a URL `/join/<token>` aparece **uma única vez**, com botão de copiar e um deep link de WhatsApp (`src/components/settings/invite-member-dialog.tsx:11-14`; opções de validade 1/7/30 dias em `:52-56`). Só o hash do token é gravado (`src/app/api/account/invitations/route.ts:217-249`).
  **Se falhar:** se a URL sair com domínio errado, a base vem de `NEXT_PUBLIC_SITE_URL`, senão de `X-Forwarded-Host`/`Host`, validados contra `ALLOWED_INVITE_HOSTS` quando definido (`invitations/route.ts:94-135`, `parseAllowedHosts` em `:76`).

- [ ] **Abrir o convite sem estar logado**
  **Fazer:** colar a URL numa janela anônima.
  **Esperar:** a página mostra o nome da conta e o papel **antes** de qualquer login, e **não resgata sozinha** (`src/app/join/[token]/page.tsx:19-22`). Isso vem do `GET /api/invitations/[token]/peek`, que é público de propósito (RPC `SECURITY DEFINER` com GRANT para `anon`, `supabase/migrations/019:89`), com rate limit de 30/min por IP.

- [ ] **🔴 Resgatar o convite com um segundo usuário**
  **Fazer:** criar/logar outro usuário e aceitar.
  **Esperar:** entra na conta com papel `agent`. O resgate funciona mesmo se a conta pessoal do convidado estiver `pending`, porque a rota valida a sessão com `supabase.auth.getUser()` em vez de `getCurrentAccount()` — e portanto **não sofre o gate 402** (`src/app/api/invitations/[token]/redeem/route.ts:88`).
  **Se falhar:** 409 abre um modal bloqueante com a opção "sair e usar outro e-mail" (`join/[token]/page.tsx:176-181, 355-405`).

- [ ] **Os papéis realmente limitam**
  **Fazer:** logado como o `agent` recém-convidado, abrir `/settings?tab=members`.
  **Esperar:** sem select de papel, sem botão de remover (`src/components/settings/members-tab.tsx:414, 455`), e o **e-mail dos outros membros vem `null`** — o servidor só o devolve para admin+ (`src/app/api/account/members/route.ts:50, 61`).
  **Onde olhar se um `agent` conseguir algo que não devia:** `src/lib/auth/roles.ts` e as policies de `supabase/migrations/017`.

- [ ] **❓ Transferir a propriedade — sem tela**
  **Esperar:** `POST /api/account/transfer-ownership` existe e funciona, mas **não há nenhum fluxo de UI que a chame**. Só por curl/console. Se for prometer isso a um cliente, teste por curl agora.

---

## Fase 3 — Conexão do WhatsApp

**~15 min. 🌐 Depende inteiramente da Meta.** Sem esta fase, tudo da Fase 4 em diante é impossível.

- [ ] **⚡ 🌐 Conectar o número** (manual ou Cadastro Incorporado)
  **Fazer:** `/settings?tab=whatsapp`. Ou preencher Phone Number ID, WABA ID, Access Token, Verify Token e PIN de 6 dígitos (`src/components/settings/whatsapp-config.tsx:78-82`), ou clicar no botão de Cadastro Incorporado — que só aparece se `NEXT_PUBLIC_META_APP_ID` e `NEXT_PUBLIC_META_ES_CONFIG_ID` existirem (`whatsapp-config.tsx:573`).
  **Esperar:** salvar responde ok. O servidor verifica as credenciais na Meta **antes** de gravar (`src/app/api/whatsapp/config/route.ts:236-247`), cifra `access_token` e `verify_token` (`:253-254`), tenta `POST /{phone}/register` quando há PIN (`:295-325`) e `POST /{waba_id}/subscribed_apps` quando há WABA (`:331-346`).
  **Se der 409:** outro `account_id` já reivindicou esse `phone_number_id` (`:208-231`).
  **Se o popup do Cadastro Incorporado não abrir sem erro nenhum:** `META_APP_ID` e o `NEXT_PUBLIC_META_APP_ID` derivado dele divergiram (`deploy/README.md:141-144`).
  **⚠️ Buraco de segurança conhecido:** `POST /api/whatsapp/config` **não checa papel nenhum** — qualquer membro, inclusive `viewer`, pode trocar o token da conta inteira (`docs/pendencias.md:14-25`). A rota irmã `/api/whatsapp/embedded-signup` exige admin (`:41`). Vale testar com um `viewer` e registrar.

- [ ] **⚡ 🌐 Testar conexão**
  **Fazer:** botão **Testar conexão** (`whatsapp-config.tsx:295`).
  **Esperar:** verde. A rota decifra o token e chama `GET /{phone_number_id}` na Meta (`src/app/api/whatsapp/config/route.ts:78-151`).
  **Se falhar, leia o `reason`:** `no_config` (nunca salvou), `token_corrupted` + `needs_reset:true` (o `ENCRYPTION_KEY` mudou desde que salvou — use **Resetar configuração**, `whatsapp-config.tsx:355`, e refaça), `meta_api_error` (é a Meta), `db_error`.

- [ ] **🌐 Verificar registro**
  **Fazer:** botão **Verificar registro** (`whatsapp-config.tsx:326`).
  **Esperar:** três checagens verdes — `phone_metadata_ok`, `waba_subscribed_to_app` e `locally_marked_registered`; `live` é o E dos três (`src/app/api/whatsapp/config/verify-registration/route.ts:143-146`).

- [ ] **⚡ 🌐 O webhook está registrado na Meta e o handshake passa**
  **Fazer:** copiar a URL do webhook da tela (`whatsapp-config.tsx:104-107`) e conferir no painel da Meta que é exatamente ela. Se precisar reverificar, a Meta faz um GET.
  **Esperar:** 200 com o challenge em texto puro. O handshake percorre **todas** as linhas de `whatsapp_config` e aceita se `decrypt(verify_token)` bater com alguma (`src/app/api/whatsapp/webhook/route.ts:106, 114-116, 134, 161-164`).
  **Se falhar:** 403 `Verification token mismatch` (`:167-170`). Se nem chega ao app, o problema está **antes**: DNS, TLS, ou algo bloqueando a Meta na borda — ver a seção de Cloudflare em `docs/seguranca.md`.

---

## Fase 4 — Receber e enviar mensagem (o teste que nenhum outro substitui)

**~15 min.** Tudo daqui para baixo pressupõe esta fase verde.

- [ ] **⚡ 🔴 🌐 Mandar uma mensagem do celular para o número da conta**
  **Fazer:** do seu celular, mandar `oi teste <hora>` para o número conectado.
  **Esperar:** em segundos, a conversa aparece em `/inbox` (Realtime), com o contato criado automaticamente pelo telefone.
  **Se não aparecer:**
  1. `/admin` → Eventos: procure `unknown_phone_number_id`. Se aparecer, o `phone_number_id` do painel da Meta não é o que está salvo.
  2. Se **não houver evento nenhum**, o POST não chegou ao app — problema de borda, ou assinatura recusada (401 quando o HMAC do corpo cru não bate contra `x-hub-signature-256`, `src/app/api/whatsapp/webhook/route.ts:192`).
  3. Armadilha conhecida: se o payload trouxer `messages` **sem** o array `contacts` (ou vice-versa), o change inteiro é descartado — a condição é OU, não E (`webhook/route.ts:255`, `if (!value.messages || !value.contacts) continue`).
  **🔴:** essa mensagem existe de verdade na sua conversa de WhatsApp. Use o seu próprio número.

- [ ] **⚡ 🔴 🌐 Responder pelo painel**
  **Fazer:** no `/inbox`, escrever e enviar.
  **Esperar:** chega no celular; a bolha vai para `sent` e depois `delivered`/`read` conforme a Meta manda os status.
  **Se o compositor estiver travado:** ou o papel não pode enviar, ou a janela de 24h expirou — `inputsDisabled = readOnly || sessionExpired` (`src/components/inbox/message-composer.tsx:201`), e o timer de 24h é calculado a partir da **última mensagem do cliente** (`src/components/inbox/message-thread.tsx:238-262`).
  **❓ Ressalva:** não existe nenhuma checagem de janela de 24h **no servidor** — a única é do cliente. Se a Meta rejeitar, o erro vem dela.

- [ ] **🔴 Enviar mídia (imagem) e conferir que ela abre**
  **Fazer:** enviar uma imagem pelo compositor; depois mandar uma imagem **do celular para o painel** e abrir a bolha.
  **Esperar:** a mídia recebida abre. A bolha faz fetch autenticado e converte em blob URL porque a rota exige sessão (`src/components/inbox/message-bubble.tsx:68-75`); o proxy é `/api/whatsapp/media/<mediaId>` (`src/app/api/whatsapp/media/[mediaId]/route.ts:68-82`).
  **⚠️ Registrar:** essa rota **não verifica** que o `mediaId` pertence a alguma conversa da conta — só que há sessão (`whatsapp.json` / GAPS). Qualquer usuário logado de qualquer conta pode baixar qualquer mídia cujo id conheça.

- [ ] **Status, atribuição e presença**
  **Fazer:** no cabeçalho da conversa, mudar o Status (open/pending/closed) e usar **Atribuir** para pôr a conversa num segundo membro.
  **Esperar:** o dropdown de Atribuir mostra bolinha de presença por membro (`src/components/inbox/message-thread.tsx:1001-1064`); abrir a conversa zera `unread_count` (`:436-446`).
  **Nota para não confundir:** **não existe** filtro "atribuídas a mim" nem coluna de dono na lista (`src/components/inbox/conversation-list.tsx:48`).

- [ ] **Reagir a uma mensagem**
  **Fazer:** hover na bolha → reagir com um emoji; depois remover.
  **Esperar:** a reação vai para a Meta e é espelhada em `message_reactions` como `actor_type='agent'` (`src/app/api/whatsapp/react/route.ts:127-163`). Emoji vazio apaga.
  **Se der 400:** a mensagem alvo ainda não tem `message_id` da Meta (`:58-65`).

- [ ] **Respostas rápidas**
  **Fazer:** criar um snippet em `/settings?tab=quick-replies`, depois usá-lo no compositor.
  **Esperar:** o snippet aparece no picker e cai no compositor.

---

## Fase 5 — CRM: contatos, tags, campos, funil

**~15 min.** Depende da Fase 4 (o contato de teste já nasceu do WhatsApp).

- [ ] **O contato nasceu sozinho e tem o nome do perfil do WhatsApp**
  **Fazer:** `/contacts`, procurar o número do teste.
  **Esperar:** existe, com nome. É o webhook que acha-ou-cria por telefone e atualiza o nome do perfil (`src/app/api/whatsapp/webhook/route.ts`, subsistema CRM).

- [ ] **A deduplicação por telefone segura**
  **Fazer:** `/contacts` → Adicionar contato, com o **mesmo** telefone do contato de teste.
  **Esperar:** o diálogo detecta o duplicado no blur e **bloqueia o exato** (avisa nos parecidos) — `src/components/contacts/contact-form.tsx`. No banco, o backstop é o índice único parcial `idx_contacts_account_phone_normalized` (migração 022).
  **❓ Verifique antes de prometer:** ninguém confirmou que esse índice existe de fato nesta base — a 022 é idempotente, mas se falhou no meio do merge de duplicatas o índice pode não ter sido criado. Confira com `\d contacts`.

- [ ] **Tag manual dispara a automação `tag_added`; tag por CSV NÃO**
  **Fazer:** criar uma tag em `/settings?tab=fields`, aplicá-la ao contato pela ficha em `/contacts`.
  **Esperar:** o vínculo é criado e o gatilho `tag_added` dispara — só quando o vínculo é **novo** (`addContactTagAndDispatch`).
  **⚠️ Armadilha para não prometer errado:** existem **cinco** caminhos de escrita de tag, e a **importação de CSV não dispara nada** — ela faz `upsert` em `contact_tags` direto do navegador (`src/lib/contacts/resolve-import-tags.ts:131`, chamado por `src/components/contacts/import-modal.tsx:335`), pulando `addContactTagAndDispatch` e o `assertContactAndTagOwnership`. Se você vender "toda tag nova aciona a automação", a importação vai desmentir.

- [ ] **🔴 Importar um CSV pequeno**
  **Fazer:** `/contacts` → Importar, com 3 linhas de teste.
  **Esperar:** prévia de 5 linhas com chips de tag, e o resumo final (importados / com tags / ignorados / falhos).
  **🔴:** cria contatos reais. Use telefones de teste que você controla, **não** uma lista real do cliente.

- [ ] **Campos personalizados**
  **Fazer:** criar um campo em `/settings?tab=fields`, preenchê-lo na ficha do contato.
  **Esperar:** salva e aparece na ficha.

- [ ] **Funil de vendas**
  **Fazer:** `/pipelines` → **Adicionar funil** (`src/app/(dashboard)/pipelines/page.tsx:270-274`), criar um negócio, arrastar de estágio.
  **Esperar:** o card move e a soma da coluna muda. O arraste tem tolerância de 5px para não engolir o clique (`src/components/pipelines/pipeline-board.tsx:58-64` + `deal-card.tsx:35-41`); há suporte a teclado pelo `KeyboardSensor` aplicado ao wrapper arrastável (`pipeline-board.tsx:58-64` e `:279-287`).
  **⚠️ Assimetria de permissão para testar:** o botão **Adicionar funil** é gated por papel na UI (`pipelines/page.tsx:370-374`, admin+). O diálogo **Gerenciar funis** **não é** — um `agent`/`viewer` consegue abrir e clicar em Salvar/Excluir; quem recusa é a RLS (`017:436-438` e `017:526-530`), com **toast de erro genérico**. Teste com um `agent` e veja se a mensagem é aceitável para o cliente.

---

## Fase 6 — O agente de IA respondendo

**~20 min. 🌐 Depende do provedor de IA (chave BYO do cliente).**
**Ordem importa:** faça esta fase **antes** da Fase 9 (automações). Uma automação ativa com gatilho `new_message_received` ou `keyword_match` **cala o auto-reply da conta inteira** (`src/lib/ai/auto-reply.ts:75-98`, com evento `standing_down_for_automation`).

- [ ] **⚡ 🌐 Cadastrar e testar a chave**
  **Fazer:** `/agents` → aba **Configurar** → provedor, modelo, chave → **Testar chave**.
  **Esperar:** validação verde. O `POST /api/ai/test` valida contra o provedor **sem salvar** (`src/app/api/ai/test/route.ts:17`). Ao salvar, o `POST /api/ai/config` revalida antes de gravar e cifra a chave (`src/app/api/ai/config/route.ts:192-198`).
  **Se falhar:** a resposta distingue chave inválida de cota estourada. A rota `DELETE /api/ai/config` existe para recuperar de chave cifrada corrompida (`:394`).

- [ ] **⚡ 🌐 Ensaiar no Playground (não toca em cliente nenhum)**
  **Fazer:** `/agents` → **Playground** → mandar uma pergunta típica do negócio.
  **Esperar:** resposta coerente, e os passos de ferramenta do turno aparecem embaixo.
  **O que o Playground NÃO exercita — e por isso não substitui o teste real:** ele roda com `ctx.dryRun = true` (as ferramentas validam e relatam sem escrever, `src/app/api/ai/playground/route.ts:142`) e **não passa os guardrails de assunto** para o prompt (`:109-115`). Um ensaio nunca vai bater num tópico proibido.
  **Auth:** exige `requireRole('agent')` (`:37`) — um `viewer` recebe 403.

- [ ] **Conferir o que o modelo realmente lê**
  **Fazer:** `/agents` → aba **Contexto**.
  **Esperar:** o prompt seção por seção, com contagem de tokens, incluindo `vault` e `guardrails` (`src/lib/ai/context-preview.ts:122-140`).
  **❓ Limitação conhecida:** o `GET /api/ai/context` aceita `?conversation_id=`, mas a tela não usa — **o transcript aparece sempre vazio** (`docs/pendencias.md:49-52`). Não é regressão.

- [ ] **⚡ 🔴 🌐 O agente respondendo de verdade, pelo WhatsApp**
  **Fazer:** ligar o auto-reply na aba Configurar. Do celular, mandar uma pergunta que o negócio saberia responder.
  **Esperar:** a resposta chega **no celular**, e a bolha no painel tem o selo **AI** (`src/components/inbox/message-bubble.tsx:321`, `message.ai_generated`).
  **Único disparador em produção:** o webhook, dentro do `after()`, quando `sideEffectsAllowed && !flowConsumed && !interactiveReplyId && inboundText.trim()` (`src/app/api/whatsapp/webhook/route.ts:945-957`).
  **Se não responder, na ordem:** (1) a conta está `pending`/`blocked`? o gate é `webhook/route.ts:797`; (2) tem automação ativa de `new_message_received`/`keyword_match`? veja o evento `standing_down_for_automation` em `/admin` → Eventos; (3) tem flow ativo que consumiu a mensagem? `/flows/[id]/runs`; (4) `ai_usage_log` registrou a chamada? (5) `/admin` → Eventos, procurando erro do provedor.

- [ ] **⚡ 🔴 🌐 O guardrail de palavra-chave transfere para humano, sem gastar token**
  **Fazer:** do celular, mandar `quero falar com meu advogado`.
  **Esperar:** o bot **não responde**. A conversa vira `pending`, `ai_autoreply_disabled=true`, e a tarja do inbox mostra a nota `🤖 Regra de segurança acionada: …` (`src/lib/ai/guardrails.ts:210-212`; handoff em `src/lib/conversations/handoff.ts:109-118`).
  **Por que `advogado`:** é um dos 3 keywords semeados por padrão, junto de `procon` e `processar` — mais 5 topics (`src/lib/ai/guardrails.ts:46-87`), semeados na primeira leitura da tela de guardrails (`src/app/api/ai/guardrails/route.ts:38-59`).
  **Cuidado ao interpretar:** o casamento é por **fronteira de palavra** sobre texto normalizado sem acento — `advogado` pega em "chamar meu advogado", mas `caro` **não** pega em "carro" (`guardrails.ts:154-184`).
  **O cliente não recebe aviso nenhum** nesse caminho: o handoff por keyword retorna antes do bloco que envia o aviso (`src/lib/ai/auto-reply.ts:162` vs `:297-313`).

- [ ] **Assumir e devolver a conversa**
  **Fazer:** na tarja do inbox, clicar **Assumir**, depois **Retomar IA**.
  **Esperar:** Assumir pausa o bot e põe a conversa em você; **Retomar IA zera o `assigned_agent_id` — de qualquer dono, não só do seu** —, zera `ai_reply_count` e apaga `ai_handoff_summary` (`src/app/api/ai/autoreply/[conversationId]/route.ts:65-84`). Avise a equipe: retomar a IA **desatribui**.
  **Rate limit:** balde próprio `ai-takeover:{userId}`, com o mesmo orçamento do envio (60/min) mas contador separado — clicar em Assumir **não** consome sua cota de envio (`autoreply/route.ts:33` vs `whatsapp/send/route.ts:39`).

- [ ] **Rascunho com IA no compositor**
  **Fazer:** botão de rascunho na caixa de escrita (`src/components/inbox/message-composer.tsx:272`).
  **Esperar:** texto sugerido no compositor, **sem enviar**. Uma chamada só, sem ferramentas, sem ambiente/vault/guardrails — só o prompt do operador + base de conhecimento (`src/app/api/ai/draft/route.ts:104-110`).

- [ ] **Custo e uso**
  **Fazer:** `/agents` → aba **Uso** (só aparece para quem tem `canEditSettings` — `src/app/(dashboard)/agents/page.tsx:49` e `:106`), e o card de custo no `/dashboard`.
  **Esperar:** números coerentes com as chamadas que você acabou de fazer.
  **⚠️ Diga ao cliente:** `ai_configs.monthly_budget_usd` é gravado, exibido e usado na projeção, mas **nenhum código impede o gasto quando estoura** — é só leitura (`docs/pendencias.md:137-143`).

---

## Fase 7 — Áudio: as quatro políticas

**~25 min.** Depende da Fase 4. Onde tudo se configura: `/agents` → aba **Regras** (`src/components/agents/ai-rules.tsx`), que salva por `PATCH /api/ai/config` (`src/app/api/ai/config/route.ts:315`).

**Como é o teste, para as quatro:** trocar a política na aba Regras, mandar **um áudio curto pelo celular**, observar. Repetir. 🔴 As políticas `notice` e `handoff` **enviam ou marcam algo visível** — use só o seu número.

**Antes de começar, dois fatos que decidem o resultado:**
- O padrão de toda conta é `ignore` — **nenhuma conta começa a falar sozinha depois de um deploy** (`src/lib/audio/policy.ts:11-16`; `supabase/migrations/061_audio_policy.sql:41`, `DEFAULT 'ignore'`).
- **Só `transcribe` toca a rede.** As outras três decidem sem baixar áudio nem chamar provedor (`src/lib/audio/inbound.ts:75-77`).

- [ ] **Política `ignore`**
  **Fazer:** deixar em `ignore`, mandar um áudio.
  **Esperar:** a mensagem entra no inbox como bolha de áudio tocável (`<audio controls>` apontando para o proxy, `src/components/inbox/message-bubble.tsx:167-173`), e **nada mais acontece** — nenhuma resposta, nenhum handoff. A linha nasce com `content_text` nulo (`webhook/route.ts:1057-1065` e `:1013`).

- [ ] **🔴 Política `notice`**
  **Fazer:** trocar para `notice`, mandar um áudio.
  **Esperar:** o cliente **recebe uma mensagem de texto**. Se `audio_notice_text` estiver vazio, o texto é exatamente *"Recebi seu áudio! Para eu te ajudar mais rápido, pode me escrever o que você precisa?"* (`src/lib/audio/policy.ts:33-34`, usado em `src/lib/audio/side-effect.ts:59`).
  **Também teste:** escrever um texto próprio na aba Regras (cortado em 300 chars, `config/route.ts:335-340`) e conferir que é ele que chega.

- [ ] **🌐 Política `transcribe` — provedor local (Whisper na VPS)**
  **Fazer:** escolher `transcribe` + provedor **local**. Mandar um áudio dizendo algo específico e verificável ("quero marcar para quinta às três").
  **Esperar:** o texto transcrito aparece como `content_text` da própria bolha de áudio, **antes** do INSERT — por isso guardrails, contexto e keyword_match enxergam o texto (`webhook/route.ts:712-721` e `:729`). No prompt do modelo ele chega prefixado com `[transcrição de áudio] ` (`src/lib/ai/context.ts:100`).
  **Se vier vazio, na ordem:** (1) `WHISPER_URL` está definida? O provedor local sem ela loga `[audio] provedor local escolhido sem WHISPER_URL` (`src/lib/audio/transcribe.ts:129-131`). Atenção: essa variável **não está no `.env.local.example`** — só em `deploy/README.md:199` e `deploy/docker-compose.app.yml:74`. (2) O serviço subiu? Ele está atrás de um profile: `docker compose ... --profile whisper up -d` (`deploy/docker-compose.app.yml:196-204`). (3) `docker compose logs whisper` — o modelo baixa ~500 MB na primeira vez, e sem o volume isso se repete a cada recriação.
  **Limites que explicam um silêncio:** timeout de 120s e teto de 25 MB, ambos virando `null` sem lançar (`transcribe.ts:48, 45, 53-59, 68-73`). O Whisper transcreve **um por vez** (mutex de classe): 1 pedido = 5,3s, 2 = 10,3s, 4 = 21,0s (`docs/whisper-escala.md:49-55`) — o 23º áudio simultâneo estoura o timeout, e o sintoma para o cliente é o aviso "pode escrever?", não um erro (`docs/whisper-escala.md:78-87`).
  **❓ Ressalva do próprio estudo:** a medição usou áudio sintético (tom + ruído), vale como ordem de grandeza (`docs/whisper-escala.md:65-69`).

- [ ] **🌐 Política `transcribe` — provedor ElevenLabs**
  **Fazer:** na aba Regras, trocar o provedor para **elevenlabs** e colar a chave. Mandar outro áudio.
  **Esperar:** transcrição igual, sem depender do contêiner local.
  **Detalhe do campo:** qualquer valor que **não seja exatamente** a string `elevenlabs` colapsa para `local` — inclusive nulo (`src/lib/audio/inbound.ts:79-82`; `config/route.ts:331-334`). Chave vazia **apaga** a credencial; campo ausente não mexe (`config/route.ts:348-356`).
  **⚠️ ❓ Não confirmado:** ninguém achou escrita em tabela de custo/uso dentro de `src/lib/audio/*` — **o minuto da ElevenLabs aparentemente não aparece em Agentes → Uso**. Se for cobrar do cliente por isso, meça por fora.

- [ ] **🔴 Política `handoff`**
  **Fazer:** trocar para `handoff`, mandar um áudio.
  **Esperar:** a conversa é transferida para uma pessoa, **sem atribuir a ninguém**, com o resumo fixo *"O cliente mandou um áudio e esta conta está configurada para passar áudio direto para uma pessoa. Ouça a mensagem na conversa."* (`src/lib/audio/side-effect.ts:36-44`). O cliente **não** recebe mensagem.

- [ ] **Áudio de saída (nota de voz da atendente)**
  **Fazer:** gravar e enviar um áudio pelo compositor.
  **Esperar:** chega no celular. Não passa por `src/lib/audio/*` — é gravado em Ogg/Opus no próprio navegador com `opus-recorder`, teto de 5 minutos e 16 MB (`src/components/inbox/message-composer.tsx:468-475`, `:76`, `:441`).

- [ ] **Devolver a política ao valor do cliente antes de sair da fase.**

**Dois fatos para não interpretar mal um resultado:**
- Um `audio_policy` desconhecido no banco (ou linha ausente) é tratado como `ignore` (`inbound.ts:69-71`), e qualquer falha em `handleInboundAudio` degrada para `ignore` — o webhook nunca cai por causa de áudio (`inbound.ts:55-58, 133-135`).
- **Conta bloqueada por cobrança AINDA transcreve**: `handleInboundAudio` roda na linha 714 e `sideEffectsAllowed` só é calculado na 797. O gate barra apenas o efeito (o aviso / o handoff), na 931 (`webhook/route.ts:714, 797, 930-938`). Isso é custo de CPU/ElevenLabs em conta que não paga.

---

## Fase 8 — Agendamento com Google Agenda

**~25 min. 🌐 Depende do Google.** Depende da Fase 6 (o agente precisa estar respondendo).

- [ ] **🌐 Conectar o Google**
  **Fazer:** `/settings?tab=scheduling` → **Conectar** (navegação completa para `/api/google/calendar/connect`, `src/components/settings/scheduling-settings.tsx:237-239`).
  **Esperar:** consentimento do Google e volta para `/settings?tab=scheduling` com o resultado em `?google=` e um toast (`scheduling-settings.tsx:99-104`).
  **Se der 400 `google_not_configured`:** faltam `GOOGLE_CLIENT_ID`/`SECRET`/redirect (`src/app/api/google/calendar/connect/route.ts:26-36`).
  **⚠️ "Conectado" mente:** o status é **apenas** `Boolean(data)` — existe LINHA, não que o token valha (`src/app/api/google/calendar/status/route.ts:48`). Um refresh token revogado no Google continua mostrando "conectado". A prova real é o próximo item.
  **❓ Fora do repositório:** ativar a Calendar API, tela de consentimento e publicação/verificação do app no Google Cloud Console não estão em lugar nenhum do código (`.env.local.example:150-152` só menciona). Se o cliente é novo, esses passos são seus.

- [ ] **Definir as regras de expediente**
  **Fazer:** na mesma tela: fuso, `slot_minutes`, `lead_time_minutes`, `max_advance_days`, janelas por dia, e o rótulo do compromisso (máx. 40 chars, vazio grava null) — `scheduling-settings.tsx:287-422`, salvo por **PUT** (`:110-114`).
  **⚠️ Se for chamar por script:** é **PUT** `/api/scheduling/settings`, não POST — o arquivo só exporta GET (45), PUT (93) e PATCH (168). Um POST recebe 405.
  **Esperar:** salvou. A tela avisa nos dois estados incoerentes: ativo sem calendário (`:268-273`) e calendário conectado com o interruptor desligado (`:280-285`).
  **Os três números da agenda que a IA usa** (`offer_slots_max`, `lookahead_days`, `slot_fetch_limit`) ficam em **outra** tela: `/agents` → Regras (`src/components/agents/ai-rules.tsx:339-341`), salvos por PATCH parcial justamente para não sobrescrever fuso e expediente (`:160-166`).

- [ ] **🌐 As ferramentas de agenda estão no catálogo**
  **Fazer:** `/agents` → aba Guardrails → painel de ferramentas (`src/components/agents/ai-tools.tsx`).
  **Esperar:** `book_appointment` etc. disponíveis. Se estiverem ausentes, a tela diz **por quê**, e cada motivo tem conserto em lugar diferente: `scheduling_off`, `google_disconnected`, `calendar_unusable` (`src/app/api/ai/tools/route.ts:89-108`).

- [ ] **⚡ 🌐 O agente NÃO oferece horário ocupado**
  **Fazer:** criar um evento manualmente na agenda do Google, dentro do expediente e nos próximos dias. Pelo WhatsApp, pedir horário.
  **Esperar:** o horário ocupado **não** é oferecido. A disponibilidade é calculada no servidor cruzando expediente + antecedência + horizonte + `freeBusy` do Google + as próprias linhas de `appointments`. **O modelo só escolhe qual ferramenta chamar — a legalidade do horário é decidida no servidor.**
  **Se oferecer mesmo assim:** é o teste que prova que a conexão do Google está viva (o item anterior não prova).

- [ ] **🔴 🌐 Agendar pelo bot, de ponta a ponta**
  **Fazer:** pelo WhatsApp, aceitar um horário oferecido.
  **Esperar:** (1) o evento aparece **no Google**; (2) a marcação aparece em `/agenda`; (3) o ícone de robô distingue `created_via='native'` do manual (`src/components/agenda/agenda-board.tsx:307-311`).
  **⚠️ Triângulo âmbar:** se a marcação tiver `status='scheduled'` e `google_event_id` nulo, a agenda mostra um triângulo âmbar — significa "existe aqui, mas **não** na agenda que a loja olha" (`agenda-board.tsx:286, 312-317`). É exatamente o sintoma de sincronização quebrada.

- [ ] **Marcar, remarcar e cancelar pela tela**
  **Fazer:** `/agenda` → Novo compromisso; depois abrir o detalhe, remarcar e cancelar com motivo.
  **Esperar:** marcação manual **não** passa por disponibilidade, de propósito — o atendente pode marcar fora do expediente; quem barra duplo agendamento é o banco (`src/app/api/appointments/route.ts:86-101`, três índices únicos parciais da migração 041). Se `calendar_synced === false`, aparece um `toast.warning` (`src/components/agenda/new-appointment-dialog.tsx:120-124`). Cancelados continuam visíveis, riscados, porque explicam o buraco no dia (`agenda-board.tsx:40-42`).
  **Não existe excluir, de propósito** (`src/app/api/appointments/[id]/route.ts:12-19`).

- [ ] **Desconectar o Google (se for reverter o teste)**
  **Esperar:** apaga a linha de `google_calendar_connections`, mas os `appointments` **mantêm** `google_event_id` — os eventos continuam no Google e apagar o vínculo os deixaria órfãos (`src/app/api/google/calendar/status/route.ts:62-65, 75-78`).

---

## Fase 9 — Automação

**~15 min (+ até 5 min de espera do cron).**
**⚠️ Ordem:** faça **depois** da Fase 6. Uma automação ativa com gatilho `new_message_received` ou `keyword_match` **cala o auto-reply da conta inteira** enquanto existir (`src/lib/ai/auto-reply.ts:75-98`). Desative ou apague ao terminar.

- [ ] **Criar uma automação a partir de template**
  **Fazer:** `/automations` → atalho de template (`src/app/(dashboard)/automations/page.tsx:136-138`) → `/automations/new?template=<slug>`.
  **Esperar:** o construtor abre pré-carregado. O botão de criar é gated por `useCan("send-messages")` (`automations/page.tsx:63`), que exige `agent` ou acima.

- [ ] **🔴 🌐 Ativar e disparar por palavra-chave**
  **Fazer:** montar uma automação `keyword_match` com uma palavra improvável (`zzteste`) e um passo de enviar mensagem. Ativar. Do celular, mandar `zzteste`.
  **Esperar:** a mensagem da automação chega no celular. A ativação valida gatilho e passos, e devolve 400 com a lista de problemas se algo estiver incompleto (`src/app/api/automations/route.ts:92-105`).
  **Se não rodar:** `/automations/[id]/logs` — a linha de `automation_logs` é criada **antes** de qualquer passo e **começa como `failed` de propósito**, para que uma execução interrompida não pareça sucesso (`src/lib/automations/engine.ts:192-200`). Cada linha expande e mostra `steps_executed`.
  **Se um passo falhar, o laço para ali** (break) e os seguintes não rodam (`engine.ts:336-347`).

- [ ] **🔴 O passo `wait` retoma — o teste que prova o cron**
  **Fazer:** acrescentar um passo `wait` de **1 minuto** seguido de outro envio. Disparar.
  **Esperar:** a primeira mensagem chega na hora; o log fica `partial`; e a segunda mensagem chega **depois do próximo tick do cron** (até 5 min, `CRON_INTERVAL_SECONDS` padrão 300).
  **Se a segunda nunca chegar:** o cron não está batendo. Volte ao item de cron da Fase 0. O `wait` insere linha em `automation_pending_executions` e retorna (`engine.ts:279-305`); só `/api/automations/cron` drena (`route.ts:34-40`, até 50 por chamada).
  **⚠️ Fato operacional:** nada devolve uma linha `running` para `pending`. Se o processo morrer entre a reivindicação e o fim da retomada, **aquela pendência nunca mais é processada** (`automations/cron/route.ts:37, 49`). E **não existe tela** que mostre pendências ao cliente — só `automation_logs`.
  **⚠️ Outro:** o cron **não** consulta o gate de cobrança. Uma automação que enfileirou um `wait` antes do bloqueio **retoma e envia** mesmo com a conta bloqueada.

- [ ] **Disparo manual (para gatilhos que não vêm de mensagem)**
  **Fazer:** `POST /api/automations/engine` com `trigger_type`/`contact_id` (auth de sessão, `requireRole('agent')`, `src/app/api/automations/engine/route.ts:16`).
  **Esperar:** roda. É o **único** caminho pelo qual `time_based` e `conversation_assigned` podem rodar.

- [ ] **🔴 Desativar ou apagar a automação de teste antes de seguir.** (Apagar leva passos, logs e pendências em cascata.)

---

## Fase 10 — Flow (chatbot conversacional)

**~15 min.** Marcado como **Beta** na sidebar.
**⚠️ Interação:** quando um flow consome a mensagem, o webhook **suprime** os gatilhos de conteúdo `new_message_received`, `keyword_match` e `interactive_reply` — mas mantém `new_contact_created` e `first_inbound_message` (`src/app/api/whatsapp/webhook/route.ts:859-880`). E flows são decididos **antes** de automações.

- [ ] **Criar um flow a partir de template e ativar**
  **Fazer:** `/flows` → criar de template → editar → **Ativar**.
  **Esperar:** ativação só passa se `validateFlowForActivation` não achar nenhum problema de severidade `error`; senão vem **422 com a lista** (`src/app/api/flows/[id]/activate/route.ts:68-107`). Rascunho e arquivamento são incondicionais.

- [ ] **🔴 🌐 Rodar o flow pelo WhatsApp**
  **Fazer:** do celular, mandar a palavra-gatilho do flow. Responder à pergunta dele.
  **Esperar:** o flow avança nó a nó e as mensagens chegam no celular.
  **Se não iniciar:** (1) **só mensagens de TEXTO** casam com gatilho de entrada — resposta interativa nunca inicia flow novo (`src/lib/flows/engine.ts:320-321`); (2) com vários flows ativos, vence o **mais antigo** por `created_at` (`engine.ts:326-348`); (3) o gatilho `manual` nunca inicia nada a partir de mensagem, e **não existe rota que inicie um run manualmente** (`engine.ts:346`).
  **Onde olhar:** `/flows/[id]/runs` — os 50 runs mais recentes, cada linha expandindo para a linha do tempo de `flow_run_events`. É a tela que responde "por que meu flow não avançou".

- [ ] **⚠️ O run ativo bloqueia o contato — confirme que o cron o aposenta**
  **Fazer:** abandonar o flow no meio (não responder) e conferir mais tarde.
  **Esperar:** depois de `on_timeout_hours` da política de fallback, `/api/flows/cron` marca o run como `timed_out` com `end_reason='stale_sweep'` e grava um evento `timeout` (`src/app/api/flows/cron/route.ts:87-108`).
  **Por que importa:** o índice `idx_one_active_run_per_contact` é UNIQUE `(account_id, contact_id) WHERE status='active'`. Enquanto o run vive, aquele contato **não dispara mais nada**. Sem cron, ele fica preso.
  **Para desbloquear na hora durante o teste:** apagar o flow (`DELETE /api/flows/[id]`) — o CASCADE leva nós, runs e eventos, e o índice parcial libera o contato (`src/app/api/flows/[id]/route.ts:203-207`).

- [ ] **Envio manual pausa o flow**
  **Fazer:** com um run ativo, responder ao contato pelo compositor do inbox.
  **Esperar:** o run ativo daquele contato é **pausado** (`src/lib/whatsapp/send-message.ts:492-505`). Isso vale também para `POST /api/v1/messages`, que usa o mesmo núcleo.

- [ ] **🔴 Arquivar ou apagar o flow de teste.**

---

## Fase 11 — Templates e disparo em massa

**~15 min. 🌐 Meta.** Depende da Fase 3.

- [ ] **🌐 Sincronizar os templates da Meta**
  **Fazer:** `/settings?tab=templates` → **Sync from Meta**.
  **Esperar:** o catálogo local espelha o da Meta. Pagina de 100 em 100, teto de 20 páginas, e devolve `truncated` se bateu o teto (`src/app/api/whatsapp/templates/sync/route.ts:170-196`). **Templates só locais NÃO são apagados** (`:21-22`).

- [ ] **🌐 Submeter um template novo**
  **Fazer:** criar um template simples e submeter (`requireRole('admin')`, `src/app/api/whatsapp/templates/submit/route.ts:102`).
  **Esperar:** vira `PENDING` local e vai para aprovação da Meta.
  **🔴 Como testar sem sujar a conta da Meta:** ligue `WHATSAPP_TEMPLATES_DRY_RUN=true` (`.env.local.example:97`; lido em `templates/submit/route.ts:131-132`). A chamada de rede é pulada e grava um `meta_template_id` sintético `dry-run-<uuid>`. **Desligue depois** — templates dry-run não existem na Meta e não podem ser enviados.
  **Se falhar:** a linha é gravada como `DRAFT` com `submission_error` (`:191-209`); se a mensagem contiver `429`, a rota devolve 429.
  **Recusa esperada:** categoria `Authentication` é rejeitada (`:111-119`).
  **⚠️ Sem checagem de papel:** `PATCH` e `DELETE /api/whatsapp/templates/{id}` **não chamam `requireRole`** — o backstop é a RLS no UPDATE/DELETE local, mas **a chamada à Meta acontece antes** (`templates/[id]/route.ts:167-171` antes de `:186`). Vale testar com um `agent` e registrar o que acontece na Meta.

- [ ] **⚡ 🔴 🌐 Fazer um disparo em massa — com UM destinatário: você**
  **Fazer:** `/broadcasts/new` → escolher um template **APPROVED** (o assistente só oferece esses, `src/components/broadcasts/step1-choose-template.tsx:39`) → **selecionar apenas o seu contato de teste** → personalizar → enviar.
  **Esperar:** a campanha aparece em `/broadcasts` e os contadores caminham `sent → delivered → read`; ao você responder pelo celular, vira `replied`.
  **🔴 COMO NÃO INCOMODAR NINGUÉM — leia antes de clicar:**
  - **Nunca** use a audiência "todos os contatos" num teste. O `resolveAudience` faz `.select('*')` **sem `.limit()`** (`src/hooks/use-broadcast-sending.ts:161`) e ninguém sabe qual é o teto real.
  - Filtre por uma **tag exclusiva de teste** aplicada só ao seu contato, ou por um CSV de uma linha.
  - **A aba tem que ficar aberta.** O disparo do painel é orquestrado **no navegador**: o hook insere a linha em `broadcasts` direto pelo Supabase do cliente e chama `/api/whatsapp/broadcast` lote a lote (`use-broadcast-sending.ts:356, 477`). A rota `/api/whatsapp/broadcast` **não grava nada no banco** (`src/app/api/whatsapp/broadcast/route.ts:123-162`). Fechar a aba abandona a campanha no meio.
  - **Teto prático de ~50:** o rate limit é 5 chamadas/60s por usuário, e o painel gasta uma chamada por lote de 10 com 1s de pausa. O **6º lote (a partir do 51º destinatário) leva 429**, e o `catch` marca os **10 daquele lote inteiro como `failed`** com a mensagem de erro (`src/lib/rate-limit.ts:123`; `use-broadcast-sending.ts:62-63, 489-491, 535-546`).
  **Se os contadores não andarem:** eles são propriedade de um **trigger** no Postgres, não de um `COUNT(*)` (`supabase/migrations/005_broadcast_counts_incremental.sql:62-99`), e é o webhook de status quem os move, casando pelo `whatsapp_message_id` e aceitando só movimento **para frente** na escada `pending→sent→delivered→read→replied` (`webhook/route.ts:416-420, 372-384`). Existe uma função de socorro para recalcular do zero, para uso manual: `recompute_broadcast_counts(bid uuid)` (`005:107-129`).
  **A lista faz polling de 5s** porque `broadcasts` não está na publicação de Realtime (`src/app/(dashboard)/broadcasts/page.tsx:28`); a tela de detalhe **não** faz polling — busca uma vez no mount (`broadcasts/[id]/page.tsx:193`).

- [ ] **Exportar os destinatários em CSV**
  **Fazer:** `/broadcasts/[id]` → exportar.
  **Esperar:** CSV com aspas RFC 4180 (`broadcasts/[id]/page.tsx:129-132`).

- [ ] **❓ Agendar um disparo — resultado esperado NEGATIVO**
  **Esperar: não existe.** A coluna `broadcasts.scheduled_at` existe (`001:302`), o CHECK aceita `'scheduled'` (`001:303`), o tipo TS declara e o pt-BR traduz "Agendado" — mas o grep por `scheduled_at` em `src/` só encontra a definição de tipo. **Nenhuma escrita, nenhum cron, nenhum executor.** Não prometa disparo agendado.

- [ ] **🔴 Apagar a campanha de teste.** (O botão fica desabilitado enquanto o status for `sending` — `broadcasts/[id]/page.tsx:338`. O CASCADE leva os destinatários.)

---

## Fase 12 — Notificações: in-app, Web Push e PWA

**~15 min. 🌐 Depende do serviço de push do navegador (FCM/APNs/Mozilla).**

- [ ] **Notificação in-app ao atribuir uma conversa**
  **Fazer:** com dois usuários, o usuário A atribui uma conversa ao usuário B.
  **Esperar:** B vê o aviso em `/notifications` (Realtime) e o contador da sidebar sobe. Clicar leva a `/inbox?c=<id>` (`src/app/(dashboard)/notifications/page.tsx:149`).
  **O que NÃO deve acontecer:** atribuir uma conversa **a si mesmo não notifica** (`supabase/migrations/055_notifications_i18n.sql:62-64`).
  **Se falhar:** a notificação nasce **exclusivamente** de um trigger no Postgres em `conversations` — não há nenhum INSERT em `notifications` no código da aplicação (`027_notifications.sql:116-118`). E o trigger **engole os próprios erros**: uma falha ao criar a notificação nunca derruba a atribuição (`055:93-97`) — ou seja, o sintoma é silêncio.
  **Nota:** o único tipo existente é `conversation_assigned` (CHECK em `027:9-10`). Não espere notificação de mais nada.

- [ ] **⚡ Instalar o PWA**
  **Fazer:** instalar pelo navegador, no celular e no desktop. O card de instalação só aparece no `/dashboard` (`src/app/(dashboard)/dashboard/page.tsx:139`).
  **Esperar:** o ícone é o ícone gerado, não um print da página (`/pwa-icon`, `src/app/pwa-icon/route.tsx`); abre em `standalone` no `start_url: '/inbox'` (`src/app/manifest.ts:23`).

- [ ] **⚡ 🌐 Ativar Web Push**
  **Fazer:** `/settings?tab=push` → escolher **"Só o que precisa de gente"** → permitir no navegador.
  **Esperar:** não aparece "servidor não configurado". Este é o **único** lugar do app que registra o service worker (`navigator.serviceWorker.register('/sw.js')`, `src/components/settings/push-notifications.tsx:93`) e o único que chama `pushManager.subscribe` (`:127-132`).
  **Se der 400 `push_not_configured`:** falta o par VAPID (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, `src/lib/push/send.ts:52-59`).
  **⚠️ Depois de mexer nessas variáveis, reinicie o processo** — o resultado de `isPushConfigured()` é cacheado em módulo (`send.ts:41, 50`).
  **No iPhone:** é preciso **instalar na tela de início ANTES** de as notificações funcionarem. iOS 16.4+.

- [ ] **⚡ 🔴 🌐 O celular apita com o app FECHADO**
  **Fazer:** fechar o app completamente. Do outro celular, mandar `quero falar com meu advogado` para o número da conta.
  **Esperar:** o aviso chega. A regra: um evento urgente (`human_needed`) alcança **os dois** modos; um evento comum (`all`) alcança **só** quem escolheu `all` (`src/lib/push/send.ts:103`).
  **Se não chegar:** (1) até 200 assinaturas por conta são lidas por disparo (`send.ts:105`); (2) assinaturas mortas (404/410) são apagadas silenciosamente (`send.ts:135-145`); (3) TTL de 1h (`send.ts:126`); (4) `sendPushToAccount` **nunca lança** — falha vira `{sent:0,pruned:0}` e log (`send.ts:157-160`). É um caminho de falha silenciosa: se ninguém apitar e nada aparecer em `/admin`, olhe os logs do contêiner `app`.
  **❓ Não há tela** que liste ou apague assinaturas de **outros** aparelhos do mesmo usuário — o GET só responde sobre o endpoint informado.

- [ ] **Desligar o push num aparelho**
  **Esperar:** desligar **apaga a linha** em vez de guardar um modo 'off' (`src/app/api/push/subscribe/route.ts:14-17`); a permissão do navegador continua concedida.

---

## Fase 13 — API pública v1

**~15 min.** Depende da Fase 3 (para envio) e da Fase 5 (para contatos).
**Não existe tela para webhooks de saída** — só a API, com escopo `webhooks:manage` (`src/app/(dashboard)/settings/page.tsx:74-88` não tem entrada de webhooks; `settings-sections.ts` também não). Estes itens são de terminal.

- [ ] **⚡ Criar uma chave de API**
  **Fazer:** `/settings?tab=api` → **Nova chave de API**, marcar os escopos, copiar o texto plano.
  **Esperar:** o plaintext aparece **uma única vez**, com botão Copiar (`src/components/settings/api-keys-settings.tsx:357-393`). Só `key_hash` e `key_prefix` são gravados (`src/app/api/account/api-keys/route.ts:124-155`). Botões de criar e revogar ficam dentro de `<RequireRole min="admin">` (`api-keys-settings.tsx:146-151, 243-258`).

- [ ] **⚡ Sonda de identidade**
  **Fazer:** `curl -H "Authorization: Bearer wacrm_live_…" https://SEU_DOMINIO/api/v1/me`
  **Esperar:** `{ account: {id, name}, key: {id, scopes} }`. Exercita todo o caminho de auth sem exigir escopo nenhum (`src/app/api/v1/me/route.ts:22-27`).
  **Se falhar:** é o primeiro item a rodar — se ele falha, todos os outros vão falhar por auth, não por lógica.

- [ ] **Ler contatos e conversas**
  **Fazer:** `GET /api/v1/contacts`, `GET /api/v1/conversations`, `GET /api/v1/conversations/{id}/messages`.
  **Esperar:** paginação por cursor; dados só da sua conta.
  **Teste de isolamento (faça):** pegue um `id` de **outra** conta (ou invente um UUID) e chame `/api/v1/contacts/{id}`. **Esperar 404, nunca 403.** O isolamento vem por dois mecanismos: filtro direto `.eq('account_id', ctx.accountId)` na maioria, e em `/conversations/{id}/messages` um **gate de posse da conversa** (`route.ts:29-35`) antes de uma query filtrada só por `conversation_id` (`:37-43`).

- [ ] **🔴 🌐 Enviar mensagem por telefone**
  **Fazer:** `POST /api/v1/messages` com o **seu** número em E.164 e escopo `messages:send`.
  **Esperar:** 201 e a mensagem chega no seu celular. Resolve-ou-cria contato+conversa e usa o mesmo núcleo do painel (`src/app/api/v1/messages/route.ts:108`).
  **🔴 Como não incomodar:** só o seu número. Este endpoint envia de verdade.

- [ ] **Handoff pela API**
  **Fazer:** `POST /api/v1/conversations/{id}/handoff` com `reason` (obrigatório, truncado em 500).
  **Esperar:** a conversa vira `pending`, o auto-reply da thread é desligado, a nota é gravada. **Não manda mensagem ao cliente** (`src/app/api/v1/conversations/[id]/handoff/route.ts:35, 54-57`).

- [ ] **🔴 🌐 Broadcast pela API**
  **Fazer:** `POST /api/v1/broadcasts` com **um** destinatário (você).
  **Esperar:** **202 imediato** com o `broadcast_id`, e a entrega acontece depois, dentro de `after()` (`src/app/api/v1/broadcasts/route.ts:80-91`). Poll em `GET /api/v1/broadcasts/{id}`.
  **Diferenças do caminho do painel, que mudam o teste:** teto rígido de **1000** destinatários (400 acima disso, `src/lib/whatsapp/broadcast-core.ts:77, 104-110`); envio **sequencial sem pausa nenhuma** (`:268-315`); `maxDuration = 60` — uma audiência perto do teto **estoura o tempo e deixa linhas em `pending` com o broadcast preso em `sending`** (`v1/broadcasts/route.ts:29-37`), e **não há nenhum reprocessamento** para elas. Telefones que não passam no E.164 nem viram linha: são contados em `rejected` e devolvidos só na resposta do POST (`broadcast-core.ts:151-155`).

- [ ] **Registrar um webhook de saída e receber o POST assinado**
  **Fazer:** `POST /api/v1/webhooks` com uma URL **https** (use um coletor tipo webhook.site) e os eventos. Guardar o `secret` — ele vem em **texto plano só no 201** (`src/app/api/v1/webhooks/route.ts:75, 83, 95-98`). Depois, mandar uma mensagem do celular.
  **Esperar:** o coletor recebe `message.received`. Os quatro pontos de emissão são `message.status_updated` (`webhook/route.ts:460`), `conversation.created` (`:634`), `conversation.reopened` (`:770`) e `message.received` (`:966`).
  **Verificar a assinatura:** HMAC-SHA256 sobre o corpo.
  **Fato importante:** o envio de webhooks **não é bloqueado pelo gate de cobrança**, por decisão explícita (`webhook/route.ts:792-795, 966-972`).
  **Se o endpoint falhar demais** ele é desativado; reativar é `PATCH is_active=true`, o que zera `failure_count` (`src/app/api/v1/webhooks/[id]/route.ts:91`). **❓ Não há cron que reative sozinho.**
  **⚠️ Registre:** o `GET /api/v1/webhooks` **não** devolve o `secret` (`WEBHOOK_PUBLIC_COLUMNS`). Se o cliente perder, só criando outro.

- [ ] **🔴 Revogar a chave e o webhook de teste.**
  **Esperar:** a revogação é **soft** (seta `revoked_at`); zero linhas → 404 "not found or already revoked" (`src/app/api/account/api-keys/[id]/route.ts:43-65`). Confirme que a chave revogada passa a dar 401 no `/api/v1/me`.
  **❓ Ressalva sobre o rate limit (120/min por chave):** o limitador é um `Map` em memória do processo (`src/lib/rate-limit.ts:46`). Com mais de uma réplica ou bundle, o limite efetivo é multiplicado. Ninguém mediu isso neste deploy.

---

## Fase 14 — Vault, base de conhecimento e guardrails

**~15 min. 🌐 O keeper gasta a chave de IA do cliente.** Depende da Fase 6.

- [ ] **Cadastrar um documento na base de conhecimento**
  **Fazer:** `/agents` → aba **Configurar** → card **Base de conhecimento** → novo documento com um fato verificável ("o horário de funcionamento é das 9h às 18h").
  **Esperar:** salva e indexa. Se a indexação falhar, a resposta é **200 com `warning`** — o documento fica salvo e buscável lexicalmente (`src/app/api/ai/knowledge/route.ts:44`).
  **Esta é a ÚNICA porta de UI da base vetorial** — ela não aparece em `/settings` (`src/components/settings/ai-config.tsx:612` → `ai-knowledge.tsx:28`).

- [ ] **🌐 O documento chega à resposta**
  **Fazer:** no Playground, perguntar exatamente o que o documento responde.
  **Esperar:** a resposta usa o fato. A recuperação é híbrida (semântica primeiro, lexical completando) com **k=5** por resposta (`src/lib/ai/knowledge.ts:104`).
  **Se não usar:** confira em `/agents` → **Contexto** se a seção `knowledge` está lá. Se você acabou de cadastrar a chave de embeddings, rode **Reindexar** (`POST /api/ai/knowledge/reindex`) — é o uso principal dele; se a chave estiver corrompida ele **para e avisa** em vez de fazer passe lexical silencioso (`reindex/route.ts:39-51`).
  **❓ Não confirmado:** ninguém verificou se a extensão `pgvector` está instalada nesta instância nem se o índice HNSW foi criado com sucesso (`030:18-22` avisa que pode exigir comando manual).

- [ ] **🌐 Rodar o keeper sob demanda**
  **Fazer:** `/agents` → Vault → sub-aba **Keeper** → **Rodar agora** (`requireRole('admin')`, `src/app/api/ai/vault/keeper/route.ts:56-67`).
  **Esperar:** o toast **diferencia cada zero**: propostas>0, consideradas>0 sem nada durável, `tooRecent`, `alreadyRead`, ou nenhuma conversa (`src/components/agents/vault-keeper-panel.tsx:84-95`). "Zero propostas" com motivo é resultado válido — o keeper só olha conversas encerradas e ociosas há 90 minutos.
  **🌐 🔴:** cada execução gasta a chave do provedor do cliente.

- [ ] **Aprovar uma página do Vault e ver o grafo**
  **Fazer:** Vault → **Aprovação** → aprovar um rascunho. Depois abrir a sub-aba **Rede**.
  **Esperar:** a página aparece como nó no grafo, colorido por `kind` (rule=âmbar, entity_customer=azul-céu, entity_business=violeta, concept=ardósia, state=esmeralda — `src/components/agents/vault-graph.tsx:51-57`).
  **⚠️ Duas discrepâncias conhecidas, não são regressão:**
  1. O diálogo **Nova página** diz no comentário do arquivo que ela "nasce aprovada" (`vault-new-page.tsx:42-43`), mas o código grava `status:'draft'` sem exceção (`src/lib/ai/vault/store.ts:150`). **Uma página criada à mão nasce rascunho** e precisa ser aprovada.
  2. Pelo dashboard, **"Arquivar" fica registrado como `operation='rejected'`** no histórico (`src/components/agents/ai-vault.tsx:115-124`, o `decide(page, false)` envia sempre `{status:'archived', operation:'rejected'}` e é o handler dos **dois** botões, `:271` e `:312`). Não prometa ao cliente que arquivamento aparece como arquivamento.
  **❓ Nunca observado funcionando:** o ciclo completo de aprendizado — aprovar uma página e a resposta do bot mudar por causa dela (`docs/pos-deploy.md:130-131`). Se você conseguir observar, registre.

- [ ] **Saúde do vault (lint)**
  **Fazer:** Vault → sub-aba **Saúde**.
  **Esperar:** os achados são calculados na hora e nada é armazenado (`src/app/api/ai/vault/lint/route.ts:8-11`). `contradiction` é heurístico e assumido como tal (`src/lib/ai/vault/lint.ts:106-113`, máx. 20 achados); `gap` devolve as 5 palavras mais frequentes sem página própria (`:229-232`).

- [ ] **Criar um guardrail próprio**
  **Fazer:** `/agents` → aba de Limites → adicionar um `keyword` do negócio do cliente.
  **Esperar:** aparece na lista com Switch de `is_active`. Escrita bloqueada quando não é admin (`src/components/agents/ai-guardrails.tsx:149`, readOnly).
  **Fato de segurança para conhecer:** falha ao **ler** os guardrails é **fail-open** — o bot responde sem eles — mas grava evento de severidade `critical` com code `guardrails_unreadable` (`src/lib/ai/guardrails.ts:123-141`). Se esse código aparecer em `/admin`, o bot está solto.

---

## Fase 15 — Admin, observabilidade e cobrança

**~15 min.** Pode ser feita a qualquer momento **depois** que a ronda de saúde tiver rodado ao menos uma vez (até 1h após o deploy).

- [ ] **⚡ A faixa de saúde não acusa nada**
  **Fazer:** `/admin` → aba **Eventos**. Ler a faixa do topo (`src/app/admin/health-strip.tsx`).
  **Esperar (respostas positivas, não ausência de erro):**
  - **Não** diz "A ronda de verificação nunca rodou" nem "A última ronda foi há N minutos". O limite é `STALE_MS = 2h` calculado **na leitura** (`src/app/api/admin/health/route.ts:22`). A faixa só mostra o que está falhando; se nada falha, mostra uma linha verde com contagens e a idade da última ronda (`health-strip.tsx:114-124`).
  - **`Migrações do banco`** não está vermelho.
  - **`Mensagens chegando`** (`inbound_silence`) não está vermelho — é a verificação que pega webhook bloqueado na borda, `phone_number_id` trocado no painel da Meta, DNS e TLS. Numa instalação nova ela aparece como "sem histórico para calibrar" até acumular **20 mensagens em 14 dias** (`src/lib/observability/health.ts:481`), com folga de **1,5×** sobre o maior silêncio histórico (`:484`) e piso de **3 horas** (`:488`).
  - **`Token do WhatsApp`** e **`Chave da IA`** não estão vermelhos — se estiverem, é problema real, não ruído de primeira execução.
  **Os cinco nomes de verificação por conta:** `ai_credentials`, `whatsapp_token`, `google_calendar`, `inbound_silence` (`health.ts:65-68`), mais as de plataforma `migrations` (`:363`) e `cron` (`src/app/api/health/cron/route.ts:106`).

- [ ] **⚡ 🌐 O alerta realmente chega ao Telegram**
  **Fazer:** forçar uma transição sem quebrar nada:
  ```sql
  UPDATE public.account_health
     SET status = 'ok', failing_since = NULL, last_alerted_at = NULL
   WHERE check_name = 'migrations' AND account_id IS NULL;
  ```
  e esperar a próxima ronda.
  **Esperar:** se a verificação estiver falhando de verdade, a transição dispara alerta no Telegram. Se estiver ok, **nada acontece — que também é a resposta certa**.
  **Se falhar:** `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` (Fase 0).

- [ ] **⚡ 🔴 O widget de feedback do cliente funciona**
  **Fazer:** no `/dashboard` (não no `/admin` — o widget é montado no layout de `(dashboard)`, `src/app/(dashboard)/layout.tsx:50`), clicar no botão flutuante e mandar um relato de teste com print.
  **Esperar:** (1) chega no Telegram; (2) aparece em `/admin` → Eventos → **Relatos**.
  **Limites:** `kind ∈ {bug, idea, other}`, comentário ≥3 chars, print `data:image/(png|jpeg);base64` até **3 MB**, rate limit 5/min (`src/app/api/feedback/route.ts:35, 54, 61, 70, 76, 44`).
  **⚠️ Conta bloqueada não consegue reclamar:** a rota usa `getCurrentAccount()` **sem** `allowBlocked` (`:39`) — conta `pending`/`blocked` recebe **402**. Um cliente novo que ainda não pagou não tem como mandar feedback pelo widget.

- [ ] **Resolver / reabrir um evento**
  **Fazer:** `/admin` → Eventos → abrir o detalhe → **Resolvido**, depois **Reabrir**.
  **Esperar:** resolver grava `resolved_at`/`resolved_by`; reabrir/ack limpa ambos (`src/app/api/admin/events/route.ts:116-129`). Os filtros são "Em aberto" | "Falhas" | "Relatos" | "Tudo", sempre com `days=14` fixo (`src/app/admin/events-panel.tsx:54-59, 108`).

- [ ] **🌐 Preços e câmbio**
  **Fazer:** `/admin` → **Preços e câmbio** → **Buscar agora**.
  **Esperar:** a cotação atualiza com `source='auto'`. Se a busca falhar, o PATCH devolve **502** (`src/app/api/admin/pricing/route.ts:75-98`). A tela considera a cotação velha a partir de 7 dias (`src/app/admin/pricing-panel.tsx:159`).
  **Também testável:** definir a cotação manualmente (aceita `0 < r ≤ 50`, `:100-119`). O cron de câmbio, quando o fetch falha, responde **200 com `updated:false`** de propósito (`src/app/api/exchange/cron/route.ts:43-48`) — silêncio ali é esperado, não bug.

- [ ] **🔴 O bloqueio por cobrança realmente bloqueia — e o que ele NÃO bloqueia**
  **Fazer:** em `/admin` → Contas, virar a **conta de teste** para `blocked`. Recarregar o painel como o cliente. Depois mandar uma mensagem do celular.
  **Esperar:**
  - O painel redireciona para `/blocked`, **agora com chave PIX e QR visíveis** (porque `blocked ≠ pending` — `src/app/blocked/blocked-view.tsx:89`).
  - A mensagem do celular **continua entrando e sendo gravada** (contato, conversa, mensagem).
  - **Param:** flows, automações, IA, push e as respostas de política de áudio (`webhook/route.ts:797-802` e usos em `:823-825, :888, :911, :930, :945-950`).
  - **Não param:** os webhooks de saída (decisão explícita) e a transcrição de áudio (roda antes do gate).
  **⚠️ O gate falha ABERTO:** se a consulta de `billing_status` der erro, os efeitos colaterais são **permitidos** (`src/lib/billing/side-effects.ts:53`).
  **❓ `past_due` não bloqueia nada** (`src/lib/billing/status.ts:35`) e a tradução `Billing.pastDueBanner` existe mas **nenhum componente a usa** — na prática `past_due` é indistinguível de `active` para o cliente.
  - [ ] **Devolver a conta de teste para `active`.**

- [ ] **Um usuário comum NÃO chega ao `/admin`**
  **Fazer:** logado como o `agent` da Fase 2, abrir `/admin` direto pela URL.
  **Esperar:** redirect para `/dashboard` (`src/app/admin/page.tsx:21-22`). Cada rota `/api/admin/*` recheca independentemente.

---

## Fase 16 — Backup e restauração

**~15 min.** Independente das demais. **Faça pelo menos uma vez antes de entregar a um cliente novo.**

- [ ] **⚡ O dump roda e tem tamanho plausível**
  **Fazer:**
  ```bash
  docker compose -f supabase-stack/docker-compose.yml exec -T db \
    pg_dump -U postgres postgres | gzip > backup-$(date +%F).sql.gz
  ```
  **Esperar:** o arquivo existe e não tem alguns poucos KB. O volume do Postgres é o **único** estado que importa — mensagens, contatos, tokens criptografados (`deploy/README.md:375-381`).
  **❓ Não há script de backup no repositório.** O comando acima é a recomendação do README, não um job existente. **Confirme no servidor se existe um cron do host chamando isso** — se não existir, não há backup nenhum.

- [ ] **⚡ 🔴 O `ENCRYPTION_KEY` está guardado FORA da VPS**
  **Fazer:** confirmar que a chave de 64 hex está num cofre/gerenciador de senhas seu, separada do backup.
  **Esperar:** sim.
  **Por quê:** sem ela o dump é inútil para os tokens — **um backup restaurado devolve esses campos como lixo e todo cliente precisa reconectar o WhatsApp e recadastrar a chave de IA** (`deploy/README.md:118-122, 383-384`).

- [ ] **Restaurar num ambiente descartável e conferir 3 coisas**
  **Fazer:** subir uma stack limpa, restaurar o dump, apontar o app com o **mesmo** `ENCRYPTION_KEY`.
  **Esperar:** (1) `/inbox` mostra o histórico; (2) `/settings?tab=whatsapp` → **Testar conexão** dá verde (prova que os tokens decifraram); (3) `bash deploy/apply-migrations.sh` diz que não há nada a aplicar.
  **Se (2) falhar com `token_corrupted`:** a `ENCRYPTION_KEY` do ambiente restaurado não é a mesma que cifrou.
  **🔴:** faça isso num host descartável, **nunca** apontando para o banco de produção.

- [ ] **🌐 ❓ O upload do backup para fora da máquina**
  **Esperar:** existe menção a `rclone`, com o aviso de que o `client_id` compartilhado será aposentado durante 2026 e o **backup para de subir com o erro só no log** (`docs/pendencias.md:149-150`). **Não há nenhuma configuração de rclone no repositório** — se existe, é do host. Confirme no servidor onde ela está e quando rodou pela última vez. Se você não souber responder "quando foi o último backup que subiu?", não entregue a cliente novo.

---

## Fase 16b — Fila de entrada, fila da IA e orçamento (ondas 5.1/5.2/5.3/5.5)

São os mecanismos que garantem duas promessas: **nenhuma mensagem se
perde** e **ninguém fica sem resposta**. Todos falham em SILÊNCIO quando
quebram — é por isso que estão no checklist e não só nos testes.

Tempo: ~25 min, mais 5 de espera passiva.

### A fila de entrada do webhook (5.1)

- [ ] ⚡ 🌐 **Mensagem normal continua chegando.** Mande uma pelo celular
      e confira que aparece na caixa de entrada em segundos.
      *Se falhar:* `select * from webhook_events order by received_at desc limit 5`
      — se a linha existe com `processed_at` nulo, o dreno parou; se não
      existe, o problema é antes (assinatura, ou a Meta não entregou).

- [ ] 🔴 **Reentrega não duplica.** Reenvie o MESMO webhook assinado três
      vezes (ver o comando no rodapé desta fase) e confira que a conversa
      tem **uma** mensagem.
      *Por que importa:* a Meta reentrega por até 7 dias quando acha que
      falhamos, e para todos os apps inscritos na WABA. Sem isso, a
      conversa do cliente enche de repetições.

- [ ] **Status não colapsa.** Mande `sent`, `delivered` e `read` do mesmo
      wamid; devem virar **três** linhas em `webhook_events`.
      *Se falhar:* a mensagem fica eternamente "enviada" na tela.

- [ ] **Banco fora do ar devolve 500, não 200.** (Só em ambiente de
      teste.) Com o Postgres parado, o webhook precisa responder **500** —
      é o que faz a Meta reentregar. Um 200 aqui é mensagem perdida.

- [ ] ⚡ **A ronda de saúde vigia a fila.** Em `/admin`, a verificação
      `webhook_queue` deve estar `ok`. Ela acusa quando o evento mais
      antigo passa de 10 minutos.
      *Por que o critério é idade e não quantidade:* mil eventos de um
      lote da Meta drenando em segundos é saúde; um evento parado há dez
      minutos é problema.

### A fila da IA (5.2)

- [ ] **Espera em vez de 429.** Em Agentes, baixe "respostas simultâneas"
      para **1**. Mande mensagens de dois contatos diferentes ao mesmo
      tempo. A segunda deve ser respondida em até 5 minutos (o cron a
      retoma), **não** ficar sem resposta.
      *Onde olhar:* `select id, ai_pending_since from conversations where ai_pending_since is not null`.

- [ ] 🔴 **Esperou demais vira gente.** Com o teto em 1, baixe a "espera
      máxima" para **30s** e repita. A segunda conversa deve ser
      **transferida** com a nota "Sem vaga para responder em X min" — e
      não ficar em silêncio.
      *Esta é a promessa inteira:* melhor demorar do que não responder.

- [ ] **A vaga volta depois de um erro.** Force um erro (chave de IA
      inválida por um minuto) e confira que
      `select count(*) from ai_inflight` volta a zero.
      *Se ficar preso:* o teto encolhe a cada falha até a conta emudecer.

### Orçamento (5.5)

- [ ] 🔴 **Estourado, bloqueia e chama alguém.** Ponha o orçamento mensal
      em um valor abaixo do já gasto no mês. A próxima mensagem deve ser
      **transferida** com "Orçamento mensal de IA esgotado", e nenhuma
      chamada nova deve aparecer em `ai_usage_log`.

- [ ] **`notify_only` continua respondendo.** Troque a ação e confirme
      que o bot volta a responder, com o evento registrado em `/admin`.

- [ ] **O número bate com a tela.** O gasto que dispara o bloqueio usa a
      mesma fórmula da tela de Custos. Se a tela diz que sobra e o bot
      parou, é bug — reporte.

### Limite da Meta no disparo (5.3)

- [ ] 🌐 **130429 não mata o destinatário.** Difícil de forçar de
      propósito; o que dá para verificar é o registro: depois de um
      disparo grande, nenhum destinatário deve estar `failed` com
      mensagem contendo `130429`.
      *Antes desta onda*, esse destinatário era marcado falho para
      sempre e nunca mais tentado.

### Disparo em massa pelo servidor (5.4)

O envio saiu do navegador. Estes itens verificam a consequência que mais
importa: **fechar a aba não interrompe mais nada.**

- [ ] 🔴 🌐 **O disparo continua sem a aba.** Crie um disparo para 3+
      contatos de teste e **feche a aba** assim que a tela disser que foi
      criado. Espere um ciclo do cron (até 5 min).
      *Esperado:* todos recebem, e o disparo vira `sent`.
      *Antes desta onda:* os que faltavam simplesmente não recebiam, sem
      nada dizer.

- [ ] **A tela não mente sobre o progresso.** A barra agora vai até "foi
      criado", não até "todos receberam" — o envio não é mais desta aba.
      Os contadores da lista de disparos (enviados/entregues/lidos) é que
      são a verdade, e vêm do gatilho do banco.

- [ ] **Retomada depois de queda.** Com um disparo em andamento,
      reinicie o app (`./stack up apps/imasterchat`). O envio deve
      continuar na rodada seguinte do cron, do ponto em que parou.
      *Por que funciona:* "o que falta" é `status = 'pending'` em
      `broadcast_recipients` — uma consulta, não um ponteiro guardado.

- [ ] **Limite da Meta não queima destinatário.** Se o log trouxer
      `limite da Meta no disparo`, os destinatários restantes devem
      continuar `pending` (e sair na próxima rodada), **não** `failed`.

- [ ] **Sem WhatsApp configurado, falha visível.** Um disparo numa conta
      sem conexão deve virar `failed`, e não ficar `sending` para sempre.

### Alerta de conversa parada — SLA de fila (6.1)

A fila da IA já se resolve sozinha (espera, e passando do prazo vira
gente). Do lado das PESSOAS, uma conversa no Financeiro podia ficar a
tarde inteira e o sistema estava tecnicamente correto o tempo todo. Este
é o relógio que faltava.

- [ ] **Sem SLA, sem ruído.** Filas recém-criadas nascem com o campo
      "Avisar após" **vazio** — e não devem gerar alerta nenhum.
      *Por quê:* alerta que ninguém pediu treina a equipe a ignorar
      alerta.

- [ ] 🔴 **O alerta sai.** Em Configurações → Filas, ponha "Avisar após"
      = **1 minuto** numa fila humana. Encaminhe uma conversa para ela e
      espere dois ciclos do cron.
      *Esperado:* um evento `queue/sla_breached` em `/admin` → Eventos,
      com o tempo de espera, e o aviso no Telegram se estiver
      configurado.

- [ ] **Não repete.** Deixe a mesma conversa parada por mais 15 minutos.
      **Não** deve sair um segundo alerta para a mesma espera.
      *Se repetir:* é assim que uma equipe aprende a ignorar alertas.

- [ ] **Duas passagens, dois avisos.** Atenda a conversa, devolva-a para
      a fila da IA e encaminhe de novo para a mesma fila humana. Passado
      o SLA, deve sair um alerta **novo**.
      *Por que funciona:* o carimbo vive na PASSAGEM, não na conversa.

- [ ] **Atender para o relógio.** Assuma a conversa antes do prazo e
      confirme que nenhum alerta sai.

### O comando do teste de reentrega

```bash
# na VPS, dentro de /home/lucas/dev/infra
SECRET=$(grep '^META_APP_SECRET=' apps/imasterchat/.env | cut -d= -f2-)
PN=$(docker exec supabase-db psql -U postgres -d postgres -t -A \
  -c "select phone_number_id from whatsapp_config limit 1")
BODY='{"entry":[{"id":"w","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"55","phone_number_id":"'"$PN"'"},"contacts":[{"wa_id":"5511999998888","profile":{"name":"Teste"}}],"messages":[{"id":"wamid.TESTE-1","from":"5511999998888","timestamp":"1786000000","type":"text","text":{"body":"teste"}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //')
for i in 1 2 3; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://imasterchat.com.br/api/whatsapp/webhook \
    -H "Content-Type: application/json" -H "x-hub-signature-256: sha256=$SIG" -d "$BODY"
done
# esperado: 200, 200, 200 — e UMA mensagem no banco
docker exec supabase-db psql -U postgres -d postgres -t -A \
  -c "select count(*) from messages where message_id='wamid.TESTE-1'"
```

> **Limpe depois:** o contato e a conversa de teste ficam na base do
> cliente se você não apagar. O comando está no fim da Fase 17.

## Fase 17 — Limpeza (não pule)

**~10 min.**

- [ ] Apagar a **automação** de teste (leva passos, logs e pendências).
- [ ] Apagar ou arquivar o **flow** de teste (libera o índice `idx_one_active_run_per_contact` do contato).
- [ ] Apagar a **campanha** de teste (leva os destinatários em cascata).
- [ ] Revogar a **chave de API** e apagar o **webhook** de saída de teste.
- [ ] Revogar o **convite** pendente, se sobrou algum.
- [ ] Devolver `audio_policy`, `WHATSAPP_TEMPLATES_DRY_RUN` e o **provedor de transcrição** aos valores do cliente.
- [ ] Devolver a conta de teste ao `billing_status` desejado.
- [ ] Apagar os **contatos** de teste e a **tag** exclusiva de teste.
- [ ] **⚠️ A conta e o usuário de teste ficam.** Não existe rota nem tela para apagar uma conta, nem para um membro sair por conta própria — o predicado `canDeleteAccount` existe (`src/lib/auth/roles.ts:102`) mas **nenhum handler DELETE** correspondente. A remoção é SQL manual no Studio.
- [ ] `/admin` → Eventos: resolver os eventos que **você** gerou, para a próxima rodada começar limpa.

---

## Apêndice — Onde olhar, por sintoma

| Sintoma | Primeiro lugar | Segundo |
|---|---|---|
| Mensagem do cliente não aparece no inbox | `/admin` → Eventos (`unknown_phone_number_id`) | logs do `app`; assinatura HMAC (`webhook/route.ts:192`) |
| Bot não responde | `/admin` → Eventos (`standing_down_for_automation`) | tabela `ai_usage_log`; gate de cobrança (`webhook/route.ts:797`) |
| Automação com `wait` não retomou | logs do contêiner `cron` | tabela `automation_pending_executions` (linhas `running` presas) |
| Flow travado / contato não dispara mais nada | `/flows/[id]/runs` | tabela `flow_runs` com `status='active'` antigo |
| Contadores de campanha parados | `/broadcasts/[id]` | tabela `broadcast_recipients`; `recompute_broadcast_counts(bid)` |
| Push não chega | `/settings?tab=push` (diz "servidor não configurado"?) | logs do `app` — `sendPushToAccount` nunca lança |
| Google diz "conectado" mas nada sincroniza | `/agenda` (triângulo âmbar) | `/agents` → Guardrails → ferramentas (`google_disconnected` / `calendar_unusable`) |
| Áudio entra e não vira texto | `docker compose logs whisper` | `WHISPER_URL` definida? provedor colapsou para `local`? |
| "Testar conexão" do WhatsApp falha | o campo `reason` da própria resposta | `token_corrupted` → Resetar configuração e reconectar |
| Cliente novo não entra no painel | `accounts.billing_status` | `/admin` → Contas |
| Nada acontece e nada dá erro | logs do contêiner `cron` | `/admin` → faixa de saúde (idade da última ronda) |

**Regra que organiza tudo acima:** *tela vazia não é prova de saúde.* Toda verificação deste checklist tem uma resposta positiva esperada — nunca "não apareceu erro".