# Contas, acesso, equipe e cobrança

Este é o pedaço do iMasterChat que decide **quem entra, o que cada pessoa pode fazer e se a conta está liberada para uso**. Cada empresa que usa o sistema é uma "conta" (na prática, uma loja, uma ótica, uma revenda de energia solar). Todo dado do sistema — contatos, conversas, negócios, automações — pertence a uma conta e é invisível para todas as outras. Dentro da conta existem quatro funções (Proprietário, Administrador, Atendente, Visualizador), e pessoas entram na equipe por um **link de convite**, não por e-mail enviado pelo sistema. Por cima disso tudo existe uma trava comercial: a conta só funciona depois que o dono da plataforma aprova o pagamento manualmente no painel de administração. Não há cartão de crédito, cobrança automática nem assinatura recorrente dentro do produto — o pagamento acontece fora do sistema (PIX) e alguém vira uma chave à mão.

---

## Para que serve (visão do cliente)

O que o dono do negócio consegue fazer com este subsistema:

- **Criar a conta da empresa.** Ele se cadastra com e-mail, nome e senha, marca o aceite dos Termos de Uso e pronto: a empresa dele existe no sistema, e ele é o Proprietário.
- **Esperar a liberação.** Assim que a conta é criada, ela nasce **aguardando aprovação**. Até alguém da plataforma aprovar, o cliente vê uma tela de espera e não consegue usar o sistema. Isso é intencional: é assim que a venda é fechada.
- **Chamar a equipe para dentro.** Ele gera um **link de convite**, escolhe a função da pessoa e a validade do link (1, 7 ou 30 dias), e manda esse link pelo WhatsApp, Slack ou qualquer canal. Quem recebe cria a conta (ou entra com a que já tem) e cai direto dentro da empresa dele.
- **Definir o que cada um pode fazer.** Um Atendente responde clientes; um Visualizador só olha; um Administrador mexe em configurações e na equipe.
- **Tirar alguém da equipe.** Remover um colega desliga o acesso dele à empresa sem apagar o login da pessoa.
- **Cuidar do próprio login.** Trocar nome, foto, e-mail e senha; e derrubar todas as sessões abertas de uma vez (útil quando um notebook some ou uma senha foi compartilhada).
- **Escolher a moeda padrão** usada nos negócios e nos totais do funil e do painel.
- **Gerar chaves de API** para ligar o iMasterChat a outros sistemas (Zapier, um ERP, um script próprio).
- **Ver os Termos de Uso e a Política de Privacidade** em páginas públicas, em português.

O que o **dono da plataforma** (quem vende o iMasterChat) consegue fazer:

- Ver **todas as contas** da plataforma numa lista, com o e-mail do dono, quantos membros tem, o status de cobrança, até quando está pago e anotações internas.
- **Aprovar, suspender ou reativar** qualquer conta na hora.
- Ver os **erros e feedbacks** que aconteceram na plataforma inteira e o **estado de saúde** de cada conta (credenciais de IA, token do WhatsApp, Google Calendar, migrações, cron).
- Ajustar **preços de modelo de IA e câmbio**, que são fatos da plataforma e não de cada conta.

---

## Como se usa, na prática

### 1. Criar a conta (o cliente novo)

Tela **Criar conta** (`/signup`). O cliente informa nome, e-mail e senha e **precisa marcar a caixa dos Termos de Uso** — o botão de cadastrar fica desabilitado enquanto ela não estiver marcada. Ao concluir, o sistema:

1. cria o login;
2. cria automaticamente a **empresa** dele, com ele como Proprietário;
3. registra o aceite dos termos (versão do texto, data, IP e navegador);
4. leva para o painel — ou, se ele chegou por um link de convite, para a tela do convite.

Não é possível "cadastrar sem aceitar os termos" nem escolher a versão do texto: a versão gravada é a que o servidor tem no momento.

### 2. A tela de espera (conta aguardando aprovação)

Toda conta recém-criada cai na tela de **conta aguardando aprovação** (`/blocked`). É uma tela cheia, sem menu, com:

- o título "Conta aguardando aprovação" e o nome da empresa;
- um botão **Falar com o suporte** (o destino vem de configuração);
- um botão **Sair**.

**Atenção para quem for escrever o tutorial:** nesse estado a tela **não mostra a chave PIX nem o QR Code**. PIX e QR só aparecem quando a conta está no estado *suspensa por pendência de pagamento*. O cliente novo, portanto, não recebe a forma de pagamento por essa tela — ele precisa ser conduzido pelo canal de suporte. (`src/app/blocked/blocked-view.tsx:89`)

Quando a conta está **suspensa** (título "Conta temporariamente suspensa"), aí sim a tela mostra o QR Code PIX e a chave PIX, além do contato.

### 3. Aprovar a conta (o dono da plataforma)

Item **Administração** na barra lateral (só aparece para quem é administrador de plataforma) → aba **Contas**. A lista traz todas as contas com colunas Conta, Proprietário, Status, Pago até, Membros e Notas. O status é um seletor com quatro opções:

| Status na tela | O que acontece |
|---|---|
| Aguardando aprovação | Conta travada. O cliente só vê a tela de espera. **É o estado de toda conta nova.** |
| Ativa | Conta liberada, uso normal. |
| Pagamento atrasado | **Não trava nada.** A conta funciona exatamente como Ativa. |
| Bloqueada | Conta travada. O cliente vê a tela de suspensão, com PIX e QR. |

A mudança vale imediatamente. Também dá para preencher **Pago até** (data) e **Notas** internas — os dois são informativos: nada no sistema lê a data de "Pago até" para bloquear automaticamente. Alguém precisa vir aqui e virar a chave.

