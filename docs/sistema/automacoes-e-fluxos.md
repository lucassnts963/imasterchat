# Automações, fluxos e o agendador

O iMasterChat tem dois motores diferentes que respondem ao cliente sem ninguém digitar. As **Automações** são uma receita linear: acontece um evento (chegou mensagem, alguém ganhou uma etiqueta) e o sistema executa uma lista de passos de cima para baixo, com uma bifurcação de "se/senão" e a possibilidade de esperar minutos, horas ou dias antes de continuar. Os **Fluxos** são um chatbot de verdade: um mapa de perguntas e botões onde o cliente escolhe caminhos, e o sistema guarda em que ponto cada contato parou para retomar quando ele responder. Sustentando os dois existe um terceiro componente, invisível para o cliente e decisivo na prática: um **agendador** (um contêiner chamado `cron`, que roda ao lado da aplicação) que a cada cinco minutos bate em duas portas do sistema — uma que executa as esperas vencidas das automações, outra que aposenta conversas de fluxo abandonadas. Sem esse agendador rodando, o passo "Espera" nunca acorda e nenhuma execução de fluxo termina por tempo.

---

## Para que serve (visão do cliente)

### Automações

Uma automação é uma regra do tipo "quando acontecer isso, faça aquilo". O dono da ótica configura uma vez e ela roda sozinha, dia e noite.

O que ela consegue fazer, passo a passo:

- Enviar uma mensagem de texto para o cliente.
- Enviar botões de resposta rápida (até 3) ou uma lista de opções tocável.
- Enviar um modelo aprovado pela Meta (para falar com quem já está fora da janela de 24 horas).
- Colocar ou tirar uma etiqueta do contato.
- Atribuir a conversa a um atendente.
- Preencher um campo do contato (nome, e-mail, empresa ou um campo personalizado).
- Criar um negócio no funil.
- Esperar um tempo (minutos, horas ou dias) e só então continuar.
- Ramificar: "se o contato tem a etiqueta X, faça isto; senão, faça aquilo".
- Chamar um sistema externo por webhook.
- Fechar a conversa.

E o que pode acionar tudo isso:

| Gatilho (nome na tela) | Quando dispara |
|---|---|
| Nova mensagem recebida | Qualquer mensagem que o cliente mandar |
| Primeira mensagem do contato | Só na primeira vez que aquele contato escreve |
| Correspondência de palavra-chave | A mensagem contém uma das palavras que você listou |
| Resposta de botão / lista | O cliente toca em um botão cujo ID você definiu |
| Novo contato criado | Um contato novo aparece a partir de uma mensagem recebida |
| Etiqueta adicionada | Alguém (ou outra automação, ou um fluxo) coloca uma etiqueta no contato |
| Conversa atribuída | Aparece na tela, mas **nada no sistema aciona este gatilho** — veja "Limites e pegadinhas" |
| Baseado em horário | Aparece na tela e pede uma expressão cron, mas **nada no sistema aciona este gatilho** |

Casos típicos: mandar a mensagem de boas-vindas para quem escreve pela primeira vez; avisar o horário de funcionamento fora do expediente; perguntar o que a pessoa procura e etiquetar conforme a resposta; esperar dois dias depois do orçamento e mandar um lembrete.

### Fluxos

Um fluxo é o menu de atendimento. O cliente manda "oi", recebe uma pergunta com botões, toca em um deles, e o sistema o leva para o próximo passo. Ele lembra onde cada pessoa parou.

Os blocos disponíveis na tela (nome exato do menu de nós):

| Bloco | O que faz |
|---|---|
| Início | Ponto de entrada do fluxo |
| Enviar mensagem | Manda um texto |
| Enviar botões | Manda até 3 botões; cada botão leva a um bloco diferente |
| Enviar lista | Manda uma lista tocável de opções (até 10 no total) |
| Enviar mídia | Manda uma imagem, vídeo ou documento que você subiu |
| Coletar resposta | Faz uma pergunta e guarda o que o cliente escreveu numa variável |
| Se / senão | Ramifica por etiqueta, campo do contato ou variável capturada |
| Etiquetar contato | Adiciona ou remove uma etiqueta |
| Transferir para agente | Passa a conversa para um humano e encerra o fluxo |
| Fim | Encerra o fluxo como concluído |

O que o cliente digitou num bloco "Coletar resposta" pode ser reaproveitado nas mensagens seguintes escrevendo `{{vars.nome_da_variavel}}`.

### O que os dois têm em comum

Ambos só agem sobre mensagens que chegam pelo WhatsApp. Ambos param de agir se a conta estiver com cobrança pendente ou bloqueada: a mensagem do cliente continua sendo gravada e aparecendo na caixa de entrada, mas nenhum robô responde.

---

## Como se usa, na prática

### Criar uma automação

