# Rodar local (Supabase self-hosted + app) para ver visual e funcionalidades

Sobe tudo na sua máquina, sem domínio e sem HTTPS. Dá para navegar em todas as
telas em português, ver a identidade nova e exercitar login, cadastro, painel
admin e bloqueio de conta.

**Não dá para testar localmente:** receber mensagens do WhatsApp. A Meta só
entrega webhook em HTTPS público — precisa de um túnel (ngrok/cloudflared) e um
número de teste. Todo o resto funciona.

## 1. Stack do Supabase

```bash
cd /caminho/do/imasterchat
git clone --depth 1 https://github.com/supabase/supabase /tmp/supabase-src
cp -r /tmp/supabase-src/docker ./supabase-stack
cp supabase-stack/.env.example .env
```

Para local, os padrões do `.env.example` do Supabase servem — as chaves de
exemplo (`ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET`) são públicas e conhecidas,
o que é irrelevante numa máquina de teste e **inaceitável em produção**. No
`.env`, ajuste só:

```bash
API_EXTERNAL_URL=http://supabase.local:8000
SUPABASE_PUBLIC_URL=http://supabase.local:8000
SITE_URL=http://localhost:3000
```

Suba:

```bash
docker compose -f supabase-stack/docker-compose.yml up -d
```

## 2. Hostname que funciona dos dois lados

Esse é o passo que, se pular, gera erro de login sem explicação:

```bash
echo "127.0.0.1 supabase.local" | sudo tee -a /etc/hosts
```

`NEXT_PUBLIC_SUPABASE_URL` é uma string só, usada pelo navegador **e** pelo
servidor dentro do container. `localhost` não serve: dentro do container ele
aponta para o próprio container. `supabase.local` resolve para o Kong dos dois
lados (o `extra_hosts` do compose cuida do lado de dentro).

## 3. Migrações

```bash
./deploy/apply-migrations.sh
```

Espera Postgres, `auth` e `storage` ficarem prontos sozinho — pode rodar logo
depois do `up -d`.

## 4. Variáveis do app

Acrescente ao mesmo `.env`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://supabase.local:8000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_LOCALE=pt-BR
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
NEXT_PUBLIC_BILLING_CONTACT=https://wa.me/55XXXXXXXXXXX
NEXT_PUBLIC_BILLING_PIX_KEY=teste@exemplo.com
```

## 5. Subir o app

```bash
docker compose -f supabase-stack/docker-compose.yml \
               -f deploy/docker-compose.local.yml up -d --build
```

Abra <http://localhost:3000>.

> **Alternativa mais rápida para mexer no visual:** `npm run dev` em vez do
> container. Aí `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000` funciona direto
> (navegador e servidor são o mesmo host, sem `/etc/hosts`), e você tem hot
> reload. Use o container quando quiser validar a imagem que vai pra VPS.

## E-mails no ambiente local (Mailpit)

Nenhum SMTP é necessário para testar. Todo e-mail que o Supabase Auth enviar
(recuperação de senha, convite, troca de e-mail) é capturado pelo **Mailpit**
em <http://localhost:54324> — abra a caixa lá e clique no link. A confirmação
de cadastro está **desativada** no local (`enable_confirmations = false`):
conta nova entra logada direto, sem e-mail. Em produção, configure um SMTP
real na stack — veja a seção "E-mails de auth (SMTP)" do `deploy/README.md`.

## 6. Roteiro de teste

**Bloqueio e aprovação manual** — o fluxo novo, vale testar primeiro:

1. Cadastre-se em `/signup`. Você cai em `/blocked` com "conta aguardando
   aprovação" — é o comportamento correto: conta nova nasce `pending`.
2. Vire admin da plataforma e libere sua conta:

```bash
docker compose -f supabase-stack/docker-compose.yml exec db \
  psql -U postgres -d postgres -c \
  "UPDATE public.profiles SET is_platform_admin = true WHERE email = 'voce@exemplo.com';
   UPDATE public.accounts SET billing_status = 'active'
    WHERE owner_user_id = (SELECT user_id FROM public.profiles WHERE email = 'voce@exemplo.com');"
```

3. Recarregue — agora entra no painel.
4. Vá em `/admin`: sua conta aparece na lista. Crie uma segunda conta num
   navegador anônimo e aprove/bloqueie ela pelo painel para ver o efeito.
5. Com a segunda conta em `blocked`, tente acessar o painel com ela: cai em
   `/blocked` com a mensagem de pendência, PIX e contato.

**Visual e tradução:**

- Tema vermelho `#E5484D` sobre near-black é o padrão; IBM Plex Sans/Mono.
- Logo novo (prompt `>_`) na sidebar, no login, no cadastro e na aba do
  navegador.
- Navegue por Painel, Caixa de entrada, Contatos, Funis, Disparos, Automações,
  Fluxos, Agentes, Notificações e todas as abas de Configurações procurando
  sobra de inglês ou chave crua (algo tipo `Settings.foo.bar` na tela).
- Em Configurações → Aparência dá para trocar o acento e claro/escuro — os cinco
  temas originais continuam lá.

## Problemas comuns

**Login falha sem mensagem clara** → quase sempre é o `/etc/hosts` do passo 2, ou
`API_EXTERNAL_URL` diferente de `NEXT_PUBLIC_SUPABASE_URL`. Precisam ser a mesma
string.

**Mudei um `NEXT_PUBLIC_*` e nada mudou** → são inlined no bundle em tempo de
build. Precisa de `up -d --build`, não `restart`.

**Recomeçar do zero:**

```bash
docker compose -f supabase-stack/docker-compose.yml down -v
```

`-v` apaga os volumes, então some tudo — inclusive seu usuário. Rode as
migrações de novo depois.
