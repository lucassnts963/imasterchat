# Inbox: conversas, atribuição, tags e presença

Este é o balcão de atendimento do iMasterChat. Tudo o que o cliente escreve no WhatsApp cai numa lista de conversas; cada conversa é uma linha da tabela `conversations` — uma por par (conta, contato) — com um status (Aberta, Pendente, Fechada), um contador de não lidas, a prévia da última mensagem e, opcionalmente, um dono: a pessoa da equipe responsável por aquele atendimento. É também aqui que mora o handoff, o momento em que o agente de IA para de responder e a conversa passa a esperar uma pessoa, e a presença (online, ausente, offline) dos membros, que aparece como uma bolinha ao lado de cada nome no menu de atribuição.

Duas coisas precisam ficar claras desde o começo, porque contrariam o que quase todo mundo espera:

- **Não existe fila, time, departamento nem skill como estrutura do sistema.** Não há tabela para isso em nenhuma das migrações. O que o produto chama de "fila" é apenas a combinação status `pending` + sem dono — qualquer atendente pode assumir.
- **Etiqueta (tag) não é da conversa, é do contato.** Não existe tabela ligando etiqueta a conversa. A Caixa de entrada usa as etiquetas do contato apenas como filtro da lista.

## Para que serve (visão do cliente)

O dono do negócio e a equipe dele conseguem:

- **Ver todas as conversas do WhatsApp num lugar só**, ordenadas da mais recente para a mais antiga, com a prévia da última mensagem e um contador de não lidas.
- **Filtrar a lista** por Todas, Não lidas, Abertas, Pendentes, Fechadas, por etiqueta do contato (marcando várias, a conversa aparece se o contato tiver qualquer uma delas) e por empresa do contato.
- **Responder o cliente** com texto, foto, vídeo, documento, nota de voz, modelo aprovado da Meta, mensagem com botões/lista e respostas rápidas salvas.
- **Marcar a conversa como Aberta, Pendente ou Fechada** pelo menu Status no cabeçalho da conversa.
- **Dizer de quem é aquele atendimento** pelo menu Atribuir: escolher um colega (com a bolinha mostrando se ele está online, ausente ou offline) ou remover a atribuição.
- **Assumir uma conversa do robô** com um clique: o assistente de IA para de responder naquela conversa e ela passa a ser sua.
- **Devolver a conversa para o robô** com o botão Retomar IA.
- **Saber quando o robô desistiu e por quê**: quando a IA transfere para uma pessoa, a conversa vira Pendente e a tarja acima da caixa de escrita mostra a nota de transferência escrita pelo próprio robô.
- **Ser avisado quando alguém te atribui uma conversa**, na tela Notificações. **Só na tela Notificações**: atribuição **não** gera aviso no celular. Os únicos dois eventos que disparam push são mensagem nova do cliente e transferência do robô para uma pessoa (`webhook/route.ts:912` e `handoff.ts:139` são os dois únicos chamadores de `sendPushToAccount`).
- **Reagir a mensagens com emoji, responder citando uma mensagem e copiar o texto dela.**
- **Ver a ficha do contato ao lado da conversa**: telefone, etiquetas, negócios e notas.

O que **não** existe e as pessoas costumam achar que existe:

- Distribuição automática de conversas. Nada atribui uma conversa sozinho quando ela chega. A conversa nasce sem dono.
- Filtro "atribuídas a mim" e coluna de dono na lista. A lista não mostra de quem é cada conversa; só ao abrir a conversa você vê o nome no menu Atribuir.
- Rodízio de verdade entre atendentes (veja "Limites e pegadinhas").
- Filas, times ou departamentos.
- Colocar e tirar etiqueta pela Caixa de entrada. O painel do contato dentro da conversa mostra as etiquetas, mas é só leitura — para mudar, vá em Contatos.
- Apagar mensagem já enviada. O menu que aparece ao passar o mouse na bolha só tem Reagir, Responder e Copiar texto.
- Paginação da lista de conversas. Ela carrega tudo o que a conta tem.

## Como se usa, na prática

### Atender uma conversa

1. Menu lateral → **Caixa de entrada**. A tela tem três painéis: a lista à esquerda, a conversa no meio, a ficha do contato à direita (dá para esconder pelo botão "Ocultar contato").
2. Clique numa conversa. As não lidas dela zeram na hora.
3. Escreva na caixa de baixo e envie. O cabeçalho mostra um relógio da janela de 24 horas do WhatsApp; expirada, a caixa avisa que só um modelo aprovado reabre a conversa.
4. **Importante:** responder **não** faz a conversa ser sua e **não** cala o robô. Se você quer o atendimento para você, use **Atribuir** ou o botão **Assumir** (próximo item).

### Assumir do robô e devolver

- Enquanto a IA está respondendo automaticamente, aparece uma tarja acima da caixa de escrita: "O assistente de IA está respondendo automaticamente", com o botão **Assumir**. Clicar nele faz duas coisas na mesma ação: pausa o robô naquela conversa e coloca a conversa no seu nome.
- Quando o robô transfere sozinho, a tarja muda para "O assistente de IA está pausado aqui" com a nota do motivo, e o botão vira **Retomar IA**.
- **Retomar IA** devolve a conversa ao robô: reativa a resposta automática, apaga a nota de transferência, zera o contador de respostas do robô e **remove qualquer dono da conversa** — inclusive se o dono for outra pessoa, e não você.
- A tarja não aparece quando a conta está com o assistente desligado, nem quando a conversa já tem dono e o robô está ativo.

