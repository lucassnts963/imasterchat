# Disparos em massa, modelos de mensagem e avisos

Este é o pedaço do iMasterChat que fala com muita gente de uma vez e que avisa a equipe quando algo precisa de atenção. São quatro coisas que dividem a mesma espinha dorsal do WhatsApp: (1) o **disparo em massa**, uma campanha que manda um modelo aprovado pela Meta para uma lista de contatos e depois mostra quantos receberam, quantos leram e quantos responderam; (2) o **catálogo de modelos de mensagem**, que é a cópia local dos templates que existem na Meta, com os botões de enviar para aprovação, editar, apagar e sincronizar; (3) as **notificações dentro do app**, que hoje existem para um único fato — alguém atribuiu uma conversa a você; e (4) os **avisos no celular** (Web Push), que existem só para alcançar a atendente quando o app está fechado. As **reações com emoji** entram nesta mesma referência porque são gravadas pelas mesmas rotas de WhatsApp descritas aqui.

Três coisas precisam ficar claras antes de qualquer tutorial:

- **Agendar um disparo não existe.** A tela mostra "Rascunho" e o sistema entende o status "Agendado", mas não há no código nada que escreva uma data de agendamento nem nada que execute um disparo no futuro. Salvar rascunho é só guardar o nome; o envio é sempre "agora".
- **O disparo pelo painel acontece dentro do navegador da pessoa.** Quem manda os lotes para a Meta é a aba aberta. Fechar a aba no meio para o envio.
- **Aviso no celular não é a mesma coisa que notificação no app.** São dois sistemas separados, com regras diferentes e configuração diferente.

## Para que serve (visão do cliente)

O dono do negócio e a equipe conseguem:

- **Mandar a mesma mensagem para muitos clientes de uma vez**, usando um modelo já aprovado pela Meta (é a única forma de falar com quem não escreveu nas últimas 24 horas).
- **Escolher para quem vai**: todos os contatos, só quem tem certas etiquetas (podendo também excluir etiquetas), quem bate uma regra de campo personalizado, ou uma lista vinda de um arquivo CSV.
- **Personalizar a mensagem por pessoa**: cada variável do modelo ({{1}}, {{2}}...) pode receber um valor fixo, o nome/telefone/e-mail do contato ou um campo personalizado.
- **Acompanhar a campanha**: quantos foram enviados, entregues, lidos, quantos responderam e quantos falharam, com um funil e a lista de destinatário por destinatário.
- **Exportar a lista de destinatários em CSV** para conferir fora do sistema.
- **Criar e gerenciar os modelos de mensagem** dentro do próprio app: escrever, mandar para a análise da Meta, ver se foi aprovado ou rejeitado (e o motivo), editar e reenviar, apagar, ou trazer de uma vez os modelos que já existem na conta da Meta.
- **Ser avisado quando um colega atribuir uma conversa a você**, na tela Notificações, com contador de não lidas no menu lateral e atualização em tempo real.
- **Receber aviso no celular ou no computador com o app fechado**, escolhendo por aparelho entre três níveis: desligado, só quando o robô precisa de uma pessoa, ou toda mensagem de cliente.
- **Reagir a uma mensagem com emoji** na conversa, e ver as reações que o cliente mandou.

O que **não** existe e as pessoas costumam achar que existe:

- **Agendamento de disparo.** Não há campo de data no assistente e não há nada que execute um envio depois.
- **Pausar, cancelar ou retomar um disparo em andamento.** Uma vez começado, ele vai até o fim ou morre com a aba.
- **Reenviar só para quem falhou.** Não existe botão de reprocessar; seria uma campanha nova.
- **Fila ou processamento em segundo plano no painel.** Se a aba fechar, os destinatários que não foram ficam parados como "Pendente" para sempre.
- **Aviso de resposta de campanha, de erro de envio ou de qualquer outra coisa na tela Notificações.** O banco só aceita um tipo de notificação: conversa atribuída.
- **Central de aparelhos do push.** Não há tela que liste ou desconecte os avisos dos seus outros celulares/computadores; cada aparelho só desliga a si mesmo.
- **Modo offline.** O componente que entrega os avisos no celular não guarda nada para uso sem internet, de propósito.
- **Um limite de quantos contatos cabem em "todos os contatos".** Não há limite escrito no assistente; o teto real vem do banco e não foi medido.

## Como se usa, na prática

### Disparar uma campanha

