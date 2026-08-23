# Auditoria de segurança — 12/08/2026

Cinco auditorias independentes, cada uma com uma lente diferente
(isolamento entre contas, autorização nas rotas, entrada não confiável,
segredos, exposição e abuso). Cada achado passou depois por um
**refutador** instruído a derrubá-lo — e um caiu.

**10 levantados · 9 confirmados · 1 refutado.**

Os três primeiros foram **reconfirmados por mim contra o banco desta
VPS**, não só lidos no código. Estavam valendo em produção.

Complementa [`seguranca.md`](./seguranca.md), que trata das fraquezas de
borda (rate limit por processo, CSP em relatório, IP forjável). Este
documento é sobre buracos de privilégio dentro do app.

---

## 🔴 Crítico

### 1. Qualquer usuário logado virava admin da plataforma

**Um PATCH.** A policy `profiles_update` deixa a pessoa editar a própria
linha, e a RLS **não sabe restringir coluna**:

```
PATCH /rest/v1/profiles?user_id=eq.<self>   {"is_platform_admin": true}
```

A migração 034 existe exatamente para impedir isso — mas o gatilho dela
só guarda `account_role` e `account_id`. A coluna `is_platform_admin`
nasceu depois, na 037, e ninguém voltou lá. A 044
(`GRANT ALL ON ALL TABLES`) tirou a última barreira.

**Confirmado nesta VPS:** o corpo da função do gatilho não menciona a
coluna, e `authenticated` tinha `UPDATE` irrestrito em `profiles`.

O que se abria em seguida: `/api/admin/accounts` (todas as contas da
instância, com billing e e-mail dos donos), `PATCH` do `billing_status`
de qualquer conta, `/api/admin/health`, e `platform_events.screenshot`
— que são **prints de caixa de entrada de clientes de outras empresas**.
E nem precisava estar com a conta liberada: `requirePlatformAdmin()`
passa `allowBlocked: true`, então uma conta recém-criada em `pending`
servia.

Cadastro é aberto (`/signup`). Ou seja: qualquer pessoa na internet.

### 2. Funções destrutivas chamáveis sem login

**Todas** as funções `SECURITY DEFINER` do schema `public` tinham
`EXECUTE` para `anon` — confirmado na VPS, as 20. Duas não recebem
argumento e mexem em **todas as contas de uma vez**:

```
POST /rest/v1/rpc/merge_duplicate_contacts     (só com a chave anon do bundle)
```

Ela roda como `postgres`, ignora RLS e, para cada conta da plataforma,
funde contatos com telefone igual — repontando conversas, negócios e
notas, e terminando em `DELETE FROM contacts`. Sem login, sem conta,
sem rastro de quem foi.

A causa é a mesma da anterior: a 044 concedeu `ALL ON ALL ROUTINES` e
devolveu o `EXECUTE` que as migrações 007, 012, 022, 028 e 036 tinham
revogado de propósito. **Um GRANT amplo não avisa o que reabriu.**

### 3. Os arquivos de todas as contas eram listáveis sem login

As três policies de SELECT do Storage eram `bucket_id = '<nome>'` e nada
mais, valendo para `anon`. Isso não é só "quem tem a URL lê": a mesma
policy governa o endpoint de **listagem**.

**Provei nesta VPS, sem login nenhum, só com a chave pública:**

```
POST /storage/v1/object/list/avatars {"prefix":""}
 -> [{"name":"c1a3272b-…"}]                    ← a pasta

POST /storage/v1/object/list/avatars {"prefix":"c1a3272b-…"}
 -> [{"name":"avatar-….png","metadata":{"size":9163,…}}]   ← nome, tamanho, data
```

O `chat-media` está vazio hoje — por isso o impacto **atual** é baixo.
Mas é para lá que vai tudo o que a atendente envia ao cliente: foto,
PDF, áudio. Numa ótica, dado de paciente. O buraco estava pronto,
faltava o conteúdo.

---

## 🟠 Alto

### 4. Um `viewer` apaga na Meta os templates da conta — ✅ CORRIGIDO

`PATCH` e `DELETE` de `/api/whatsapp/templates/[id]` exigem só sessão —
nenhum `requireRole`. Um membro `viewer` manda o DELETE: o template é
removido **em definitivo na Meta**, o DELETE local é barrado pela RLS
sem erro (zero linhas não é erro no PostgREST) e a rota responde
`200 {"success": true}`.

Resultado: a conta perde um template aprovado e continua vendo a linha
no painel. As rotas irmãs (`submit`, `sync`) já usam `requireRole`.