### Atribuir a alguém

1. Abra a conversa → cabeçalho → botão **Atribuir** (quando já há dono, ele mostra "Atribuída" com o nome).
2. Escolha o colega na lista. Cada nome tem uma bolinha de presença: online, ausente ou offline. O seu nome aparece com "(eu)".
3. Para soltar a conversa, escolha **Remover atribuição**.
4. Quem recebeu vê um aviso em **Notificações**; clicar no aviso abre a conversa. Quem se atribui a si mesmo (inclusive pelo botão Assumir) **não** recebe aviso.
5. Qualquer membro com papel `agent` ou acima pode atribuir qualquer conversa da conta a qualquer pessoa, inclusive tirar de outro atendente. Não há bloqueio para isso.

### Mudar o status

Abra a conversa → cabeçalho → menu **Status** → Aberta, Pendente ou Fechada. Regra prática do produto: **Pendente** = "esperando uma pessoa" (é o que a transferência da IA grava); **Fechada** = "encerrado". Se o cliente escrever de novo numa conversa **Fechada**, ela reabre sozinha: volta para Aberta, **perde o dono**, o robô é reativado e a nota de transferência é apagada. Conversas Pendentes e Abertas com dono não são liberadas por mensagem nova.

### Etiquetas

- Criar, renomear, colorir e apagar etiquetas: menu lateral → **Configurações** → seção **Campos e etiquetas**. Exige papel admin ou acima.
- Colocar/tirar etiqueta de alguém: menu lateral → **Contatos**, na ficha ou no formulário do contato. Exige papel agent ou acima.
- Usar etiqueta como filtro: **Caixa de entrada** → filtro **Etiquetas** no topo da lista.

### Respostas rápidas

No compositor, o menu **Mais** → **Respostas rápidas** insere um snippet salvo. Ao montar uma mensagem interativa, o botão **Salvar como resposta rápida** guarda aquele desenho de botões para reuso. O catálogo é gerenciado em **Configurações** → **Respostas rápidas**.

### Presença

Nada para configurar: o app manda um batimento a cada 30 segundos enquanto a aba está aberta. Sem interação por 5 minutos, ou com a aba escondida, o status vira "ausente". Ao fechar a aba os batimentos param e, 75 segundos depois, os colegas passam a ver "offline". A presença aparece em dois lugares: no menu **Atribuir** da conversa e no roster de **Configurações → Membros da equipe**.

## O que dá para configurar

| Ajuste | Onde | O que muda | Papel |
| --- | --- | --- | --- |
| Para quem a IA transfere ("Passar para") | Agentes de IA → aba **Configuração** | Um membro específico, ou "Fila sem atribuição (qualquer atendente pode assumir)", que grava NULL em `ai_configs.handoff_agent_id` | admin |
| Avisar o cliente na transferência | Agentes de IA → **Configuração** (`handoff_notice_enabled`) | Liga/desliga a mensagem enviada ao cliente quando a conversa é transferida | admin |
| Texto desse aviso | Agentes de IA → **Configuração** (`handoff_notice_text`, até 300 caracteres) | Vazio usa o texto padrão neutro | admin |
| Quantas respostas o robô dá por rodada | Agentes de IA → **Configuração**, campo de máximo de respostas automáticas | 1 a 20, padrão 3. É por rodada: cada mensagem nova do cliente zera a contagem | admin |
| Ligar/desligar o assistente e a resposta automática | Agentes de IA → **Configuração** (`is_active`, `auto_reply_enabled`) | Com qualquer um desligado, a tarja de IA some da conversa | admin |
| Palavras e assuntos que forçam transferência | Agentes de IA → aba **Limites** | Palavra-chave transfere **antes** de chamar o modelo; assunto é orientação no prompt | admin |
| Criar/editar/apagar etiquetas | Configurações → **Campos e etiquetas** | Catálogo de etiquetas da conta | admin |
| Colocar/tirar etiqueta de um contato | Contatos | Vínculo contato-etiqueta | agent |
| Atribuir/desatribuir e mudar status | Caixa de entrada, cabeçalho da conversa | `assigned_agent_id` e `status` | agent |
| Assumir / Retomar IA | Caixa de entrada, tarja acima do compositor | Pausa ou reativa o robô e mexe no dono | agent |
| Atribuição por automação | Automações → editor da automação, passo "Atribuir conversa" | "Agente específico" funciona; "Rodízio" não distribui (veja pegadinhas) | agent para editar automações |
| Papel de cada membro | Configurações → **Membros da equipe** | owner / admin / agent / viewer — é o que decide quem responde e quem atribui | admin |
| Quem recebe aviso no celular | Configurações → **Avisos no celular** (`push_subscriptions.notify_mode`) | "Toda mensagem" ou só "precisa de uma pessoa"; a escolha é por navegador/aparelho | o próprio dono do aparelho |
| Atribuir pelo nó de handoff de um fluxo | Só no código (`HandoffNodeConfig.assign_to`) | O motor respeita, mas **não existe campo na tela** do editor de fluxos | — |
| Limites de uso | `src/lib/rate-limit.ts:119,127` | 60 envios/min por usuário; 120 reações/min; Assumir/Retomar usa um contador próprio (`ai-takeover:{userId}`) com o mesmo teto de 60/min | — |
| Tempos de presença | `src/lib/presence.ts:16,23,26` | Batimento 30s; "ausente" após 5 min sem interação; "offline" após 75s sem batimento | — |
| `META_APP_SECRET` | Variável de ambiente | Sem ela o webhook rejeita tudo com 401 e nenhuma mensagem entra | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Variável de ambiente | É com ela que o webhook grava conversas e mensagens ignorando RLS | — |
| `VAPID_*` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Variável de ambiente | Sem elas o aviso no celular simplesmente não sai | — |
| `NEXT_PUBLIC_SITE_URL` | Variável de ambiente | Base dos links de conversa colocados em eventos de agenda | — |