Quem tem acesso a essa aba é definido **apenas por SQL**: não existe tela para promover alguém a administrador de plataforma. Ver "O que dá para configurar".

### 4. Convidar a equipe

Menu **Configurações** → seção **Membros da equipe** → botão **Convidar membro**. Abre um modal de dois passos:

**Passo 1 — o formulário:**

- **Função:** Administrador, Atendente ou Visualizador. (Proprietário não está na lista: não se convida ninguém como dono.)
- **Link válido por:** 1 dia, 7 dias ou 30 dias.
- **Rótulo** (opcional): um lembrete de para quem o link foi enviado, ex. "Sara — equipe de suporte". Máximo de 80 caracteres.

**Passo 2 — o link:** aparece a URL do convite, um botão **Copiar** e um botão **Enviar pelo WhatsApp** (que abre o WhatsApp com uma mensagem pronta). A tela avisa, com razão: **esse link aparece uma única vez**. O sistema guarda apenas uma impressão digital dele, nunca o texto. Se a janela fechar sem copiar, o único caminho é revogar o convite e criar outro.

Os convites ainda não usados aparecem numa lista abaixo, com o rótulo, a data de criação, quando expiram e um botão **Revogar**.

Convites **só são visíveis para Administrador e Proprietário**. Atendente e Visualizador não veem a lista nem o botão de convidar.

### 5. Entrar por um convite (o colega)

O colega abre o link e cai na página do convite. Antes de qualquer login, a página já mostra "Você foi convidado para *[nome da empresa]*", a função que ele vai receber e até quando o link vale. Dali ele escolhe **Entrar** (se já tem login) ou **Criar uma nova conta**. Depois de autenticado, ele clica em **Aceitar convite** — o sistema nunca aceita sozinho.

Duas coisas importantes:

- **O convite só é aceito se a conta pessoal de quem aceita estiver vazia.** Se a pessoa já usou o sistema por conta própria (tem contatos, conversas, negócios, WhatsApp conectado…), o aceite falha e aparece um aviso bloqueante com a opção **Sair e usar outro e-mail**. O link continua válido.
- Quando dá certo, a conta pessoal vazia dela é apagada e o login passa a pertencer à empresa que convidou.

O link de convite atravessa o cadastro inteiro: se a pessoa clicar no convite, se cadastrar e precisar confirmar e-mail, o retorno da confirmação volta para a página do convite. E quem já está logado e clica num link de convite não é jogado no painel — vai direto para a tela do convite.

### 6. Gerir quem já está dentro

**Configurações → Membros da equipe.** Lista todos os membros com foto, nome, função, data de entrada e um indicador de presença (online / ausente / offline).

- **Administrador ou Proprietário** vê, em cada linha, um seletor de função e um botão **Remover**.
- Esses controles **não aparecem** na linha do Proprietário nem na sua própria linha. Ou seja: ninguém muda o próprio papel pela tela, e o dono não é rebaixado por aqui.
- **Remover** abre uma confirmação que explica o efeito real: a pessoa é desconectada desta conta e **recebe uma conta pessoal nova no próximo login; o login dela não é excluído**.
- O **e-mail dos colegas** só é exibido para Administrador e Proprietário. Atendente e Visualizador veem a lista sem os e-mails.

### 7. Perfil, senha e sessões

**Configurações → Seu perfil:** nome de exibição, foto (PNG/JPG/WebP/GIF, até 2 MB) e e-mail. A troca de e-mail exige confirmação **nos dois endereços**, o antigo e o novo. A mesma tela mostra função, data de entrada e ID do usuário.

**Configurações → Login e segurança:** troca de senha (é preciso digitar a senha atual) e o botão **Sair de todos os dispositivos**, que derruba todas as sessões abertas, inclusive a atual.

**Configurações → Negócios e moeda:** a moeda padrão da conta. Só Administrador e Proprietário conseguem salvar; a própria tela avisa isso.

### 8. Chaves de API

**Configurações → Chaves de API.** Qualquer membro vê a lista de chaves existentes; **só Administrador e Proprietário criam e revogam**. Ao criar, escolhe-se um nome e os escopos. A chave completa aparece **uma única vez** — depois disso, só resta revogar e criar outra. Uma chave sem escopo nenhum ainda serve para testar a conexão.

### 9. Esqueci a senha

Existe a tela **Esqueci minha senha** (`/forgot-password`), que dispara o e-mail de redefinição do Supabase. **O que acontece depois do clique no e-mail não foi possível verificar pelo código**: a tela aponta o retorno para endereços (`/auth/callback` e `/reset-password`) que não existem neste repositório. Antes de transformar isso em tutorial, é obrigatório testar no ambiente real com e-mail funcionando.

---

## O que dá para configurar

