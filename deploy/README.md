# Deploy: iMasterChat + Supabase self-hosted na mesma VPS

Sobe o app e o Supabase completo (Postgres, Auth, Storage, Realtime, Kong,
Studio) num único `docker compose`, na mesma máquina. As 37 migrações são
aplicadas por script — sem SQL Editor manual.

## Antes de começar

- VPS com Docker e Docker Compose v2.
- Dois hostnames apontando pra VPS: um do app (`app.imasterchat.com.br`) e um da
  API do Supabase (`api.imasterchat.com.br`). Podem ser subdomínios do mesmo
  domínio.
- Um proxy reverso com TLS na frente (Caddy ou Nginx). O Supabase self-hosted
  **não** sobe HTTPS sozinho, e o WhatsApp Cloud API só entrega webhook em HTTPS.

## 1. Subir o stack do Supabase

```bash
git clone --depth 1 https://github.com/supabase/supabase
cp -r supabase/docker /caminho/do/imasterchat/supabase-stack
cd /caminho/do/imasterchat
cp supabase-stack/.env.example .env
```

Edite o `.env` — os que **não** podem ficar no padrão:

```bash
POSTGRES_PASSWORD=<senha longa e aleatória>
JWT_SECRET=<40+ caracteres aleatórios>
ANON_KEY=<JWT assinado com o JWT_SECRET, role "anon">
SERVICE_ROLE_KEY=<JWT assinado com o JWT_SECRET, role "service_role">
DASHBOARD_USERNAME=<login do Studio>
DASHBOARD_PASSWORD=<senha do Studio>

API_EXTERNAL_URL=https://api.imasterchat.com.br
SUPABASE_PUBLIC_URL=https://api.imasterchat.com.br
SITE_URL=https://app.imasterchat.com.br
```