## Como funciona por dentro

### Caminho de uma mensagem recebida

`POST /api/whatsapp/webhook` (`src/app/api/whatsapp/webhook/route.ts:181`) valida o HMAC `x-hub-signature-256` sobre o corpo cru e responde 200 imediatamente; todo o processamento roda dentro de `after()` (`route.ts:206-222`), de propósito — uma promessa solta seria congelada no serverless e perderia inserts. Dentro do processamento, com service role (RLS ignorada):

1. Acha ou cria o contato e a conversa. O insert da conversa tem só `account_id`, `user_id` (o dono da configuração do WhatsApp, para auditoria) e `contact_id` (`route.ts:1227-1233`) — `assigned_agent_id` nasce NULL.
2. Insere a mensagem e atualiza a conversa num único UPDATE: prévia, `last_message_at`, `unread_count + 1` e, se a conversa estava `closed`, o patch de reabertura (`route.ts:746-763`). O patch entra no mesmo UPDATE porque, em dois updates, o auto-reply (que roda depois e relê a linha) leria o dono antigo e ficaria calado.
3. Se a conta estiver com cobrança pendente ou bloqueada, o contato, a conversa e a mensagem **ainda são gravados**, mas tudo que envia mensagem é pulado: flows, automações, push, política de áudio e auto-reply (`route.ts:781-802`).
4. Emite `conversation.created` / `conversation.reopened` / `message.received` para os webhooks de saída da conta.

Reabertura: `src/lib/conversations/reopen.ts:60-70` — só para `closed`, e devolve `{ status: 'open', assigned_agent_id: null, ai_autoreply_disabled: false, ai_handoff_summary: null }`. O bloco de comentário em `reopen.ts:32-42` explica por que `pending` e `open` não são liberados.

### Os seis caminhos que escrevem `assigned_agent_id`

| # | Caminho | Arquivo:linha | Efeito |
| --- | --- | --- | --- |
| 1 | Menu Atribuir do inbox | `src/components/inbox/message-thread.tsx:833-836` | UPDATE direto do navegador na tabela `conversations`; quem manda é a RLS |
| 2 | Botão Assumir | `src/app/api/ai/autoreply/[conversationId]/route.ts:67-68` | Grava o usuário chamador e pausa o robô |
| 3 | `handOffConversation` | `src/lib/conversations/handoff.ts:117` | Só grava se um destinatário foi nomeado **e** a conversa ainda não tiver dono |
| 4 | Passo `assign_conversation` de automação | `src/lib/automations/engine.ts:501` | Agente específico ou o pseudo-rodízio |
| 5 | Nó de handoff de fluxo com `assign_to` | `src/lib/flows/engine.ts:445` | Campo sem interface no builder |
| 6 | Reabertura | `src/lib/conversations/reopen.ts:64` | Zera o dono |

Não há mais nenhum. `assigned_agent_id` é `UUID` puro em `001_initial_schema.sql:145` — **sem FK e sem CHECK**; a validação "essa pessoa é da conta" existe só em código e só no caminho de handoff (`handoff.ts:88-107`, que devolve `invalid_assignee`).

A lista do menu Atribuir vem de um `select('*')` em `profiles` sem filtro de conta (`message-thread.tsx:220-231`); quem recorta para os membros da conta é a política `profiles_select` (`017_account_sharing.sql:612-613`). Vale lembrar que, além das políticas da 017, existe o trigger `enforce_profile_privilege_columns` (`034_fix_profiles_update_rls.sql:58-80`): pelo navegador é impossível alterar `account_role`/`account_id` da própria linha, só as RPCs SECURITY DEFINER e o service role conseguem.

### Handoff (transferência para gente)

Existe **uma só** implementação, `src/lib/conversations/handoff.ts`, usada por três chamadores: a ferramenta `request_human` do agente, o auto-reply quando o modelo desiste, e a rota pública `/api/v1/conversations/{id}/handoff`. Ela faz exatamente quatro coisas (`handoff.ts:109-118`):

