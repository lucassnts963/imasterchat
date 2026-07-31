# Cobrança manual e multi-cliente

Como o iMasterChat é vendido: cada cliente (loja) tem uma **conta** própria, você
fatura fora do sistema (PIX, contrato) e libera ou bloqueia o acesso à mão pelo
painel `/admin`. Não há gateway de pagamento e nada muda de estado sozinho — não
existe cron que bloqueie ninguém de surpresa.

## Modelo de dados

Cada conta é um tenant isolado (migração `017_account_sharing.sql`): contatos,
conversas, funis e configuração de WhatsApp são separados por `account_id` e
protegidos por RLS. Uma segunda loja do mesmo cliente = uma segunda conta.

A migração `037_manual_billing.sql` acrescenta:

| Coluna | Onde | Para quê |
|---|---|---|
| `billing_status` | `accounts` | `pending` · `active` · `past_due` · `blocked` |
| `paid_until` | `accounts` | Data informativa (próximo vencimento) — não bloqueia nada sozinha |
| `billing_notes` | `accounts` | Notas internas: contrato, valor, contato |
| `is_platform_admin` | `profiles` | Quem enxerga o painel `/admin` |

### O que cada status faz

- **`pending`** — padrão de toda conta nova. O cadastro continua aberto, mas quem
  se cadastra cai na tela `/blocked` com "conta aguardando aprovação" até você
  liberar. É isso que impede que qualquer pessoa ganhe um tenant grátis.
- **`active`** — acesso total.
- **`past_due`** — acesso total; use para uma fatura atrasada que você ainda não
  quer cortar.
- **`blocked`** — acesso suspenso por falta de pagamento.

## Primeiro acesso (uma vez só)

Depois de aplicar a migração 037, marque-se como admin da plataforma no SQL
Editor do Supabase:

```sql
UPDATE public.profiles SET is_platform_admin = true
 WHERE user_id = '<seu id em auth.users>';
```

Contas que já existiam antes da migração são promovidas a `active`
automaticamente — a migração nunca tranca um cliente que já estava rodando.

## Rotina de cobrança

1. O cliente se cadastra (ou você cria a conta) → nasce `pending`.
2. Você acessa `/admin`, vê a conta na lista com e-mail do proprietário e nº de
   membros, e muda o status para `active`. Preencha `paid_until` e as notas com o
   combinado do contrato.
3. Se atrasar: mude para `past_due` (avisa mas não corta) ou `blocked` (corta).
4. Pagou: volta para `active`. Nada foi perdido — veja abaixo.

### Cliente esqueceu a senha

O caminho normal é o próprio cliente usar "Esqueci a senha" no login — o
Supabase envia o e-mail de redefinição (exige o SMTP configurado; veja
"E-mails de auth (SMTP)" no `deploy/README.md`). Enquanto o SMTP não estiver
configurado, o plano B é você redefinir manualmente: **Supabase Studio →
Authentication → Users → ⋯ na linha do usuário → Reset password** (ou envie
um novo convite de acesso). Não há como recuperar a senha antiga — só definir
uma nova.

## O que acontece com uma conta bloqueada

**As mensagens continuam chegando e sendo salvas.** O webhook do WhatsApp segue
gravando contatos, conversas e mensagens normalmente. Isso é decisão de produto:
uma discussão de cobrança não pode virar perda de dados, e ao reativar a conta o
histórico está completo.

O que para é a superfície paga — tudo que age em nome do cliente:

| Continua | Para |
|---|---|
| Receber e armazenar mensagens | Acesso ao painel (redireciona para `/blocked`) |
| Login e logout | Envio de mensagens (APIs respondem 402) |
| Ver o aviso com contato e PIX | Automações, fluxos e respostas automáticas de IA |

O envio da API pública de webhooks (`message.received`) **não** é bloqueado: ele
notifica os sistemas do próprio cliente e não manda mensagem para ninguém —
silenciá-lo só criaria um buraco inexplicado no fluxo de eventos dele.

## Onde isso é aplicado no código

O bloqueio tem dois pontos de entrada, e só dois:

- `src/lib/auth/account.ts` — `getCurrentAccount()` lança `PaymentRequiredError`
  (HTTP 402) para contas `pending`/`blocked`. Como toda rota de API passa por
  aqui, o bloqueio vale para o sistema inteiro sem edição rota a rota. A opção
  `allowBlocked` existe para as poucas telas que precisam justamente explicar o
  bloqueio (`/blocked`, `/admin`).
- `src/lib/billing/side-effects.ts` — usado pelo webhook, que roda com
  service-role e não tem sessão de usuário. Falha **aberto**: se a consulta de
  status der erro, as automações rodam. O modo de falha aceitável é atender uma
  conta bloqueada por uma mensagem, não quebrar as automações de quem paga.

O RLS **não** foi alterado de propósito: a página `/blocked` precisa ler o nome e
o status da própria conta para explicar a situação, e bloquear isso no banco
derrubaria justamente a consulta que mostra o motivo.

As colunas de cobrança só podem ser escritas pelo service-role (trigger na
migração 037), ou seja: pelas rotas `/api/admin/*` e pelo SQL Editor. Nem o
proprietário da conta consegue se marcar como pago por uma chamada direta.

## Variáveis de ambiente

```bash
# Contato de suporte mostrado na tela de bloqueio (vira botão se for URL)
NEXT_PUBLIC_BILLING_CONTACT=https://wa.me/5591999999999

# Chave PIX mostrada na tela de bloqueio
NEXT_PUBLIC_BILLING_PIX_KEY=chave@exemplo.com

# QR Code PIX (PNG em base64, com ou sem o prefixo data:) exibido na
# tela de bloqueio junto com a chave. Gere o base64 a partir da imagem
# do QR estático do seu banco:
#   node -e "console.log(require('fs').readFileSync('qr.png').toString('base64'))"
NEXT_PUBLIC_BILLING_PIX_QR=iVBORw0KGgo...
```