| Ajuste | Onde | O que muda | Papel exigido |
|---|---|---|---|
| Status de cobrança da conta (Aguardando aprovação / Ativa / Pagamento atrasado / Bloqueada) | Administração → aba Contas | Libera ou trava o acesso da empresa inteira | Administrador da plataforma |
| Pago até (data) | Administração → aba Contas | Só anotação. Nada bloqueia sozinho quando a data passa | Administrador da plataforma |
| Notas internas da conta | Administração → aba Contas | Só anotação (contrato, valor, contato) | Administrador da plataforma |
| Quem é administrador da plataforma | **Só por SQL:** `UPDATE public.profiles SET is_platform_admin = true WHERE user_id = '<id>'` (`supabase/migrations/037_manual_billing.sql:44`; `docs/cobranca-manual.md:39`) | Dá acesso ao painel Administração e às rotas `/api/admin` | Acesso direto ao banco |
| Preços de modelo de IA e câmbio | Administração → aba Preços e câmbio | Base de cálculo de custo da plataforma | Administrador da plataforma |
| Função de um membro (Administrador / Atendente / Visualizador) | Configurações → Membros da equipe | O que a pessoa pode fazer no sistema | Administrador da conta |
| Remover membro | Configurações → Membros da equipe | Tira o acesso à empresa; a pessoa ganha uma conta pessoal nova | Administrador da conta |
| Criar convite (função, validade 1/7/30 dias, rótulo) | Configurações → Membros da equipe → Convidar membro | Gera o link de entrada | Administrador da conta |
| Revogar convite pendente | Configurações → Membros da equipe | Invalida o link antes do uso | Administrador da conta |
| Moeda padrão da conta | Configurações → Negócios e moeda | Moeda de novos negócios e dos totais de funil e painel | Administrador da conta |
| Nome, foto e e-mail | Configurações → Seu perfil | Como você aparece para os colegas | Qualquer membro (só no próprio perfil) |
| Senha e "Sair de todos os dispositivos" | Configurações → Login e segurança | Segurança do próprio login | Qualquer membro (só no próprio login) |
| Criar / revogar chave de API | Configurações → Chaves de API | Acesso máquina-a-máquina à API pública | Administrador da conta (listar: qualquer membro) |
| Nome da empresa | **Não tem tela.** Existe só a rota `PATCH /api/account` (`src/app/api/account/route.ts:41`) | Renomeia a conta | Administrador da conta |
| Transferir a propriedade da conta | **Não tem tela.** Existe só a rota `POST /api/account/transfer-ownership` | Troca o dono; o dono atual vira Administrador | Proprietário |
| `NEXT_PUBLIC_SITE_URL` | Variável de ambiente (`.env.local.example:43`) | Base das URLs de convite e dos e-mails de autenticação | Operação |
| `ALLOWED_INVITE_HOSTS` | Variável de ambiente (`.env.local.example:76`) | Hostnames aceitos ao montar a URL do convite a partir dos cabeçalhos da requisição | Operação |
| `NEXT_PUBLIC_BILLING_CONTACT`, `NEXT_PUBLIC_BILLING_PIX_KEY`, `NEXT_PUBLIC_BILLING_PIX_QR` | Variáveis de ambiente (`.env.local.example:126-136`) | Contato, chave PIX e QR mostrados na tela de bloqueio (PIX/QR só no estado *Bloqueada*) e o contato no rodapé de Termos e Privacidade | Operação |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Variáveis de ambiente (`.env.local.example:6-7` e `18`) | Conexão com o banco; a chave de serviço ignora o isolamento entre contas | Operação |
| `TERMS_VERSION` / `TERMS_PUBLISHED_LABEL` | Código: `src/lib/legal/terms.ts:16` e `19` (valor atual: `2026-08-03`) | Versão do texto registrada no aceite e a data exibida na página de Termos | Desenvolvimento |
| Validade padrão e teto dos convites (7 e 365 dias) | Código: `src/lib/auth/invitations.ts:29` e `32` | Limites do link de convite | Desenvolvimento |
| Limites de taxa (consulta de convite 30/min por IP, aceite 10/min por IP, ações administrativas 30/min por usuário) | Código: `src/lib/rate-limit.ts:132`, `136`, `149` | Proteção contra abuso | Desenvolvimento |
| `enable_signup`, `minimum_password_length` (6), `enable_confirmations` (`false`) e limites do serviço de autenticação | `supabase/config.toml:176`, `182`, `226` e `197-212` | Regras de cadastro e senha **no stack local do CLI**. Na instalação real (self-hosted) a configuração equivalente é do serviço de auth e **não está neste repositório** | Operação |

---

## Como funciona por dentro

### O desenho central

Não existe tabela de "membros". A associação pessoa → empresa mora em duas colunas de `profiles`: `account_id` e `account_role`. **Uma pessoa pertence a exatamente uma conta.** É por isso que aceitar um convite exige que a conta pessoal esteja vazia, e é por isso que remover alguém precisa criar uma conta nova para ele.

O isolamento entre empresas é feito no banco, por RLS, através de uma única função: `is_account_member(target_account_id, min_role)` (`supabase/migrations/017_account_sharing.sql:145`). Ela lê `profiles` pelo `auth.uid()` e compara a hierarquia numérica `owner=4 > admin=3 > agent=2 > viewer=1`. A mesma hierarquia está espelhada no TypeScript em `src/lib/auth/roles.ts`.

As policies têm três níveis (`017_account_sharing.sql:386-394`):

- **leitura**: qualquer membro (Visualizador para cima);
- **escrita operacional** (contatos, conversas, negócios, disparos, automações, fluxos): Atendente para cima;
- **escrita de configuração** (etiquetas, campos personalizados, configuração do WhatsApp, modelos de mensagem, funis): Administrador para cima.

Tabelas filhas (`messages`, `contact_tags`, `pipeline_stages`, `broadcast_recipients`, `automation_steps`, `flow_nodes`, `flow_run_events`, `message_reactions`, `contact_custom_values`) não têm `account_id`: o isolamento delas é feito por `EXISTS` na tabela pai (`017:511`).

### Nascimento de uma conta