1. Menu lateral → **Disparos em massa**. A lista mostra cada campanha com nome, modelo, número de destinatários, barra de entrega, barra de leitura, status e data. Enquanto houver campanha "Enviando", a tela se atualiza sozinha a cada 5 segundos (e pausa a atualização se você trocar de aba).
2. Botão **Novo disparo**. Ele só fica ativo para quem pode enviar mensagens (papel `agent` ou acima); para quem não pode, o botão aparece bloqueado.
3. **Passo 1 — Modelo.** Aparecem somente modelos com status APROVADO. Se a lista estiver vazia, o próprio passo manda criar um modelo em Configurações antes.
4. **Passo 2 — Público.** Quatro opções: *Todos os contatos*, *Filtrar por etiquetas* (com uma segunda lista de etiquetas para excluir), *Campo personalizado* (campo + operador É / Não é / Contém + valor) e *Upload de CSV* (arquivo com uma coluna `phone` em formato E.164 e, opcionalmente, `name`).
5. **Passo 3 — Personalizar.** Para cada variável do modelo, escolha *Valor fixo*, *Campo do contato* ou *Campo personalizado*. Se o modelo tem cabeçalho de imagem/vídeo/documento, aqui é onde se informa a **URL da mídia** — e ela é a mesma para todos os destinatários da campanha.
6. **Passo 4 — Revisar e enviar.** Dê o nome da campanha. Dois botões: **Salvar como rascunho** (grava a campanha vazia, sem destinatários, com status Rascunho) e **Enviar disparo**.
7. Durante o envio a tela mostra "Processando X de Y destinatários". **Não feche esta aba.** O envio é feito pelo próprio navegador, em lotes de 10 contatos com 1 segundo de pausa entre lotes.
8. Ao terminar, a campanha fica **Enviado** (ou **Falhou**, se nenhum destinatário tiver saído).

Se o público veio de CSV, os telefones do arquivo viram contatos de verdade na sua base antes do disparo (com deduplicação por telefone) — não é uma lista descartável.

### Acompanhar uma campanha

1. **Disparos em massa** → clique na campanha.
2. A tela traz seis números (Total de destinatários, Enviados, Entregues, Lidos, Responderam, Com falha), o funil Enviado → Entregue → Lido → Respondeu e a tabela de destinatários, com filtro por status e a coluna Erro para quem falhou.
3. **Exportar CSV** baixa a tabela de destinatários.
4. **Excluir** apaga a campanha e todos os destinatários dela. O botão fica desabilitado enquanto o status for "Enviando".
5. Esta tela **não** se atualiza sozinha: ela busca os dados uma vez ao abrir. Para ver o avanço das entregas e leituras, recarregue a página.

Se um contato for apagado depois da campanha, a linha continua no histórico do disparo, só que sem nome (aparece "Unknown").

### Criar um modelo de mensagem

1. Menu lateral → **Configurações** → aba **Modelos de mensagem**.
2. **Novo modelo**: nome (só letras minúsculas, números e underscore), categoria, idioma, cabeçalho opcional (texto, imagem, vídeo ou documento), corpo com as variáveis, rodapé e botões.
3. Salvar envia o modelo para análise da Meta e o status local passa a refletir o que a Meta diz: PENDING, APPROVED, REJECTED e assim por diante. Quando é rejeitado, o motivo devolvido pela Meta aparece na tela.
4. **Editar** um modelo aprovado dispara uma nova análise: o status volta para PENDENTE.
5. **Sincronizar da Meta** traz os modelos que já existem na sua conta do WhatsApp Business (inclusive os criados direto no Gerenciador da Meta). Essa sincronização nunca apaga um modelo que só existe aqui dentro.
6. **Excluir** apaga o modelo na Meta e depois localmente.
7. Modelos de categoria **Autenticação** não podem ser criados por aqui: crie no Gerenciador da Meta e traga com Sincronizar da Meta.

O nome e o idioma ficam congelados depois que o modelo existe na Meta. `pt_BR` e `pt` são idiomas diferentes para a Meta.

### Receber avisos no app

1. Menu lateral → **Notificações**. A lista traz até 100 avisos, do mais novo para o mais velho, e chega em tempo real — não precisa recarregar.
2. Clicar num aviso marca ele como lido e abre a conversa correspondente na Caixa de entrada.
3. **Marcar todas como lidas** limpa o contador de uma vez. O contador de não lidas também aparece ao lado de "Notificações" no menu lateral.
4. Só existe um tipo de aviso: alguém atribuiu uma conversa a você. Quem atribui uma conversa para si mesmo não recebe aviso.

### Ligar os avisos no celular

1. Menu lateral → **Configurações** → aba **Avisos no celular**.
2. Escolha um dos três modos: **Desligado**, **Só o que precisa de gente** (avisa quando o robô para e chama uma pessoa) ou **Toda mensagem** (avisa a cada mensagem de cliente).
3. O navegador vai pedir permissão para notificações. Sem permissão, nada funciona; se o navegador estiver bloqueando o site, a tela avisa para liberar nas configurações do navegador.
4. **A escolha vale só para aquele aparelho.** O celular pode avisar de tudo e o computador ficar quieto. Para ligar em outro aparelho, repita lá.
5. No iPhone é preciso instalar o app na tela de início antes (iOS 16.4 ou mais novo).
6. Se o servidor não tiver as chaves VAPID configuradas, a tela diz "Este servidor ainda não tem as chaves de notificação (VAPID) configuradas" e nenhuma opção funciona.