`ANON_KEY` e `SERVICE_ROLE_KEY` são JWTs derivados do `JWT_SECRET` — gere pelo
[gerador oficial](https://supabase.com/docs/guides/self-hosting#api-keys). Se
trocar o `JWT_SECRET` depois, precisa gerar as duas chaves de novo **e**
rebuildar o app (a anon key é inlined no bundle).

```bash
docker compose -f supabase-stack/docker-compose.yml up -d
```

## 1b. E-mails de auth (SMTP) — sem isso, "Esqueci a senha" não funciona

Quem envia e-mail de confirmação e de recuperação de senha é o Supabase
(GoTrue), não o app — e a stack self-hosted vem com SMTP de mentira no
`.env.example`. Sem um SMTP real, o cliente que clicar em "Esqueci a
senha" **nunca recebe o e-mail**. Configure no mesmo `.env`:

```bash
# Provedor SMTP real (Resend, Brevo, Amazon SES, Mailgun…).
# Para operação pequena no Brasil, Resend ou Brevo têm tier grátis;
# SES quando o volume crescer.
SMTP_HOST=smtp.resend.com          # exemplo (Resend)
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<api key do provedor>
SMTP_ADMIN_EMAIL=nao-responda@imasterchat.com.br
SMTP_SENDER_NAME=iMasterChat

# Cadastro entra direto, sem clique em e-mail de confirmação.
# Recomendado aqui: o modelo de cobrança manual já segura toda conta
# nova em "pending" até você aprovar no /admin — exigir confirmação de
# e-mail por cima disso é fricção dupla. O SMTP acima continua
# necessário para "Esqueci a senha".
ENABLE_EMAIL_AUTOCONFIRM=true
```

- Confira os nomes exatos contra o `supabase-stack/.env.example` da
  versão que você clonou — a stack oficial muda de release em release.
- O link dos e-mails aponta para `SITE_URL` (passo 1) — precisa ser a
  URL pública do app.
- Depois de trocar SMTP: `docker compose -f supabase-stack/docker-compose.yml up -d`
  de novo para o serviço `auth` reler o `.env`.
- Enquanto não houver SMTP, o plano B é o admin trocar a senha do
  cliente pelo Studio (Authentication → Users → ⋯ → Reset password).
- Para testar local não precisa de nada disso: a stack de
  desenvolvimento captura todo e-mail no Mailpit (`http://localhost:54324`)
  — veja `deploy/LOCAL.md`.

## 2. Aplicar as migrações

O script espera Postgres, o schema `auth` (criado pelo GoTrue) e o schema
`storage` (criado pelo storage-api) antes de rodar — a migração 001 referencia
`auth.users` e as 008/016/023 inserem em `storage.buckets`, então rodar cedo
demais quebra.

```bash
./deploy/apply-migrations.sh
```

Idempotente: rode de novo a cada deploy que trouxer migração nova.

## 3. Variáveis do app

Acrescente ao mesmo `.env`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://api.imasterchat.com.br
NEXT_PUBLIC_SITE_URL=https://app.imasterchat.com.br
NEXT_PUBLIC_APP_LOCALE=pt-BR

# 64 hex — criptografa os tokens de WhatsApp de cada cliente:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<64 hex>

META_APP_SECRET=<App Secret do seu app Meta>
META_APP_ID=<App ID>

NEXT_PUBLIC_BILLING_CONTACT=https://wa.me/55XXXXXXXXXXX
NEXT_PUBLIC_BILLING_PIX_KEY=<sua chave PIX>

HOST_PORT=3000
```

`ANON_KEY` e `SERVICE_ROLE_KEY` o app lê direto do `.env` do Supabase — uma
fonte só pras chaves, sem duplicar.

## 4. Subir o app

```bash
docker compose -f supabase-stack/docker-compose.yml \
               -f deploy/docker-compose.app.yml up -d --build
```

## 4b. Proxy reverso: o que precisa ficar exposto

Dois hostnames públicos, cada um proxyando para um serviço local:

| Hostname | Destino local | O quê |
|---|---|---|
| `app.imasterchat.com.br` | `127.0.0.1:3000` (app) | Todo o site + APIs do app |
| `api.imasterchat.com.br` | `127.0.0.1:8000` (Kong) | Auth, REST, Storage, Realtime do Supabase |

### Host do app (`app.…` → :3000)

Proxy de **tudo** (`/`). Atenção especial a três rotas:

- **`/api/whatsapp/webhook`** — a Meta chama `GET` (verificação) e `POST`
  (mensagens). Precisa estar **público, sem basic auth e sem filtro de IP**
  (os IPs da Meta mudam; a rota já se protege com assinatura HMAC via
  `META_APP_SECRET`) e com **certificado TLS válido** — autoassinado a Meta
  rejeita em silêncio.
- **`/api/v1/*`** — API pública com chave (`Authorization: Bearer wacrm_live_…`).
  Público por design; rate limit próprio no app.
- **`/api/whatsapp/embedded-signup`** — recebe o `code` do popup do Facebook
  Login; basta estar acessível como o resto do site.

### Host da API Supabase (`api.…` → :8000, Kong)

O navegador do usuário fala **direto** com esse host (a anon key vai inlined
no bundle), então ele é tão público quanto o app. Rotas que o app usa:

- `/auth/v1/*` — login, signup, recuperação de senha
- `/rest/v1/*` — PostgREST (todos os dados)
- `/storage/v1/*` — avatares e mídia de chat (upload/download)
- `/realtime/v1/*` — **WebSocket**: o proxy precisa repassar o upgrade
  (inbox ao vivo, presença, notificações dependem disso)

O **Studio** é publicado pelo Kong nesse mesmo host (rota `/`, protegida
pelo basic auth `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`). Ele não é
usado pelo app — se puder, restrinja ao seu IP no proxy; no mínimo use
uma senha forte.

### Requisitos do proxy (valem para os dois hosts)

- **WebSocket upgrade** em `/realtime/v1/*` (Caddy faz sozinho; Nginx
  precisa de `proxy_set_header Upgrade/Connection` e `proxy_http_version 1.1`).
- **Tamanho de corpo**: uploads de mídia passam pelo `/storage/v1` — o
  padrão do Nginx (1 MB) é pouco; use `client_max_body_size 25m` nos dois
  hosts (o webhook da Meta e o `/api/v1` também recebem POSTs).
- **Timeout de leitura** ≥ 60 s no host da API (conexões Realtime longas).
- Repasse `Host` e `X-Forwarded-Host`/`X-Forwarded-Proto` reais — os links
  de convite derivam a origem do request quando `NEXT_PUBLIC_SITE_URL`
  não cobre o caso (veja `ALLOWED_INVITE_HOSTS` no `.env.local.example`).

Exemplo mínimo (Nginx, repetir o bloco para cada host):

```nginx
# no contexto http (uma vez só) — traduz o header de upgrade do WebSocket
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  server_name api.imasterchat.com.br;
  # ... listen 443 ssl + certificados ...
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 120s;
  }
}
```

(Com Caddy, `reverse_proxy 127.0.0.1:8000` já cobre WebSocket e TLS.)

### Migrar de VPS depois (provisória → permanente) só trocando o DNS

Funciona sem rebuild **porque tudo referencia o domínio, não o IP** — mas a
máquina nova precisa chegar idêntica antes da virada:

1. Restaurar o banco (`pg_dump` → restore) na VPS nova.
2. Copiar o **`.env` inteiro** — em especial `JWT_SECRET`/`ANON_KEY`/
   `SERVICE_ROLE_KEY` (mudou o secret = todas as sessões caem e o bundle
   precisa de rebuild) e `ENCRYPTION_KEY` (mudou = todos os tokens de
   WhatsApp salvos viram lixo).
3. Subir stack + app + proxy na nova, testar pelo IP (ex.: entrada no
   `/etc/hosts` da sua máquina apontando o domínio para o IP novo).
4. Baixar o TTL do DNS antes da virada e então trocar o A record.
   A Meta continua entregando webhook no mesmo domínio, sem reconfigurar
   nada no app dela.

## 5. Primeiro acesso

1. Crie sua conta em `https://app.imasterchat.com.br/signup`.
2. Ela nasce `pending` (é o comportamento correto — veja
   `docs/cobranca-manual.md`). Libere a si mesmo e vire admin da plataforma:

```bash
docker compose -f supabase-stack/docker-compose.yml exec db \
  psql -U postgres -d postgres -c \
  "UPDATE public.profiles SET is_platform_admin = true WHERE email = 'voce@exemplo.com';
   UPDATE public.accounts SET billing_status = 'active'
    WHERE owner_user_id = (SELECT user_id FROM public.profiles WHERE email = 'voce@exemplo.com');"
```

3. `/admin` agora lista todas as contas.

---

## Armadilhas do self-host (leia antes de debugar)

**`NEXT_PUBLIC_SUPABASE_URL` tem que ser a URL pública, nunca `http://kong:8000`.**
Ela é inlined no JavaScript em tempo de build e roda no navegador do visitante,
que não resolve nome de serviço do Docker. O código do servidor usa a mesma
variável, então esse hostname público precisa resolver **também de dentro do
container**. Se o DNS da VPS não faz loopback do próprio domínio, adicione no
serviço `app`:

```yaml
extra_hosts:
  - 'api.imasterchat.com.br:172.17.0.1'
```

**Trocar qualquer `NEXT_PUBLIC_*` exige rebuild** (`up -d --build`), não só
restart — são inlined no bundle.

**Webhook da Meta precisa de HTTPS válido** apontando para
`https://app.imasterchat.com.br/api/whatsapp/webhook`. Certificado autoassinado a
Meta rejeita silenciosamente.

**`pgvector`**: a migração 030 roda `CREATE EXTENSION IF NOT EXISTS vector`. A
imagem `supabase/postgres` já traz — só é problema se você trocar por um
Postgres genérico.

**Backup**: o volume do Postgres é o único estado que importa (mensagens,
contatos, tokens criptografados). Um `pg_dump` diário via cron já resolve:

```bash
docker compose -f supabase-stack/docker-compose.yml exec -T db \
  pg_dump -U postgres postgres | gzip > backup-$(date +%F).sql.gz
```

Sem o `ENCRYPTION_KEY` o dump é inútil pros tokens de WhatsApp — guarde a chave
separada do backup.
