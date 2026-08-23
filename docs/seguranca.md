# Segurança: onde estamos e o que uma borda resolveria

Escrito ao avaliar a ideia de colocar o Cloudflare na frente. A
conclusão curta primeiro, porque ela muda o plano:

> **O app tem DUAS origens públicas, não uma.** Proteger só o Next.js
> deixa o login desprotegido — porque o login não passa por ele.

---

## O que já existe

| Camada | Estado |
|---|---|
| Assinatura do webhook da Meta | HMAC-SHA256 com `timingSafeEqual` |
| Chaves da API v1 | Guardadas como SHA-256, nunca em claro |
| Tokens (Meta, Google) | Cifrados com AES-GCM (`ENCRYPTION_KEY`) |
| Isolamento entre contas | RLS em toda tabela, via `is_account_member()` |
| Rotas agendadas | Segredo compartilhado com `timingSafeEqual` |
| Cabeçalhos | HSTS, nosniff, X-Frame-Options DENY, Permissions-Policy |
| Rate limit | Por rota, na aplicação |

## As fraquezas reais

### 1. O login não passa pelo app

`signInWithPassword` vai **do navegador direto para o Kong do
Supabase**. O middleware do Next e o rate limiter da aplicação nunca
veem uma tentativa de senha. A única proteção é o limite embutido do
GoTrue: **30 tentativas por 5 minutos por IP** no padrão.

Contra um ataque com IP fixo, funciona. Contra qualquer botnet, não —
30 por IP × mil IPs é dez mil tentativas por minuto.

⚠️ `supabase/config.toml` **não vale aqui**: é a configuração do CLI
para desenvolvimento local. Em self-hosted os limites vêm das variáveis
`GOTRUE_*` no `.env` do stack do Supabase.

### 2. O rate limit é por processo

`src/lib/rate-limit.ts` guarda os contadores num `Map` em memória. Uma
instância só — que é o caso hoje — funciona. Duas instâncias, ou um
`docker compose restart`, e o limite reinicia. Está documentado no
próprio arquivo; virar problema depende de escalar.

### 3. CSP está em modo relatório

`next.config.ts` manda `Content-Security-Policy-Report-Only`. O
navegador reporta violação no console e **não bloqueia nada**. Vale
promover para bloqueio depois de dois deploys sem violação.

### 4. O IP do cliente é forjável

Duas rotas limitam por IP (`/api/invitations/*`), e liam a entrada mais
à esquerda de `X-Forwarded-For`. Proxies **acrescentam** a essa lista em
vez de substituí-la: quem manda `X-Forwarded-For: 1.2.3.4` faz a lista
chegar como `1.2.3.4, <ip real>`, e a leitura pela esquerda pega o valor
forjado. O limite por IP virava algo que se contorna trocando um header.

Corrigido: `CF-Connecting-IP` primeiro quando existe — a Cloudflare
reescreve esse header a cada request, então não dá para plantar valor
nele. Vale só com a nuvem laranja ligada e com `trusted_proxies` no
Caddy; sem isso, continua sendo a aproximação antiga.

O risco real era baixo (os tokens de convite são de 256 bits, e o
próprio código chamava a enumeração de teórica), mas o conserto é de
três linhas e passa a valer de verdade se a Cloudflare entrar.

### 5. Rotas sem teto

Várias rotas autenticadas não chamam `checkRateLimit`. Não é buraco de
autenticação — todas exigem sessão — mas significa que uma sessão
comprometida não encontra freio. `/api/feedback` foi a mais gritante
(carrega até 3 MB por chamada) e já ganhou teto.

---

## Cloudflare: o que resolve e o que não

### Resolve

- **DDoS volumétrico** — a razão original de existir, e o plano grátis
  já entrega
- **Esconder o IP do VPS**, o que tira o servidor do alcance de varredura
  direta
- **Bloqueio por país / ASN**, útil para uma ótica que só atende Brasil
- **TLS e certificados** sem Certbot no servidor

### Não resolve

- **Nada do que está acima**, exceto parcialmente o item 2 — as
  fraquezas são de aplicação, e uma borda não as vê
- **O login**, a menos que o **Kong também** esteja atrás do proxy. Este
  é o ponto que a maioria erra: protege-se o app, o atacante mira
  `auth.seudominio.com.br/auth/v1/token` e a borda nem participa

### O que custa