Escolher "Desligado" apaga o registro daquele aparelho no servidor e cancela a assinatura no navegador — não fica nada guardado.

### Reagir a uma mensagem

Na **Caixa de entrada**, o menu que aparece ao passar o mouse sobre a bolha da mensagem tem a opção de reagir com emoji. A reação vai para o WhatsApp do cliente e aparece na conversa; escolher o mesmo emoji de novo (reação vazia) remove. Reações que o cliente manda chegam pelo webhook e aparecem em tempo real.

## O que dá para configurar

| Ajuste | Onde | O que muda |
|---|---|---|
| Modo de aviso no celular deste aparelho (Desligado / Só o que precisa de gente / Toda mensagem) | Configurações → aba **Avisos no celular** | Define se e quando aquele navegador toca. Vale por aparelho, não por pessoa. Qualquer membro pode mexer no próprio |
| Criar, editar, reenviar e apagar modelo | Configurações → aba **Modelos de mensagem** | Altera o modelo aqui e na Meta. **Criar exige papel admin**; editar e apagar são barrados pela segurança do banco para quem não é admin, mas veja a pegadinha em "Limites e pegadinhas" |
| Sincronizar da Meta | Configurações → aba **Modelos de mensagem** | Traz até 2000 modelos da Meta (20 páginas de 100). **Exige papel admin** |
| Modelo, público, variáveis, URL de mídia e nome da campanha | Disparos em massa → Novo disparo | Monta o disparo. **Exige papel agent ou acima** |
| Salvar como rascunho | Disparos em massa → Novo disparo → passo Revisar e enviar | Cria a campanha com status Rascunho e zero destinatários. Não agenda nada |
| Filtro por status e Exportar CSV | Disparos em massa → detalhe da campanha | Só afeta a visualização e o arquivo baixado |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Variável de ambiente (`.env`, `Dockerfile`, `docker-compose.app.yml`) | Chave pública dos avisos no celular. Precisa estar presente **no build** e em runtime; sem ela o painel diz que o servidor não está configurado |
| `VAPID_PRIVATE_KEY` | Variável de ambiente (só servidor) | Chave privada dos avisos no celular. Sem ela nenhum push é enviado |
| `VAPID_SUBJECT` | Variável de ambiente | Identificação do remetente para o serviço de push (`mailto:` ou `https:`). Padrão embutido: `mailto:admin@imasterchat.app` |
| `WHATSAPP_TEMPLATES_DRY_RUN` | Variável de ambiente | Modo de ensaio: enviar, editar e apagar modelo não chamam a Meta; o modelo recebe um identificador falso `dry-run-<uuid>` |
| `WACRM_ENABLE_WRITES` + `WACRM_ENABLE_BROADCASTS` | Variáveis de ambiente do servidor MCP | Só com as duas ligadas a ferramenta `send_broadcast` fica disponível para um assistente externo — e ainda assim ela exige `confirm=true` na chamada |
| Cadência do disparo pelo painel (10 por chamada, 1 s entre lotes) | Código: `src/hooks/use-broadcast-sending.ts:62-63` | Ritmo do envio. Não há tela para isso |
| Orçamento de disparos (5 chamadas por 60 s por usuário) | Código: `src/lib/rate-limit.ts:123` | Ver a pegadinha dos 50 destinatários abaixo |
| Teto de destinatários da API pública (1000 por requisição) | Código: `src/lib/whatsapp/broadcast-core.ts:77` | Acima disso a requisição é recusada com 400 |
| Tempo máximo do envio da API pública (60 s) | Código: `src/app/api/v1/broadcasts/route.ts:37` | Passou disso, o envio é cortado no meio |
| Teto de aparelhos alcançados por aviso (200) e validade do aviso (1 h) | Código: `src/lib/push/send.ts:105` e `:126` | Quantos aparelhos da conta recebem cada push e por quanto tempo o serviço tenta entregar |
| Atualização automática da lista de disparos (5 s) | Código: `src/app/(dashboard)/broadcasts/page.tsx:28` | Frequência do polling |
| Textos dos avisos e do painel de push | `messages/pt-BR.json` (bloco `Notifications` e `Settings.push`) | Redação exibida ao usuário |

## Como funciona por dentro

### O caminho do disparo pelo painel

Todo o orquestrador é código de navegador (`src/hooks/use-broadcast-sending.ts`, `'use client'` na linha 1):

