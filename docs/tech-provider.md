# Tech Provider e Embedded Signup

Dois jeitos de conectar o WhatsApp de um cliente:

| | Manual (já existia) | Embedded Signup (este documento) |
|---|---|---|
| Quem cria o app na Meta | O cliente | Você, uma vez só |
| O que o cliente faz | Cria app, gera token permanente, copia Phone Number ID | Clica em "Conectar com o Facebook" e autoriza |
| Verificação de negócio | Do cliente | Sua, como Tech Provider |
| Quando usar | Cliente que já tem estrutura na Meta | Todo mundo |

O manual continua funcionando e é o fallback quando o Embedded Signup não
resolve (WABA com vários números, por exemplo).

## Por que isso destrava clientes sem site

A Meta exige site para **verificação de negócio**. Sob o modelo Tech Provider,
quem passa por essa verificação é você — o cliente entra sob o seu app.

Uma conta não verificada opera em Tier 0: **250 clientes únicos por 24h em
conversas iniciadas pelo negócio**. Atendimento é inbound: quando o cliente
final manda mensagem primeiro, a resposta dentro da janela de 24h não consome
esse limite. Ou seja, o caso de uso de atendimento é o menos afetado pela falta
de verificação — dá para operar de verdade sem site.

O que o cliente precisa mesmo assim, e costuma pegar de surpresa:

- Meta Business Portfolio (Business Manager)
- Autenticação em dois fatores ligada
- **Método de pagamento cadastrado na WABA**

Quando ele quiser volume ou disparos em massa, aí sim precisa verificar o
negócio — e vai precisar de um site.

## Configuração (uma vez)

No app da Meta (o seu, de Tech Provider):

1. Use case **"Connect through WhatsApp"**.
2. Permissões `whatsapp_business_management` e `whatsapp_business_messaging`.
3. Crie uma **configuração de Embedded Signup** e anote o `config_id`.
4. Webhook apontando para `<NEXT_PUBLIC_SITE_URL>/api/whatsapp/webhook`,
   inscrito no campo `messages`.
5. Em Facebook Login for Business, autorize **exatamente** a origem de
   `NEXT_PUBLIC_SITE_URL`.

> ⚠ Os passos 4 e 5 usam a origem REAL do deploy, não um `app.` de exemplo.
> Na instalação de referência ela é o ápice, `https://imasterchat.com.br` —
> este documento já mandou autorizar `app.imasterchat.com.br` e o popup
> falharia sem dizer por quê. A Meta compara a origem byte a byte; um
> subdomínio a mais é um domínio diferente.

Variáveis de ambiente:

```bash
# Servidor — o secret nunca vai para o navegador
META_APP_ID=<App ID>
META_APP_SECRET=<App Secret>

# Navegador — são públicos por natureza (o popup roda client-side)
NEXT_PUBLIC_META_APP_ID=<mesmo App ID>
NEXT_PUBLIC_META_ES_CONFIG_ID=<config_id do Embedded Signup>
```

São `NEXT_PUBLIC_*`, então mudar qualquer uma exige **rebuild** da imagem, não
só restart. Sem as duas, o botão não renderiza e só aparece o formulário
manual — é o comportamento correto para quem não é Tech Provider.

## O que acontece quando o cliente clica

`POST /api/whatsapp/embedded-signup` faz, em ordem:

1. Troca o `code` do popup pelo token de negócio do cliente (precisa do
   `META_APP_SECRET`, por isso é server-side).
2. Descobre qual WABA foi compartilhada, via `debug_token`. Usamos
   `granular_scopes` em vez de varrer `/me/businesses` porque isso retorna
   exatamente o que o cliente acabou de compartilhar, não tudo que ele enxerga.
3. Lista os números daquela WABA.
4. **Inscreve o nosso app nos webhooks da WABA.** É esse passo que faz mensagem
   chegar; sem ele a Meta aceita a conexão e nunca entrega nada — é a causa mais
   comum de "conectou mas não acontece nada".
5. Registra o número e salva o token criptografado (AES-256-GCM com
   `ENCRYPTION_KEY`) na conta de quem clicou.

O popup também manda, por `postMessage`, qual WABA e qual número o cliente
escolheu. O front repassa isso para a rota. Se faltar essa informação e a WABA
tiver mais de um número, a rota responde **409 em vez de adivinhar** — conectar
o número errado rotearia mensagens de outro negócio para dentro desta conta.

Um número só pode alimentar uma conta (o webhook roteia por
`phone_number_id`). Se já estiver em uso, a resposta é
`phone_number_already_claimed`.

## Testar

O Embedded Signup **não funciona em localhost**: a Meta valida o domínio
autorizado e o popup só abre em HTTPS público. Para testar antes de subir na
VPS, use um túnel (`cloudflared tunnel --url http://localhost:3000`) e autorize
a URL do túnel no Facebook Login for Business.

Todo o resto do sistema roda local normalmente — veja `deploy/LOCAL.md`.