1. No menu lateral, abra **Automações**. A tela lista o que já existe e mostra, no topo, os **Modelos de início rápido**.
2. Clique em **Criar automação** (ou em um dos modelos, que já abre o construtor preenchido). Esse botão só aparece habilitado para quem tem papel de agente ou acima; um visualizador vê a lista, mas não cria.
3. No construtor, escolha o **Tipo de gatilho**. Dependendo do gatilho, aparece um campo extra: **Palavras-chave** (lista separada por vírgula), **IDs de resposta** (os IDs dos botões, correspondência exata) ou **Agendamento** (expressão cron).
4. Clique em **Adicionar etapa** e monte a sequência. A etapa **Condição (Se/Senão)** cria dois ramos, **Sim** e **Não**, e você adiciona etapas dentro de cada um.
5. Ligue o interruptor **Ativa** e clique em **Salvar**.
6. Se algo estiver faltando (uma automação de palavra-chave sem palavra-chave, um passo de enviar mensagem sem texto), o salvamento é recusado e a tela mostra a lista do que precisa ser corrigido. Você pode salvar como rascunho sem passar por essa validação: basta deixar **Ativa** desligado.

Na lista de **Automações**, cada linha tem um interruptor para ativar/pausar na hora e um menu com **Editar**, **Duplicar**, **Ver logs** e **Excluir**. A cópia sempre nasce desativada, com "(Copy)" no nome.

**Ver logs** abre o histórico das últimas 100 execuções daquela automação: quem foi o contato, quando, se deu **sucesso**, **parcial** ou **falhou**, e — expandindo a linha — cada etapa que rodou e o que ela devolveu. É a primeira tela a abrir quando o cliente diz "não recebi a mensagem".

### Criar um fluxo

1. No menu lateral, abra **Fluxos** (aparece com o rótulo "Beta" ao lado; é só um rótulo, não restringe nada).
2. Clique em **Novo fluxo**. A janela oferece **Começar a partir de um modelo** (três modelos prontos) ou **Criar fluxo em branco**, que só pede um nome.
3. O editor abre com duas visões, alternadas pelos botões **Canvas** e **Lista**. A visão Lista mostra os nós um embaixo do outro com seus formulários; o Canvas mostra o mapa, e você liga um bloco no outro arrastando entre os pontos de conexão.
4. No topo, defina o **Gatilho**: "Uma mensagem contém uma palavra-chave" (com o campo **Palavras-chave**), "Primeira mensagem já recebida do cliente" ou "Somente manual".
5. Adicione os nós com **Adicionar nó** e escolha o **Nó de entrada** — o bloco por onde a conversa começa. Sem nó de entrada, o fluxo não ativa.
6. Cada nó tem uma **Chave do nó**: o identificador interno. Ele aparece no histórico de execuções, então vale manter estável.
7. Salve e mude o status para **Ativo**. Se o mapa tiver defeito (um botão apontando para um bloco que não existe, um bloco inalcançável, texto acima do limite do WhatsApp), a ativação é recusada e a tela lista os erros. Voltar para **Rascunho** ou **Arquivado** nunca é validado.

Para diagnosticar, abra o fluxo e vá em **Execuções**: as 50 mais recentes, com o contato, o nó onde cada uma parou, quantos reenvios de pergunta houve, e — expandindo — a linha do tempo completa (nó entrou, mensagem enviada, resposta recebida, transferência, erro).

### Subir um arquivo para o nó Enviar mídia

No formulário do nó, escolha o arquivo. Ele vai para um armazenamento **público** — o WhatsApp precisa baixá-lo sem autenticação. O limite é 16 MB e os formatos aceitos são: PNG, JPEG, WebP, MP4, 3GPP, PDF, Word, Excel, PowerPoint (incluindo os formatos novos do Office) e texto puro.

### Ligar o agendador

Isso não é feito por tela. No servidor, o arquivo `.env` precisa ter `AUTOMATION_CRON_SECRET` preenchido. Se ele estiver vazio, o contêiner `cron` imprime um aviso e fica dormindo — nada quebra visivelmente, mas o passo **Espera** de toda automação fica preso para sempre e nenhuma execução de fluxo é aposentada por tempo. Quem tem acesso de administrador de plataforma consegue ver se a ronda está rodando na tela de **Administração**; ela acusa atraso depois de 2 horas sem sinal.

---

## O que dá para configurar