**Corrigido em 12/08/2026.** As duas passaram a exigir
`requireRole('admin')`, como as irmãs. E o DELETE local agora usa
`count: 'exact'` com filtro de conta: zero linhas deixa de virar
`200 {success:true}` e vira 404 — era assim que o template sumia da Meta
e continuava no painel.

### 5. XSS armazenado, disparado por um cliente do WhatsApp — ✅ CORRIGIDO

`/api/whatsapp/media/[mediaId]` repassa o `Content-Type` que veio da
Meta — que é o que **o remetente escolheu**.

Um cliente qualquer, sem conta e sem login, manda um "documento"
chamado `orcamento-2026.pdf` cujo mime é `text/html` com `<script>`. A
atendente clica no anexo; o navegador recebe `text/html` **na origem do
app**, dentro da sessão autenticada dela.

**Corrigido em 12/08/2026.** O tipo passou a ser decidido no servidor
por allowlist (`safeContentType`): imagem, áudio, vídeo e PDF são
servidos com o próprio tipo e `inline`; **todo o resto vira
`application/octet-stream` com `Content-Disposition: attachment`**, mais
`X-Content-Type-Options: nosniff` para o navegador não adivinhar um tipo
melhor que o nosso.

---

## 🟡 Médio e baixo

| # | achado | onde |
|---|---|---|
| 6 | Rate limiter aceita chave forjada pelo cabeçalho na única rota sem auth, e só limpa a cada 1000 chamadas — crescimento de memória controlado por quem ataca | `lib/rate-limit.ts:75` |
| 7 | `/api/ai/playground` gasta a chave do provedor sem teto por conta e sem limite de tamanho do texto | `api/ai/playground/route.ts:39` |

---

## ✅ Refutado — e por que isso importa

**"SSRF cega pelo endpoint de push"**: a rota de inscrição realmente não
valida a URL, e a RLS não impede o usuário de gravar o que quiser. O
refutador confirmou a ausência de validação — e derrubou o achado no
consumidor: a `web-push` não busca a URL do jeito que o cenário supunha.

Fica registrado porque um documento de segurança que só cresce perde a
utilidade. **Um achado falso custa mais caro que um a menos**: manda
consertar o que não está quebrado e queima a confiança no resto da
lista.

---

## O padrão por trás dos três críticos

Os três nasceram da **migração 044**, que fez
`GRANT ALL ON ALL TABLES/ROUTINES TO anon, authenticated` para resolver
um problema de permissão pontual.

Ela resolveu — e reabriu, em silêncio, tudo o que sete migrações
anteriores tinham fechado de propósito. Nenhum teste quebrou, porque
"mais permissão" nunca quebra teste.

Duas regras que saem daqui:

1. **`GRANT ALL` a papel de navegador não entra mais neste repositório.**
   Permissão nova é explícita, por tabela e por coluna.
2. **Coluna privilegiada nova entra no gatilho de guarda no mesmo
   commit que a cria.** Foi o esquecimento disso que produziu o crítico
   nº 1 — a 037 criou a coluna e a guarda ficou para trás.

---

## Estado da correção

`supabase/migrations/063_privilege_hardening.sql` fecha **1, 2 e 3**.

Validada em produção dentro de `BEGIN … ROLLBACK`, com sete asserções —
todas verdes, nada commitado:

| conferência | resultado |
|---|---|
| gatilho passa a cobrir `is_platform_admin` | ✅ |
| `anon` não executa mais `merge_duplicate_contacts` | ✅ |
| `service_role` continua executando (o app depende) | ✅ |
| `authenticated` fica com UPDATE em só 3 colunas de `profiles` | ✅ |
| `peek_invitation` continua aberta a `anon` (página `/join`) | ✅ |
| `is_account_member` intacta (revogá-la quebraria toda a RLS) | ✅ |
| as três policies de Storage recriadas com escopo | ✅ |

**Os buckets continuam `public = true` de propósito:** a URL pública é o
que a **Meta busca** para entregar a mídia. Confirmei que o caminho
`/storage/v1/object/public/...` serve sem credencial e **sem passar por
RLS** (HTTP 200 sem apikey) — então restringir a policy mata a
enumeração sem quebrar o envio.

**Risco residual assumido:** quem descobrir a URL exata continua
baixando. O caminho é `account-<uuid>/<timestamp>-<nome>`, sem
componente aleatório. Fechar isso pede sufixo aleatório e URL assinada
— mudança de produto, registrada em [`pendencias.md`](./pendencias.md).

**4 e 5 foram corrigidos em 12/08/2026** (onda 0 do
[`plano.md`](./plano.md)) — exigem rebuild do app para valerem em
produção.

**6 e 7 seguem abertos.** São mudanças de código pequenas: validar o
cabeçalho de IP antes de usá-lo como chave de balde, e acrescentar o
teto por conta na rota do playground.
