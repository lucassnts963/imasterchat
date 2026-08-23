# Rodar local

Há **dois** jeitos de subir o Supabase nesta máquina, e eles servem a
propósitos diferentes. Escolher o errado não quebra nada — as portas não
colidem — mas você acaba com dois bancos e depurando o que não é o do app.

| | CLI do Supabase | Stack self-hosted |
|---|---|---|
| Quando | desenvolvimento do dia a dia | validar o **deploy** |
| Sobe com | `supabase start` | `docker compose -f supabase-stack/docker-compose.yml up -d` |
| Config | `supabase/config.toml` (versionado) | `supabase-stack/` (clonado, gitignored) |
| API | `http://127.0.0.1:54321` | `http://supabase.local:8000` |
| Postgres | 54322 | 5432 |
| Migrações | `supabase db reset` | `./deploy/apply-migrations.sh` |
| Espelha produção | não | sim — é o mesmo compose do VPS |
| Documentado em | este arquivo | `deploy/LOCAL.md` |

**Use o CLI** para escrever código. É uma linha para subir, `db reset`
aplica `supabase/migrations/` inteiro em ordem, e o Studio vem junto em
`http://127.0.0.1:54323`.

**Use o stack self-hosted** quando a pergunta for sobre o deploy em si —
Kong, `API_EXTERNAL_URL`, o hostname que precisa resolver dentro e fora do
container. São exatamente as coisas que o CLI esconde, e por isso ele não
serve para testá-las.

## CLI — o caminho curto

```bash
supabase start          # a primeira vez baixa as imagens
supabase db reset       # aplica 001 → a última, do zero
npm run dev
```

O `.env.local` precisa apontar para o que o `supabase start` imprime:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

### Docker na WSL, código no Windows

Se o Docker vive na WSL e o checkout está em `C:\`, rode o CLI **de dentro
da WSL** apontando para o caminho montado — ele lê `supabase/config.toml` e
as migrações de lá e sobe os containers onde o Docker está:

```bash
wsl -d Ubuntu -e bash -ic 'cd /mnt/c/dev/imasterchat && supabase start'
```

O WSL2 encaminha `localhost`, então o `npm run dev` continua rodando no
Windows e enxerga a API em `127.0.0.1:54321` normalmente.

## O que NÃO dá para testar local

**Receber mensagem do WhatsApp.** A Meta só entrega webhook em HTTPS
público — precisa de túnel (ngrok/cloudflared) e um número de teste.

**OAuth do Google, por outro lado, funciona.** `http://localhost` é a
exceção que o Google abre à regra do HTTPS, então basta cadastrar

```
http://localhost:3000/api/google/calendar/callback
```

nos *Authorized redirect URIs* do OAuth client e adicionar a sua conta em
*Test users* enquanto a tela de consentimento estiver em modo Testing.
Veja `docs/agendamento-google-calendar.md` para o resto.