| Ajuste | Onde | O que muda | Exige papel |
|---|---|---|---|
| Ativar / pausar automação | Interruptor na tela **Automações** | A automação passa (ou deixa de passar) a responder aos gatilhos | agente |
| Gatilho da automação e sua configuração | Construtor de automação | Qual evento aciona; palavras-chave, IDs de resposta ou agendamento | agente |
| Etapas da automação (13 tipos) | Construtor de automação, **Adicionar etapa** | O que a automação faz e em que ordem | agente |
| Duração da etapa Espera | Construtor, campos **Quantidade** e **Unidade** (Minutos / Horas / Dias) | Quanto tempo até a automação continuar. Mínimo efetivo de 1 segundo | agente |
| Modo do passo Atribuir conversa | Construtor: **Rodízio** ou **Agente específico** | Para quem a conversa vai. Veja a pegadinha do Rodízio abaixo | agente |
| Excluir / duplicar automação | Menu da linha na tela **Automações** | Duplicata nasce desativada | agente |
| Status do fluxo (Rascunho / Ativo / Arquivado) | Cabeçalho do editor de **Fluxos** | Só "Ativo" responde a mensagem de cliente; só "Ativo" é validado | agente |
| Gatilho do fluxo e palavras-chave | Editor de fluxo, seção **Gatilho** | O que faz o fluxo começar | agente |
| Nó de entrada e o grafo de nós | Editor de fluxo (Lista ou Canvas) | Todo o desenho da conversa | agente |
| Arquivo do nó Enviar mídia | Formulário do nó | Imagem/vídeo/documento enviado. Teto de 16 MB no navegador | agente |
| Política de fallback do fluxo (`fallback_policy`) | **Não tem tela.** Só por chamada direta à API `PUT /api/flows/[id]` ou alteração no banco | Como o fluxo reage a resposta que não casa com nenhuma opção, quantos reenvios tenta, quantas horas até considerar abandonado, e o que fazer ao esgotar | — |
| `AUTOMATION_CRON_SECRET` | Variável de ambiente (`.env`) | Sem ela, as cinco rotas agendadas respondem 503 e o contêiner de cron nem tenta | administrador do servidor |
| `CRON_INTERVAL_SECONDS` | Variável de ambiente (padrão 300) | Segundos entre uma varredura e outra de automações e fluxos | administrador do servidor |
| `KEEPER_EVERY_TICKS` | Variável de ambiente (padrão 6) | A cada quantas varreduras o agendador também chama a cotação do dólar e o keeper de IA | administrador do servidor |
| `HEALTH_EVERY_TICKS` | Variável de ambiente (padrão 12) | A cada quantas varreduras o agendador chama a ronda de saúde. Com o padrão, 1 hora | administrador do servidor |
| `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL` | Variáveis de ambiente | Sem elas os dois motores não conseguem gravar nada | administrador do servidor |
| Teto de encadeamento de etiquetas (3 níveis) | Constante no código, sem tela nem variável | Quantas automações de "Etiqueta adicionada" podem se acionar em cadeia | — |
| Teto de 50 esperas por varredura e de 64 saltos por execução de fluxo | Constantes no código | Vazão do agendador e proteção contra laço infinito no fluxo | — |
| Modelos prontos (4 de automação, 3 de fluxo) | Estáticos no código | O que aparece em "Modelos de início rápido" e na galeria de fluxos | — |

Valores padrão da política de fallback do fluxo, aplicados campo a campo quando o campo está ausente ou malformado: reenviar a pergunta ao não entender, no máximo 2 reenvios, considerar abandonado depois de 24 horas, e transferir para um humano ao esgotar os reenvios.

---

## Como funciona por dentro

### O caminho de uma mensagem recebida

Tudo começa em `POST /api/whatsapp/webhook` (`src/app/api/whatsapp/webhook/route.ts`), autenticado pela assinatura HMAC da Meta contra o corpo cru (linhas 183-193). O processamento pesado roda dentro de `after()` (linha 215), depois da resposta ao Meta.

A ordem importa:

1. Se a conta está com cobrança pendente ou bloqueada, a mensagem é gravada e os efeitos colaterais são pulados (linhas 797-802, 824-825, 887).
2. **Fluxos primeiro**: `dispatchInboundToFlows` (linha 825).
3. **Automações depois**: `runAutomationsForTrigger` num laço **aguardado** dentro do `after()` (linhas 881-901) — aguardado de propósito, porque uma promessa solta pode ser congelada em runtime serverless.
4. Se o fluxo consumiu a mensagem, o webhook **suprime** os gatilhos de conteúdo `new_message_received`, `keyword_match` e `interactive_reply`, mas mantém `new_contact_created` e `first_inbound_message` (linhas 859-880).

### Motor de automações (`src/lib/automations/engine.ts`)

- `runAutomationsForTrigger` busca automações por `account_id` + `trigger_type` + `is_active=true` (linhas 95-100). O escopo é a **conta**, não o usuário.
- Antes de qualquer passo, confirma que o `contact_id` pertence à conta; se não pertence, aborta em silêncio (linhas 78-93). Como o motor escreve com a chave `service_role`, que ignora a RLS, essa é a única barreira.
- A função nunca lança: o corpo inteiro está em try/catch e cada automação tem o seu (linhas 110-118).
- `executeAutomation` cria a linha de `automation_logs` **antes** de rodar qualquer passo, já com `status='failed'` (linhas 192-200), para que uma execução interrompida no meio não pareça sucesso.
- `execution_count` é incrementado por RPC atômica `increment_automation_execution_count` (linhas 225-227).
- `executeStepsFrom` roda os passos em ordem. Se um passo falhar, o laço para com `break`, o status vira `failed` e a mensagem de erro é gravada (linhas 336-347). O status final só é escrito no escopo raiz; escopos de ramo não sobrescrevem (linhas 350-355).
- **Condição**: `evaluateCondition` avalia quatro assuntos — presença de etiqueta, campo do contato, conteúdo da mensagem e hora do dia (linhas 692-742) — e o ramo escolhido roda recursivamente a partir da posição 0 (linhas 308-326).
- **Espera**: o passo `wait` insere uma linha em `automation_pending_executions` com `run_at = agora + duração`, marca o log como `partial` e **retorna**, abandonando o escopo (linhas 279-305). A duração é `amount ×` 60.000 ms (minutos), 3.600.000 ms (horas) ou 86.400.000 ms (dias), com piso de 1.000 ms (linhas 744-747).
- **Retomada**: `resumePendingExecution` recarrega a automação por id; se ela não existir mais, a pendência vira `failed` (linhas 142-152). Continua de `next_step_position`, com o mesmo `parent_step_id`/`branch` e o mesmo `log_id`, sob o evento sintético `resumed_wait` (linhas 155-165).
- **Envio**: passos de envio precisam de uma conversa. O motor prefere a `conversation_id` que veio do webhook; sem ela (retomada de espera, disparo manual) procura a conversa do contato na conta e, se não achar, o passo falha com `contact has no existing conversation` (linhas 638-656).
- `send_webhook` tem guarda de SSRF: recusa destinos privados/loopback, não segue redirecionamento e tem timeout de 10 s (linhas 594-607).
- `update_contact_field` só grava `name`, `email` e `company`; campos personalizados usam o prefixo `custom:<uuid>` e são conferidos contra a conta (linhas 516-547).
- `send_template` ordena os parâmetros numericamente, não lexicograficamente, para não embaralhar modelos com 10 ou mais variáveis (linhas 407-420).
- `add_tag` grava via `addContactTagIfAbsent` e, se a etiqueta era nova, dispara recursivamente o gatilho `tag_added`, com teto de profundidade 3 lido de `vars._tag_chain_depth` (linhas 436-467).
- Mensagens enviadas pelos motores são persistidas com `sender_type='bot'` (`src/lib/automations/meta-send.ts:198-206`), e o envio é escopado por `account_id` tanto no contato quanto na configuração do WhatsApp (linhas 119-141).