O gatilho `on_auth_user_created` insere a linha em `accounts` e a linha em `profiles` com `account_role='owner'` na mesma função (`017_account_sharing.sql:671` e `675`). **Se isso falhar, o cadastro ainda é aceito**: a exceção é engolida com `RAISE WARNING` e o gatilho retorna `NEW` (`017:679`). O resultado é um usuário autenticado sem perfil e sem conta, que recebe **403** ("Profile is not linked to an account") em vez de 401 (`src/lib/auth/account.ts:180`).

### Onde mora a trava de cobrança

**A trava não está na RLS.** As policies são neutras quanto a `billing_status`. Quem barra é a aplicação:

- `getCurrentAccount()` lança `PaymentRequiredError` (HTTP 402) quando o status é `pending` ou `blocked` (`src/lib/auth/account.ts:226`);
- `isBillingGated` considera **só** esses dois (`src/lib/billing/status.ts:35`) — `past_due` não trava nada;
- o layout do grupo `(dashboard)` captura o 402 e redireciona para `/blocked` (`src/app/(dashboard)/layout.tsx:40`);
- o middleware **não** consulta o banco;
- os únicos chamadores com `allowBlocked: true` são a página `/blocked`, a página `/admin` e as rotas `/api/admin` (`src/app/blocked/page.tsx:23`, `src/app/admin/page.tsx:21`, `src/app/api/admin/health/route.ts:36`, `.../events/route.ts:16`, `.../pricing/route.ts:21`).

Uma conta bloqueada **continua recebendo e gravando mensagens do WhatsApp**. O que para é o lado que age em nome do operador. No webhook, `accountAllowsSideEffects(accountId)` é consultado **depois** da persistência (`src/app/api/whatsapp/webhook/route.ts:797`) e desliga o disparo de fluxos (`823-824`), automações (`888`), IA (`911`), áudio (`930`) e o bloco de `946`. Esse gate **falha aberto**: se a consulta der erro, os efeitos colaterais são permitidos (`src/lib/billing/side-effects.ts:53`).

Escrever em `billing_status` / `paid_until` / `billing_notes` é possível apenas sob `service_role`, `postgres` ou `supabase_admin` — um gatilho recusa o resto (`037_manual_billing.sql:114`). Por isso o único caminho de aplicação é `PATCH /api/admin/accounts/[accountId]`, que usa a chave de serviço.

Contas que já existiam antes da migração 037 foram promovidas para `active` pela própria migração, com um marcador em `billing_notes` (`037:75`) — clientes antigos não foram trancados.

### Prevenção de escalonamento de privilégio

A RLS não sabe expressar regra por coluna. Um gatilho separado impede que o cliente do navegador (papel `authenticated`) altere `profiles.account_role` ou `profiles.account_id` (`034_fix_profiles_update_rls.sql:64`, erro `insufficient_privilege`). Sem ele, qualquer usuário se promoveria a `owner` com um `UPDATE` direto.

Pela mesma lógica, mudança de papel, remoção e transferência de propriedade **não são `UPDATE` direto**: são três RPCs `SECURITY DEFINER` que refazem toda a autorização a partir do `auth.uid()` (`018_account_member_rpcs.sql`):

- `set_member_role` exige `owner`/`admin` (`018:67`), recusa mexer no próprio papel (`018:73`), recusa alvo de outra conta, recusa rebaixar um `owner` e recusa promover a `owner` (`018:89`, `95`, `99`);
- `remove_account_member` recusa remover a si mesmo (`018:161`) e o `owner` (`018:180`); cria uma conta pessoal nova para o removido e move o perfil para lá como `owner` (`018:187` e `194`). Essa conta nova nasce `pending` (o `INSERT` não informa `billing_status`), então o removido cai na tela de espera;
- `transfer_account_ownership` rebaixa o dono atual para `admin`, promove o alvo e reaponta `accounts.owner_user_id`, tudo na mesma transação (`018:270`, `273`, `276`).

### O caminho de um convite

1. **Criação** — `POST /api/account/invitations` gera um token de 32 bytes em base64url, grava só o SHA-256 e devolve o texto plano mais a URL `/join/<token>` uma única vez (`src/lib/auth/invitations.ts:48`; `route.ts:217-249`). A validade sofre *clamp* no servidor: padrão 7 dias, teto 365 (`invitations.ts:92`). A base da URL vem de `NEXT_PUBLIC_SITE_URL`; sem ela, dos cabeçalhos `X-Forwarded-Host`/`Host`, validados contra `ALLOWED_INVITE_HOSTS` quando definido (`route.ts:94-135`).
2. **Consulta sem login** — `GET /api/invitations/[token]/peek` hasheia o token em TypeScript antes de tocar o banco e chama a RPC `peek_invitation`, que é `SECURITY DEFINER` com `GRANT EXECUTE` para `anon` (`019_invitation_rpcs.sql:89`). Ela distingue de propósito `not_found`, `used` e `expired` (`019:60`, `64`, `68`); a defesa contra enumeração são os 256 bits do token mais o limite de 30 requisições por minuto por IP.
3. **Aceite** — `POST /api/invitations/[token]/redeem` valida a sessão com `supabase.auth.getUser()` em vez de `getCurrentAccount()`, portanto **não sofre o 402 de cobrança** (`redeem/route.ts:88`); `/join` também não está na lista de caminhos protegidos do middleware. A RPC trava a linha com `FOR UPDATE` (`019:143`), verifica que a conta atual do usuário é dele e está vazia em 11 tabelas (`019:194`, erro `23505` → HTTP 409), move o perfil (`019:216`) e só então apaga a conta pessoal órfã (`019:229`) — nessa ordem, para o `ON DELETE CASCADE` não levar o usuário junto.

