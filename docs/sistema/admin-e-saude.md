# Admin da plataforma, saúde e alertas

Este é o painel de quem é dono do iMasterChat — não do dono da ótica, da loja de bicicleta ou da empresa de energia solar, mas de quem vende o sistema para eles. Ele reúne, numa tela só (`Administração`, no menu lateral), três coisas: a lista de problemas que aconteceram em qualquer conta da plataforma (falhas detectadas pelo próprio código e relatos digitados pelos clientes no botão de feedback), o estado de cobrança de todas as contas, e os números globais de preço de IA e cotação do dólar. Por trás, uma ronda automática de hora em hora testa as dependências de cada conta (chave da IA, token do WhatsApp, Google Agenda, se as mensagens continuam chegando) e, quando algo quebra, avisa por mensagem no Telegram.

Um ponto que precisa ficar claro desde já: **nada disto é visível para o cliente final**. O dono da ótica não vê a saúde da própria conta, não vê os eventos de erro da própria conta e não tem acesso ao painel. A única porta que ele enxerga deste subsistema é o botão de feedback ("Achou algo errado?"), que despeja o relato dele na mesma lista que o dono da plataforma lê.

---

## Para que serve (visão do cliente)

Há dois públicos aqui, e eles não se sobrepõem.

**Para o dono da plataforma (quem opera e vende o iMasterChat):**

- Ver, num só lugar, tudo o que deu errado em todas as contas nos últimos 14 dias: erro de integração, chave de IA recusada, token do WhatsApp vencido, relato de cliente.
- Receber um aviso no Telegram quando algo quebra, sem precisar ficar olhando tela. O aviso diz de que conta é, o que quebrou e há quanto tempo.
- Marcar cada problema como "Estou nisso" ou "Resolvido", para não tratar o mesmo assunto duas vezes.
- Ver de relance uma faixa de saúde no topo da tela: se está tudo verde, aparece uma linha verde com a contagem; se algo está falhando, aparecem só as linhas quebradas.
- Ver todas as contas da plataforma e ajustar, à mão, o estado de cobrança de cada uma: aguardando aprovação, ativa, pagamento atrasado, bloqueada. Também dá para anotar até quando está pago e escrever notas internas (contrato, valor, contato).
- Manter atualizado o preço de cada modelo de IA e a cotação do dólar, que são os números usados para mostrar custo em reais nas telas de custo do sistema.

**Para o cliente final (dono da ótica, da bicicletaria, da empresa de energia solar):**

- Ele tem um botão flutuante de feedback no canto inferior direito, dentro do sistema. Clica, escolhe entre "Problema", "Ideia" ou "Outro", escreve o que aconteceu e, se quiser, anexa uma imagem da tela. O texto que aparece é "Achou algo errado? Vai direto para quem desenvolve o iMasterChat."
- Junto do texto vai automaticamente o contexto técnico: qual tela ele estava, qual navegador, tamanho da tela, idioma, e o último erro que apareceu no console. É o que transforma "não funcionou" em um chamado que dá para trabalhar.
- Ele recebe o aviso "Recebido, obrigado!" e pode enviar outro. **Não existe tela onde ele acompanhe o que enviou** — o relato some da vista dele depois de enviado.
- O sistema avisa antes de anexar imagem: a tela pode conter a conversa de um cliente. Vale repetir isso em qualquer tutorial.

O que o cliente final **não** consegue fazer, e costuma presumir que consegue: ver o histórico dos próprios chamados, ver se a conta dele está com alguma integração quebrada, receber aviso de que o token do WhatsApp dele venceu. Nada disso existe hoje na interface dele.

---

## Como se usa, na prática

### Entrar no painel

O item **Administração** aparece no menu lateral apenas para quem tem a marcação de administrador da plataforma. Quem não tem, não vê o item e, se digitar o endereço na mão, é levado de volta ao painel normal — a checagem é refeita no servidor, o esconder do menu é só estética.

Não existe tela para dar ou tirar esse papel. Ele é ligado com um comando SQL direto no banco:

```sql
UPDATE public.profiles SET is_platform_admin = true WHERE user_id = '<id do usuário em auth.users>';
```

(documentado em `supabase/migrations/037_manual_billing.sql:43-45`).

### Aba Eventos (a que abre por padrão)

No topo, a **faixa de saúde**. Se estiver tudo bem, ela mostra uma linha verde com quantas verificações estão em `ok`, quantas foram puladas e há quanto tempo a última ronda rodou. Se algo estiver quebrado, ela lista só o que está quebrado, com nome em português: `Chave da IA`, `Token do WhatsApp`, `Google Agenda`, `Migrações do banco`, `Mensagens chegando`. Também aparece uma linha quando a própria ronda de verificação está atrasada ou nunca rodou.

Abaixo, a lista de eventos, com quatro filtros: **Em aberto**, **Falhas**, **Relatos**, **Tudo**. A janela é fixa em 14 dias — não há campo na tela para mudar isso.

Clicar em uma linha abre o detalhe: a mensagem, o contexto técnico, a imagem da tela quando o cliente anexou, e três botões — **Resolvido**, **Estou nisso** e **Reabrir**.

### Aba Contas

Uma tabela com todas as contas da plataforma: nome da conta, e-mail do proprietário, um seletor de status de cobrança, um campo de data "Pago até", a contagem de membros e um campo de notas internas. O subtítulo da tela avisa: "Alterações valem imediatamente."

O seletor grava assim que muda. A data e as notas gravam quando o campo perde o foco (você clica fora). Cada alteração é uma gravação independente; não há botão "salvar tudo".

Os quatro status são: **Aguardando aprovação** (`pending`), **Ativa** (`active`), **Pagamento atrasado** (`past_due`) e **Bloqueada** (`blocked`).

### Aba Preços e câmbio

Dois cartões.