1. Resolve a audiência. Para "todos os contatos" é um `.select('*')` sem `.limit()` (`use-broadcast-sending.ts:161`). Para CSV, os telefones viram linhas em `contacts` antes de tudo, deduplicados por telefone e inseridos em lotes de 200 (`:219-288`).
2. Insere a linha em `broadcasts` direto pelo Supabase do cliente, com `status: 'sending'`, `total_recipients` preenchido e os cinco contadores semeados em zero (`:356`, `:371-377`).
3. Insere as linhas de `broadcast_recipients` com status `pending`. Se a inserção de um lote falhar, o hook marca a campanha inteira como `failed` e escreve `failed_count` à mão (`:407-413`) — é o único ponto do sistema que escreve um contador com valor diferente de zero fora do trigger.
4. Resolve as variáveis por contato, ordenando as chaves numericamente para que `{{1}}` venha antes de `{{10}}` (`:94-99`). Cabeçalho de mídia vira `messageParams.headerMediaUrl`, igual para todos (`:448-455`).
5. Chama `POST /api/whatsapp/broadcast` em lotes de 10, com `await sleep(1000)` entre lotes (`:62-63`, `:477`, `:553`), e escreve o status de cada destinatário conforme a resposta (`:507-546`).
6. No fim, vira o status da campanha para `sent` ou, se todos falharam, `failed` (`:561-565`).

A rota `/api/whatsapp/broadcast` **não escreve nada no banco**: ela lê `whatsapp_config` e `message_templates` e chama a Meta (`route.ts:123-162`). Todo o estado por destinatário é escrito pelo navegador.

### O caminho do disparo pela API pública

`src/lib/whatsapp/broadcast-core.ts` tem duas fases:

- `createBroadcast` (`:85-247`) valida (`template_name` obrigatório, `recipients` não vazio, máximo 1000), lê a configuração do WhatsApp, lê a linha do modelo (e aborta com `template_malformed` se ela estiver corrompida, `:137-143`), descarta telefones fora do E.164 contando-os como `rejected` sem criar linha (`:151-155`), colapsa destinatários que resolvem para o mesmo contato mantendo a primeira ocorrência (`:173-178`) e persiste `broadcasts` + `broadcast_recipients`. **Não semeia contadores** de propósito (`:188-206`).
- `deliverBroadcast` (`:262-327`) percorre os destinatários **sequencialmente e sem nenhuma pausa**, tentando variantes de telefone só quando o erro da Meta é "recipient not allowed" (`:291`), e atualiza a linha do destinatário para `sent` (com `whatsapp_message_id`) ou `failed`. No fim vira o status da campanha para `sent` se pelo menos um saiu.

A rota `POST /api/v1/broadcasts` responde **202 antes de enviar qualquer mensagem** (`route.ts:82-91`) e faz o fan-out dentro de `after()` (`:80`), com `maxDuration = 60` (`:37`). `GET /api/v1/broadcasts/{id}` serve para poll e filtra por `account_id` na mão (`:28`), devolvendo 404 para id de outra conta.

### Contadores

Os campos `sent_count`, `delivered_count`, `read_count`, `replied_count` e `failed_count` de `broadcasts` são propriedade de um **trigger incremental** no Postgres (`supabase/migrations/005_broadcast_counts_incremental.sql:62-99`), que soma e subtrai ±1 conforme o status da linha filha muda — não é um `COUNT(*)`. O modelo é de **escada cumulativa** (`005:47-59`): uma linha `read` conta ao mesmo tempo em `sent_count`, `delivered_count` e `read_count`; `pending` não conta em nada; `failed` só conta em `failed_count`. Existe `recompute_broadcast_counts(bid uuid)` (`005:107-129`) para recalcular tudo do zero à mão, se algum número ficar torto.

### Como o status de cada destinatário avança

Quem move a escada é o webhook da Meta (`src/app/api/whatsapp/webhook/route.ts`):

- `handleStatusUpdate` (`:386-472`) casa o evento com a linha por `whatsapp_message_id` (`:416-420`) e só aceita movimentos **para frente** em `pending → sent → delivered → read → replied` (`isValidStatusTransition`, `:372-384`); `failed` só é aceito vindo de `pending` ou `sent`.
- `flagBroadcastReplyIfAny` (`:482-511`) marca `replied` no destinatário mais recente daquele contato dentro da conta, desde que esteja em `sent`, `delivered` ou `read`.
- A unicidade de `whatsapp_message_id` é garantida por índice único parcial (`003:30-32`), o que impede correlação duplicada se a Meta reentregar o evento.

### Modelos de mensagem

O `status` guardado é o **enum cru da Meta** (DRAFT, PENDING, APPROVED, REJECTED, PAUSED, DISABLED, IN_APPEAL, PENDING_DELETION — `014:108-119`) e chega por três caminhos:

- `POST /api/whatsapp/templates/submit` — valida, manda para a Meta, faz upsert local por `(user_id, name, language)` (`:75`). Falha da Meta grava a linha como DRAFT com `submission_error` (`:193-200`) e devolve 429 quando a mensagem contém "429".
- `POST /api/whatsapp/templates/sync` — pagina de 100 em 100 com teto de 20 páginas (`:169-173`), casa por `(account_id, name, language)` para decidir update ou insert (`:242-287`), nunca apaga e devolve `truncated` quando bateu o teto.
- `src/lib/whatsapp/template-webhook.ts` — trata os campos de webhook da Meta e casa por `meta_template_id` **sem filtrar por conta** (`:136`), avisando no log quando casa em mais de uma linha (`:155-159`). O motivo de rejeição só é preenchido no evento REJECTED e é limpo em qualquer outra transição (`:126-131`).