A página `/join` tem layout próprio com `Referrer-Policy: no-referrer` para o token não vazar no cabeçalho `Referer` (`src/app/join/layout.tsx:31-36`).

### Aceite dos Termos

`POST /api/terms/accept` ignora o corpo da requisição: grava a versão do **servidor** (`TERMS_VERSION`), o IP e o user-agent observados (`route.ts:81`). O `upsert` usa `onConflict: 'user_id,version'` com `ignoreDuplicates`, apoiado no índice único `(user_id, version)` — reenviar é idempotente e **não** sobrescreve a data do aceite original (`route.ts:85`). A gravação usa a chave de serviço (`route.ts:76`). No cadastro, a chamada é disparada com `.catch(() => {})`: falhar ao registrar o aceite não derruba o cadastro (`src/app/(auth)/signup/page.tsx:113`).

A tabela `terms_acceptances` é append-only por construção: com RLS ligada e **sem** policy de `UPDATE` nem de `DELETE`, essas operações são negadas (`057_terms_acceptances.sql:52-54`).

### Sessão, middleware e gates de tela

- `src/middleware.ts:73` tem uma lista **estática e por prefixo** de caminhos protegidos: `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/settings`, `/agents`, `/flows`, `/notifications`, `/admin`, `/blocked`. Ela **não cobre `/api`** (exceto `/api/whatsapp/` que não seja o webhook) — a proteção das rotas de API é feita dentro de cada handler.
- O middleware copia os cookies rotacionados pelo refresh de token para toda resposta de redirect (`middleware.ts:38`); sem isso a sessão travava após ociosidade.
- Quem já está logado e visita `/login`, `/signup` ou `/forgot-password` é redirecionado; se a URL tem `?invite=`, o destino vira `/join/<token>` (`middleware.ts:63`).
- `src/hooks/use-auth.tsx` carrega o perfil e a conta em **consultas separadas**: `profiles` (`153-159`), depois `accounts` por id (`185-191`) e `ai_scheduling_settings` best-effort (`214`). O *embed* por chave estrangeira foi deliberadamente evitado por causa do cache de schema do PostgREST.
- Os gates de interface **falham fechados** durante o carregamento: `<RequireRole>` devolve o fallback e `useCan` devolve `false` enquanto o perfil não chegou (`src/components/auth/require-role.tsx:42`; `src/hooks/use-can.ts:42`).
- O link **Administração** na barra lateral é cosmético (`src/components/layout/sidebar.tsx:280`); a proteção real está na página e nas rotas de API.

### Chave de serviço

`supabaseAdmin()` (`src/lib/admin/client.ts`) é o cliente `service_role` compartilhado. Além de `/api/admin/accounts` — **o único uso cross-tenant**, que lista todas as contas — ele é usado por `/api/terms/accept`, `/api/feedback`, `/api/whatsapp/embedded-signup`, `/api/health/cron` e pelos auxiliares de observabilidade e de áudio. O gate de cobrança do webhook constrói o **próprio** cliente `service_role` em `src/lib/billing/side-effects.ts:25-32`. Ou seja: chave de serviço não está confinada a `/api/admin`; o que é exclusivo de `/api/admin` é a **leitura entre contas**.

### Instalação nova

A migração `044_public_grants.sql:43` restaura `GRANT ALL` em todas as tabelas e rotinas do schema `public` para `anon`, `authenticated` e `service_role`. Sem ela, numa instância nova do Supabase o PostgREST devolve "permission denied" antes mesmo de a RLS ser avaliada.

---

## Limites e pegadinhas

**Cobrança**

- **Toda conta nova nasce travada** (`billing_status` default `pending`). Se ninguém aprovar, o cliente nunca entra. Isso vale inclusive para quem foi **removido** de uma equipe: a conta pessoal nova dele também nasce `pending`, então ele cai na tela de espera.
- **A tela de espera não mostra a chave PIX.** PIX e QR só aparecem no estado *Bloqueada*. Um tutorial que diga "pague pelo PIX que aparece na tela" está errado para o cliente novo.
- **`Pagamento atrasado` não faz nada.** É indistinguível de *Ativa* para o cliente. Existe uma mensagem de aviso traduzida (`Billing.pastDueBanner` em `messages/pt-BR.json:2330`), mas **nenhum componente a usa** — não há banner, não há alerta. Use esse status apenas como anotação interna.
- **`Pago até` não bloqueia nada.** Nada consulta essa data. A suspensão é sempre manual.
- **O gate de cobrança do webhook falha aberto.** Se a consulta de status der erro, o sistema age como se a conta estivesse liberada (`src/lib/billing/side-effects.ts:53`).
- **Conta bloqueada continua consumindo.** As mensagens do WhatsApp continuam entrando e sendo gravadas; só as ações automáticas (IA, fluxos, automações, envios) param.

**Equipe e papéis**