O primeiro é a **cotação do dólar**: mostra o valor com quatro casas decimais, se veio de busca automática ou foi digitada à mão, e há quantos dias foi obtida. A partir de 7 dias a tela sinaliza que está velha. Tem um botão **Buscar agora**, que consulta a fonte externa na hora, e um campo para digitar o valor manualmente.

O segundo é a **tabela de preços de IA**: uma linha por prefixo de modelo, com preço de entrada e de saída em dólares por milhão de tokens. O botão Salvar só habilita quando algum valor mudou.

Na primeira vez que a aba é aberta, se a tabela de preços estiver vazia, ela é preenchida sozinha com a tabela de referência que vem no código.

### Enviar um relato (o cliente final)

Botão flutuante no canto inferior direito, dentro do sistema. Escolhe o tipo, escreve, anexa imagem se quiser, envia. **Esse botão não existe dentro do painel de Administração** — ele está montado no layout do painel do cliente, não no do admin. Se você, como dono da plataforma, quiser mandar um relato para você mesmo, precisa estar em uma tela comum do sistema.

---

## O que dá para configurar

Tudo nesta tabela exige o papel de administrador da plataforma, salvo onde indicado.

### Ajustes pela interface

| Ajuste | Onde | O que muda |
| --- | --- | --- |
| Status de cobrança da conta | Administração → Contas | Define se a conta é `pending`, `active`, `past_due` ou `blocked`. Vale na hora. Exige admin da plataforma. |
| Pago até (data) | Administração → Contas | Data livre no formato AAAA-MM-DD, ou vazio. Grava ao sair do campo. Exige admin da plataforma. |
| Notas internas da conta | Administração → Contas | Texto livre de até 2000 caracteres. Grava ao sair do campo. Exige admin da plataforma. |
| Preço de entrada/saída por modelo | Administração → Preços e câmbio | Dólares por 1M de tokens, por prefixo de modelo. Alimenta o cálculo de custo mostrado no sistema. Exige admin da plataforma. |
| Cotação do dólar — Buscar agora | Administração → Preços e câmbio | Consulta a fonte externa e grava com origem `auto`. Se a busca falhar, responde erro e nada muda. Exige admin da plataforma. |
| Cotação do dólar — valor manual | Administração → Preços e câmbio | Grava com origem `manual` e registra quem gravou. Recusa valores fora de 0 (exclusivo) a 50. Exige admin da plataforma. |
| Estado de um evento | Administração → Eventos, no detalhe | Resolvido / Estou nisso / Reabrir. Exige admin da plataforma. |
| Filtro da lista de eventos | Administração → Eventos | Em aberto / Falhas / Relatos / Tudo. A janela de dias é fixa em 14 na tela. Exige admin da plataforma. |
| Enviar relato com imagem | Botão de feedback, em qualquer tela do painel do cliente | Cria um evento do tipo relato. Não exige admin: qualquer usuário logado de conta não bloqueada. |

### Ajustes por variável de ambiente

| Ajuste | Onde | O que muda |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | `.env` / `deploy/docker-compose.app.yml:86` | Token do bot que envia os alertas. Vazio ou ausente: nenhum alerta sai, mas os eventos continuam sendo gravados normalmente. |
| `TELEGRAM_ALERT_CHAT_ID` | `.env` / `deploy/docker-compose.app.yml:87` | Chat de destino dos alertas. Mesma condição do token. |
| `AUTOMATION_CRON_SECRET` | `.env` / `deploy/docker-compose.app.yml:57` e `:144` | Segredo compartilhado por todas as rotas agendadas, incluindo a ronda de saúde e a de câmbio. Ausente: as rotas respondem 503. Vazio no container: o agendador não chama nada, só imprime um aviso e dorme. |
| `CRON_INTERVAL_SECONDS` | `deploy/docker-compose.app.yml:146` | Segundos entre ticks do agendador embarcado. Padrão declarado: 300. |
| `HEALTH_EVERY_TICKS` | `deploy/docker-compose.app.yml:157` | De quantos em quantos ticks a ronda de saúde roda. Padrão declarado: 12 (com o intervalo padrão, dá 1 hora). A tela acusa atraso depois de 2 horas, então subir esse número acima de 24 faz a faixa de saúde acusar falha permanente. |
| `KEEPER_EVERY_TICKS` | `deploy/docker-compose.app.yml:150` e `:176` | De quantos em quantos ticks a cotação é atualizada. Padrão declarado: 6. |
| `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL` | `.env`, lidas em `src/lib/admin/client.ts:18-19` | Sem elas o cliente privilegiado não sobe e a ronda inteira falha. |
| `ENCRYPTION_KEY` | `deploy/docker-compose.app.yml:50` | Se for rotacionada sem migrar os tokens gravados, a verificação do WhatsApp passa a acusar `credentials_unreadable` em todas as contas. |
| `EXPECTED_MIGRATION` | `next.config.ts:86-100` | **Não se define à mão.** É calculada no build, lendo o último arquivo `.sql` de `supabase/migrations` em ordem alfabética. Muda quando você adiciona migração e reconstrói a imagem. |

### Ajustes que só existem no código (exigem alterar e reimplantar)

| Ajuste | Onde | Valor |
| --- | --- | --- |
| Janela de silêncio da deduplicação de alerta | `src/lib/observability/events.ts:52` | 15 minutos |
| Severidade mínima que dispara alerta | `src/lib/observability/events.ts:55` | `error` |
| Lembrete de problema ainda quebrado | `src/lib/observability/health.ts:40` | 24 horas |
| Teto de contas verificadas por execução da ronda | `src/app/api/health/cron/route.ts:31` | 25 |
| Calibração do silêncio de mensagens recebidas | `src/lib/observability/health.ts:481`, `:484`, `:488` | mínimo de 20 mensagens em 14 dias; folga de 1,5× sobre o maior silêncio já visto; piso de 3 horas |
| Idade da ronda antes de a tela acusar atraso | `src/app/api/admin/health/route.ts:22` | 2 horas |
| Idade a partir da qual a cotação é sinalizada como velha | `src/app/admin/pricing-panel.tsx:159` | 7 dias |
| Tamanho máximo da imagem anexada a um relato | `src/app/api/feedback/route.ts:35` | 3.000.000 bytes |
| Limite de relatos por usuário | `src/lib/rate-limit.ts:142` | 5 por minuto |
| Conceder/retirar o papel de admin da plataforma | `UPDATE` manual em `profiles`, ver `supabase/migrations/037_manual_billing.sql:43-45` | não há tela |