### Motor de fluxos (`src/lib/flows/engine.ts`)

- `dispatchInboundToFlows` é a porta de entrada. Busca o run ativo do contato com `.limit(1)` ordenado por `started_at DESC` em vez de `maybeSingle()`, para não morrer se dois runs ativos existirem por acidente (linhas 189-202).
- **Idempotência**: procura um evento `reply_received` cujo `payload->>meta_message_id` seja igual, entre todos os runs daquele contato na conta; achando, devolve `consumed:true` sem avançar (linhas 296-310 e 849-862). Protege contra reentrega da Meta.
- Só mensagem de **texto** casa com gatilho de entrada; resposta interativa nunca inicia um fluxo novo (linhas 320-321).
- Havendo vários fluxos ativos que casam, vence o **mais antigo** por `created_at` (linhas 326-348).
- Duas mensagens simultâneas tentando iniciar run para o mesmo contato: o índice único parcial faz o `INSERT` perdedor devolver 23505 e o runner trata como duplicata consumida (linhas 1085-1090).
- Todos os nós são carregados numa consulta só e indexados por `node_key`; o avanço entre nós auto-avançantes é feito em memória (linhas 230-247).
- O avanço do ponteiro é um `UPDATE` otimista: só muda `current_node_key` se o valor lido no início ainda estiver lá e o run continuar ativo. Perdendo a corrida, grava um evento de erro `lost_race_during_advance` mas não derruba o run (linhas 744-754 e 802-829).
- O laço de avanço tem teto rígido de 64 iterações; estourando, o run vira `failed` com `end_reason='advance_loop_overflow'` (linhas 558, 789-793).
- `collect_input` guarda o texto aparado em `flow_runs.vars[var_key]`, zera `reprompt_count` e espelha o valor em memória para a interpolação seguinte enxergá-lo (linhas 943-966).
- **Interpolação em fluxos aceita apenas `{{vars.chave}}`, sem espaços.** A interpolação de automações é diferente: aceita espaços e também `{{message.text}}` (`src/lib/flows/engine.ts:518-524` versus `src/lib/automations/engine.ts:749-756`).
- Resposta que não casa: incrementa e persiste `reprompt_count` e consulta `decideFallback` (`src/lib/flows/fallback.ts:74-91`) — `ignore` devolve `consumed:false` (deixa as automações tentarem), `reprompt` reenvia o mesmo prompt, `handoff` põe a conversa em `pending` e encerra o run, `end` encerra como `completed` (linhas 993-1054).
- `handoff` põe a conversa em `pending`, atribui um agente **se** `config.assign_to` existir, grava o evento e encerra o run como `handed_off` (linhas 435-457).
- Falha de escrita de etiqueta num nó `set_tag` **não** derruba o run: registra o erro e avança (linhas 730-739). Falha de **envio** (texto, mídia ou prompt do `collect_input`) **derruba**: evento de erro e run `failed` (linhas 596-603, 627-634, 665-671).
- Um `set_tag` em modo "adicionar" dispara o gatilho `tag_added` das automações, com o mesmo teto de 3 níveis (linhas 712-722, via `src/lib/contacts/tag-events.ts:41-64`).
- O runner **não** grava o texto cru da resposta do cliente no evento — só o comprimento — para não deixar dado sensível em `flow_run_events` (linhas 896-908).

### Quando um humano responde

`sendMessageToConversation` (`src/lib/whatsapp/send-message.ts:492-505`) marca todo `flow_run` ativo daquele contato na conta como `paused_by_agent` com `end_reason='agent_replied'`. Vale para o envio pela caixa de entrada (`POST /api/whatsapp/send`) e para a API pública (`POST /api/v1/messages`), que compartilham o mesmo núcleo.

### O agendador