1. `status` vira `pending`;
2. `ai_autoreply_disabled` vira `true`;
3. `ai_handoff_summary` recebe a nota (prefixada pelo emoji de robô quando vem da ferramenta, truncada em 500 caracteres — `tools/handoff.ts:62`, `handoff.ts:62,68`);
4. `assigned_agent_id` só é escrito se houver destinatário **e** a conversa não tiver dono — comentário explícito "Never steal a thread a human already owns" (`handoff.ts:115-118`).

O handoff, por decisão explícita, **não manda mensagem ao cliente** (`handoff.ts:19-22`); quando `handoff_notice_enabled` está ligado, quem envia é o auto-reply, depois de a transferência já estar gravada (`src/lib/ai/auto-reply.ts:297-307`). O texto padrão, quando a conta não escreve o próprio, é "Vou encaminhar seu atendimento para o setor responsável. Em breve alguém entra em contato por aqui." — evita de propósito dizer "humano" ou "atendente" (`handoff.ts:35-36`).

Todo handoff dispara aviso no celular para a **conta inteira** (todas as inscrições com modo `human_needed` ou `all`), não só para quem recebeu a conversa: `sendPushToAccount` sem `exceptUserId` (`handoff.ts:139-149`; seleção por modo em `src/lib/push/send.ts:99-105`).

Três gatilhos levam a handoff automático:

- o modelo chama a ferramenta `request_human` (`src/lib/ai/tools/handoff.ts:58-64`) — o único parâmetro é `reason`; o destinatário é sempre o `handoff_agent_id` da conta, o modelo não escolhe pessoa;
- a mensagem do cliente bate num guardrail de palavra-chave — a transferência acontece **antes** de qualquer chamada ao provedor (`auto-reply.ts:150-163`);
- o modelo termina sem texto ou sinaliza desistência sem chamar a ferramenta — o próprio auto-reply grava com nota montada por código (`auto-reply.ts:264-285`, `src/lib/ai/handoff.ts`).

Portões do auto-reply relevantes aqui: `if (conv.assigned_agent_id) return` e `if (conv.ai_autoreply_disabled) return` (`auto-reply.ts:122-123`). O robô também se cala sozinho quando a conta tem qualquer automação ativa de `new_message_received` ou `keyword_match` (`auto-reply.ts:75-98`). O teto de respostas é por rodada: cada inbound faz `update({ ai_reply_count: 0 })` (`auto-reply.ts:100-112`); `ai_reply_total` é o acumulado vitalício.

O catálogo de ferramentas do agente é `request_human` mais, no máximo, as quatro de agendamento (`src/lib/ai/tools/registry.ts:137,143-145`). `request_human` não pode ser desligada (`registry.ts:86,155-157`). Ou seja: **a IA não põe etiqueta, não cria negócio, não muda status e não atribui conversa a ninguém.**

### Etiquetas

`CONVERSATION_SELECT = '*, contact:contacts(*, contact_tags(tags(*)))'` (`src/lib/inbox/conversations.ts:9-10`) — a etiqueta chega pelo contato, embutida na consulta de conversas. O filtro é OU e roda **no cliente**, sobre o array já carregado (`conversations.ts:61-64`, aplicado em `conversation-list.tsx:172-179`).

Existem cinco caminhos de escrita em `contact_tags`:

| Caminho | Arquivo | Dispara `tag_added`? |
| --- | --- | --- |
| Tela de Contatos → `POST /api/contacts/[id]/tags` → `addContactTagAndDispatch` | `src/lib/contacts/tag-events.ts:30-66` | Sim, se o vínculo for novo |
| Passo `add_tag` de automação | `src/lib/automations/engine.ts:432-438` | Sim, com controle de profundidade próprio |
| API pública v1 de contatos | `src/lib/api/v1/contacts.ts:202-205` | Sim |
| Remoção (`DELETE` da rota ou passo `remove_tag`) | `src/lib/contacts/tag-write.ts:71-88`, `engine.ts:470-481` | Não dispara nada |
| **Importação de CSV** | `src/lib/contacts/resolve-import-tags.ts:107-137` (`upsert` direto do navegador, chamado de `import-modal.tsx:335`) | **Não** |

A importação de CSV também pula o `assertContactAndTagOwnership` de `tag-write.ts:19-47`; nesse caminho só a RLS de `contact_tags` segura o escopo. O disparo normal só acontece em vínculo novo — repetido é engolido pelo UNIQUE `(contact_id, tag_id)` e detectado pelo código de erro 23505 (`tag-write.ts:63`). Encadeamento de tag tem teto (`MAX_TAG_CHAIN_DEPTH`, `tag-events.ts:43-52`).

### Presença

`member_presence` só aceita `online` e `away` (`024_member_presence.sql:34`); **`offline` nunca é gravado** — é derivado por quem vê, quando o último batimento passa de 75 segundos (`src/lib/presence.ts:23,50-53`), com um tick local de 15 segundos para o estado mudar sem evento do banco (`src/hooks/use-presence.ts:20`). Não há política de escrita para o cliente: a única escrita é a função SECURITY DEFINER `public.touch_presence(p_status)` (`024:56-90`), que resolve o `account_id` pelo profile do próprio chamador — ninguém consegue publicar presença de outra pessoa nem em outra conta. O batimento é montado uma vez em `app-shell.tsx:54` (`src/components/presence/presence-heartbeat.tsx`).