---

## Como funciona por dentro

### O papel de admin da plataforma

A autorização inteira gira em torno da coluna booleana `profiles.is_platform_admin` (`037_manual_billing.sql:90-91`, padrão `false`) e da função SQL `public.is_platform_admin()` (`037:137-151`), que é `SECURITY DEFINER`, `STABLE`, com `search_path` fixo em `public`, e devolve `false` por `COALESCE` quando não há perfil para `auth.uid()`.

A checagem acontece em três camadas, e as três são independentes:

1. **Menu lateral** (`src/components/layout/sidebar.tsx:280-295`) — mostra ou esconde o link. O próprio comentário no código diz que é gate cosmético.
2. **Página e rotas** — `src/app/admin/page.tsx:21-22` redireciona para `/dashboard` quando não é admin; cada rota `/api/admin/*` recheca no servidor.
3. **RLS no banco** — as policies `platform_events_admin`, `account_health_admin`, `ai_model_prices_write` e `exchange_rates_write` usam `is_platform_admin()`.

O middleware (`src/middleware.ts:73-78`) só garante que `/admin` exija sessão; ele não conhece a flag.

Nenhum arquivo em `src/` escreve `is_platform_admin` — só há leituras.

### As duas famílias de dados

**Eventos** (`platform_events`, migração 052): uma linha por ocorrência, dois tipos no mesmo lugar — `kind='error'` (o código detectou uma falha) e `kind='report'` (o cliente digitou). É um histórico que só cresce.

**Saúde** (`account_health`, migração 053): estado atual, não histórico. Uma linha por par (conta, verificação), sobrescrita a cada ronda. Verificações de plataforma ficam com `account_id` nulo, garantidas por um índice único parcial (`053:81-83`).

### O gravador de eventos e o alerta

`recordEvent()`, em `src/lib/observability/events.ts`:

1. Imprime o evento no stdout antes de qualquer I/O — `console.error` para severidade a partir de `error`, `console.warn` abaixo disso (`events.ts:76-78`).
2. Decide se alerta: só a partir de severidade `error` (`ALERT_FROM`, linha 55), só se o Telegram estiver configurado, e só se não houve alerta recente para o mesmo par (conta, `code`) nos últimos 15 minutos (`ALERT_WINDOW_MS`, linha 52; consulta em `125-146`).
3. Grava a linha, já com `alerted_at` preenchido no próprio INSERT, **antes** de o Telegram responder — assim uma segunda falha simultânea encontra a janela tomada (`events.ts:99-103`).
4. Envia o alerta (`events.ts:148-180`), incluindo o nome da conta buscado em `accounts`; sem `account_id`, o rótulo é `plataforma (sem conta)` (`184-199`).

Truncamentos: mensagem cortada em 2000 caracteres na gravação (`:96`) e em 600 no texto do Telegram (`:159`); cada valor de contexto vai cortado em 120 caracteres e no máximo 6 chaves entram no alerta (`:163-170`).

Duas decisões de projeto que importam em incidente:

- **`recordEvent` nunca lança.** Todo o corpo está num `try` cujo `catch` só faz `console.error` (`events.ts:113-115`). Se o INSERT falhar, o evento se perde em silêncio; sobra o stdout.
- **Se a consulta de deduplicação der erro, o código assume que ainda não alertou** (`events.ts:141-145`). O viés é alertar a mais, não a menos.

`sendTelegramAlert()` (`src/lib/observability/telegram.ts:41-76`) faz um POST em `https://api.telegram.org/bot<token>/sendMessage`, com `parse_mode: HTML`, sem prévia de link, com timeout de 5 segundos. Nunca lança: devolve `{sent:false, reason}` — `not_configured`, `http_<status>` ou `network_error`.

### A ronda de saúde

`GET /api/health/cron` (`src/app/api/health/cron/route.ts`) roda sem usuário. Autentica pelo header `x-cron-secret` comparado a `AUTOMATION_CRON_SECRET` com `timingSafeEqual` e checagem de comprimento: 503 se a variável não existe, 401 se o header não bate (`:33-46`). Depois roda inteira sob service role.

A sequência:

1. `settlePastAppointments(db)` — aposenta compromissos vencidos (`:55`). É a primeira coisa que roda, antes de qualquer verificação.
2. `checkPlatform(db)` — a verificação `migrations` (`:57`).
3. Lê até 500 contas (`:62-65`), ordena cada uma pela **verificação mais antiga** que ela tem e pega as 25 primeiras (`MAX_ACCOUNTS_PER_RUN`, `:31`, `:68-90`). Conta que nunca foi verificada entra primeiro.
4. Para cada uma dessas contas, roda `checkAccount` em série (`:93-98`).
5. Grava a linha de plataforma `cron`, com status `ok` e um detalhe contando as contas verificadas (`:106-109`).

Responde `{checked, pending, failing, platform, appointments_settled}` (`:111-117`) e 500 em qualquer exceção (`:118-124`).

### As verificações, uma a uma

`checkAccount` (`src/lib/observability/health.ts:54-88`) roda exatamente quatro verificações por conta, em série (`:64-69`):