- **Uma pessoa = uma conta.** Não existe "trocar de empresa" nem participar de duas. Quem já usou o sistema por conta própria **não consegue** aceitar um convite: precisa se cadastrar com outro e-mail (a própria tela oferece "Sair e usar outro e-mail").
- **Não existe tela para transferir a propriedade da conta.** A rota e a RPC funcionam, mas só por chamada manual. Se o dono sair da empresa, não há caminho pela interface.
- **Não existe apagar a conta, nem sair da conta por conta própria.** Não há rota nem tela. A exclusão de dados prometida na Política de Privacidade é feita fora do aplicativo.
- **Não existe convite por e-mail.** O sistema não envia e-mail de convite; ele gera um link e você distribui.
- **O link do convite aparece uma única vez.** Fechou a janela sem copiar, acabou: revogue e crie outro.
- **Um Administrador não edita o perfil do colega.** Ele lê nome e foto, mas só o próprio dono escreve neles (`017:612` e `614`).
- **A trilha de Configurações não esconde seções por papel.** Todas as 13 seções — incluindo Membros, WhatsApp e Chaves de API — aparecem também para Visualizador; o que muda é o conteúdo de cada painel (`src/components/settings/settings-rail.tsx:62`). Um Visualizador vê a seção "Membros da equipe", só não vê os controles.
- **Nem toda rota de API valida papel.** Este subsistema define os papéis, mas quem os aplica é cada handler — e há falhas conhecidas fora dele: `PATCH` e `DELETE` de `/api/whatsapp/templates/[id]` não exigem papel nenhum, ou seja, um Visualizador consegue apagar um modelo de mensagem na Meta. Não trate "Visualizador = somente leitura" como garantia absoluta.
- **Não existe tela para criar um administrador da plataforma.** Só `UPDATE` direto no banco.

**Convites e limites de taxa**

- **O limite de taxa é em memória, por processo** (`src/lib/rate-limit.ts:9`). Com mais de uma instância da aplicação, o limite é silenciosamente derrotado.
- **Sem `NEXT_PUBLIC_SITE_URL` configurado e sem cabeçalhos de host reconhecíveis, o fallback final da URL do convite é `https://wacrm.tech`** (`src/app/api/account/invitations/route.ts:134`) — um domínio de marketing de outro repositório, que dá 404 em `/join/<token>`. Convites gerados nessa condição não funcionam. Configure `NEXT_PUBLIC_SITE_URL`.

**Termos de Uso**

- A constante `TERMS_VERSION` existe e `GET /api/terms/accept` sabe responder se a versão vigente já foi aceita, **mas nenhum componente chama esse GET**. Não foi encontrado nenhum mecanismo que force um usuário **antigo** a reaceitar depois de um bump de versão. Não afirme que "subir a versão re-pede o aceite de toda a base": o que está comprovado é que cadastros novos registram a versão nova.

**Não verificado**

- **Redefinição de senha:** o retorno aponta para `/auth/callback` e `/reset-password`, que **não existem no repositório**. Se o fluxo se completa por outro caminho do serviço de autenticação, ou se está quebrado, é desconhecido. Precisa de teste com e-mail real.
- **Confirmação de e-mail no cadastro:** `supabase/config.toml:226` traz `enable_confirmations = false`, mas esse arquivo vale para o stack local do CLI. A instalação real é self-hosted e a configuração do serviço de auth não está neste repositório. O código do cadastro trata os dois caminhos (com e sem sessão imediata). Verifique no ambiente antes de escrever o tutorial.
- **O gatilho antiescalonamento (034) nunca foi executado contra um banco vivo** — a própria migração declara isso e lista os testes manuais (`034:47-55`, `83-97`).
- **O bootstrap da conta em Supabase self-hosted** não foi verificado: uma falha de permissão apareceria como usuário sem perfil, sem erro visível no cadastro.
- **Avatares antigos:** o bucket `avatars` é **público** (leitura liberada para qualquer um, escrita restrita à pasta do próprio usuário — `008_profile_avatars_storage.sql:33` e `42`). Não foi verificado se o arquivo antigo é apagado ao trocar a foto.
- **Conteúdo jurídico** das páginas de Termos e Privacidade não foi lido além da estrutura — não afirme prazos de retenção ou canais de exclusão sem conferir o texto.
- **Rotas sem interface:** `GET /api/account`, `PATCH /api/account`, `GET /api/terms/accept` e `POST /api/account/transfer-ownership` não têm nenhum chamador na aplicação.

---

## Referência

### Tabelas

| Tabela | Para que serve | Migração de origem | RLS |
|---|---|---|---|
| `profiles` | Uma linha por login. Fonte da verdade de `account_id` e `account_role`. Também guarda `is_platform_admin` | `001_initial_schema.sql:13`; `011:28`; `017:120-125`; `034:79`; `037:90` | `SELECT`: próprio ou membro da conta (`017:612`). `UPDATE`/`INSERT`: só o próprio (`017:614`, `617`). Sem `DELETE`. Gatilho bloqueia mudança de `account_role`/`account_id` pelo navegador (`034:64-71`) |
| `accounts` | O tenant: nome, dono, moeda padrão e estado de cobrança | `017_account_sharing.sql:60`; `021:23`; `037:61`; `039:14` | `SELECT`: membro (`017:631`). `UPDATE`: admin+ (`017:633`). Sem `INSERT`/`DELETE` para cliente. Gatilho protege colunas de cobrança (`037:109-120`) |
| `account_invitations` | Um convite pendente por linha; guarda só o hash do token | `017_account_sharing.sql:90` | `SELECT` e `ALL`: admin+ (`017:639`, `641`). Atendente e Visualizador não veem nada. Acesso anônimo só via RPC `peek_invitation` |
| `terms_acceptances` | Registro append-only de aceite dos Termos (versão, data, IP, user-agent) | `057_terms_acceptances.sql:26` | `SELECT` e `INSERT` só do próprio (`057:56`, `63`). Sem `UPDATE`/`DELETE` — negado por ausência de policy |
| `member_presence` | Presença online/ausente de cada membro; "offline" é derivado da idade de `last_seen_at` | `024_member_presence.sql:31` | `SELECT`: membro (`024:48`). Nenhuma policy de escrita — tudo passa pela RPC `touch_presence()` (`024:56-89`) |
| `api_keys` | Chaves da API pública por conta; guarda só o hash | `026_api_keys.sql:41` | `SELECT`: qualquer membro (`026:68`). `INSERT`/`UPDATE`/`DELETE`: admin+ (`026:75`, `79`, `83`) |
| `account_health` | Estado atual (não histórico) de cada verificação de saúde por conta | `053_account_health.sql:40` | `ALL`: só administrador de plataforma (`053:96-98`). O cron passa por cima sob service role |
| `platform_events` | Erros e feedbacks da plataforma inteira | `052_platform_events.sql:64` | `ALL`: administrador de plataforma (`052:152`). Usuário comum só enxerga e cria os próprios eventos de tipo `report` (`052:161`, `176`) |