### Realtime

A tela assina `messages` e `conversations` **sem filtro** (`src/hooks/use-realtime.ts:47-52`) e deixa a RLS decidir o que chega. Além do realtime, a página força refetch quando o WebSocket reconecta e quando a aba volta a ficar visível (`src/app/(dashboard)/inbox/page.tsx:363-373` e `:381-391`), e há um botão de atualizar no cabeçalho da conversa (`message-thread.tsx:959-974`). `unread_count` sobe no webhook (`route.ts:759`) e zera por efeito do cliente ao abrir a thread (`message-thread.tsx:436-446`).

## Limites e pegadinhas

- **Responder pelo inbox não assume a conversa e não cala a IA.** O envio atualiza apenas `last_message_text`, `last_message_at` e `updated_at`, e pausa runs de Flow ativos (`src/lib/whatsapp/send-message.ts:483-504`). Não toca em `assigned_agent_id`, `status` nem `ai_autoreply_disabled`. Na prática: o atendente responde, o cliente responde de volta, **e a IA responde de novo por cima**. Para calar o robô é preciso clicar em **Assumir** ou atribuir a conversa a alguém. Todo tutorial precisa dizer isso.
- **"Rodízio" na automação não distribui nada.** O passo `assign_conversation` no modo `round_robin` faz `select('user_id').eq('account_id', …).limit(1)`, sem `ORDER BY` e sem qualquer estado de rodízio; o próprio comentário do código admite que a implementação preserva o formato antigo até existir um algoritmo de verdade (`src/lib/automations/engine.ts:487-497`). A interface chama isso de "Rodízio" em português (`messages/pt-BR.json:1200`), o que promete o que o código não entrega. Não medimos qual pessoa sai na prática — sem `ORDER BY` o Postgres não garante ordem; o que se afirma é que a escolha é arbitrária e **não rotativa**.
- **Etiqueta posta por importação de CSV não dispara a automação de `tag_added`.** Quem vende "importe sua base e a automação cuida do resto" está prometendo errado.
- **O nó de handoff dos fluxos é mais fraco que o da IA:** ele só muda o status para `pending`. Não escreve `ai_handoff_summary` (a tarja não mostra motivo nenhum) e **não liga** `ai_autoreply_disabled` — então o robô continua elegível naquela conversa se ninguém for atribuído (`src/lib/flows/engine.ts:440-449` e `:1039-1044`). E o campo de escolher a pessoa não existe na tela do editor: o formulário do nó só oferece a nota interna (`src/components/flows/forms/node-config-form.tsx:212-220`).
- **O link do aviso no celular de "precisa de uma pessoa" não abre a conversa.** Ele aponta para `/inbox?conversation=<id>` (`handoff.ts:145`), mas a tela lê `?c=` (`inbox/page.tsx:44`). O aviso abre a Caixa de entrada sem selecionar a conversa. O mesmo descasamento existe em `webhook/route.ts:918`, `agenda-board.tsx:336` e `event-text.ts:81`; os links de `dashboard/queries.ts:323` e da tela de Notificações (`notifications/page.tsx:149`) usam `?c=` e funcionam.
- **Retomar IA solta qualquer dono**, não só o de quem clicou — inclusive um atendente para quem o handoff havia roteado a conversa (`api/ai/autoreply/[conversationId]/route.ts:70-84`).
- **Qualquer agente pode roubar a conversa de qualquer outro.** A política `conversations_update` só exige ser membro `agent` da conta; não olha o dono atual nem o valor gravado (`017_account_sharing.sql:416`).
- **Quem se atribui não recebe notificação** — o gatilho pula auto-atribuição (`055_notifications_i18n.sql:61-64`). Atribuições feitas por automação, fluxo ou handoff chegam com `actor_name` nulo, porque não há `auth.uid()` no service role.
- **A lista de conversas carrega tudo, sem paginação nem limite** (`conversation-list.tsx:99-102`). Em conta grande isso pesa.
- **A lista não tem filtro por dono nem mostra o dono no item.** Só descobre-se abrindo a conversa.
- **A ficha do contato dentro da conversa é só leitura para etiquetas** (`contact-sidebar.tsx:186-210`). Mudança de etiqueta é na tela Contatos.
- **Um `viewer` lê tudo.** Ele enxerga todas as conversas e mensagens da conta (a política de SELECT só exige ser membro), mas não envia, não reage e não atribui. O `requireRole('agent')` nas rotas é indispensável porque o núcleo de envio chama a Meta **antes** de gravar — a RLS não desfaz uma mensagem já entregue (`api/whatsapp/send/route.ts:26-35`).
- **Um pico de mensagens do mesmo contato pode gerar mais respostas de IA que o teto configurado**, porque cada inbound zera `ai_reply_count`.
- **O proxy de mídia repassa o `Content-Type` que veio do remetente** (`api/whatsapp/media/[mediaId]/route.ts`, a resposta usa `contentType || mediaInfo.mimeType`). Isso é um defeito conhecido de XSS armazenado: um arquivo recebido pode ser servido pelo domínio do painel com um tipo que o navegador executa.
- **A rota de mídia não exige papel:** basta estar logado e ter `account_id` no profile. Um `viewer` baixa qualquer mídia da conta.
- **Não existe apagar mensagem no inbox.** O menu da bolha tem apenas Reagir, Responder e Copiar texto (`message-actions.tsx:110-145`). A chave de tradução `Inbox.actions.delete` existe, mas não é usada ali.
- **A tarja de IA some quando a conversa tem dono**, mesmo com o robô ativo — a interface reflete o portão do servidor (`ai-thread-banner.tsx:159-160`).
- `conversations.user_id` existe além de `account_id`, mas desde a 017 é **auditoria, não isolamento** (`017:33-35`); o webhook grava ali o dono da configuração do WhatsApp. Não foi auditado se algum consumidor ainda o trata como "dono do atendimento" — não conte com esse campo.
- Não foi verificado se existe limpeza/expiração das linhas de `member_presence`; nenhum job foi encontrado, mas a busca não foi exaustiva.
- Tudo o que está descrito aqui sobre schema e RLS vem dos arquivos em `supabase/migrations/`, não de uma inspeção do banco de produção.