| Verificação | O que faz | Resultado |
| --- | --- | --- |
| `ai_credentials` (`:97-135`) | Se a conta registrou uso na última hora (contagem em `ai_usage_log`), devolve `ok` sem chamar o provedor (`:106-114`). Senão valida a credencial. | Erros com `code` `rate_limited` ou `timeout` são classificados como `ok`, não como falha (`:124-126`). |
| `whatsapp_token` (`:144-182`) | Decifra o token e chama `verifyPhoneNumber`. | Token indecifrável: `failing` com `credentials_unreadable`, apontando a `ENCRYPTION_KEY` (`:159-170`). Qualquer falha na chamada: `failing` com o código fixo `meta_token_rejected` (`:172-181`). |
| `google_calendar` (`:192-221`) | Verifica a conexão do Google. | Sem conexão: `skipped`. `invalid_grant`: mensagem que instrui reconectar em Configurações → Agendamento. |
| `inbound_silence` (`:442-476`, decisão em `:497-533`) | Olha só mensagens com `sender_type='customer'` dos últimos 14 dias, com join explícito `conversations!inner(account_id)` porque a ronda roda sob service role e a RLS não escopa nada (`:446-460`). | Menos de 20 mensagens em 14 dias: `skipped`. Senão, dispara quando o silêncio atual passa de `max(maior silêncio histórico × 1,5; 3 horas)`. |

Uma verificação que explode vira `skipped` com `code='check_crashed'` — nunca é reportada como falha da conta (`:74-82`).

`checkMigrations` (`:368-414`) compara `EXPECTED_MIGRATION` (calculada no build) com a tabela `applied_migrations`: `skipped` se a variável não existe; `failing`/`ledger_unreadable` se a tabela não pode ser lida; `ok` com `code='db_ahead'` se o banco está à frente do build; `failing`/`migration_missing` se está atrás. O `source` do evento de migração faltando é `app`, não `cron`, deliberadamente, para não mandar quem investiga para o agendador (`:340-344`).

### Como a saúde é gravada

`persist` (`health.ts:232-334`, reexportado como `persistCheck` em `:535`):

- Faz UPDATE ou INSERT explícito, **nunca upsert**, porque o índice de unicidade das linhas de plataforma é parcial e o PostgREST não sabe expressar `ON CONFLICT` sobre índice parcial (`:277-299`).
- Preserva `failing_since` entre execuções enquanto continuar falhando; zera quando volta a funcionar (`:252-256`).
- Alerta na transição ok → falhando, e depois só repete após 24 horas ainda quebrado (`REMINDER_MS`, `:40`, `:258-262`).
- Ao alertar, grava um evento com severidade `critical` e contexto com `check`, `desde` e `lembrete` (`:303-317`).
- A recuperação também vira evento: `code` `<check>_recovered` com severidade `info` (`:321-330`).
- Engole qualquer erro de gravação com `console.error` — uma falha ao gravar a saúde não interrompe a ronda (`:331-333`).

### A frescura da ronda

Ninguém grava "a ronda está atrasada". Isso é calculado **na leitura**, em `GET /api/admin/health` (`:22`, `:67-88`): sem linha `cron` o resultado é `failing`/`never_ran`; com `checked_at` de mais de 2 horas, `failing`/`stale`. A linha `cron` é removida da lista de verificações devolvida (`:93`) e entregue separada.

### Preços e câmbio

`GET /api/admin/pricing` semeia `ai_model_prices` a partir de `defaultPrices()` quando a tabela está vazia, com upsert e `ignoreDuplicates`, e só loga um aviso se a semeadura falhar (`:32-44`).

`PATCH /api/admin/pricing` tem três ações no mesmo verbo, decididas pelo corpo:

- `{action:'refresh_rate'}` → busca em `fetchUsdToBrl()` e grava com `source='auto'` e `updated_by`; responde 502 se a busca falha (`:75-98`).
- `{usd_rate:number}` → grava com `source='manual'`, recusando fora de `0 < r ≤ 50` (`:100-119`).
- `{model_prefix, input_usd, output_usd}` → atualiza um preço, recusando não-finitos e negativos (`:127-149`).

`fetchUsdToBrl()` (`src/lib/ai/price-store.ts:99-116`) bate na AwesomeAPI (`economia.awesomeapi.com.br`) com timeout de 10 segundos e descarta qualquer valor fora de 1 a 50, devolvendo `null` — o chamador mantém o que já tinha. `loadExchangeRate()` calcula `ageDays` em dias inteiros na leitura (`:81-83`).

`GET /api/exchange/cron` faz o mesmo pelo agendador, com o mesmo segredo de cron, e grava `source='auto'` sem `updated_by`. Quando a busca externa falha, responde **HTTP 200** com `{updated:false, reason:'fetch_failed'}`, de propósito, para não pintar o monitoramento de vermelho por causa de um terceiro fora do ar (`:43-48`).

### Cobrança manual

As três colunas de cobrança em `accounts` são protegidas por trigger no banco: qualquer UPDATE que altere `billing_status`, `paid_until` ou `billing_notes` fora de `service_role`/`postgres`/`supabase_admin` levanta `billing columns can only be changed by the platform admin` (`037:102-128`). Por isso a rota de PATCH usa o cliente service-role (`src/app/api/admin/accounts/[accountId]/route.ts:111`).

### Qual cliente cada rota usa

Só duas rotas do admin passam pelo cliente service-role: `GET /api/admin/accounts` (`:37`) e `PATCH /api/admin/accounts/[accountId]` (`:111`). Eventos, saúde e preços usam o cliente de **sessão** e dependem das policies com `is_platform_admin()` para enxergar as linhas.

### O caminho de um relato de cliente

`POST /api/feedback` insere direto em `platform_events` pelo cliente de sessão (`:101-119`) — **não passa pelo `recordEvent`**, portanto não usa a deduplicação nem grava `alerted_at`. Depois dispara a notificação do Telegram sob service role, anexando quantas falhas (`kind='error'`) a conta acumulou na última hora (`:169-219`).

Validações: `kind` ∈ {bug, idea, other} (`:54`), comentário com pelo menos 3 caracteres (`:61`), imagem no formato `data:image/(png|jpeg);base64` (`:70`) e até 3.000.000 bytes (`:35`, `:76`). Severidade `error` para bug e `info` para o resto (`:110`); status `open` e `source='app'` (`:111-112`).

