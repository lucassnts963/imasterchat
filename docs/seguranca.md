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

### 4. Rotas sem teto

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
chegar** — e param em silêncio, porque a requisição nunca alcança o app,
então nenhum evento é gravado e a faixa de saúde continua verde. O
sintoma vira "hoje ninguém mandou mensagem".

Se for usar Cloudflare: **deixe Bot Fight Mode desligado**, ou coloque
`/api/whatsapp/webhook` num subdomínio em modo DNS-only (nuvem cinza).

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