## Referência

### Tabelas

| Tabela | Para que serve | Migração de origem | RLS (resumo) |
| --- | --- | --- | --- |
| `conversations` | Uma linha por (conta, contato): status, dono, prévia, não lidas e todo o estado do robô naquela thread | `001_initial_schema.sql:140-158`; `017:180,280,413-417`; `029:100-104`; `033:43-44`; `036:125-126`; `045:33-34` | SELECT: qualquer membro (inclusive viewer). INSERT/UPDATE/DELETE: membro `agent`+. Nenhuma política limita **qual** valor vai em `assigned_agent_id` |
| `messages` | Uma linha por mensagem, nos dois sentidos; `sender_type` in ('customer','agent','bot') | `001:163-185`; `009:30-37`; `010:57-71`; `033:34-35`; `035:20-21`; RLS final `017:509-518` | SELECT via join com `conversations` para qualquer membro; ALL para `agent`+. A política antiga "Service role can insert messages" foi derrubada em `017:510` |
| `message_reactions` | Uma reação por (mensagem, ator); UNIQUE (message_id, actor_type, actor_id) | `009_message_actions.sql:42-114`; RLS final `017:571-598` | SELECT para qualquer membro; ALL para `agent`+ |
| `tags` | Catálogo de etiquetas da conta (nome + cor). Sem qualquer ligação com `conversations` | `001:58-68`; `017:177,277,392-396` | SELECT qualquer membro; INSERT/UPDATE/DELETE **admin**+ |
| `contact_tags` | Junção contato-etiqueta. É aqui que a etiqueta é posta em alguém. Não tem `account_id` (escopo vem do join com `contacts`) | `001:73-87`; `017:486-495` | SELECT qualquer membro; ALL `agent`+ |
| `contacts` | O cliente do outro lado; o inbox lê `company` e as etiquetas dele para filtrar | `001:36-53`; `017:385-389`; `022_contact_phone_dedup.sql` | SELECT qualquer membro; escrita `agent`+ |
| `member_presence` | Último batimento por usuário; alimenta a bolinha de presença | `024_member_presence.sql:31-101` | Só SELECT para membros. Escrita apenas pela RPC SECURITY DEFINER `touch_presence` |
| `notifications` | Aviso in-app de "te atribuíram uma conversa" (único tipo: `conversation_assigned`) | `027_notifications.sql:4-131`; `055_notifications_i18n.sql:29-100` | SELECT/UPDATE só do próprio destinatário; sem INSERT para cliente (só o trigger). UPDATE limitado a `read_at` |
| `quick_replies` | Snippets de texto ou mensagem interativa do compositor | `035_interactive_messages.sql:24-61` | SELECT qualquer membro; escrita `agent`+ |
| `ai_configs` | Config única por conta da IA; aqui importam `handoff_agent_id` e o aviso de transferência | `029:45-95`; `033:40-41`; `058_handoff_notice.sql:28-42` | SELECT qualquer membro; escrita **admin**+ |
| `ai_handoff_guardrails` | Assuntos/palavras que o robô não trata; `keyword` transfere antes de chamar o modelo | `048_ai_guardrails.sql:34-95` | SELECT qualquer membro; escrita **admin**+ |
| `push_subscriptions` | Uma linha por navegador; `notify_mode` in ('all','human_needed') | `051_push_subscriptions.sql:20-120` | Todas as políticas por dono da linha (`auth.uid() = user_id`); INSERT também exige ser membro da conta. Nem admin lê a inscrição do colega. O envio roda com service role e passa por cima |
| `profiles` | Fonte da lista do menu Atribuir e base do `is_account_member` | `001:13-31`; `017:120-125,274-275,609-618`; trigger `034:58-80` | SELECT: própria linha ou membro da mesma conta; UPDATE/INSERT só da própria linha, e o trigger impede mudar `account_role`/`account_id` pelo navegador |

### Rotas