---

## Limites e pegadinhas

**Sobre o que não existe:**

- **Não há tela para tornar alguém admin da plataforma.** É `UPDATE` manual no SQL Editor. Nenhum arquivo em `src/` escreve essa coluna.
- **O cliente não vê a saúde da própria conta.** `account_health` tem uma única policy, e ela exige `is_platform_admin()` (`053:95-98`). Não há tela, rota nem aviso para o dono da conta saber que o token do WhatsApp dele está recusado. Quem descobre é o dono da plataforma, pela faixa de saúde ou pelo Telegram.
- **O cliente não vê os erros da própria conta.** A única policy de SELECT que sobra para um usuário comum exige `kind='report'` **e** `user_id = auth.uid()` (`052:161-166`).
- **O cliente não tem tela de acompanhamento dos relatos que enviou.** Existe uma rota `GET /api/feedback` que devolve os 20 relatos mais recentes do próprio usuário, mas **nenhum componente do front a chama** — o widget só faz o POST (`feedback-widget.tsx:144-145`).
- **Não há retenção nem limpeza.** Nenhum código apaga linhas de `platform_events` ou `account_health`, e nenhuma migração cria job ou policy de retenção. As tabelas só crescem. Como `platform_events.screenshot` guarda imagens em data URL de até 3 MB, o crescimento não é desprezível.
- **`GET /api/admin/accounts` não tem paginação nem limite.** Devolve todas as contas da plataforma de uma vez.

**Sobre coisas que parecem funcionar de um jeito e funcionam de outro:**

- **Os nomes das contas não aparecem no painel.** Tanto `/api/admin/health` quanto `/api/admin/events` montam o mapa de nomes lendo `accounts` pelo **cliente de sessão**, e a única policy de SELECT em `accounts` é `is_account_member(id)` — não existe policy dando leitura cross-tenant ao admin da plataforma (`017_account_sharing.sql:631-632`). Pela leitura das migrações, esse mapa só pode conter a própria conta do admin; para as demais, a tela mostra os 8 primeiros caracteres do UUID (`health-strip.tsx:105`, `events-panel.tsx:231`). Ressalva honesta: isso é leitura de policy, não observação em banco vivo. Se alguém criou uma policy à mão fora de migração, o comportamento muda.
- **O filtro "Em aberto" também traz eventos marcados como "Estou nisso".** A rota traduz `status=open` para `.neq('status','resolved')`, o que inclui `ack` (`events/route.ts:64`).
- **Mudar o estado de um evento apaga a nota de resolução.** A rota grava `resolution_note` sempre, com `null` quando o campo não veio no corpo (`events/route.ts:125-128`), e a tela nunca envia esse campo (`events-panel.tsx:145`). Ou seja: pela interface, a nota é sempre apagada. Não há campo de nota na tela.
- **A faixa de saúde não avisa quando ela mesma falha.** Se `/api/admin/health` responder erro, a função simplesmente retorna e a tela continua mostrando o estado anterior, sem nenhuma indicação (`health-strip.tsx:61-63`). Uma faixa verde pode estar verde por estar desatualizada.
- **O agrupamento visual de eventos tem um detalhe estranho.** A tela colapsa ocorrências consecutivas do mesmo par (`code`, `account_id`) desde que a linha do grupo anterior seja `kind='error'`; o tipo da linha que chega não é testado (`events-panel.tsx:376-383`). Um relato de cliente pode ser absorvido no grupo de uma falha anterior com o mesmo código.
- **A janela padrão da rota de eventos é 7 dias, mas a tela sempre pede 14.** A API aceita de 1 a 90 pela query string; nenhuma interface expõe isso.
- **"Rate limited" e "timeout" da IA contam como saúde boa.** É proposital, para não alarmar por instabilidade momentânea, mas significa que uma conta com o provedor de IA saturado o tempo todo aparece como `ok`.
- **Qualquer falha ao validar o token do WhatsApp vira o mesmo código, `meta_token_rejected`**, independentemente da causa real — inclusive rede fora do ar.
- **Só uma rota de admin tem limite de chamadas.** `PATCH /api/admin/accounts/[accountId]` tem 30 por minuto por usuário. `PATCH /api/admin/events` e `PATCH /api/admin/pricing` não têm nenhum.
- **Um admin de plataforma com a própria conta bloqueada continua entrando no painel.** Todas as rotas de admin usam `getCurrentAccount({allowBlocked:true})`, e o layout de `/admin` vive fora do grupo `(dashboard)` justamente para não herdar o gate de cobrança.
- **O botão de feedback não existe dentro de `/admin`.** Ele está montado no layout do painel do cliente (`src/app/(dashboard)/layout.tsx:50`), e o layout de admin é outro.
- **Sem Telegram configurado, nada avisa.** Sem `TELEGRAM_BOT_TOKEN` ou `TELEGRAM_ALERT_CHAT_ID` (ambos precisam estar preenchidos), nenhum alerta sai — mas os eventos continuam sendo gravados e aparecem no painel. É silêncio, não perda de dado.
- **Se `AUTOMATION_CRON_SECRET` estiver vazio, o container de cron não chama nada** — imprime um aviso e dorme em loop. A faixa de saúde vai acusar `never_ran` ou `stale` depois de 2 horas.
- **O intervalo real da ronda é ≥ 1 hora**, não exatamente 1 hora: o loop do agendador soma a duração das próprias chamadas ao intervalo. O "1 hora" é aritmética sobre os padrões declarados no compose (`12 × 300s`), não medição de produção.
- **A ronda cobre no máximo 25 contas por execução.** Com mais de 25 contas ativas, cada conta é verificada com menos frequência que uma vez por hora — a ordenação prioriza quem está há mais tempo sem verificação, mas o teto é rígido.
- **`EXPECTED_MIGRATION` é do build, não do banco.** Se você aplicar uma migração nova sem reconstruir a imagem, a verificação `migrations` vai reportar `ok` com `db_ahead`. Se reconstruir sem aplicar, vai reportar `failing`/`migration_missing`.
- **Se a ronda estourar antes de chegar no fim**, a linha `cron` não é carimbada e a rota responde 500. A tela, nesse caso, mostra a ronda como atrasada — ela não distingue "quebrou no meio" de "nunca rodou" além dos códigos `stale` e `never_ran`.
- **Um evento perdido é perdido em silêncio.** `recordEvent` engole o erro de gravação. Se o banco estiver fora, o único registro é o stdout do container.