### Notificações no app

Nascem **exclusivamente** de um gatilho no Postgres em `conversations` (`027_notifications.sql:116-118`) — não existe nenhum `insert` em `notifications` no código da aplicação. A partir da migração 055 o gatilho grava só os **fatos** (`actor_name`, `contact_name`) e deixa `title`/`body` nulos (`055:78-90`); quem monta a frase, na língua de quem lê, é a tela (`notifications/page.tsx:36-51`). Linhas anteriores à 055 continuam sendo exibidas com o texto em inglês gravado no banco, porque a tela respeita `n.title` quando ele existe (`:37`). Quando `actor_name` é nulo, a tela usa a frase "Uma conversa com X foi atribuída a você" em vez de inventar um nome. O gatilho não notifica quem se atribui a si mesmo, e essa checagem só roda quando existe `auth.uid()` — uma atribuição feita por service-role sempre notifica (`055:62-64`). O gatilho engole os próprios erros: uma falha ao criar o aviso nunca derruba a atribuição da conversa (`055:93-97`).

A tabela está na publicação de Realtime com `REPLICA IDENTITY FULL` (`027:31`, `:123-131`); a tela (`:83-117`) e o contador do menu lateral (`use-unread-notifications.ts:33-54`) assinam mudanças.

### Avisos no celular (Web Push)

Tudo está em `src/lib/push/send.ts`:

- `isPushConfigured()` (`:41-71`) lê `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` e **cacheia o resultado em módulo** — mudar a variável exige reiniciar o processo.
- `sendPushToAccount()` (`:81-161`) sai calado se não houver VAPID (`:92`), lê no máximo 200 assinaturas da conta (`:105`), manda com TTL de 1 hora (`:126`), apaga assinaturas mortas quando o serviço devolve 404 ou 410 (`:135-145`) e **nunca lança** (`:157-160`).
- A regra de quem recebe: um evento urgente (`human_needed`) alcança **os dois modos**; um evento comum (`all`) alcança só quem escolheu "Toda mensagem" (`:103`).
- O texto do aviso é cortado em 120 caracteres com reticências (`:164-167`).

Existem exatamente **dois** eventos que geram push: mensagem nova do cliente (urgência `all`, `webhook/route.ts:911-925`) e transferência para humano (urgência `human_needed`, com `urgent: true`, `src/lib/conversations/handoff.ts:139-149`). O push de mensagem nova só sai se a conta não estiver bloqueada por cobrança e se o texto não for vazio (`webhook:911`).

O componente de entrega no navegador é `public/sw.js`: **sem handler de fetch de propósito** (comentário `:8-15`), só mostra a notificação (`:29-57`) e trata o clique reaproveitando uma aba já aberta (`:59-79`). Só a transferência para humano faz o aparelho vibrar (`:53`). Avisos são agrupados por conversa via `tag` (`:48`), então cinco mensagens do mesmo cliente viram um aviso que se atualiza. O registro do service worker acontece **só** quando a pessoa escolhe um modo nas Configurações (`push-notifications.tsx:93`) — é o único `navigator.serviceWorker.register` de todo o `src/`.

A assinatura é por **navegador**, não por pessoa: `endpoint` é UNIQUE (`051:38`) e o upsert usa `onConflict: 'endpoint'` (`subscribe/route.ts:102`), então o mesmo aparelho nunca acumula linhas e é re-associado à conta atual se o usuário trocar de conta. Desligar apaga a linha e chama `sub.unsubscribe()` no navegador (`push-notifications.tsx:99-105`).

### Reações

Reação é estado por `(mensagem, ator)`, nunca uma mensagem nova: emoji vazio apaga, emoji preenchido faz upsert com `onConflict: 'message_id,actor_type,actor_id'` — tanto pelo webhook do cliente (`webhook/route.ts:563-591`) quanto pela rota do atendente (`react/route.ts:127-154`). A rota recusa reagir a mensagem que não tem identificador da Meta (`react/route.ts:58-65`).

## Limites e pegadinhas

**Disparo pelo painel trava a partir de mais ou menos 50 destinatários.** O endpoint aceita 5 chamadas por 60 segundos por usuário (`rate-limit.ts:123`) e o painel gasta uma chamada por lote de 10, com 1 segundo entre lotes. Pela leitura do código, o sexto lote (a partir do 51º destinatário) cai na mesma janela e recebe 429; quando um lote volta com erro, o hook marca **os 10 destinatários daquele lote como "Com falha"**, com a mensagem de erro gravada na linha (`use-broadcast-sending.ts:489-491`, `:535-546`). Esse encadeamento não foi verificado com um disparo real — o que o cliente vê na tela nesse momento não foi observado. Para listas grandes, o caminho correto hoje é a API pública, não o painel.