O plano grátis dá **uma regra de rate limiting** e os rulesets
gerenciados; regras WAF personalizadas só a partir do Pro (~US$ 20/mês).
Em 2026 a Cloudflare passou a contar a regra de rate limiting dentro da
cota de regras WAF na maioria dos planos pagos.

### ⚠️ O risco que quebra o produto

**Bot Fight Mode bloqueia webhook legítimo.** É problema documentado e
recorrente na comunidade, e o pior detalhe: **não dá para contornar com
regra WAF de Skip nem com Page Rule** no plano grátis.

Se ele bloquear a Meta, **todas as mensagens dos clientes param de
chegar**. Isso costumava ser invisível: a requisição nunca alcança o
app, nenhum evento é gravado, e o token do WhatsApp continua válido —
só ninguém está usando ele.

A verificação `inbound_silence` foi criada por causa disto. Ela compara
o silêncio atual com o maior silêncio que a PRÓPRIA conta já teve em 14
dias, então noite, domingo e feriado já estão embutidos no parâmetro e
não geram falso alarme. Passou disso com folga, vira alerta.

Se for usar Cloudflare: **deixe Bot Fight Mode desligado**. O plano B,
só para o dia em que quiser ligá-lo, é dar à Meta um subdomínio em
DNS-only (nuvem cinza) — está montado e comentado em
[`deploy/Caddyfile.exemplo`](../deploy/Caddyfile.exemplo).

E o Realtime do Supabase usa WebSocket — funciona proxied em todos os
planos, mas é o segundo lugar para conferir se algo parar.

### Uma consideração que não é técnica

Proxy significa que o TLS termina na Cloudflare, e o conteúdo trafega
decifrado dentro da infraestrutura deles. Isso inclui conversas de
clientes de uma ótica — dado de saúde, com política de privacidade
publicada e LGPD aplicável. Não é impeditivo (praticamente toda a web
faz isso), mas é decisão consciente, não detalhe de infraestrutura.

---

## Recomendação, em ordem de retorno

**1. Turnstile no login** — resolve a fraqueza nº 1, que é a única com
caminho de ataque remoto e não autenticado. É da Cloudflare, é grátis, e
**não exige proxiar nada**. Em self-hosted, quatro variáveis no
container `auth`:

```
GOTRUE_SECURITY_CAPTCHA_ENABLED=true
GOTRUE_SECURITY_CAPTCHA_PROVIDER=turnstile
GOTRUE_SECURITY_CAPTCHA_SECRET=<secret>
GOTRUE_SECURITY_CAPTCHA_TIMEOUT=10s
```

Mais o widget nas telas de login e cadastro, passando o token em
`options.captchaToken`.

**2. Apertar os limites do GoTrue** — `GOTRUE_RATE_LIMIT_*` no `.env` do
Supabase. Trinta tentativas por 5 minutos é folgado demais para uma
ótica com meia dúzia de usuários.

**3. Cloudflare proxied, com Bot Fight Mode DESLIGADO** — pelo DDoS e
por esconder o IP. Se for fazer, **as duas origens** (app e Kong).

**4. CSP para modo bloqueio** — depois de dois deploys sem violação no
console.

**5. Rate limit compartilhado** — só quando houver mais de uma
instância. Hoje seria complexidade sem ganho.

⚠️ **Se a Cloudflare entrar, `trusted_proxies` no Caddy não é opcional.**
Sem ela, quem abre a conexão TCP é a Cloudflare, todo limite por IP
conta o mundo inteiro como um visitante só — e isso vale também para os
30 sign-ins por 5 minutos do GoTrue, que deixariam de ser por atacante e
passariam a ser um balde global. A proteção contra força bruta ficaria
pior do que é hoje. Ver [`deploy/Caddyfile.exemplo`](../deploy/Caddyfile.exemplo).

O item 1 é o de maior retorno e o mais barato. O 3 é o que você
perguntou, e é bom — mas resolve um problema que você provavelmente
ainda não tem, enquanto o 1 resolve um que já tem.

---

## Fontes

- [Cloudflare Free Plan Limits 2026](https://eastondev.com/blog/en/posts/dev/20251201-cloudflare-pricing-compare/)
- [Rate limiting best practices — Cloudflare WAF docs](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)
- [Bot Fight Mode bloqueando webhook crítico](https://community.cloudflare.com/t/issue-with-bot-fight-mode-blocking-a-critical-webhook/830410)
- [Get started with Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
- [Enable CAPTCHA Protection — Supabase](https://supabase.com/docs/guides/auth/auth-captcha)