**Defeitos confirmados em áreas vizinhas que aparecem aqui:**

- O teto mensal de gasto de IA por conta (`monthly_budget_usd`) é exibido e usado em projeção, mas **nunca é aplicado** — não corta nada. Os preços que você mantém na aba Preços e câmbio alimentam essa exibição e essa projeção, não um bloqueio.
- Um pico de mensagens do mesmo contato pode gerar mais respostas de IA do que o teto configurado; a verificação `ai_credentials` não tem relação com esse limite e não vai acusar nada.

**Ressalvas do levantamento (o que não foi verificado):**

- Nada disto foi executado contra um banco vivo. Tudo sobre RLS vem da leitura do SQL das migrações. Não foi confirmado que 037, 050, 052 e 053 estão aplicadas em algum ambiente, nem que ninguém alterou policies fora de migração.
- As policies da tabela `profiles` não foram lidas: não se sabe quem consegue **ler** a coluna `is_platform_admin` de outros usuários.
- Não se sabe se `applied_migrations` tem RLS habilitada no banco real. O script que a cria (`deploy/apply-migrations.sh:83-87`) não emite `ENABLE ROW LEVEL SECURITY` nem `GRANT`. Na prática a verificação a lê sob service role, então isso não afeta a verificação — afeta quem mais poderia lê-la.
- Não foi confirmado se algum agendador externo ao repositório (crontab de host, systemd timer, CronJob) também chama `/api/health/cron`. O único encontrado é o serviço `cron` do compose.
- O comentário da migração 053 lista os nomes de verificação como `ai_credentials | whatsapp_token | google_calendar | migrations | cron` (`053:44-45`) e **não menciona `inbound_silence`**, que o código grava. A coluna é texto livre, então não há conflito técnico — a documentação da migração é que está desatualizada.

---

## Referência

### Tabelas

| Tabela | Migração de origem | O que guarda | Quem enxerga (RLS) |
| --- | --- | --- | --- |
| `platform_events` | `supabase/migrations/052_platform_events.sql` | Falhas detectadas pelo código (`kind='error'`) e relatos do widget de feedback (`kind='report'`). | `platform_events_admin`: FOR ALL com `is_platform_admin()` (`052:152-154`). `platform_events_report_select`: SELECT de `kind='report'` do próprio usuário, na própria conta (`052:161-166`). `platform_events_report_insert`: INSERT travado em `kind='report'`, `user_id=auth.uid()`, membro da conta, `status='open'`, `alerted_at` e `resolved_at` nulos (`052:176-184`). GRANTs de SELECT/INSERT (`:190`) e UPDATE/DELETE (`:191`) para `authenticated`, mas sem policy que os habilite para não-admin. |
| `account_health` | `supabase/migrations/053_account_health.sql` | Estado atual de cada verificação, uma linha por (conta, verificação). `account_id` nulo para as verificações de plataforma. | `account_health_admin`: FOR ALL com `is_platform_admin()` (`053:96-98`). É a única policy. |
| `exchange_rates` | `supabase/migrations/050_model_prices_and_fx.sql` | Cotação USD→moeda, uma linha por moeda. Fato global. | `exchange_rates_select`: SELECT para qualquer `authenticated` (`050:91-92`). `exchange_rates_write`: FOR ALL com `is_platform_admin()` (`050:95-97`). |
| `ai_model_prices` | `supabase/migrations/050_model_prices_and_fx.sql` | Preço por prefixo de modelo, em USD por 1M de tokens. Fato global. | `ai_model_prices_select`: SELECT para qualquer `authenticated` (`050:51-52`). `ai_model_prices_write`: FOR ALL com `is_platform_admin()` (`050:55-57`). |
| `profiles.is_platform_admin` | `supabase/migrations/037_manual_billing.sql:90-91` | Flag booleana, padrão `false`. Define quem é admin da plataforma. | Policies de `profiles` não levantadas neste documento. |
| `accounts` (colunas `billing_status`, `paid_until`, `billing_notes`) | `017_account_sharing.sql` (RLS) + `037_manual_billing.sql:51-65` (colunas e trigger) | Estado de cobrança manual de cada conta. | `accounts_select` USING `is_account_member(id)`; `accounts_update` USING/WITH CHECK `is_account_member(id,'admin')` (`017:631-635`). **Não há policy de leitura cross-tenant para o admin da plataforma** — as rotas `/api/admin/accounts` usam service role. Trigger `trg_protect_billing_columns` bloqueia alteração fora de service role (`037:102-128`). |
| `applied_migrations` | **Não há migração.** É criada pelo script `deploy/apply-migrations.sh:83-87` com `CREATE TABLE IF NOT EXISTS`. | `filename` (PK) e `applied_at`. Livro-caixa lido pela verificação `migrations`. | O script não emite `ENABLE ROW LEVEL SECURITY` nem `GRANT`. Efetivamente: sem RLS declarada e sem grant para `authenticated`. |

Enums criados pela 052 e 053: `platform_event_kind` (`error` | `report`), `platform_event_severity` (`info` | `warning` | `error` | `critical`), `platform_event_status` (`open` | `ack` | `resolved`), `health_status` (`ok` | `failing` | `skipped`). `billing_status_enum` (`pending` | `active` | `past_due` | `blocked`) vem da 037.