**O limitador é um Map na memória do processo** (`rate-limit.ts:46`): o teto de 5/min vale por instância do servidor e não é compartilhado entre réplicas.

**Fechar a aba durante o envio para o disparo no meio.** Como o orquestrador é o navegador, os destinatários que ainda não foram ficam em "Pendente" e a campanha fica presa em "Enviando". **Não existe nenhum cron, fila ou rotina de reprocessamento** para destinatários presos em "Pendente" — nem para o painel, nem para o estouro dos 60 segundos da API pública.

**A API pública pode estourar o tempo.** O envio roda depois da resposta, com teto de 60 segundos; o próprio código registra que uma audiência perto do limite de 1000 pode estourar esse tempo e deixar linhas em "Pendente" com a campanha presa em "Enviando" (`v1/broadcasts/route.ts:29-37`). O envio ali é sequencial e **sem nenhuma pausa** entre destinatários; se a Meta impõe algum limite de taxa que isso violaria, não está documentado no repositório.

**A tela de detalhe da campanha não se atualiza sozinha.** Nem `broadcasts` nem `broadcast_recipients` estão na publicação de Realtime; a lista faz polling de 5 segundos, mas o detalhe busca uma vez só ao abrir. Para ver entregas e leituras chegando, recarregue.

**Telefones inválidos na API pública somem da campanha.** Eles são contados no campo `rejected` da resposta do POST e não viram linha em `broadcast_recipients` — quem não guardar a resposta perde essa informação.

**Destinatários repetidos na API pública são colapsados.** Dois números que resolvem para o mesmo contato viram um envio só.

**"Agendado" é fantasma.** A coluna `broadcasts.scheduled_at` existe (`001:302`), o status "scheduled" é aceito pelo banco e traduzido como "Agendado" na tela, e o tipo TypeScript declara o campo — mas nada em `src/` escreve nessa coluna e não há executor. Um tutorial jamais deve prometer agendamento.

**Rascunho não é campanha pela metade.** Salvar rascunho grava a campanha com zero destinatários; a audiência escolhida no assistente **não** é guardada. Voltar depois significa refazer os passos.

**Cabeçalho de mídia é uma URL só para toda a campanha.** Não dá para variar a imagem por destinatário.

**Apagar modelo pode apagar na Meta mesmo sem permissão.** As rotas `PATCH` e `DELETE` de `/api/whatsapp/templates/{id}` **não fazem nenhuma checagem de papel no código** (`templates/[id]/route.ts:70-81`, `:245-268`) — diferente de `submit` e `sync`, que exigem admin. A rota de DELETE chama a Meta **antes** de apagar a linha local (`:280-304`, depois `:306-309`); a segurança do banco só protege a linha local. Na prática, um membro sem papel de admin consegue provocar a exclusão do modelo na Meta. Trate isso como defeito conhecido, não como comportamento a documentar para o cliente.

**O link do aviso no celular não abre a conversa.** O push é montado com `/inbox?conversation=<id>` (`webhook/route.ts:918` e `handoff.ts:145`), mas a Caixa de entrada lê o parâmetro `c` (`inbox/page.tsx:44`). Clicar no aviso abre a Caixa de entrada sem selecionar a conversa. O aviso da tela **Notificações** não tem esse problema: ele navega com `?c=` (`notifications/page.tsx:149`).

**Aviso no celular não avisa sobre atribuição de conversa.** Só existem dois gatilhos de push: mensagem nova de cliente e transferência para humano. Quem depende de saber que recebeu uma conversa precisa olhar a tela Notificações.

**A notificação no app só tem um tipo.** O banco trava `type` em `conversation_assigned` (`027:9-10`). Qualquer pedido de "me avisa quando a campanha terminar" ou "me avisa quando o cliente responder" não tem onde nascer hoje.

**Cada aparelho é uma ilha.** Não há tela que mostre em quais celulares/computadores você ligou os avisos, e nem o administrador consegue ver ou apagar a assinatura de um colega — as quatro regras de segurança da tabela usam o próprio usuário (`051:71-87`). Também não foi verificado o que acontece quando duas contas diferentes assinam push no mesmo navegador.

**As chaves VAPID precisam existir no momento do build.** A chave pública é lida do bundle do cliente (`push-notifications.tsx:119`); injetar a variável só em runtime não resolve. E o resultado da checagem é cacheado em memória: depois de configurar, reinicie o processo.

**O webhook de modelos não vem ligado por padrão na Meta.** Sem ligar os campos à mão no painel do App na Meta, o status dos modelos só se atualiza quando alguém clica em "Sincronizar da Meta" (`template-webhook.ts:15-21`).

**O webhook de modelo casa por identificador da Meta sem filtrar conta.** Se o mesmo `meta_template_id` aparecer em mais de uma linha, todas são atualizadas (com um aviso no log).