O serviço `cron` em `deploy/docker-compose.app.yml:138-194` é um contêiner `curlimages/curl` rodando um laço de shell, não um `crond`.

- Se `AUTOMATION_CRON_SECRET` estiver vazio, imprime dois avisos e entra num laço de `sleep 3600` (linhas 161-165).
- O laço vai das linhas 167 a 194. A cada volta chama `/api/automations/cron` e `/api/flows/cron` (linhas 171-174); a cada `KEEPER_EVERY_TICKS` voltas chama também `/api/exchange/cron` e `/api/ai/vault/keeper` (linhas 179-184); a cada `HEALTH_EVERY_TICKS` voltas chama `/api/health/cron` (linhas 190-191). Ao fim, `sleep $CRON_INTERVAL_SECONDS` (linha 193).
- Toda chamada termina com `|| echo`, para que a falha de um endpoint não mate o laço e leve os outros junto.
- As cinco rotas usam o **mesmo** segredo, comparado em tempo constante com pré-checagem de comprimento; sem a variável definida, respondem 503.

`/api/automations/cron` drena até 50 linhas de `automation_pending_executions` com `status='pending'` e `run_at <= agora`, ordenadas por `run_at`; reivindica cada uma com um `UPDATE` condicional para `running` e chama `resumePendingExecution` (`src/app/api/automations/cron/route.ts:34-56`).

`/api/flows/cron` lê **todos** os runs ativos de **todas** as contas junto com `flows(fallback_policy)`, sem filtro de conta e sem `LIMIT` (linhas 54-59), calcula a idade desde `last_advanced_at` em JavaScript e, passando de `on_timeout_hours`, faz `UPDATE` para `timed_out` condicionado a `status='active'`, gravando o evento de auditoria só se o `UPDATE` afetou alguma linha (linhas 87-108).

### Tenancy e permissão

Os dois motores escrevem com clientes `service_role` independentes (`src/lib/automations/admin-client.ts:11-12` e `src/lib/flows/admin-client.ts:11-12`), que **ignoram a RLS**. Por isso as rotas de escrita chamam `requireRole('agent')` explicitamente — a RLS não as protege. As policies das tabelas valem para o que as telas leem direto do Supabase pelo navegador.

---

## Limites e pegadinhas

**"Baseado em horário" e "Conversa atribuída" não disparam.** Os dois aparecem no seletor de gatilho do construtor e o de horário até exige uma expressão cron na validação, mas nenhum código do sistema os aciona. Os únicos disparadores de automação são o webhook do WhatsApp (`new_contact_created`, `first_inbound_message`, `new_message_received`, `keyword_match`, `interactive_reply`), o helper de etiquetas (`tag_added`) e a rota manual `POST /api/automations/engine`. Uma automação "todo dia às 9h" **nunca vai rodar sozinha**. Não prometa isso ao cliente.

**O modo "Rodízio" do passo Atribuir conversa não distribui.** Ele pega o primeiro perfil da conta com `LIMIT 1`, sem ordenação e sem guardar de quem foi a vez anterior (`src/lib/automations/engine.ts:487-497`). Na prática, tende sempre para a mesma pessoa. Quem precisa de distribuição real deve usar "Agente específico" e criar regras separadas.

**Etiqueta posta por importação de CSV não aciona a automação de "Etiqueta adicionada".** A importação grava as ligações contato-etiqueta direto na tabela (`src/lib/contacts/resolve-import-tags.ts:131`), sem passar pelo ponto que dispara o gatilho. Só disparam: a tela do contato, a API pública de contatos, o passo `add_tag` de automação e o nó `set_tag` de fluxo.

**O nó "Transferir para agente" não escolhe a pessoa pela tela e não desliga a IA.** O formulário desse nó oferece apenas o campo **Nota interna** (`src/components/flows/forms/node-config-form.tsx:212-220`). O motor até respeita um `assign_to` na configuração (`src/lib/flows/engine.ts:444`), mas nada na interface o preenche. E o nó não mexe em nenhum controle de IA: ele muda a conversa para "pendente" e encerra o fluxo, só isso.

**Responder pela caixa de entrada pausa o fluxo, mas não assume a conversa nem cala a IA.** O envio manual marca o run como "Pausada pelo agente" — esse efeito é real. Mas ele não atribui a conversa a você nem impede o agente de IA de responder a próxima mensagem do cliente. Para isso é preciso usar "Atribuir" / "Assumir".

**O passo Espera depende inteiramente do agendador.** Se o contêiner `cron` não estiver rodando ou `AUTOMATION_CRON_SECRET` estiver vazio, a automação para no "Espera" e o log fica eternamente em **parcial**. Não há aviso na tela de automações; o único indicador é a tela de **Administração**, e ela só acusa depois de 2 horas.

**Pendências reivindicadas e perdidas não voltam.** O cron marca a linha como `running` antes de retomar. Nada no código devolve uma linha de `running` para `pending`. Se o processo cair entre a reivindicação e o fim da retomada, aquela espera **nunca mais é processada**, porque a busca do cron só enxerga `pending`.

**Não existe tela para ver ou cancelar uma espera pendente.** A tela de logs mostra apenas as execuções (`automation_logs`), não a fila. E linhas concluídas ou falhas da fila nunca são apagadas — não há rotina de limpeza.