Colunas de `api_keys` (corrigidas): `id` 026:42, `account_id` 026:43, `created_by` 026:44, `name` 026:45, `key_prefix` 026:46, `key_hash` 026:47, `scopes` 026:48, `last_used_at` 026:49, `expires_at` 026:50, `revoked_at` 026:51, `created_at` 026:52.

Enum de cobrança: `billing_status_enum` = `pending | active | past_due | blocked` (`037_manual_billing.sql:51-56`), default `pending` (`037:62-63`).

### Rotas

| Método | Rota | Arquivo | Quem pode |
|---|---|---|---|
| GET | `/api/account` | `src/app/api/account/route.ts:27` | Qualquer membro (sofre o 402 de cobrança). Sem chamador na interface |
| PATCH | `/api/account` | `src/app/api/account/route.ts:41` | Administrador da conta; limite 30/min. Nome com até 80 caracteres. Sem chamador na interface |
| GET | `/api/account/members` | `src/app/api/account/members/route.ts:30` | Qualquer membro. E-mail dos colegas só para admin+ (`route.ts:50`, `61`) |
| PATCH | `/api/account/members/[userId]` | `src/app/api/account/members/[userId]/route.ts:45` | Administrador da conta; limite 30/min; a RPC `set_member_role` refaz a autorização. Recusa `role='owner'` com 400 |
| DELETE | `/api/account/members/[userId]` | `src/app/api/account/members/[userId]/route.ts:97` | Administrador da conta. Devolve `{ ok:true, newPersonalAccountId }` |
| POST | `/api/account/transfer-ownership` | `src/app/api/account/transfer-ownership/route.ts:55` | Proprietário; a RPC refaz a checagem. Sem tela |
| GET | `/api/account/invitations` | `src/app/api/account/invitations/route.ts:139` | Administrador da conta. Só convites não aceitos e não expirados |
| POST | `/api/account/invitations` | `src/app/api/account/invitations/route.ts:167` | Administrador da conta; limite 30/min. Devolve o token em texto plano uma única vez |
| DELETE | `/api/account/invitations/[id]` | `src/app/api/account/invitations/[id]/route.ts:25` | Administrador da conta. `DELETE` físico; 0 linhas → 404 |
| GET | `/api/invitations/[token]/peek` | `src/app/api/invitations/[token]/peek/route.ts:65` | **Público, sem autenticação.** Limite 30/min por IP |
| POST | `/api/invitations/[token]/redeem` | `src/app/api/invitations/[token]/redeem/route.ts:65` | Qualquer sessão válida; **não** sofre o 402. Limite 10/min por IP. Erros: 42501→401, 22023→400, 23505→409 |
| GET | `/api/terms/accept` | `src/app/api/terms/accept/route.ts:41` | Qualquer sessão (não exige perfil nem conta). Sem chamador na interface |
| POST | `/api/terms/accept` | `src/app/api/terms/accept/route.ts:64` | Qualquer sessão; grava com a chave de serviço |
| GET | `/api/admin/accounts` | `src/app/api/admin/accounts/route.ts:33` | Administrador da plataforma + chave de serviço (ignora RLS) |
| PATCH | `/api/admin/accounts/[accountId]` | `src/app/api/admin/accounts/[accountId]/route.ts:31` | Administrador da plataforma + chave de serviço; limite de taxa. Único caminho para escrever cobrança |
| GET | `/api/admin/health` | `src/app/api/admin/health/route.ts:34` | Administrador da plataforma, com o cliente da sessão (a policy `account_health_admin` é que libera). Últimas 500 linhas |
| GET | `/api/admin/events` | `src/app/api/admin/events/route.ts:29` | Administrador da plataforma. A coluna de screenshot só vem na busca por id |
| PATCH | `/api/admin/events` | `src/app/api/admin/events/route.ts:100` | Administrador da plataforma |
| GET | `/api/admin/pricing` | `src/app/api/admin/pricing/route.ts:28` | Administrador da plataforma |
| PATCH | `/api/admin/pricing` | `src/app/api/admin/pricing/route.ts:64` | Administrador da plataforma |
| GET | `/api/account/api-keys` | `src/app/api/account/api-keys/route.ts:45` | Qualquer membro |
| POST | `/api/account/api-keys` | `src/app/api/account/api-keys/route.ts:71` | Administrador da conta. Texto plano uma vez só |
| DELETE | `/api/account/api-keys/[id]` | `src/app/api/account/api-keys/[id]/route.ts:24` | Administrador da conta |
| GET | `/api/v1/me` | `src/app/api/v1/me/route.ts:20` | Chave de API (`Authorization: Bearer`), sem escopo exigido. Devolve a conta e os escopos da chave |

### Telas

