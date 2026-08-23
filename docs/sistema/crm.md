# Contatos, funil, negócios e campos

Este é o cadastro de clientes do iMasterChat e o acompanhamento das vendas. De um lado, os **Contatos**: quem é a pessoa, o telefone dela, e-mail, empresa, as etiquetas que a classificam, os campos extras que cada negócio quiser guardar e as anotações internas da equipe. Do outro, os **Funis**: um quadro de colunas onde cada negócio (uma oportunidade de venda) é arrastado de etapa em etapa até virar ganho ou perdido. As duas partes se encontram no contato: todo negócio pertence a um contato, e a ficha do contato mostra os negócios dele.

O contato aparece sozinho: quando alguém manda mensagem no WhatsApp da empresa, o sistema já cria a pessoa no cadastro. Além disso dá para criar à mão, importar uma planilha CSV ou criar por API. Todos esses caminhos passam pela mesma regra de não-duplicar telefone, garantida pelo banco de dados: um telefone só existe uma vez por conta.

As **respostas rápidas** (os textos prontos que o atendente insere no inbox) também moram neste subsistema, porque são uma tabela de configuração da conta, embora sejam usadas na tela do inbox.

---

## Para que serve (visão do cliente)

O que o dono da ótica, da loja de bicicleta ou da empresa de energia solar consegue fazer aqui:

**Sobre os clientes**

- Ter uma lista de todos os clientes que já falaram com a empresa pelo WhatsApp, sem digitar nada: quem manda mensagem entra na lista sozinho, com nome e telefone.
- Cadastrar um cliente à mão, antes mesmo de ele mandar mensagem.
- Subir a lista de clientes que já existe em uma planilha (arquivo CSV) e trazer todo mundo de uma vez, com etiquetas já aplicadas.
- Procurar um cliente por nome, telefone ou e-mail.
- Etiquetar clientes ("comprou lente multifocal", "orçamento enviado", "cliente antigo") e depois filtrar a lista por essas etiquetas.
- Criar campos próprios do negócio ("grau do olho direito", "modelo da bike", "kWh da conta de luz") e preencher esses campos em cada cliente.
- Escrever anotações internas sobre o cliente, que só a equipe vê.
- Mandar a primeira mensagem para um cliente que nunca escreveu antes, usando um modelo aprovado pelo WhatsApp, direto da ficha dele.
- Excluir um cliente, sozinho ou vários de uma vez.

**Sobre as vendas**

- Ter um quadro de vendas com colunas (etapas) e arrastar cada oportunidade de uma coluna para a outra com o dedo ou com o mouse.
- Registrar em cada oportunidade: título, cliente, valor, moeda, data prevista de fechamento, responsável e notas.
- Marcar a venda como ganha ou perdida, e reabrir se voltar a andar.
- Ver, em cima do quadro, seis números do funil: total de negócios, valor total, ticket médio, valor ponderado por etapa, ganhos no mês e perdidos no mês.
- Ter mais de um funil (por exemplo, um para venda de produto e outro para pós-venda) e trocar entre eles.

**Sobre o atendimento**

- Guardar respostas prontas (texto ou mensagem com botões) e inserir com dois cliques no inbox, em vez de digitar tudo de novo.
- Ver, dentro da conversa aberta no inbox, os dados do contato, as etiquetas dele, os negócios em andamento e as anotações — e escrever uma anotação sem sair da conversa.

**O que a automação faz sozinha com esses dados**

- Colocar e tirar etiqueta de um cliente.
- Preencher nome, e-mail, empresa ou um campo personalizado.
- Criar um negócio no funil.
- Disparar uma automação quando um cliente novo é criado, quando ele manda a primeira mensagem, ou quando recebe uma etiqueta.

---

## Como se usa, na prática

### Ver e achar clientes — menu **Contatos**

A tela abre com a lista, 25 por página, mostrando nome, telefone, e-mail, empresa, etiquetas e data de criação. No topo:

- **Campo de busca** ("Busque por nome, telefone ou e-mail..."): procura nos três campos ao mesmo tempo, por trecho.
- **Filtrar por etiquetas**: escolha uma ou mais etiquetas. O filtro é "qualquer uma": um cliente que tenha pelo menos uma das etiquetas marcadas aparece. Não existe filtro "todas as etiquetas ao mesmo tempo".
- **Adicionar contato** e **Importar**: só para papel agente ou acima.
- **Campos personalizados**: o botão só aparece para admin ou acima.

Marcando as caixinhas da esquerda aparece a barra "X selecionado(s)" com **Excluir selecionados**. A seleção vale só para a página que está na tela e é zerada quando você busca, filtra ou muda de página.

### Cadastrar um cliente à mão — **Contatos → Adicionar contato**

Preencha nome, telefone (com código do país, ex.: +5511999999999), e-mail, empresa e etiquetas. Ao sair do campo de telefone, o sistema já verifica se aquele número existe:

- Se for **exatamente o mesmo número**, aparece "Já existe um contato com este número de telefone", com um atalho **Ver [nome]**, e o botão de salvar fica desabilitado.
- Se for **muito parecido** (os últimos 8 dígitos batem, mas o começo é diferente), aparece um aviso amarelo "Já existe um contato com um número muito parecido" e o salvamento continua liberado.

O telefone é obrigatório. No cadastro manual não há validação de formato: qualquer texto não vazio é aceito.

### Importar uma planilha — **Contatos → Importar**

O arquivo precisa ser CSV com uma linha de cabeçalho. A única coluna obrigatória é `phone`. As opcionais são `name`, `email`, `company` e `tags`. A célula de etiquetas aceita várias separadas por vírgula ou por ponto-e-vírgula (use aspas em volta da célula quando houver mais de uma).

Depois do upload aparece uma prévia das 5 primeiras linhas com as etiquetas em forma de chip. Ao confirmar, o resumo final mostra quatro números: importados, etiquetas atribuídas, ignorados e com falha. "Ignorado" quer dizer duplicado — dentro do próprio arquivo ou já existente na conta.

Se a planilha trouxer uma etiqueta que ainda não existe:

- quem importa é **admin ou acima**: a etiqueta é criada automaticamente, sempre na cor azul (#3b82f6);
- quem importa é **agente**: a etiqueta é ignorada e o sistema avisa "Etiquetas desconhecidas ignoradas (crie-as antes em Configurações)".

### Abrir a ficha de um cliente — clique na linha da lista

Abre um painel lateral com cinco abas:

| Aba | O que tem |
|---|---|
| Detalhes | Nome, telefone, e-mail, empresa, data de criação. Editável, botão **Salvar alterações**. |
| Etiquetas | Todas as etiquetas da conta; clicar em uma adiciona ou remove do contato. |
| Anotações | Anotações internas, com campo de escrita e botão **Adicionar anotação**. |
| Campos personalizados | Um campo de texto por definição criada, botão **Salvar campos personalizados**. |
| Negócios | Os negócios daquele cliente, com a etapa em que estão. |

No cabeçalho da ficha existem os botões **Editar**, **Mensagem**, **Excluir** e **Enviar modelo**. O **Enviar modelo** é o caminho para falar com alguém que nunca escreveu para a empresa: escolhe-se um modelo já aprovado pela Meta e o sistema acha ou cria a conversa sozinho.

### Criar etiquetas e campos — menu **Configurações → Campos e etiquetas**

- **Etiquetas**: criação com nome e uma de 8 cores predefinidas; exclusão com confirmação. Exige admin ou acima.
- **Campos personalizados**: criar, renomear e excluir definições. Exige admin ou acima. Só existe um tipo de campo: texto livre. O mesmo painel também abre pelo botão **Campos personalizados** da tela de Contatos.

Excluir um campo personalizado apaga também o valor guardado em todos os contatos — o diálogo avisa isso.

### Moeda dos negócios — menu **Configurações → Negócios e moeda**

Escolhe a moeda padrão da conta. Ela é usada em dois lugares: como moeda sugerida para negócios novos e como formato de todos os totais do funil. Exige admin ou acima; para os demais, o campo aparece só para leitura.

### O funil — menu **Funis**

Na primeira vez que alguém abre a tela numa conta que ainda não tem nenhum funil, o sistema cria um sozinho, chamado **Sales Pipeline**, com cinco etapas: **New Lead, Qualified, Proposal Sent, Negotiation, Won**. Esses nomes são gravados em inglês, mesmo com o sistema em português — quem quiser em português precisa renomear as etapas à mão.

No topo da tela:

- **Seletor de funil** (menu com o nome do funil atual): troca de funil e dá acesso a **Gerenciar funis**.
- **Adicionar funil**: cria outro funil, também com as cinco etapas padrão. Exige admin ou acima.
- **Adicionar negócio**: exige agente ou acima. Fica desabilitado enquanto não houver funil com etapas.

Abaixo vem a faixa das seis métricas e, embaixo, o quadro: uma coluna por etapa, com a contagem e a soma dos valores no topo de cada coluna. No celular as colunas deslizam de lado.

**Mover um negócio**: arraste o card para outra coluna. É preciso mover pelo menos 5 pixels para virar arraste — um toque simples abre o negócio para edição em vez de arrastar. Também funciona pelo teclado. O card muda de coluna na hora; se a gravação falhar, o quadro é recarregado e aparece "Falha ao mover o negócio".

**Criar ou editar um negócio**: abre um painel lateral com título, contato, valor e moeda, data prevista de fechamento, etapa, responsável, notas e vínculo com uma conversa. Título, contato e etapa são obrigatórios; sem contato o botão de salvar fica desabilitado. Dentro desse mesmo painel ficam os botões **Marcar como ganho**, **Marcar como perdido**, **Reabrir negócio** e **Excluir negócio**.

**Gerenciar funis** (item do menu do seletor): renomeia o funil, adiciona/renomeia/recolore (10 cores) e reordena as etapas arrastando, exclui etapa, exclui o funil inteiro e tem um atalho **Criar um novo funil**. As mudanças de nome, cor e ordem das etapas só valem depois de clicar em **Salvar alterações**.

Não é possível excluir uma etapa que ainda tenha negócios: aparece "Primeiro mova ou exclua os negócios desta etapa".

### Respostas rápidas — menu **Configurações → Respostas rápidas**

Cada resposta rápida é de um de dois tipos: **texto** (um trecho pronto) ou **interativa** (mensagem com botões/lista, validada contra os limites da Meta). Criar, editar e excluir exige agente ou acima; qualquer membro consegue ver e usar.

No inbox, o botão de respostas rápidas do compositor abre a lista. Escolher uma resposta de texto **acrescenta** o trecho ao que já estiver digitado (não substitui). Escolher uma interativa abre o construtor de mensagem interativa já preenchido, para conferir antes de enviar. Montando uma mensagem interativa no compositor, o botão **Salvar como resposta rápida** guarda aquilo para reuso — o nome é pedido em uma caixinha do navegador.

### Painel do contato no inbox — menu **Inbox**

Com uma conversa aberta, o painel lateral direito mostra os dados do contato, as etiquetas, os negócios (com a etapa) e as anotações, e permite escrever uma anotação sem sair da conversa.

---

## O que dá para configurar

| Ajuste | Onde | O que muda | Papel |
|---|---|---|---|
| Etiquetas (nome + cor, 8 cores) | Configurações → Campos e etiquetas | O vocabulário de classificação dos clientes; alimenta filtro da lista, público de disparos, automações e o prompt da IA | admin+ |
| Campos personalizados (criar, renomear, excluir) | Configurações → Campos e etiquetas, ou botão "Campos personalizados" em Contatos | Quais informações extras a conta guarda de cada cliente | admin+ |
| Valor de um campo personalizado em um cliente | Ficha do contato → aba Campos personalizados | O dado daquele cliente | agente+ |
| Moeda padrão da conta | Configurações → Negócios e moeda | Moeda sugerida em negócios novos e formato de todos os totais do funil | admin+ |
| Criar funil | Funis → Adicionar funil | Novo quadro, já com as 5 etapas padrão | admin+ |
| Renomear funil; criar/renomear/recolorir/reordenar/excluir etapa; excluir funil | Funis → menu do seletor → Gerenciar funis | Estrutura do quadro | admin+ (recusa vem do banco, ver Limites) |
| Criar/editar/excluir negócio; mover entre etapas; ganho/perdido/reabrir | Funis | Os dados da venda | agente+ |
| Criar, editar, importar e excluir contato | Contatos | A base de clientes | agente+ |
| Colocar/tirar etiqueta de um contato | Ficha do contato → aba Etiquetas; ou formulário de contato | Classificação do cliente; pode disparar automação de "etiqueta adicionada" | agente+ |
| Anotações do contato | Ficha do contato → aba Anotações; painel do inbox | Histórico interno | agente+ |
| Respostas rápidas | Configurações → Respostas rápidas; botão "Salvar como resposta rápida" no compositor | Os textos prontos do atendimento | agente+ |
| Papel de cada membro | Configurações → Membros da equipe | Define tudo da coluna "Papel" desta tabela | admin+ |
| Chaves de API com escopos `contacts:read` / `contacts:write` | Configurações → Chaves de API | Permite que um sistema externo leia e crie contatos | admin+ |
| `SUPABASE_SERVICE_ROLE_KEY` | Variável de ambiente (`.env.local`, exemplo em `.env.local.example:18`) | Sem ela o webhook não cria contato, a automação não mexe em etiqueta/negócio e a API pública não autentica | — |

Ajustes que **não têm tela** e só mudam mexendo no código:

| Ajuste | Onde | Valor atual |
|---|---|---|
| Etapas padrão de todo funil novo (nome e cor) | `src/app/(dashboard)/pipelines/page.tsx:40-46` | New Lead, Qualified, Proposal Sent, Negotiation, Won |
| Tamanho da página da lista de contatos | `src/app/(dashboard)/contacts/page.tsx:62` | 25 |
| Limite de encadeamento etiqueta → automação → etiqueta | `src/lib/contacts/tag-chain.ts:1` | 3 níveis |
| Cor das etiquetas criadas pela importação CSV | `src/lib/contacts/resolve-import-tags.ts:3` | #3b82f6 |
| Paleta de cores das etapas | `src/components/pipelines/pipeline-settings.tsx:40-51` | 10 cores |
| Fórmula do "valor ponderado" | `src/components/pipelines/pipeline-analytics.tsx:34-47` | 10% na primeira etapa, 100% na última, interpolação linear até 90% |
| Tamanho dos lotes da importação | `src/components/contacts/import-modal.tsx:270`; `src/lib/contacts/resolve-import-tags.ts:126` | 50 contatos por bloco; 100 vínculos de etiqueta por bloco |

---

## Como funciona por dentro

### Como um contato nasce

São quatro caminhos, e todos convergem no mesmo utilitário de deduplicação por telefone (`src/lib/contacts/dedupe.ts`):

1. **Webhook do WhatsApp** — `src/app/api/whatsapp/webhook/route.ts:1130`. É o caminho mais comum. Cria com `account_id` da conta dona da configuração do WhatsApp e `user_id` do dono dessa configuração (coluna de auditoria, não de isolamento). Se a Meta não mandar `profile.name`, o nome fica sendo o próprio telefone (`:1163-1170`).
2. **Formulário manual** — `src/components/contacts/contact-form.tsx:166`.
3. **Importação CSV** — `src/components/contacts/import-modal.tsx:284`.
4. **API pública** — `src/lib/api/v1/contacts.ts:127`.

Não existe rota REST interna de CRUD de contato: a interface do dashboard escreve direto no Postgres via supabase-js, protegida por RLS.

### Deduplicação por telefone

Dois níveis:

- **Em código**: pré-filtro em SQL por `LIKE '%<últimos 8 dígitos>'` e, sobre os poucos candidatos, `phonesMatch` em JavaScript, que considera iguais dois números cujos últimos 8 dígitos coincidem — tolerância a prefixo de tronco (`src/lib/contacts/dedupe.ts:43-54`; `src/lib/whatsapp/phone-utils.ts:25-33`).
- **No banco (a garantia de verdade)**: coluna gerada `phone_normalized` (só os dígitos) mais índice UNIQUE parcial em `(account_id, phone_normalized)` (`supabase/migrations/022_contact_phone_dedup.sql:30-32` e `:118-120`). É por conta: duas contas diferentes podem ter o mesmo telefone.

Todos os caminhos de escrita tratam o erro `23505` (violação de unique) como "perdi a corrida" e voltam a resolver o contato vencedor em vez de falhar: `dedupe.ts:72-75`, `webhook/route.ts:1179-1182`, `api/v1/contacts.ts:143-146`, `resolve-conversation.ts:115-118`, `contact-form.tsx:204-214`.

A migração 022 também fez um merge único das duplicatas históricas: repontou `conversations`, `contact_notes`, `deals`, `broadcast_recipients`, `automation_logs`, `automation_pending_executions`, `contact_tags`, `contact_custom_values` e `flow_runs` não ativos para o contato mais **antigo** e apagou os demais (`022:66-101`).

### Nome do contato

Quando o webhook encontra um contato já existente e o `profile.name` do WhatsApp mudou, ele **atualiza** o nome (`webhook/route.ts:1150-1155`). O nome vindo do WhatsApp sobrescreve o que o operador digitou.

### Exclusão de contato

`ON DELETE CASCADE` em conversas, anotações, vínculos de etiqueta e valores de campos personalizados. Mas `deals.contact_id` e `broadcast_recipients.contact_id` são `ON DELETE SET NULL` (`supabase/migrations/004_contact_delete_set_null.sql:41-65`): o histórico de negócios e de disparos fica, apenas sem dono.

### Lista de contatos

`src/app/(dashboard)/contacts/page.tsx`. Página de 25 (`:62`), busca com ILIKE em nome, telefone e e-mail (`:143-157`). Com filtro de etiqueta ativo, a paginação sai do cliente e passa a ser feita pela função `filter_contacts_by_tags` no banco (join + distinct + count janelado), porque o caminho no cliente estourava o teto de aproximadamente 1000 linhas do PostgREST (`supabase/migrations/025_filter_contacts_by_tags.sql:33-71`). O filtro é OR (`025:51`, com DISTINCT em `:48`). A função é `SECURITY INVOKER` (`025:42`) e só tem GRANT para `authenticated` (`025:75`) — a RLS continua valendo, não há elevação de privilégio.

Há proteção contra respostas de busca fora de ordem: um contador de sequência garante que só o fetch mais recente escreve no estado (`:106`, `:124`, `:149`, `:171`, `:195`). A seleção em massa é zerada a cada fetch (`:129`) e a exclusão em massa é um único `DELETE .in('id', ids)` (`:305`).

### Etiquetas

A interface **não** escreve direto em `contact_tags`: passa pela rota `POST`/`DELETE /api/contacts/[id]/tags`, que exige papel agente (`src/app/api/contacts/[id]/tags/route.ts:28`, `:56`) e confere no servidor que contato e etiqueta pertencem à mesma conta (`src/lib/contacts/tag-write.ts:19-47`). O cliente fetch fica em `src/lib/contacts/tag-api.ts:12`.

O evento de automação `tag_added` só é emitido quando a linha em `contact_tags` é realmente nova; um insert duplicado (`23505`) retorna `added:false` e não dispara nada (`tag-write.ts:66`; `tag-events.ts:39`, `:41-50`). O encadeamento etiqueta → automação → etiqueta tem teto de 3 níveis (`src/lib/contacts/tag-chain.ts:1`).

### Importação CSV

Parser em `src/lib/contacts/parse-contact-csv.ts:52-60` (cabeçalhos aceitos) e `:16-32` (célula de etiquetas com `split(/[,;]/)`, deduplicada sem diferenciar maiúsculas). O dedupe tem três camadas: dentro do arquivo, por telefone normalizado, mantendo a primeira ocorrência (`dedupe.ts:83-105`); contra os telefones já existentes na conta, com uma leitura de `phone_normalized` (`import-modal.tsx:231-249`); e o índice UNIQUE do banco, cujo `23505` é contado como "ignorado", não como "falhou" (`:308-311`). Insere em blocos de 50 (`:270`) e, se um bloco inteiro falhar, reprocessa linha a linha para que uma linha ruim não derrube as outras 49 (`:288-313`). A criação de etiquetas ausentes depende de `canEditSettings` (`:261`; `src/lib/contacts/resolve-import-tags.ts:68-69`), e os vínculos são gravados com `upsert(..., ignoreDuplicates: true)` em blocos de 100 (`resolve-import-tags.ts:126-137`).

### Ficha do contato

`src/components/contacts/contact-detail-view.tsx`. Cinco abas em `:455-487`; negócios carregados por `contact_id` com o estágio embutido (`:177-180`).

Salvar campos personalizados é **apagar tudo e reinserir**: um `delete .eq('contact_id')` seguido do insert só dos valores não vazios (`:302-320`).

Anotação: insert com `contact_id`, `account_id`, `user_id` e `note_text` (`:265-270`); exclusão direta por id, sem diálogo de confirmação (`:282-286`).

O botão de enviar modelo chama `POST /api/whatsapp/send` com `contact_id` e sem `conversation_id`; a rota acha ou cria a conversa (`:336-353`; `src/app/api/whatsapp/send/route.ts:113-141`).

### Campos personalizados

`src/components/contacts/custom-fields-manager.tsx`. O insert grava `field_type: 'text'` literal e nunca escreve `field_options` (`:110-115`). A checagem de nome duplicado é só no cliente, comparando sem maiúsculas contra a lista já carregada (`:90-95`) — não existe UNIQUE no banco. O mesmo painel é reaproveitado como diálogo em Contatos e inline em Configurações (`:31-49`; `src/components/settings/custom-fields-settings.tsx:41`; `src/components/settings/fields-and-tags-panel.tsx:29`).

### Funil

`src/app/(dashboard)/pipelines/page.tsx`. A semeadura automática dispara quando a lista de funis vem vazia (`:150-154`) e usa `seedDefaultPipeline` (`:112-141`) com as etapas fixas de `:40-46`. A criação manual repete as mesmas etapas (`:282-288`).

Mover negócio: dnd-kit em `src/components/pipelines/pipeline-board.tsx:74-86`; sensores em `:58-64` (`PointerSensor` com `distance: 5` e `KeyboardSensor`), aplicados ao wrapper arrastável em `:279-287` (`useDraggable` com `listeners`/`attributes`). O comentário em `deal-card.tsx:35-41` explica por que o clique do card ainda funciona apesar do arraste. A persistência é otimista: o estado muda, depois o `UPDATE deals.stage_id`; no erro, recarrega o quadro e mostra toast (`page.tsx:217-233`).

Negócio: nasce com `status: 'open'` (`deal-form.tsx:200`), exige título, contato e etapa (`:155-158`, `:442`). Ganho/perdido/reabrir são updates só de status que fecham o painel (`:214-231`, `:385-426`). O CHECK de status vem da migração 002 (`002:17`, `:20`), que também normalizou o antigo `'active'` para `'open'` (`002:33-34`).

Gerenciar funil: `src/components/pipelines/pipeline-settings.tsx`. Reordenar mexe só no estado local (`:98-105`) e persiste num único upsert por id com nome, cor e `position: i` (`:113-127`). A recusa de excluir etapa com negócios é uma contagem no cliente (`:164-172`). Excluir o funil é um delete simples (`:185-191`) — o banco cascateia etapas e negócios (`001:250`, `:270`).

Métricas: `src/components/pipelines/pipeline-analytics.tsx`. A probabilidade por etapa é interpolada pela posição (`:34-47`); perdidos ficam fora de tudo e ganhos ficam fora do ponderado (`:59-72`). "Ganhos no mês" e "Perdidos no mês" comparam `updated_at` (com fallback para `created_at`) contra o dia 1 do mês corrente (`:74-85`).

Moeda: os totais agregados (soma da coluna, valor do funil, ticket médio, ponderado) usam a moeda padrão da conta (`pipeline-board.tsx:119`; `pipeline-analytics.tsx:110`, `:117`, `:124`); só o card individual usa `deal.currency` (`deal-card.tsx:83`). Não existe conversão cambial em lugar nenhum — a migração 021 adotou explicitamente "uma moeda por conta, sem FX" (`021:14-16`). O DEFAULT para contas novas virou BRL na migração 039 (`039:14-15`), sem tocar em contas já existentes.

### Respostas rápidas

Tabela `quick_replies`, compartilhada por toda a conta. `GET /api/quick-replies` usa o cliente do usuário e deixa a RLS decidir (`route.ts:13-20`); `POST`, `PATCH` e `DELETE` usam service role e reforçam o escopo com `.eq('account_id')` explícito (`route.ts:63-72`; `[id]/route.ts:79`, `:100`). Trocar o `kind` zera a coluna de conteúdo do outro tipo (`[id]/route.ts:41-56`).

No compositor do inbox, o snippet de texto é concatenado ao rascunho, com quebra de linha quando necessário (`src/components/inbox/message-composer.tsx:367-388`); salvar como resposta rápida pede o título por `window.prompt` (`:331-363`).

### Automação escrevendo no CRM

`src/lib/automations/engine.ts`: `add_tag`/`remove_tag` (`:470-481`), `update_contact_field` — restrito a name/email/company ou `custom:<id>` (`:507-557`, lista permitida em `:544`) — e `create_deal`, que usa a moeda padrão da conta com fallback USD (`:559-584`, moeda em `:581`). Como o motor roda com service role e ignora RLS, há checagem explícita de que o contato pertence à conta antes de qualquer passo; contato de outra conta é recusado em silêncio (`:78-93`).

O webhook dispara `new_contact_created` só quando ele mesmo acabou de criar a linha, e `first_inbound_message` sempre que for a primeira mensagem do cliente naquela conversa — o que pega também contatos importados por CSV que escrevem pela primeira vez (`webhook/route.ts:696-701`, `:878-879`).

### API pública

Escopos `contacts:read` e `contacts:write` (`src/lib/api-keys/scopes.ts:19-20`). `POST /api/v1/contacts` é find-or-create: 201 quando cria, 200 quando já existia (`route.ts:98`, `:138`). Exige telefone em E.164 válido, de 7 a 15 dígitos e sem começar em zero, e rejeita com 400 caso contrário (`src/lib/api/v1/contacts.ts:116-122`; `phone-utils.ts:39-41`) — regra mais rígida que a do formulário manual. Passar `tags` substitui o conjunto por diferença (adiciona as que faltam, remove as que sobram; array vazio limpa tudo) e cria as inexistentes (`api/v1/contacts.ts:160-217`, `:167-172`). Como a API roda com service role (`src/lib/auth/api-context.ts:112`), essa criação de etiqueta ignora a exigência de admin da RLS. Para as colunas NOT NULL de auditoria, o `user_id` atribuído é o dono da configuração do WhatsApp e, se não houver, o dono da conta (`:73-95`). A listagem usa paginação por cursor (keyset), aceita `?search=` e `?tag=`, e sanitiza o termo de busca para não quebrar a gramática `.or()` do PostgREST (`route.ts:31-33`, `:49-73`).

### Isolamento por conta e papéis

A RLS de todo o CRM foi reescrita na migração 017, trocando `auth.uid() = user_id` por `is_account_member()` (`017:136-164`, `:385-445`). As colunas `user_id` continuam existindo, mas só como auditoria (`017:30-35`). Dois níveis de escrita:

- **Dado operacional** (`contacts`, `contact_notes`, `deals`, `contact_tags`, `contact_custom_values`, `quick_replies`): agente ou acima.
- **Dado de configuração** (`tags`, `custom_fields`, `pipelines`, `pipeline_stages`): admin ou acima.
- **Leitura**: qualquer membro, inclusive visualizador.

`contact_tags`, `contact_custom_values` e `pipeline_stages` **não têm coluna `account_id`** — a RLS delas é herdada por join no pai (`017:488-506`, `:523-530`).

Sem a migração 044 (`GRANT ALL` em todas as tabelas do schema public para anon/authenticated/service_role) nada disso funciona em um Postgres novo: imagens recentes do Supabase deixaram de conceder SELECT por padrão (`044:40-54`).

### Onde mais o CRM é lido

- Uma conversa é única por `(account_id, contact_id)` desde a migração 036 (`036:125-126`); webhook e resolver buscam a conversa mais antiga e evitam `.single()` para convergir (`webhook/route.ts:1208-1222`; `resolve-conversation.ts:167-182`).
- Dashboard: contatos criados hoje versus ontem, soma dos negócios abertos e o donut por etapa (só `status = 'open'`, etapas vazias omitidas) — `src/lib/dashboard/queries.ts:58-64`, `:133-162`.
- Público dos disparos: `src/components/broadcasts/step2-select-audience.tsx:145-149`, `:156-164` lê `contact_tags` e `contact_custom_values` direto do cliente.
- Agente de IA: recebe nome, telefone e etiquetas do contato no prompt de sistema e é instruído a nunca pedir o telefone (`src/lib/ai/environment.ts:157-173`, `:200`).

---

## Limites e pegadinhas

**Contatos**

- **O nome vindo do WhatsApp sobrescreve o que o operador digitou.** Se o cliente tem "Dona Maria - lente multifocal" no cadastro e o perfil do WhatsApp dele diz "Maria", na próxima mensagem o cadastro vira "Maria". Não há como travar isso pela tela.
- **O contato duplicado "parecido" pode ser salvo.** O bloqueio no formulário só acontece em coincidência exata de dígitos. Se os últimos 8 dígitos batem mas o começo é diferente (por exemplo, com e sem o 9 na frente), o sistema só avisa em amarelo e deixa salvar — e o índice do banco, que compara o número inteiro normalizado, também deixa passar.
- **Não existe tela para juntar (mesclar) dois contatos.** A função `merge_duplicate_contacts()` existe no banco, mas é `SECURITY DEFINER` com `REVOKE ALL FROM PUBLIC` e só foi chamada uma vez, dentro da própria migração 022. Não há caminho pela aplicação.
- **Excluir contato não apaga o histórico de vendas nem de disparos.** Os negócios e os destinatários de disparo continuam existindo, só que sem contato vinculado. Já conversas, anotações, etiquetas e valores de campos personalizados somem junto.
- **O cadastro manual não valida o formato do telefone**; a API pública valida (E.164). Um número digitado errado na tela vira um contato que o WhatsApp nunca vai alcançar.
- **A seleção em massa vale só para a página visível** e é perdida ao buscar, filtrar ou mudar de página. Não existe "selecionar todos os 3.000 contatos".
- **`avatar_url` existe na tabela, é lida no inbox e devolvida pela API pública, mas não foi encontrado nenhum caminho da aplicação que preencha essa coluna.** Não prometa foto de perfil de contato.

**Etiquetas**

- **Etiqueta aplicada por importação de CSV NÃO dispara a automação de "etiqueta adicionada".** A importação grava os vínculos diretamente em `contact_tags` com `upsert`, sem passar pelo escritor central que emite o evento. Se o cliente montou uma automação do tipo "quando receber a etiqueta X, mande a mensagem Y", importar uma planilha com a etiqueta X não vai disparar nada.
- **O card de Etiquetas em Configurações lista apenas as etiquetas criadas pelo próprio usuário** (`src/components/settings/tag-manager.tsx:72-76` filtra por `user_id`). Um admin não vê ali as etiquetas criadas por um colega, embora essas etiquetas apareçam normalmente na tela de Contatos, no formulário e nos filtros. É inconsistência conhecida, não configuração.
- **A exclusão de etiqueta não avisa quantos contatos vão perdê-la** — o diálogo só repete o nome. A remoção dos vínculos acontece por cascade.
- **Não há UNIQUE em nome de etiqueta**: dá para ter duas etiquetas "Orçamento" na mesma conta.
- **O filtro por etiqueta é OR, nunca AND.** Não existe "clientes que tenham as duas etiquetas ao mesmo tempo".
- **Pela API pública, criar etiqueta ignora a exigência de admin**, porque a API roda com service role. Quem tem uma chave com `contacts:write` cria etiquetas novas, mesmo que pela tela isso exigisse admin.
- **O número de "etiquetas atribuídas" no resumo da importação conta as linhas enviadas, não as efetivamente criadas** (`resolve-import-tags.ts:135`, `assigned += chunk.length` mesmo com `ignoreDuplicates`). Reimportar a mesma planilha mostra o mesmo número, sem nada de novo ter sido gravado.

**Campos personalizados**

- **Só existe campo do tipo texto livre.** Não há lista de opções, número, data nem sim/não. A coluna `field_options` existe no banco e no tipo TypeScript, mas nenhum código escreve ou lê esse campo — não sabemos se é resíduo de um plano abandonado.
- **Salvar os campos personalizados de um contato apaga todos os valores e reinsere os não vazios.** Se o insert falhar depois do delete, os valores anteriores se perdem.
- **Não há UNIQUE em nome de campo**: a checagem de duplicidade é só no cliente, contra a lista já carregada na tela. Duas abas abertas ao mesmo tempo podem criar dois campos com o mesmo nome.

**Anotações**

- **Não são editáveis** (não existe `updated_at` nem tela de edição) e **são excluídas sem confirmação** — um clique no lixo e a anotação some.
- **Desde a migração 017, qualquer agente da conta pode apagar a anotação de um colega.** A regra antiga restringia ao autor.

**Funil e negócios**

- **As etapas do funil padrão nascem em inglês** (New Lead, Qualified, Proposal Sent, Negotiation, Won) e o funil se chama "Sales Pipeline", mesmo com a interface em português. O texto do diálogo de criação diz "As etapas padrão (Novo lead → Ganho) serão criadas automaticamente", mas o que é gravado é o nome em inglês. Renomear é manual, em Gerenciar funis.
- **O diálogo de excluir funil diz "Isso arquivará todos os negócios deste funil". Não arquiva: apaga.** Etapas e negócios do funil são removidos em cascata pelo banco, sem volta. É texto errado na tela, e vale avisar o cliente antes.
- **O diálogo "Gerenciar funis" não tem trava de papel na interface.** Agente e visualizador conseguem abrir, editar e clicar em Salvar ou Excluir; quem recusa é o banco, e a tela mostra apenas um erro genérico ("Falha ao salvar o funil"). O mesmo vale para o atalho "Criar um novo funil" de dentro desse diálogo, que abre a caixa de criação sem passar pelo botão bloqueado. A trava real de papel está só no botão **Adicionar funil** da tela.
- **A semeadura automática do funil padrão não foi verificada para papel agente.** O seed roda com o cliente do próprio usuário e as regras do banco exigem admin, o que sugere que um agente entrando primeiro numa conta nova veria a tela vazia sem mensagem de erro clara. Isso não foi testado — não prometa nem descarte.
- **"Ganhos no mês" e "Perdidos no mês" usam a data da última alteração do registro, não a data de fechamento.** Editar uma nota de um negócio ganho no mês passado faz ele contar no mês atual.
- **Os totais do funil ignoram a moeda de cada negócio.** Soma da coluna, valor do funil, ticket médio e ponderado são formatados na moeda padrão da conta; só o card mostra a moeda real do negócio. Não existe conversão cambial em nenhum ponto do sistema. Se a conta tiver negócios em moedas diferentes, os totais somam números de moedas diferentes como se fossem a mesma.
- **O "valor ponderado" não é configurável.** A probabilidade sai da posição da etapa (primeira ≈10%, última 100%), não de um percentual que o cliente escolha por etapa.
- **Um negócio precisa de contato para ser salvo.** Se o contato de um negócio for excluído, o negócio fica sem contato; não foi testado se ainda é possível editá-lo pelo formulário, que exige contato preenchido para salvar.
- **`deals.stage_id` não tem `ON DELETE`.** A proteção contra apagar etapa com negócios é só na interface; não foi verificado se existe outro caminho que apague a etapa direto e estoure a chave estrangeira.
- **Não existe histórico de movimentação de negócio.** O sistema guarda a etapa atual, não por onde o negócio passou nem quando.

**Respostas rápidas**

- Escolher uma resposta rápida de texto **acrescenta** ao que já está escrito, não substitui. Quem espera substituição vai mandar as duas coisas juntas.
- O nome da nova resposta rápida é pedido pela caixinha nativa do navegador (`window.prompt`), que alguns navegadores bloqueiam.

**Geral**

- **Não existe rota interna de API para contatos.** Integrações externas precisam usar a API pública v1 com chave; a tela do dashboard fala direto com o banco.
- **Não há nenhum job agendado que toque contatos, funil ou negócios.** Nada é limpo, arquivado ou recalculado sozinho.
- **Nada aqui foi verificado contra o banco real do cliente, só contra as migrações.** Em particular, o índice UNIQUE de telefone (`idx_contacts_account_phone_normalized`) da migração 022 é criado depois de um merge de duplicatas — se a migração falhou no meio, o índice pode não existir. Antes de prometer "não dá para duplicar telefone" a um cliente, confira o índice na base dele.
- Um telefone composto só de letras geraria `phone_normalized` vazio, e o índice é parcial (`WHERE phone_normalized <> ''`) — em tese esse caso escaparia da regra de unicidade. Não foi testado.

---

## Referência

### Tabelas

| Tabela | Para que serve | Migração de origem | Escopo de conta |
|---|---|---|---|
| `contacts` | A pessoa. Uma linha por telefone por conta. | `001_initial_schema.sql:36`; `017:176,276` (account_id); `022:30` (phone_normalized + unique) | coluna `account_id` |
| `tags` | Etiqueta colorida, definida por conta. | `001:58`; `017:177,277,296` | coluna `account_id` |
| `contact_tags` | Vínculo N:N contato ↔ etiqueta. | `001:73` | herdado do contato (sem `account_id`) |
| `custom_fields` | Catálogo dos campos extras da conta. | `001:92`; `017:178,278,297` | coluna `account_id` |
| `contact_custom_values` | Valor de um campo extra em um contato. | `001:108` | herdado do contato (sem `account_id`) |
| `contact_notes` | Anotações internas sobre o contato. | `001:125`; `017:179,279,298` | coluna `account_id` |
| `pipelines` | Um funil de vendas. | `001:234`; `017:183,283,302` | coluna `account_id` |
| `pipeline_stages` | As etapas (colunas) do funil. | `001:248` | herdado do funil (sem `account_id`) |
| `deals` | A oportunidade de venda. | `001:267`; `002` (assigned_to + CHECK de status); `004:47-65` (contact_id nulável, SET NULL); `017:184,284,303` | coluna `account_id` |
| `quick_replies` | Snippets de texto ou mensagem interativa. | `035_interactive_messages.sql:24-61` | coluna `account_id` |
| `accounts.default_currency` | Moeda padrão da conta (não é tabela do CRM, mas é lida por ele). | `017:60-80`; `021:23-32` (coluna + CHECK ISO-4217); `039:14-15` (DEFAULT vira BRL) | a própria conta |

Colunas que valem lembrar:

- `contacts`: `phone` (TEXT NOT NULL), `phone_normalized` (gerada, só dígitos, `022:30-32`), `name`, `email`, `company`, `avatar_url` (nunca escrita pela aplicação), UNIQUE parcial `(account_id, phone_normalized) WHERE phone_normalized <> ''` (`022:118-120`), trigger `set_updated_at` (`001:362`).
- `tags`: `color` default `#3b82f6`; sem UNIQUE em `name`.
- `contact_tags`: `UNIQUE(contact_id, tag_id)` (`001:78`) — é o que torna "adicionar etiqueta" idempotente.
- `custom_fields`: `field_type` default `'text'` (a interface só grava `'text'`), `field_options` JSONB nunca usado; sem UNIQUE em `field_name`.
- `contact_custom_values`: `UNIQUE(contact_id, custom_field_id)` (`001:114`), usada como chave de upsert pelas automações (`engine.ts:539`).
- `contact_notes`: sem `updated_at` — notas não são editáveis.
- `pipeline_stages`: `position` INTEGER (ordem das colunas), `color` default `#3b82f6`.
- `deals`: `stage_id` sem `ON DELETE` (NO ACTION, `001:271`), `contact_id` nulável com SET NULL, `conversation_id`, `assigned_to` (REFERENCES profiles, SET NULL, `002:11-12`), `value` NUMERIC(12,2) default 0, `currency` default `'USD'`, `expected_close_date` DATE, `status` CHECK IN ('open','won','lost').
- `quick_replies`: `kind` CHECK IN ('text','interactive'), `content_text`, `interactive_payload` JSONB.

### Papéis por tabela (RLS final, migração 017; `quick_replies` pela 035)

| Tabela | Ler | Criar / editar / excluir |
|---|---|---|
| `contacts` | qualquer membro | agente+ (`017:386-389`) |
| `tags` | qualquer membro | admin+ (`017:393-396`) |
| `contact_tags` | qualquer membro (via contato) | agente+ (`017:488-495`) |
| `custom_fields` | qualquer membro | admin+ (`017:400-403`) |
| `contact_custom_values` | qualquer membro (via contato) | agente+ (`017:499-506`) |
| `contact_notes` | qualquer membro | agente+ (`017:407-410`) |
| `pipelines` | qualquer membro | admin+ (`017:435-438`) |
| `pipeline_stages` | qualquer membro (via funil) | admin+ (`017:523-530`) |
| `deals` | qualquer membro | agente+ (`017:442-445`) |
| `quick_replies` | qualquer membro | agente+ (`035:50-57`) |
| `accounts` | qualquer membro | update: admin+ (`017:631-635`); sem INSERT/DELETE para cliente |

### Rotas

| Método | Rota | Autenticação e papel | O que faz | Arquivo |
|---|---|---|---|---|
| POST | `/api/contacts/[id]/tags` | sessão + papel agente | Adiciona etiqueta ao contato; insere só se ausente (23505 = no-op) e dispara `tag_added` apenas em vínculo novo | `src/app/api/contacts/[id]/tags/route.ts` |
| DELETE | `/api/contacts/[id]/tags` | sessão + papel agente | Remove a etiqueta do contato; o `tag_id` vai no corpo, não na URL | `src/app/api/contacts/[id]/tags/route.ts` |
| GET | `/api/quick-replies` | sessão; a RLS limita à conta | Lista as respostas rápidas, mais novas primeiro | `src/app/api/quick-replies/route.ts` |
| POST | `/api/quick-replies` | sessão + papel agente (escrita com service role, `account_id` carimbado do contexto) | Cria resposta rápida de texto ou interativa (validada contra os limites da Meta) | `src/app/api/quick-replies/route.ts` |
| PATCH | `/api/quick-replies/[id]` | sessão + papel agente + `.eq('account_id')` explícito | Edita; trocar `kind` zera a coluna de conteúdo do outro tipo | `src/app/api/quick-replies/[id]/route.ts` |
| DELETE | `/api/quick-replies/[id]` | sessão + papel agente + `.eq('account_id')` explícito | Exclui a resposta rápida | `src/app/api/quick-replies/[id]/route.ts` |
| GET | `/api/v1/contacts` | chave de API, escopo `contacts:read` | Lista com paginação por cursor, `?search=` (nome/telefone) e `?tag=<id>`, com etiquetas embutidas | `src/app/api/v1/contacts/route.ts` |
| POST | `/api/v1/contacts` | chave de API, escopo `contacts:write` | Find-or-create por telefone E.164: 201 cria, 200 já existia; aceita `tags` por nome | `src/app/api/v1/contacts/route.ts` |
| GET | `/api/v1/contacts/[id]` | chave de API, escopo `contacts:read` | Lê um contato; contato de outra conta devolve 404, nunca 403 | `src/app/api/v1/contacts/[id]/route.ts` |
| PATCH | `/api/v1/contacts/[id]` | chave de API, escopo `contacts:write` | Atualiza name/email/company (null limpa) e substitui o conjunto de etiquetas por diferença | `src/app/api/v1/contacts/[id]/route.ts` |
| POST | `/api/whatsapp/webhook` | assinatura HMAC-SHA256 da Meta (`META_APP_SECRET`); escreve com service role | Não é rota "de CRM", mas é onde o contato nasce na maioria dos casos: acha ou cria por telefone, atualiza o nome do perfil e dispara `new_contact_created` / `first_inbound_message` | `src/app/api/whatsapp/webhook/route.ts` |
| POST | `/api/whatsapp/send` | sessão + `requireRole('agent')` (`send/route.ts:34`); valida que o contato é da conta antes de abrir a conversa | Usada pela ficha do contato com `contact_id` e sem `conversation_id`, para iniciar conversa por modelo | `src/app/api/whatsapp/send/route.ts` |

### Telas

| Nome no menu / no fluxo | Rota | Arquivo | O que faz |
|---|---|---|---|
| Contatos | `/contacts` | `src/app/(dashboard)/contacts/page.tsx` | Lista com busca, filtro por etiquetas (OR), páginas de 25, seleção e exclusão em massa; abre os quatro modais |
| Adicionar/Editar contato (diálogo) | `/contacts` | `src/components/contacts/contact-form.tsx` | Criar e editar, com detecção de telefone duplicado ao sair do campo e seleção de etiquetas |
| Ficha do contato (painel lateral) | `/contacts` | `src/components/contacts/contact-detail-view.tsx` | Abas Detalhes, Etiquetas, Anotações, Campos personalizados e Negócios; botão Enviar modelo |
| Importar contatos (modal) | `/contacts` | `src/components/contacts/import-modal.tsx` | Upload de CSV, prévia de 5 linhas com chips de etiqueta e resumo (importados / etiquetas / ignorados / com falha) |
| Campos personalizados (modal e painel) | `/contacts` e `/settings?tab=fields` | `src/components/contacts/custom-fields-manager.tsx` | Criar, renomear e excluir definições de campo |
| Funis | `/pipelines` | `src/app/(dashboard)/pipelines/page.tsx` | Seletor de funil, métricas, quadro, criação de funil e acesso ao gerenciamento |
| Quadro do funil | `/pipelines` | `src/components/pipelines/pipeline-board.tsx` | Colunas arrastáveis por etapa, com contagem e soma; deslize horizontal no celular |
| Card do negócio | `/pipelines` | `src/components/pipelines/deal-card.tsx` | Título, selo Ganho/Perdido, contato, valor na moeda do próprio negócio, data prevista e iniciais do responsável |
| Novo/Editar negócio (painel lateral) | `/pipelines` | `src/components/pipelines/deal-form.tsx` | Contato, valor e moeda, data prevista, etapa, responsável, notas, ações de status e exclusão |
| Gerenciar funis (modal) | `/pipelines` | `src/components/pipelines/pipeline-settings.tsx` | Renomear funil, gerenciar e reordenar etapas, excluir etapa, excluir funil, atalho para criar outro funil |
| Métricas do funil | `/pipelines` | `src/components/pipelines/pipeline-analytics.tsx` | Faixa de 6 métricas com tooltip explicando cada cálculo |
| Configurações (casca) | `/settings` | `src/app/(dashboard)/settings/page.tsx` | Trilha lateral das seções; mapeia `?tab=fields`, `?tab=deals` e `?tab=quick-replies` |
| Campos e etiquetas | `/settings?tab=fields` (aceita os legados `?tab=tags` e `?tab=custom-fields`) | `src/components/settings/fields-and-tags-panel.tsx` | Junta o gerenciador de etiquetas com o de campos personalizados (este só para admin+) |
| Etiquetas (card) | `/settings?tab=fields` | `src/components/settings/tag-manager.tsx` | Criação inline com 8 cores e exclusão com confirmação — lista filtrando por `user_id` |
| Negócios e moeda | `/settings?tab=deals` | `src/components/settings/deals-settings.tsx` | Moeda padrão da conta (somente leitura para quem não é admin) |
| Respostas rápidas | `/settings?tab=quick-replies` | `src/components/settings/quick-replies-manager.tsx` | Lista, cria e edita snippets de texto ou mensagens interativas |
| Seletor de resposta rápida (modal) | `/inbox` | `src/components/inbox/quick-reply-picker.tsx` | Escolhe a resposta rápida e insere no compositor |
| Painel do contato no inbox | `/inbox` | `src/components/inbox/contact-sidebar.tsx` | Dados, etiquetas, negócios e anotações do contato da conversa aberta |
| Público do disparo (etapa 2) | `/broadcasts/new` | `src/components/broadcasts/step2-select-audience.tsx` | Seleção de público por etiqueta ou por valor de campo personalizado |

### Arquivos-chave de lógica

| Arquivo | Papel |
|---|---|
| `src/lib/contacts/dedupe.ts` | Núcleo da deduplicação por telefone: `findExistingContact`, `isExactMatch`, `isUniqueViolation`, `dedupeByPhone` |
| `src/lib/whatsapp/phone-utils.ts` | `normalizePhone`, `phonesMatch` (últimos 8 dígitos), `isValidE164` |
| `src/lib/contacts/tag-write.ts` | Escrita de `contact_tags` com verificação de pertencimento; trata 23505 como no-op |
| `src/lib/contacts/tag-events.ts` | Escritor central de etiquetas; só emite `tag_added` em vínculo novo |
| `src/lib/contacts/tag-chain.ts` | `MAX_TAG_CHAIN_DEPTH = 3` |
| `src/lib/contacts/tag-api.ts` | Cliente fetch da rota de etiquetas |
| `src/lib/contacts/parse-contact-csv.ts` | Parser do CSV de importação |
| `src/lib/contacts/resolve-import-tags.ts` | Resolve nomes de etiqueta na importação e grava os vínculos em lotes |
| `src/lib/api/v1/contacts.ts` | Serializer, `findOrCreateContact`, `setContactTags` (diff) e `resolveAuditUserId` da API pública |
| `src/lib/whatsapp/resolve-conversation.ts` | Acha ou cria contato + conversa a partir de um telefone |
| `src/lib/automations/engine.ts` | Passos de automação que escrevem no CRM e a checagem de conta |
| `src/lib/auth/account.ts` | `getCurrentAccount` / `requireRole` |
| `src/lib/auth/roles.ts` | `canEditSettings` = admin+, `canSendMessages` = agente+ |
| `src/types/index.ts` | Tipos de Contact, Tag, ContactTag, CustomField, ContactCustomValue, ContactNote, Pipeline, PipelineStage, Deal, DealStatus, QuickReply |

### O que não foi verificado

Registrado aqui para que ninguém trate como fato:

- O schema real do banco do cliente. Tudo veio da leitura das migrações; nenhuma consulta foi executada.
- Se o índice UNIQUE de telefone existe de fato na base do cliente.
- Se a semeadura automática do funil padrão funciona para papel agente.
- O que acontece ao editar um negócio cujo contato foi excluído.
- Se existe algum caminho que apague uma etapa com negócios e estoure a chave estrangeira.
- O comportamento do filtro por etiqueta com volume grande de contatos.
- O caminho que preencheria `contacts.avatar_url` (não encontrado).
- Para que serve `custom_fields.field_options` (não usado por nenhum código).