**Dois colegas da mesma conta podem criar linhas locais duplicadas para o mesmo modelo.** O índice único ainda é por `(user_id, name, language)`, não por conta (`014:190-191`; TODO em `templates/submit/route.ts:68-75`).

**Qualquer agente pode mexer na reação de qualquer um.** Depois da migração 017, a regra de segurança de `message_reactions` deixou de exigir que o ator seja você (`009:80-89` versus `017:584-598`).

**Um viewer não vê "Novo disparo" ativo**, mas a proteção real do disparo pelo painel está na rota (`requireRole('agent')`) e nas regras do banco — a tela só esconde o botão.

**O que não foi medido:** quantos contatos realmente voltam em "todos os contatos" (a consulta não tem `.limit()`; o teto vem da configuração do PostgREST, que não foi encontrada configurada no repositório); se a Meta de fato entrega o evento "sent"; e o estado final dos privilégios de coluna da tabela `notifications` — a migração 027 tentou permitir UPDATE só em `read_at`, mas a migração 044 faz `GRANT ALL` em todas as tabelas do schema, o que pela ordem de aplicação anula essa restrição (a segurança por linha continua valendo: cada um só mexe nas próprias notificações).

## Referência

### Tabelas

| Tabela | Para que serve | Migração de origem | Quem pode ler / escrever |
|---|---|---|---|
| `broadcasts` | A campanha: nome, modelo, filtro de audiência, status e contadores agregados | `001_initial_schema.sql:294`; conta e regras finais em `017_account_sharing.sql:185,285,304,448-452` | Ler: qualquer membro. Inserir/alterar/apagar: `agent` ou acima |
| `broadcast_recipients` | Uma linha por contato dentro da campanha; fonte de verdade do status e ponto de ligação com o id de mensagem da Meta | `001:321`; `003_broadcast_recipient_wamid.sql:26-36`; `004_contact_delete_set_null.sql:26-44`; `017:533-541` | Ler: qualquer membro da conta dona da campanha. Escrever: `agent` ou acima |
| `message_templates` | Catálogo local dos modelos da Meta, com status cru, motivo de rejeição e nota de qualidade | `001:211`; `014_message_templates_meta_integration.sql`; `017:182,282,301,427-431` | Ler: qualquer membro. Inserir/alterar/apagar: `admin` ou acima |
| `notifications` | Aviso dentro do app; hoje só "conversa atribuída a você" | `027_notifications.sql`; `055_notifications_i18n.sql` | Cada pessoa lê e atualiza só as suas. Não há regra de INSERT nem de DELETE para o cliente — as linhas nascem do gatilho |
| `push_subscriptions` | Uma linha por navegador, com endpoint, chaves e o modo de aviso daquele aparelho | `051_push_subscriptions.sql` | Cada pessoa vê e mexe só nas suas, mesmo sendo admin |
| `message_reactions` | Uma reação (emoji) por (mensagem, ator); ator pode ser cliente ou atendente | `009_message_actions.sql:42-114`; `017:571-598` | Ler: qualquer membro. Escrever/apagar: `agent` ou acima, sem distinguir de quem é a reação |

Detalhes que importam:

- `broadcasts.status` aceita `draft`, `scheduled`, `sending`, `sent`, `failed` (`001:303`). `scheduled` nunca é escrito pelo sistema.
- `broadcast_recipients.status` aceita `pending`, `sent`, `delivered`, `read`, `replied`, `failed` (`001:325`).
- `broadcast_recipients.contact_id` deixou de ser obrigatório e virou `ON DELETE SET NULL` na migração 004 — apagar contato não apaga o histórico.
- Apagar a campanha apaga os destinatários em cascata (`001:323`).
- `message_templates.status` aceita `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`, `IN_APPEAL`, `PENDING_DELETION` (`014:108-119`), com padrão `DRAFT`.
- `message_templates.buttons` é JSONB com no máximo 10 elementos (`014:142-150`).
- `notifications.type` só aceita `conversation_assigned` (`027:9-10`). `title` deixou de ser obrigatório na 055 e está marcada como legado.
- `push_subscriptions.notify_mode` é o enum `push_notify_mode` com `all` e `human_needed`, padrão `human_needed` (`051:20-28`). "Desligado" não é um valor: é a ausência da linha.
- `message_reactions` é única por `(message_id, actor_type, actor_id)` (`009:50`).

### Rotas