| Nome no menu / na tela | Rota | Arquivo |
|---|---|---|
| Entrar | `/login` | `src/app/(auth)/login/page.tsx:26` |
| Criar conta | `/signup` | `src/app/(auth)/signup/page.tsx:23` |
| Esqueci minha senha | `/forgot-password` | `src/app/(auth)/forgot-password/page.tsx:19` |
| Página do convite ("Você foi convidado para…") | `/join/[token]` | `src/app/join/[token]/page.tsx:84` |
| Conta aguardando aprovação / Conta temporariamente suspensa | `/blocked` | `src/app/blocked/page.tsx:18`, `src/app/blocked/blocked-view.tsx` |
| Administração (abas Eventos, Contas, Preços e câmbio) | `/admin` | `src/app/admin/page.tsx:19`, `src/app/admin/admin-tabs.tsx:29-56` |
| Configurações → Membros da equipe | `/settings?tab=members` | `src/components/settings/members-tab.tsx:124` |
| Convidar um colega (modal) | `/settings?tab=members` | `src/components/settings/invite-member-dialog.tsx:71` |
| Configurações → Seu perfil | `/settings?tab=profile` | `src/components/settings/profile-form.tsx:34` |
| Configurações → Login e segurança | `/settings?tab=security` | `src/components/settings/security-panel.tsx`, `password-form.tsx:23`, `sessions-card.tsx:38` |
| Configurações → Negócios e moeda | `/settings?tab=deals` | `src/components/settings/deals-settings.tsx:52` |
| Configurações → Chaves de API | `/settings?tab=api` | `src/app/api/account/api-keys/route.ts` (painel em `src/components/settings`) |
| Termos de Uso (público) | `/termos` | `src/app/termos/page.tsx:36` |
| Política de Privacidade (público) | `/privacidade` | `src/app/privacidade/page.tsx:38` |

### Funções (papéis) e o nome que aparece na interface

| Papel no banco | Nome na tela | O que a interface promete |
|---|---|---|
| `owner` | Proprietário | Controle total da conta e do faturamento |
| `admin` | Administrador | Gerencia membros + tudo mais |
| `agent` | Atendente (na barra lateral aparece como "Agente") | Usa os recursos; sem configurações |
| `viewer` | Visualizador | Somente leitura em todo o app |

Hierarquia usada tanto no banco quanto no código: `owner=4 > admin=3 > agent=2 > viewer=1` (`017_account_sharing.sql:145`; `src/lib/auth/roles.ts`).

### Arquivos-chave

| Arquivo | Papel |
|---|---|
| `src/lib/auth/account.ts` | `getCurrentAccount` (157), `requireRole` (252), `requirePlatformAdmin` (272) e os erros 401/403/402 com `toErrorResponse` (104) |
| `src/lib/auth/roles.ts` | Hierarquia de papéis e os predicados `canManageMembers`, `canEditSettings`, `canSendMessages`, `canDeleteAccount`, `canTransferOwnership` |
| `src/lib/auth/invitations.ts` | Geração do token de 32 bytes, hash SHA-256, montagem da URL e clamp da validade |
| `src/lib/auth/api-context.ts` | `requireApiKey` — resolve `Authorization: Bearer` numa conta, com cliente de serviço e escopos (`:80`) |
| `src/lib/billing/status.ts` | `BILLING_STATUSES`, `isBillingStatus`, `isBillingGated` (`:35`) |
| `src/lib/billing/side-effects.ts` | `accountAllowsSideEffects` — gate de cobrança do webhook; falha aberto (`47-59`) |
| `src/lib/legal/terms.ts` | `TERMS_VERSION` (`2026-08-03`) e `TERMS_PUBLISHED_LABEL` |
| `src/lib/account/members.ts` | `fetchAccountMembers` (cliente, best effort: devolve `[]` em qualquer erro) e `memberLabel` |
| `src/middleware.ts` | Redirecionos de autenticação, lista estática de rotas protegidas (`:73`) e cópia dos cookies rotacionados (`:38`) |
| `src/hooks/use-auth.tsx` | `AuthProvider`/`useAuth`; deriva `accountRole`, `canManageMembers`, `canEditSettings`, `canSendMessages`, `isPlatformAdmin` (`353-367`) |
| `src/hooks/use-can.ts` | `useCan(action)`; `false` enquanto o perfil carrega |
| `src/components/auth/require-role.tsx` | `<RequireRole min=…>`; falha fechado durante o carregamento (`42-44`) |
| `src/lib/admin/client.ts` | `supabaseAdmin()` — cliente `service_role` compartilhado (ver ressalva em "Como funciona por dentro") |
| `supabase/migrations/017_account_sharing.sql` | Migração fundadora do multi-tenant: enum de papéis, `accounts`, `account_invitations`, `is_account_member`, `account_id` em 15 tabelas, backfill e reescrita das policies |
| `supabase/migrations/018_account_member_rpcs.sql` | RPCs `set_member_role`, `remove_account_member`, `transfer_account_ownership` |
| `supabase/migrations/019_invitation_rpcs.sql` | RPCs `peek_invitation` (anônimo) e `redeem_invitation` |
| `supabase/migrations/034_fix_profiles_update_rls.sql` | Gatilho antiescalonamento de privilégio |
| `supabase/migrations/037_manual_billing.sql` | Cobrança manual: colunas, gatilho de proteção, `is_platform_admin()` e o `UPDATE` de bootstrap (`:44`) |
| `supabase/migrations/044_public_grants.sql` | `GRANT ALL` no schema `public` — sem isso, instância nova não lê nada |
| `supabase/migrations/057_terms_acceptances.sql` | Tabela de aceite dos termos, append-only |
| `docs/cobranca-manual.md` | Documento operacional da cobrança manual |