Nomes de verificação efetivamente gravados pelo código: `ai_credentials`, `whatsapp_token`, `google_calendar`, `inbound_silence` (`health.ts:65-68`), `migrations` (`health.ts:363`) e `cron` (`api/health/cron/route.ts:106`).

### Rotas

| Método | Rota | Arquivo | Papel exigido | O que faz |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/accounts` | `src/app/api/admin/accounts/route.ts` | Admin da plataforma, via `requirePlatformAdmin()` compartilhado (`:35`). Depois usa service role (`:37`). | Lista todas as contas com `billing_status`, `paid_until`, `billing_notes`, `created_at`, mais e-mail do proprietário e contagem de membros derivados de uma varredura única em `profiles` (`:39-73`). Sem paginação e sem limite. |
| PATCH | `/api/admin/accounts/[accountId]` | `src/app/api/admin/accounts/[accountId]/route.ts` | Admin da plataforma (`:36`) + limite de 30 chamadas/min por usuário (`:39-43`). Escrita por service role (`:111`). | Altera `billingStatus` (validado, `:57`), `paidUntil` (`AAAA-MM-DD` ou nulo, `:68-84`) e `billingNotes` (até 2000 caracteres ou nulo, `:86-102`). 400 se nada a atualizar (`:104`), 404 se a conta não existe (`:125`). |
| GET | `/api/admin/events` | `src/app/api/admin/events/route.ts` | Admin da plataforma, via helper local (`:15-21`). Cliente de sessão. | Com `?id=<uuid>`: um evento, incluindo a coluna `screenshot` (`:34-46`). Sem `id`: até 200 eventos (`:61`) dos últimos `days` dias (padrão 7, entre 1 e 90 — `:51`), com filtros `kind`, `status` e `account_id` (`:63-66`), mais o mapa `accountNames` (`:76-92`). A coluna `screenshot` nunca sai na listagem (`:26-27`). |
| PATCH | `/api/admin/events` | `src/app/api/admin/events/route.ts` | Admin da plataforma, via helper local (`:102`). Cliente de sessão, apoiado na policy `platform_events_admin`. | Marca um evento como `open`, `ack` ou `resolved` (`:112`). Ao resolver grava `resolved_at` e `resolved_by`; ao reabrir ou marcar `ack`, limpa ambos (`:116-129`). `resolution_note` é sempre gravada, com `null` quando não veio no corpo (`:125-128`). |
| GET | `/api/admin/health` | `src/app/api/admin/health/route.ts` | Admin da plataforma, checagem inline com 403 (`:36-39`). Cliente de sessão, apoiado na policy `account_health_admin`. | Até 500 linhas de `account_health` ordenadas por `checked_at` desc (`:42-48`), o mapa `accountNames` (`:53-65`) e um objeto `cron` calculado na leitura: `never_ran`, `stale` (mais de 2h) ou ok (`:22`, `:67-88`). A linha `cron` sai da lista de verificações (`:93`). |
| GET | `/api/admin/pricing` | `src/app/api/admin/pricing/route.ts` | Admin da plataforma, via helper local (`:20-26`). Cliente de sessão; RLS de escrita é a segunda camada. | Semeia `ai_model_prices` a partir de `defaultPrices()` quando a tabela está vazia (`:32-44`), devolve os preços ordenados por provedor e preço de entrada, e a cotação de BRL (`:46-55`). |
| PATCH | `/api/admin/pricing` | `src/app/api/admin/pricing/route.ts` | Admin da plataforma, via helper local (`:66`). Sem limite de chamadas. | Três ações no mesmo verbo: `refresh_rate` (busca externa, `source='auto'`, 502 se falhar, `:75-98`), `usd_rate` (manual, `source='manual'`, 0 < r ≤ 50, `:100-119`) e atualização de um preço de modelo (`:127-149`). |
| GET | `/api/health/cron` | `src/app/api/health/cron/route.ts` | **Nenhuma sessão.** Header `x-cron-secret` comparado a `AUTOMATION_CRON_SECRET` com `timingSafeEqual`: 503 sem a variável, 401 se não bate (`:33-46`). Roda sob service role. | A ronda de saúde completa: liquida compromissos vencidos, verifica migrações, verifica até 25 contas em série, carimba a linha `cron`. Responde `{checked, pending, failing, platform, appointments_settled}`. |
| GET | `/api/exchange/cron` | `src/app/api/exchange/cron/route.ts` | **Nenhuma sessão.** Mesmo esquema de `x-cron-secret` (`:27-40`). Escreve com service role (`:50`). | Busca USD→BRL e grava com `source='auto'`, sem `updated_by` (`:42-59`). Falha de busca responde 200 com `{updated:false, reason:'fetch_failed'}` (`:43-48`); falha de escrita responde 500 (`:61-64`). |
| POST | `/api/feedback` | `src/app/api/feedback/route.ts` | Qualquer usuário logado de conta **não bloqueada** (`getCurrentAccount()` sem `allowBlocked`, `:39` — conta bloqueada recebe 402) + limite de 5 por minuto por usuário (`:44`). Não exige admin. | Insere `kind='report'` em `platform_events` pelo cliente de sessão (`:101-119`) e notifica no Telegram sob service role, anexando a contagem de falhas da conta na última hora (`:169-219`). |
| GET | `/api/feedback` | `src/app/api/feedback/route.ts` | Qualquer usuário logado de conta não bloqueada (`:139`). Apoiada na policy `platform_events_report_select`. | Devolve os 20 relatos mais recentes do próprio usuário, sem a coluna `screenshot` (`:143-152`). **Nenhum componente do front chama esta rota.** |

### Telas

| Nome no menu / na tela | Rota | Arquivo | O que é |
| --- | --- | --- | --- |
| Administração | `/admin` | `src/app/admin/page.tsx` | Server Component. Redireciona para `/dashboard` se não for admin da plataforma (`:21-22`), para `/login` sem sessão e para `/blocked` em conta bloqueada (`:24-25`). Renderiza as abas. |
| (layout do painel) | `/admin` | `src/app/admin/layout.tsx` | Envolve em `AppShell` (`:37`) e declara `robots` com `index:false`, `follow:false`, `nocache:true` (`:19-30`). Vive fora do grupo `(dashboard)` para não herdar o gate de cobrança — e, por isso, sem o botão de feedback. |
| (barra de abas) | `/admin` | `src/app/admin/admin-tabs.tsx` | Três abas: **Eventos** (padrão), **Contas** e **Preços e câmbio**. |
| Eventos | `/admin` | `src/app/admin/events-panel.tsx` | Lista com filtros **Em aberto**, **Falhas**, **Relatos**, **Tudo** (`:54-59`), janela fixa de 14 dias (`:108`). Agrupa ocorrências consecutivas do mesmo par (conta, código) (`:158`, `:372-388`). Modal de detalhe com contexto, imagem e botões **Resolvido**, **Estou nisso**, **Reabrir** (`:266-367`). |
| Eventos → faixa de saúde | `/admin` | `src/app/admin/health-strip.tsx` | Consome `GET /api/admin/health` (`:61`). Mostra só o que está falhando (`:84`, `:99-112`) e a ronda de cron quando quebrada (`:85`, `:91-97`). Tudo ok: uma linha verde com contagens e a idade da última ronda (`:114-124`). Rótulos em português: Chave da IA, Token do WhatsApp, Google Agenda, Migrações do banco, Mensagens chegando (`:37-43`); nome desconhecido aparece como o próprio slug (`:103`). |
| Contas | `/admin` | `src/app/admin/admin-panel.tsx` | Tabela de todas as contas: Conta, Proprietário, Status, Pago até (grava ao sair do campo, `:166-171`), Membros e Notas (grava ao sair do campo, `:185-190`). Cada alteração é um PATCH independente (`:74-96`). Textos do namespace `Billing.admin`. |
| Preços e câmbio | `/admin` | `src/app/admin/pricing-panel.tsx` | Cartão da cotação (valor em pt-BR com 4 casas, origem auto/manual, idade em dias, botão **Buscar agora**, campo manual — `:106-147`) e cartão de preços por prefixo de modelo com Salvar habilitado só quando há alteração (`:271-273`, `:307-318`). Cotação considerada velha a partir de 7 dias (`:159`). |
| Administração (item de menu) | — | `src/components/layout/sidebar.tsx:280-295` | Link renderizado só quando o perfil tem `isPlatformAdmin`. Gate cosmético: a página e as rotas rechecam no servidor. |
| Feedback (botão flutuante) | qualquer tela do painel do cliente | `src/components/feedback/feedback-widget.tsx` | Montado em `src/app/(dashboard)/layout.tsx:50`. Envia `POST /api/feedback` com tipo, comentário, imagem opcional e um contexto coletado do navegador: url, userAgent, viewport, idioma, modo standalone e último erro de console (`:144-160`). |

### Arquivos-chave

| Arquivo | Papel |
| --- | --- |
| `src/lib/admin/client.ts` | Cliente service-role preguiçoso e compartilhado (`:15-22`). O comentário `:8-12` exige que os chamadores passem por `requirePlatformAdmin()` antes de usá-lo. |
| `src/lib/observability/events.ts` | `recordEvent()`: grava em `platform_events` e decide o alerta. Constantes em `:52` (janela de 15 min), `:55` (severidade mínima), `:57-62` (ranking), `:64-69` (emojis). Helpers em `:125-146`, `:148-180`, `:184-199`. |
| `src/lib/observability/health.ts` | `checkAccount` (`54-88`), `checkAi` (`97-135`), `checkWhatsApp` (`144-182`), `checkGoogle` (`192-221`), `persist` (`232-334`, reexportado como `persistCheck` em `535`), `sourceOf` (`336-349`), `checkPlatform` (`359-365`), `checkMigrations` (`368-414`), `checkInboundSilence` (`442-476`), `evaluateSilence` (`497-533`). |
| `src/lib/observability/telegram.ts` | `isTelegramConfigured()` (`27-32`) e `sendTelegramAlert()` (`41-76`). `esc()` escapa `&`, `<` e `>` (`79-84`). |
| `src/lib/auth/account.ts` | `getCurrentAccount()` (`157-243`), que resolve sessão, perfil, conta e a flag (`:241`), com gate de cobrança em `:226`. `requirePlatformAdmin()` (`272-278`). |
| `src/lib/ai/price-store.ts` | `loadPriceOverrides()` (`20-44`), `loadExchangeRate()` com `ageDays` (`56-89`), `fetchUsdToBrl()` (`99-116`). |
| `deploy/docker-compose.app.yml` | Serviço `cron` (`138-194`): loop em sh com `CRON_INTERVAL_SECONDS`, `KEEPER_EVERY_TICKS` e `HEALTH_EVERY_TICKS`; chama `/api/health/cron` com timeout de 600s (`190-191`) e `/api/exchange/cron` com 30s (`179-180`). |
| `next.config.ts` | `latestMigration()` lê `supabase/migrations` no build e injeta `EXPECTED_MIGRATION` (`86-100`). |
| `deploy/apply-migrations.sh` | Cria `public.applied_migrations` (`83-87`) e registra cada arquivo aplicado (`96-98`). |
| `src/lib/observability/events.test.ts` | Testes do gravador: deduplicação por (conta, código), o INSERT que falha sendo engolido, o mock do Telegram. |
| `src/lib/observability/health.test.ts` | Testes de `evaluateSilence`: fica quieta de noite e no fim de semana, acusa quando o silêncio passa do histórico da conta. |
| `docs/pos-deploy.md` | Checklist operacional: logs do cron (`40-42`), faixa de saúde (`49-66`), como forçar um alerta com `UPDATE` em `account_health` (`76-80`), widget de feedback (`118-122`). |