| Método | Rota | Arquivo | Autenticação / papel |
| --- | --- | --- | --- |
| GET | `/api/whatsapp/webhook` | `webhook/route.ts:99` | Nenhuma sessão. Verificação da Meta por `hub.verify_token` comparado contra todas as linhas de `whatsapp_config` (`:115-141`) |
| POST | `/api/whatsapp/webhook` | `webhook/route.ts:181` | HMAC `x-hub-signature-256`; inválido → 401. Sem `auth.uid()`; roda com service role |
| POST | `/api/whatsapp/send` | `send/route.ts:24` | `requireRole('agent')`; limite `send:{userId}` 60/min. Aceita `conversation_id` ou `contact_id`. **Não atribui, não muda status, não cala o robô** |
| POST | `/api/whatsapp/react` | `react/route.ts:21` | `requireRole('agent')`; limite `react:{userId}` 120/min |
| GET | `/api/whatsapp/media/[mediaId]` | `media/[mediaId]/route.ts:6` | Só exige sessão válida e profile com `account_id` — **sem checagem de papel**. Usa a config de WhatsApp da conta do chamador |
| POST | `/api/ai/autoreply/[conversationId]` | `autoreply/[conversationId]/route.ts:27` | `requireRole('agent')`; limite `ai-takeover:{userId}` com o teto de 60/min. `paused=true` + `assign_to_me` = Assumir; `paused=false` = Retomar IA (zera dono, contador e nota) |
| GET | `/api/ai/config` | `ai/config/route.ts:33` | Qualquer membro logado. É o que a tarja de IA consulta |
| POST | `/api/ai/config` | `ai/config/route.ts:80` | `requireRole('admin')`. Valida `handoff_agent_id` como membro da conta (`:129-140`) |
| PATCH | `/api/ai/config` | `ai/config/route.ts:315` | `requireRole('admin')` |
| DELETE | `/api/ai/config` | `ai/config/route.ts:394` | `requireRole('admin')` |
| POST | `/api/contacts/[id]/tags` | `contacts/[id]/tags/route.ts:24` | `requireRole('agent')`. Passa por `addContactTagAndDispatch` e dispara `tag_added` em vínculo novo |
| DELETE | `/api/contacts/[id]/tags` | `contacts/[id]/tags/route.ts:51` | `requireRole('agent')`. Não dispara evento |
| GET | `/api/quick-replies` | `quick-replies/route.ts:11` | Sessão + RLS `quick_replies_select` |
| POST | `/api/quick-replies` | `quick-replies/route.ts:26` | `requireRole('agent')` |
| PATCH | `/api/quick-replies/[id]` | `quick-replies/[id]/route.ts:11` | `requireRole('agent')`, com escopo por `account_id` no service role |
| DELETE | `/api/quick-replies/[id]` | `quick-replies/[id]/route.ts:84` | `requireRole('agent')`, com escopo por `account_id` no service role |
| GET | `/api/v1/conversations` | `v1/conversations/route.ts:23` | Chave de API com escopo `conversations:read`. Paginação keyset, filtros `?status=` e `?contact_id=`; devolve `assigned_agent_id` |
| GET | `/api/v1/conversations/{id}` | `v1/conversations/[id]/route.ts:15` | Chave de API `conversations:read`. Id de outra conta → 404 |
| GET | `/api/v1/conversations/{id}/messages` | `v1/conversations/[id]/messages/route.ts:19` | Chave de API `messages:read` |
| POST | `/api/v1/conversations/{id}/handoff` | `v1/conversations/[id]/handoff/route.ts:36` | Chave de API `conversations:handoff`. `reason` obrigatório (truncado em 500), `assign_to` opcional. Chama o mesmo `handOffConversation` |
| POST | `/api/v1/messages` | `v1/messages/route.ts:44` | Chave de API `messages:send`. Resolve contato+conversa pelo telefone |

Não existe PATCH em `/api/v1/conversations/{id}`: pela API pública não dá para atribuir nem mudar status, a não ser pelo `/handoff`. A atribuição manual do inbox também **não** passa por rota — é um UPDATE direto do navegador na tabela, controlado pela RLS.

### Telas