**Uma automação que já entrou em espera antes do bloqueio da conta continua enviando.** O webhook checa se a conta pode ter efeitos colaterais; o cron de automações **não** faz essa checagem. Uma conta com cobrança pendente pode ver mensagens saindo de esperas enfileiradas antes do bloqueio.

**Automação é vista pela conta, mas editada só pelo autor.** A lista respeita a conta: um colega com papel de agente vê a automação criada por outro. Mas abrir, editar, duplicar ou excluir devolve **404** para quem não é o criador, porque essas rotas filtram por `user_id` e não por conta (`src/app/api/automations/[id]/route.ts:36,76,155` e `duplicate/route.ts:32`). **Fluxos não têm essa restrição**: qualquer membro com papel de agente edita, ativa e apaga o fluxo criado por outro.

**Salvar um fluxo com os nós apaga tudo e reinsere, sem transação.** O `PUT` remove todos os nós e insere os novos (`src/app/api/flows/[id]/route.ts:146-171`). Se um cliente responder exatamente nessa janela, o runner pode não encontrar o nó e encerrar o run. Evite editar fluxo ativo em horário de pico.

**Excluir um fluxo mata as execuções em andamento na hora.** O cascade leva nós, runs e eventos. A própria janela de confirmação avisa isso.

**A política de fallback não tem tela.** O editor salva nome, descrição, gatilho, configuração do gatilho, nó de entrada e nós — e **não** envia `fallback_policy` (`src/components/flows/flow-editor-state.tsx:336-345`). Quem quiser mudar quantos reenvios o bot tenta, ou as 24 horas até considerar a conversa abandonada, precisa chamar a API diretamente ou alterar o banco. Não escreva tutorial mandando o cliente procurar esse ajuste na tela: não existe.

**O tipo de nó `http_fetch` é aceito pelo banco, mas não existe.** Está na lista permitida do banco desde a migração 016, não tem formulário no construtor e não tem tratamento no runner: o validador o recusa na ativação e o runner derruba o run se topar com ele.

**A varredura de fluxos não pagina.** Ela lê todos os runs ativos de todas as contas de uma vez. Com muitas contas e muitos runs abertos, essa chamada cresce sem limite.

**A galeria de execuções de fluxo é legível por qualquer membro.** `GET /api/flows/[id]/runs` exige apenas sessão, sem checagem de papel — um visualizador consegue ler o histórico e as variáveis capturadas.

**Um fluxo com "ignorar" no fallback pode segurar o contato indefinidamente se o cron estiver parado.** Com a política padrão (reenviar, depois transferir), o run se resolve sozinho. Com `on_unknown_reply: 'ignore'`, o run continua ativo, devolve `consumed:false` e as automações passam a responder por cima — e sem o cron ninguém o aposenta.

**A concessão pública de funções foi restaurada pela migração 044.** Ela dá `EXECUTE` em todas as rotinas do schema `public` a `anon` e `authenticated`, revertendo na prática os `REVOKE` que 007 e 012 fizeram sobre os contadores de execução. Como o aplicador de migrações usa ordem alfabética de arquivo, 044 é a última palavra.

### O que se sabe que não foi verificado

O mapa de origem registra estas incertezas e elas seguem abertas:

- Nada foi executado contra um banco: RLS, índices e CHECKs vêm da leitura dos arquivos de migração. Se alguma migração foi aplicada à mão nesta instalação, o estado real pode divergir.
- Não se sabe empiricamente o que acontece com vários runs ativos cujo `contact_id` virou NULL após exclusão do contato — o índice único é parcial e `contact_id` é anulável.
- Não se confirmou se o índice antigo `idx_flows_active_trigger` ainda existe no banco.
- Não se verificou se existe algum outro agendador nesta instalação (Vercel Cron, crontab do host, pinger externo) além do contêiner do compose.
- O arquivo `docs/automations-and-cron.md`, citado em `.env.local.example:82`, não existe no repositório.

---

## Referência

### Tabelas

