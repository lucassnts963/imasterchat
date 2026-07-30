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