| Nome no menu / local | Rota | Arquivo | O que é |
| --- | --- | --- | --- |
| Caixa de entrada | `/inbox` | `src/app/(dashboard)/inbox/page.tsx:27` | Três painéis; deep link por `?c=<id>`; realtime com re-sync ao reconectar e ao voltar à aba |
| Caixa de entrada (lista, à esquerda) | `/inbox` | `src/components/inbox/conversation-list.tsx:50` | Ordena por `last_message_at` desc; filtros Todas/Não lidas/Abertas/Pendentes/Fechadas + etiquetas + empresa. Sem filtro por dono |
| Caixa de entrada (conversa, no centro) | `/inbox` | `src/components/inbox/message-thread.tsx:163` | Relógio de 24h, menu Status e menu Atribuir com bolinha de presença; zera não lidas ao abrir |
| Caixa de entrada (tarja de IA) | `/inbox` | `src/components/inbox/ai-thread-banner.tsx:73` | "IA respondendo" + Assumir, ou nota de transferência + Retomar IA |
| Caixa de entrada (ficha do contato, à direita) | `/inbox` | `src/components/inbox/contact-sidebar.tsx:29` | Telefone, etiquetas (só leitura), negócios e notas |
| Caixa de entrada (compositor) | `/inbox` | `src/components/inbox/message-composer.tsx` | Texto, mídia, áudio, modelos, mensagens interativas e respostas rápidas; travado para quem não pode enviar |
| Caixa de entrada (bolha) | `/inbox` | `src/components/inbox/message-bubble.tsx:321` | O selo "IA" só aparece quando `messages.ai_generated` é true |
| Caixa de entrada (ações da bolha) | `/inbox` | `src/components/inbox/message-actions.tsx` | Reagir, Responder, Copiar texto |
| Caixa de entrada (reações) | `/inbox` | `src/components/inbox/message-reactions.tsx` | Pílulas de emoji por mensagem |
| Caixa de entrada (citação) | `/inbox` | `src/components/inbox/reply-quote.tsx` | Prévia da mensagem citada |
| Caixa de entrada (modelos) | `/inbox` | `src/components/inbox/template-picker.tsx` | Modal de modelos aprovados da Meta |
| Caixa de entrada (respostas rápidas) | `/inbox` | `src/components/inbox/quick-reply-picker.tsx` | Escolha de snippet salvo |
| Notificações | `/notifications` | `src/app/(dashboard)/notifications/page.tsx:38` | Avisos de conversa atribuída; o clique abre `/inbox?c=<id>` |
| Agentes de IA → Configuração | `/agents?tab=setup` | `src/components/settings/ai-config.tsx:553-588` | "Passar para": membro específico ou "Fila sem atribuição"; aviso de transferência; teto de respostas |
| Agentes de IA → Limites | `/agents?tab=guardrails` | `src/app/(dashboard)/agents/page.tsx:128` | Palavras e assuntos que forçam transferência |
| Configurações → Membros da equipe | `/settings?tab=members` | `src/components/settings/members-tab.tsx:124` | Roster com presença ao vivo, papéis e convites |
| Configurações → Campos e etiquetas | `/settings?tab=fields` | `src/components/settings/tag-manager.tsx:103` | Criação/edição/exclusão de etiquetas (admin+) |
| Configurações → Respostas rápidas | `/settings?tab=quick-replies` | `src/components/settings/settings-sections.ts:33` | Catálogo de respostas rápidas da conta |
| Configurações → Avisos no celular | `/settings?tab=push` | `src/components/settings/settings-sections.ts:30` | Inscrição do aparelho e modo de aviso |
| Contatos | `/contacts` | `src/app/(dashboard)/contacts/page.tsx:109` | Onde a etiqueta é realmente posta num contato, e onde fica a importação de CSV |
| Automações (editor) | `/automations/[id]/edit` | `src/components/automations/automation-builder.tsx:1327` | Passo "Atribuir conversa" (Agente específico / Rodízio) e passos de etiqueta |
| Fluxos (editor) | `/flows/[id]` | `src/components/flows/forms/node-config-form.tsx:212` | Nó de handoff — só expõe a nota interna |

### Arquivos-chave

- `src/lib/conversations/handoff.ts` — a única implementação de transferência.
- `src/lib/conversations/reopen.ts` — o que uma conversa fechada perde ao ser reaberta.
- `src/lib/inbox/conversations.ts` — `CONVERSATION_SELECT`, achatamento de etiquetas e o filtro OU.
- `src/lib/ai/auto-reply.ts` — todos os portões do robô e os dois caminhos automáticos de transferência.
- `src/lib/whatsapp/send-message.ts` — prova o que um envio de atendente muda (e o que não muda).
- `src/app/api/whatsapp/webhook/route.ts` — toda a entrada.
- `src/lib/automations/engine.ts` — `assign_conversation`, `add_tag`, `remove_tag`, `close_conversation`.
- `src/lib/flows/engine.ts` — nó de handoff (`:435`) e handoff por fallback esgotado (`:1039`).
- `src/lib/contacts/tag-write.ts` e `tag-events.ts` — escrita de etiqueta e disparo de `tag_added`.
- `src/lib/presence.ts`, `src/hooks/use-presence.ts`, `src/components/presence/presence-heartbeat.tsx` — presença.
- `src/lib/push/send.ts` — quem recebe o aviso de "precisa de uma pessoa".
- `src/lib/auth/roles.ts` — hierarquia owner > admin > agent > viewer.
- `supabase/migrations/017_account_sharing.sql` — reescreveu toda a RLS deste subsistema.

### Lacunas conhecidas nesta documentação

- Não foi lido o corpo completo de `message-composer.tsx` nem de `contacts/page.tsx`; ambos foram descritos pelos pontos abertos, não pelo comportamento integral.
- O texto exato que a tela de Notificações mostra quando `actor_name` é nulo (atribuição feita por automação/regra) não foi verificado.
- O descasamento `?conversation=` vs `?c=` foi concluído por comparação de strings; `middleware.ts` não foi lido para descartar algum rewrite.
- Os webhooks de saída não foram investigados além dos três eventos emitidos aqui: `conversation.created`, `conversation.reopened` e `message.received`.