| Tabela | Para que serve | Migração de origem |
|---|---|---|
| `automations` | Definição da automação: gatilho, configuração, ativa/inativa, contador de execuções | `006_automations.sql:14`; `account_id` e RLS final em `017_account_sharing.sql:186,286,305,455-459`; índice em `020_account_sharing_followups.sql:41-43` |
| `automation_steps` | Passos em árvore rasa: raiz e filhos de uma condição, separados por ramo `yes`/`no`. Não tem `account_id`; herda a tenancy de `automations` | `006_automations.sql:53`; RLS final em `017:544-552` |
| `automation_logs` | Histórico de cada disparo: passos executados, status (`success`/`partial`/`failed`) e erro | `006_automations.sql:87`; RLS final em `017:462-464` |
| `automation_pending_executions` | Fila de retomada das esperas. `status` em `pending`/`running`/`done`/`failed`, `run_at`, `context`. Índice parcial em `run_at` para `pending` | `006_automations.sql:119`; `account_id` em `017:188,288,307` |
| `flows` | Envelope do chatbot: nome, gatilho, nó de entrada (por `node_key`, texto) e `fallback_policy`. Status `draft`/`active`/`archived` | `010_flows.sql:77`; `account_id` e RLS em `017:189,289,308,471-475`; trigger `set_updated_at` em `010:262-263`; índice em `020:49-51` |
| `flow_nodes` | Os nós do grafo. **As arestas moram dentro do `config` de cada nó** — não existe tabela de arestas. `UNIQUE (flow_id, node_key)` | `010_flows.sql:114`; CHECK final de tipos em `016_flow_media.sql:41-53`; RLS final em `017:555-563` |
| `flow_runs` | Estado por contato: nó atual, variáveis, contagem de reenvios, como terminou. Status `active`/`completed`/`handed_off`/`timed_out`/`paused_by_agent`/`failed`. Único parcial `(account_id, contact_id) WHERE status='active'`. Publicada em realtime | `010_flows.sql:156`, coluna status em `010:165-172`; índice único final em `017:337-340`; RLS em `017:478-479` |
| `flow_run_events` | Trilha append-only do run. Serve de auditoria **e** de chave de idempotência contra reentrega da Meta | `010_flows.sql:216`; RLS final em `017:566-569` |
| `storage.buckets['flow-media']` | Bucket **público** da mídia dos fluxos. 16 MB, lista fixa de tipos permitidos | `016_flow_media.sql:59-118`; policies de escrita finais em `020_account_sharing_followups.sql:66-118` |
| `messages` (colunas deste subsistema) | `content_type` ampliado com `interactive`; `interactive_reply_id` guarda o id do botão tocado; `sender_type='bot'` distingue envio de robô | `010_flows.sql:59-73` |

Escrita em `automation_logs`, `automation_pending_executions`, `flow_runs` e `flow_run_events` é exclusiva da chave `service_role`: não há policy de INSERT/UPDATE/DELETE para clientes. `automation_pending_executions` não tem policy nenhuma — nem de leitura.

Leitura por membro da conta (`is_account_member`) vale em `automations`, `automation_logs`, `flows`, `flow_runs`; escrita exige papel `agent` ou acima em `automations`, `automation_steps`, `flows` e `flow_nodes`.

### Rotas

| Método e caminho | Autenticação / papel | O que faz |
|---|---|---|
| `GET /api/automations` | sessão; leitura sob RLS de conta | Lista as automações da conta, mais novas primeiro |
| `POST /api/automations` | `requireRole('agent')` | Cria automação, opcionalmente a partir de modelo; se nascer ativa, valida gatilho e passos e devolve 400 com a lista de problemas |
| `GET /api/automations/[id]` | sessão + filtro `user_id = eu` | Devolve a automação e a árvore de passos. 404 para colega de conta |
| `PATCH /api/automations/[id]` | `requireRole('agent')` + dono | Atualiza cabeçalho e, com `steps`, apaga e reinsere todos os passos. Revalida se o resultado ficar ativo |
| `DELETE /api/automations/[id]` | `requireRole('agent')` + dono | Apaga; o cascade leva passos, logs e pendências |
| `POST /api/automations/[id]/duplicate` | `requireRole('agent')` + dono | Clona como "(Copy)", desativada, remapeando os pais dos passos |
| `POST /api/automations/engine` | `requireRole('agent')` | Disparo manual de um gatilho. Único caminho pelo qual `time_based` e `conversation_assigned` podem rodar |
| `GET /api/automations/cron` | header `x-cron-secret` (`AUTOMATION_CRON_SECRET`); 503 sem a variável, 401 se não bater | Drena até 50 esperas vencidas e as retoma. Devolve `{processed}` |
| `GET /api/flows` | sessão; RLS de conta | Lista os fluxos da conta |
| `POST /api/flows` | `requireRole('agent')` | Cria fluxo em rascunho, em branco ou clonando um modelo (com rollback se os nós falharem) |
| `GET /api/flows/[id]` | sessão; posse verificada por RLS de conta | Devolve `{flow, nodes}` |
| `PUT /api/flows/[id]` | `requireRole('agent')` + membro da conta | Atualiza o cabeçalho e, com `nodes`, apaga todos os nós e reinsere. Não é transacional |
| `DELETE /api/flows/[id]` | `requireRole('agent')` + membro da conta | Apaga o fluxo; cascade leva nós, runs e eventos |
| `POST /api/flows/[id]/activate` | `requireRole('agent')` + membro da conta | Muda status. Só "ativo" é validado; 422 com a lista se houver erro |
| `GET /api/flows/[id]/runs` | **apenas sessão** — sem checagem de papel | Devolve o fluxo, os 50 runs mais recentes com o contato e todos os eventos desses runs |
| `GET /api/flows/templates` | apenas sessão | Galeria rasa de modelos de fluxo |
| `GET /api/flows/cron` | header `x-cron-secret` (`AUTOMATION_CRON_SECRET`); 503 sem a variável | Aposenta runs ativos parados além de `on_timeout_hours`. Devolve `{swept}` |
| `GET /api/ai/vault/keeper` | header `x-cron-secret` (mesmo segredo) | Ronda do keeper do vault de IA em todas as contas. Outro subsistema, mesmo agendador |
| `POST /api/ai/vault/keeper` | `requireRole('admin')` | Roda a mesma ronda sob demanda, restrita à conta de quem clicou |
| `GET /api/exchange/cron` | header `x-cron-secret` (mesmo segredo) | Atualiza a cotação USD→BRL. Falha de busca devolve 200 com `{updated:false}` |
| `GET /api/health/cron` | header `x-cron-secret` (mesmo segredo) | Aposenta compromissos vencidos, checa a plataforma e até 25 contas por execução, e grava o carimbo de tempo da ronda |
| `GET /api/admin/health` | administrador de plataforma, senão 403 | Tela de saúde. É onde se descobre que o cron parou: a frescura é calculada na leitura, com limite de 2 h |
| `POST /api/whatsapp/webhook` | assinatura HMAC da Meta | Quem dispara os dois motores |
| `POST /api/whatsapp/send` | `requireRole('agent')` | Envio manual do agente; pausa qualquer run ativo do contato |
| `POST /api/v1/messages` | chave de API com escopo `messages:send` | API pública de envio; mesmo núcleo, também pausa runs ativos |