| Método | Rota | Autenticação e papel exigido | O que faz |
|---|---|---|---|
| POST | `/api/whatsapp/broadcast` | Sessão, `requireRole('agent')` (`:75`), com portão de cobrança; limite de 5 chamadas/60 s por usuário (`:80`) | Envia o modelo para uma lista de telefones chamando a Meta e devolve o resultado por telefone. Não escreve no banco. Aceita `recipients:[{phone,params,messageParams}]` e a forma legada `phone_numbers[] + template_params[]` |
| POST | `/api/v1/broadcasts` | Chave de API com escopo `broadcasts:send` (`:48`); 120 req/min por chave; cliente service-role (a isolação por conta é feita no código, não pelas regras do banco) | Cria a campanha e as linhas de destinatário, responde 202 e envia depois, em segundo plano (limite de 60 s). Corpo: `template_name`, `template_language`, `name`, `recipients:[{to,params}]`, máximo 1000 |
| GET | `/api/v1/broadcasts/{id}` | Chave de API com escopo `broadcasts:send` (`:19`); filtro manual por conta (`:28`) | Devolve status e contadores da campanha para poll. Id de outra conta cai em 404 |
| GET | `/api/push/subscribe` | Sessão, qualquer membro (`:22`) | Diz se o servidor tem VAPID e se aquele endpoint de navegador já está assinado, com o modo atual |
| POST | `/api/push/subscribe` | Sessão, qualquer membro (`:51`) | Registra ou atualiza a assinatura do navegador (upsert por `endpoint`). Devolve 400 com `push_not_configured` se faltar VAPID. Modo inválido cai para `human_needed`; user agent é cortado em 200 caracteres |
| DELETE | `/api/push/subscribe` | Sessão, qualquer membro (`:118`) | Apaga a linha daquele endpoint, filtrando também pelo usuário |
| POST | `/api/whatsapp/templates/submit` | Sessão, `requireRole('admin')` (`:102`) | Valida e envia o modelo para aprovação da Meta; upsert local por `(user_id,name,language)`. Recusa categoria `Authentication`. Respeita `WHATSAPP_TEMPLATES_DRY_RUN` |
| PATCH | `/api/whatsapp/templates/{id}` | Sessão apenas; **sem checagem de papel no código** (`:60-81`) — quem barra é a regra do banco (`admin`) | Edita o modelo na Meta e devolve o status local para PENDING. Só aceita modelos em APPROVED, REJECTED ou PAUSED e exige identificador da Meta |
| DELETE | `/api/whatsapp/templates/{id}` | Sessão apenas; **sem checagem de papel no código** (`:245-268`) | Apaga na Meta (quando há identificador e não é ensaio) e depois apaga a linha local |
| POST | `/api/whatsapp/templates/sync` | Sessão, `requireRole('admin')` (`:136`) | Puxa os modelos da Meta (100 por página, até 20 páginas), atualiza ou insere por `(account_id,name,language)`, nunca apaga, sinaliza `truncated` |
| POST | `/api/whatsapp/react` | Sessão, `requireRole('agent')` (`:27`); limite de 120/min por usuário | Manda a reação para a Meta e espelha em `message_reactions`. Emoji vazio apaga |
| POST | `/api/whatsapp/webhook` | Assinatura HMAC da Meta; inválida devolve 401 (`:184-193`). Depois roda com service-role | Faz o status por destinatário avançar, marca "respondeu", grava reações do cliente, atualiza status e qualidade dos modelos e dispara o aviso de mensagem nova |
| GET | `/api/whatsapp/webhook` | `hub.verify_token` comparado com o token de cada linha de `whatsapp_config` (`:113-135`) | Handshake de verificação do webhook da Meta |

### Telas

| Nome no menu / caminho | Rota | O que traz |
|---|---|---|
| Disparos em massa | `/broadcasts` | Lista de campanhas com barras de entrega e leitura; atualiza a cada 5 s enquanto houver campanha enviando e pausa com a aba escondida; botão "Novo disparo" bloqueado para quem não pode enviar |
| Disparos em massa → Novo disparo | `/broadcasts/new` | Assistente de 4 passos (Modelo, Público, Personalizar, Revisar e enviar) e o botão "Salvar como rascunho" |
| Disparos em massa → detalhe | `/broadcasts/[id]` | Seis cartões de estatística, funil, tabela de destinatários com filtro por status, exportação CSV e exclusão com confirmação (bloqueada enquanto envia). Sem atualização automática |
| Notificações | `/notifications` | Até 100 avisos, em tempo real, com marcar-como-lida e marcar-todas; clicar abre a conversa |
| Configurações → Avisos no celular | `/settings?tab=push` | Três opções por aparelho (Desligado, Só o que precisa de gente, Toda mensagem). Único lugar que registra o service worker |
| Configurações → Modelos de mensagem | `/settings?tab=templates` | Criar, editar, reenviar, apagar e "Sincronizar da Meta" |
| Caixa de entrada (conversa aberta) | `/inbox` | Renderiza e assina em tempo real as reações das mensagens |
| Painel | `/dashboard` | O feed de atividade mostra as 5 campanhas mais recentes, com link para Disparos em massa |

### Ferramenta MCP

`send_broadcast` (`mcp-server/src/tools/broadcast.ts`) só é registrada quando `WACRM_ENABLE_WRITES` **e** `WACRM_ENABLE_BROADCASTS` estão ligadas, e ainda recusa a chamada sem `confirm=true` (`:52-59`).