### Telas

| Nome no menu / na tela | Rota | O que mostra |
|---|---|---|
| Automações | `/automations` | Lista com interruptor de ativar/pausar (otimista, com desfazer em caso de erro), modelos de início rápido, duplicar e excluir. Criação bloqueada para quem não é agente |
| Automações → nova | `/automations/new` | Construtor de automação nova; aceita `?template=<slug>` |
| Automações → Editar | `/automations/[id]/edit` | Construtor carregado com o estado salvo |
| Automações → Ver logs | `/automations/[id]/logs` | Últimas 100 execuções; cada linha expande para as etapas executadas |
| Fluxos | `/flows` | Lista de fluxos e galeria de modelos; criar e excluir bloqueados para quem não é agente |
| Fluxos → editor | `/flows/[id]` | Editor com visão **Lista** e visão **Canvas** (arrastar arestas, auto-layout) |
| Fluxos → Execuções | `/flows/[id]/runs` | 50 execuções mais recentes; cada linha expande para a linha do tempo de eventos. É a tela do "por que meu fluxo não avançou" |

### Arquivos principais

| Arquivo | Papel |
|---|---|
| `src/lib/automations/engine.ts` | Motor das automações: despacho, execução, os 13 tipos de passo, retomada de espera, condição, interpolação |
| `src/lib/automations/steps-tree.ts` | Converte a árvore do construtor em linhas planas e remonta na leitura |
| `src/lib/automations/validate.ts` | Validação de ativação; produz a lista de problemas dos 400 |
| `src/lib/automations/meta-send.ts` | Envio pelo motor de automações, com retry de variantes de telefone e `sender_type='bot'` |
| `src/lib/automations/templates.ts` | Modelos `welcome_message`, `out_of_office`, `lead_qualifier`, `follow_up_reminder` |
| `src/lib/automations/trigger-meta.ts` | Rótulos e ícones dos gatilhos na interface |
| `src/lib/automations/admin-client.ts` | Cliente `service_role` compartilhado (ignora RLS) |
| `src/lib/flows/engine.ts` | Runner dos fluxos: entrada, início de run, retomada por resposta, avanço, encerramento, eventos |
| `src/lib/flows/fallback.ts` | Resolve a política de fallback e decide reprompt/handoff/end/ignore |
| `src/lib/flows/types.ts` | Contratos de configuração de cada tipo de nó e a política padrão (linhas 299-304) |
| `src/lib/flows/validate.ts` | Validação de ativação: gatilho, integridade do grafo, alcançabilidade, limites da Meta |
| `src/lib/flows/meta-send.ts` | Envios do runner: texto, botões, lista, mídia |
| `src/lib/flows/edges.ts` | Traduz "aresta dentro do config" em arestas de canvas |
| `src/lib/flows/layout.ts` | Auto-layout (dagre) para fluxos sem posições salvas |
| `src/lib/flows/templates.ts` | Modelos `welcome_menu`, `faq_bot`, `lead_capture` |
| `src/lib/contacts/tag-events.ts` | Ponto único que adiciona etiqueta e dispara o gatilho `tag_added` |
| `src/lib/contacts/tag-chain.ts` | `MAX_TAG_CHAIN_DEPTH = 3` e a leitura da profundidade |
| `src/lib/contacts/tag-write.ts` | Escrita de etiqueta com checagem de conta; trata duplicata como "já existia" |
| `src/lib/auth/account.ts` | `getCurrentAccount` / `requireRole` |
| `src/lib/whatsapp/send-message.ts` | Núcleo de envio; pausa runs ativos quando um humano responde (linhas 492-505) |
| `src/app/api/whatsapp/webhook/route.ts` | O disparador: fluxos antes de automações, com supressão de gatilhos de conteúdo |
| `deploy/docker-compose.app.yml` | O agendador: serviço `cron` (linhas 138-194) |
| `src/components/automations/automation-builder.tsx` | Construtor de automações (13 passos, 8 gatilhos) |
| `src/components/flows/flow-editor-state.tsx` | Estado do editor de fluxos, compartilhado por Lista e Canvas; `save()` e mudança de status |
| `src/components/flows/forms/node-config-form.tsx` | Formulários por tipo de nó, incluindo o upload de mídia |
| `src/lib/storage/upload-media.ts` | Impõe o caminho `account-<uuid>/…` exigido pelas policies do bucket |
