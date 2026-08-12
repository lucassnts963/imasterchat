# As telas do produto e o tratamento de áudio

Este documento cobre duas coisas que andam juntas na experiência do usuário: **o app em si** — as 27 telas, o menu, o idioma, as cores, a instalação no celular e os avisos com o app fechado — e **o que o sistema faz quando o cliente manda um áudio no WhatsApp**. São dois assuntos porque o áudio é o único recurso do produto cuja configuração inteira mora em uma única aba de uma única tela (Agentes de IA → Regras → seção Áudio), e cujo resultado aparece em todo o resto do app: a transcrição vira o texto da mensagem e, dali em diante, o sistema não sabe mais distinguir um áudio transcrito de um texto digitado.

O app é um Next.js (App Router) com quatro grupos de telas: as de entrada (login, cadastro, recuperação de senha), o app autenticado (menu lateral + cabeçalho, com portão de cobrança), o painel de plataforma `/admin` (mesmo visual, sem portão de cobrança) e as páginas públicas soltas (landing, privacidade, termos, convite, bloqueio). O idioma é **um só por instalação**, definido por variável de ambiente. O app é instalável no celular (PWA), mas deliberadamente **não funciona offline** — a instalação existe para receber aviso de mensagem com o app fechado.

---

## Para que serve (visão do cliente)

### O aplicativo

O dono do negócio e a equipe entram em um app que tem um menu lateral fixo com dez seções (Painel, Caixa de entrada, Notificações, Contatos, Funis, Disparos em massa, Automações, Fluxos, Agenda, Agentes de IA) e Configurações no rodapé do menu. Quem é administrador da plataforma vê ainda uma entrada "Administração".

O que o usuário final consegue fazer:

- **Instalar o app no celular ou no computador.** Vira ícone na tela de início, abre sem a barra do navegador e, ao abrir pelo ícone, cai direto na **Caixa de entrada** (não no Painel — quem abre o app está atendendo alguém).
- **Receber aviso de mensagem com o app fechado**, no celular ou no computador. Cada aparelho escolhe seu nível: desligado, só o que precisa de gente, ou toda mensagem. O celular pode avisar de tudo e o computador ficar quieto.
- **Escolher a aparência**: claro ou escuro, e uma entre seis cores de destaque. A escolha vale por aparelho e muda ao vivo. Há um botão de sol/lua no cabeçalho, disponível em qualquer tela.
- **Mandar um recado para quem desenvolve** pelo botão flutuante de feedback, com print da tela anexado.
- **Convidar gente para a conta** por um link que abre uma tela de convite antes de a pessoa entrar ou se cadastrar.

### O áudio que o cliente manda

Quando um cliente manda um áudio no WhatsApp, o negócio escolhe entre quatro comportamentos:

| Escolha na tela | O que o cliente percebe |
| --- | --- |
| **Não fazer nada** | O áudio fica gravado e aparece na conversa para a atendente ouvir, mas ninguém responde automaticamente. Do lado do cliente, é silêncio. |
| **Pedir que escreva** | O agente responde na hora pedindo que o cliente escreva o pedido. Não custa nada por minuto e acaba com o silêncio. |
| **Transcrever e responder** | O áudio vira texto e o agente responde como se o cliente tivesse digitado. A partir daí tudo funciona: histórico, palavras-chave, agendamento, automações. |
| **Passar para uma pessoa** | O agente nem tenta entender: transfere a conversa para atendimento humano e avisa a equipe. |

Detalhes que valem para o cliente final:

- Se a transcrição **falhar ou vier vazia**, o sistema não fica mudo: ele cai automaticamente no "Pedir que escreva". Ou seja, o pior caso do modo Transcrever é o comportamento do modo Pedir que escreva.
- O texto desse pedido é editável (até 300 caracteres). Vazio, usa o padrão: *"Recebi seu áudio! Para eu te ajudar mais rápido, pode me escrever o que você precisa?"*.
- Quem transcreve pode ser o **Whisper na VPS** (sem custo por minuto, o áudio não sai da infraestrutura, mais lento) ou a **ElevenLabs** (cobra por minuto, o áudio sai para um terceiro, mais rápida e precisa em áudio ruim de celular).
- No Whisper local dá para ensinar o **jargão do ramo** ("armação, lente antirreflexo, multifocal, Ray-Ban") para reduzir erro de transcrição. Verbos de agendamento e dias da semana já vêm inclusos.
- A **atendente também pode gravar áudio** para o cliente, pelo microfone do compositor da caixa de entrada. Isso é outro caminho, independente das quatro escolhas acima — a nota de voz da atendente não é transcrita.

---

## Como se usa, na prática

### Configurar o que fazer com áudio

1. Menu lateral → **Agentes de IA**.
2. Aba **Regras** (é a quarta aba; as abas são Playground, Vault, Limites, Regras, Contexto, Configuração e Uso).
3. Role até a seção **Áudio**.
4. Em **"Quando o cliente manda um áudio"**, escolha uma das quatro opções. Cada opção traz a explicação abaixo dela.
5. Os campos seguintes aparecem e somem conforme a escolha:
   - **"Mensagem quando não der para entender o áudio"** aparece em *Pedir que escreva* e em *Transcrever e responder*.
   - **"Quem transcreve"** só aparece em *Transcrever e responder*.
   - **"Palavras do seu ramo"** só aparece quando o provedor é *Whisper na nossa VPS*.
   - **"Chave da ElevenLabs"** só aparece quando o provedor é *ElevenLabs (API)*.
6. Botão **Salvar regras**. Precisa ser administrador da conta.

Sobre a chave da ElevenLabs: ela é guardada criptografada e **nunca volta para a tela**. Depois de salva, o campo mostra "••• chave salva — digite outra para trocar". Deixar em branco mantém a chave atual; a tela não envia campo vazio.

Se salvar der erro dizendo para configurar o Agendamento primeiro: a mesma tela grava também as regras de agendamento, e elas dependem de a conta ter agendamento configurado em Configurações → Agendamento.

### Como o negócio se chama entra na transcrição

Em **Configurações → Agendamento** existe um campo de rótulo do agendamento (como o negócio chama um compromisso: "consulta", "orçamento", "visita técnica" — até 40 caracteres). Esse rótulo é usado na agenda **e também é injetado no prompt do Whisper local**, para melhorar a transcrição de frases como "quero marcar uma consulta". Quem mexe em um, mexe no outro sem saber.

### Ouvir o áudio do cliente

Na **Caixa de entrada**, a mensagem de áudio aparece como um player com controles de reproduzir/pausar. O arquivo não fica no servidor do produto: o player busca os bytes na Meta a cada vez, por um endereço que exige sessão. Áudio antigo pode não tocar mais — a Meta expira mídia.

### Gravar áudio para o cliente

Na **Caixa de entrada**, no compositor de mensagem, há o botão de microfone. O navegador pede permissão de microfone (já liberada no cabeçalho de permissões do site). A gravação é Ogg/Opus feita no próprio navegador, com teto de **5 minutos** e **16 MB**.

### Instalar o app no celular

O convite de instalação aparece **apenas no Painel** (`/dashboard`), como um card. Fora do Painel ele não existe.

- Onde o navegador suporta, o botão **Instalar** abre o diálogo nativo.
- Onde não suporta, o card mostra as instruções da plataforma: no iPhone, Safari → Compartilhar → Adicionar à Tela de Início; no Android, menu ⋮ → Instalar aplicativo; no computador, o ícone de instalar na barra de endereço.
- **"Não exibir novamente"** é definitivo naquele aparelho. **"Fechar"** só adia até o navegador ser fechado.
- Instalar por qualquer caminho (inclusive pelo menu do navegador, em outra aba) faz o card sumir para sempre naquele aparelho.

### Ligar os avisos no celular

1. Menu lateral → **Configurações**.
2. Seção **Avisos no celular** (no rail da esquerda).
3. Escolha o modo: **Desligado**, **Só o que precisa de gente** ou **Toda mensagem**.
4. O navegador pede permissão de notificação. É neste momento — e só neste — que o app registra o service worker.

A escolha vale **por aparelho, não por pessoa**. A mesma atendente pode ter "toda mensagem" no celular e "desligado" no computador. No iPhone é preciso instalar o app na tela de início antes de as notificações funcionarem (iOS 16.4 ou mais novo).

Quando chegam várias mensagens do mesmo cliente, elas colapsam em **uma** notificação que se atualiza, em vez de empilhar. Só a transferência para humano faz o aparelho vibrar; mensagem comum, não. Tocar na notificação foca uma aba já aberta em vez de abrir outra janela.

### Trocar cor e claro/escuro

**Configurações → Aparência**: seis cores de destaque e o par claro/escuro. Ou o botão de sol/lua no cabeçalho, de qualquer tela. A preferência fica **só naquele aparelho** — não acompanha a conta, não vai para o banco. Trocar em uma aba propaga para as outras abas do mesmo navegador.

---

## O que dá para configurar

### Pela interface

| Ajuste | Onde | O que muda | Exige admin |
| --- | --- | --- | --- |
| Política de áudio (Não fazer nada / Pedir que escreva / Transcrever e responder / Passar para uma pessoa) | Agentes de IA → Regras → Áudio | Define todo o comportamento diante de um áudio recebido. Grava `ai_configs.audio_policy` | Sim |
| Mensagem quando não der para entender o áudio (até 300 caracteres) | Agentes de IA → Regras → Áudio | O texto enviado ao cliente nos modos *Pedir que escreva* e *Transcrever* com falha. Vazio usa o padrão do código. Grava `ai_configs.audio_notice_text` | Sim |
| Quem transcreve (Whisper na VPS / ElevenLabs) | Agentes de IA → Regras → Áudio (só na política *Transcrever*) | Qual provedor recebe o áudio. Grava `ai_configs.audio_transcription_provider` | Sim |
| Chave da ElevenLabs | Agentes de IA → Regras → Áudio (só com provedor ElevenLabs) | Credencial da transcrição paga; guardada cifrada. Campo em branco mantém a atual. Grava `ai_configs.elevenlabs_api_key` | Sim |
| Palavras do seu ramo (até 500 caracteres) | Agentes de IA → Regras → Áudio (só com provedor local) | Enviesa a transcrição do Whisper local para o vocabulário do negócio. Não tem efeito nenhum na ElevenLabs. Grava `ai_configs.transcription_vocabulary` | Sim |
| Rótulo do agendamento (até 40 caracteres) | Configurações → Agendamento | Como o negócio chama um compromisso. Usado na agenda **e** no prompt do Whisper local. Grava `ai_scheduling_settings.appointment_label` | Sim |
| Avisos no celular: desligado / só o que precisa de gente / toda mensagem | Configurações → Avisos no celular | Registra ou apaga a assinatura de push **deste aparelho** (`push_subscriptions.notify_mode`) | Não |
| Cor de destaque (6 opções) e claro/escuro | Configurações → Aparência | Aparência do app naquele aparelho. Só localStorage — não vai ao banco | Não |
| Claro/escuro em um clique | Botão de sol/lua no cabeçalho | O mesmo `data-mode` da tela de Aparência | Não |

### Por variável de ambiente (deploy)

| Ajuste | Variável / arquivo | O que muda |
| --- | --- | --- |
| Endereço do Whisper local | `WHISPER_URL` (padrão `http://whisper:9000`, definido em `deploy/docker-compose.app.yml:74`) | Sem ela, o provedor local devolve nulo e a política cai no aviso. Não é `NEXT_PUBLIC_`, então trocar não exige rebuild |
| Ligar/desligar o Whisper local | Profile do compose: `docker compose ... --profile whisper up -d` | O serviço `whisper` só sobe com o profile. Sem porta publicada — o app o alcança pela rede interna do Docker |
| Modelo e recursos do Whisper | `ASR_ENGINE=faster_whisper`, `ASR_MODEL=small`, `ASR_QUANTIZATION=int8`, limites de 2 CPUs e 3 GB (`deploy/docker-compose.app.yml`) | Precisão e velocidade da transcrição local |
| Idioma da interface | `NEXT_PUBLIC_APP_LOCALE` (`.env.local.example:47`, build arg e runtime no compose) | Um idioma por instalação: `en`, `pt-BR` ou `ko`. Não há troca pelo usuário |
| Chaves de push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`.env.local.example:210-215`) | Sem elas, a tela de avisos mostra "servidor ainda não tem as chaves configuradas" e o POST devolve 400 com código `push_not_configured` |
| Contato de suporte nas páginas legais | `NEXT_PUBLIC_BILLING_CONTACT` | O e-mail/contato exibido em /privacidade e /termos |
| Chave de criptografia | `ENCRYPTION_KEY` | Decifra a chave da ElevenLabs em runtime. Trocá-la faz a transcrição paga falhar e cair no aviso |

### Só no código (não há tela nem variável)

| Ajuste | Onde |
| --- | --- |
| Idioma da transcrição — `'pt'` fixo | `src/lib/audio/inbound.ts:125` |
| Timeout de 120 s e teto de 25 MB por áudio | `src/lib/audio/transcribe.ts:48` e `:45` |
| Modelo e URL da ElevenLabs (`scribe_v1`) | `src/lib/audio/transcribe.ts:80` e `:83` — deliberadamente fora de configuração |
| Vocabulário base do prompt (verbos de agendamento, dias da semana) | `src/lib/audio/prompt.ts:30-35` |
| Teto de 5 minutos e formato Ogg/Opus da nota de voz da atendente | `src/components/inbox/message-composer.tsx:76` e `468-475` |
| Catálogo de temas e o padrão (accent `elucas`, modo escuro) | `src/lib/themes.ts:16-27` e `:50-54` |
| Ordem e composição do menu lateral | `src/components/layout/sidebar.tsx:94-109` |
| Texto do aviso padrão de áudio | `src/lib/audio/policy.ts:33-34` |
| Resumo fixo enviado à equipe no handoff por áudio | `src/lib/audio/side-effect.ts:36-44` |

---

## Como funciona por dentro

### O caminho de um áudio recebido

Tudo começa no webhook da Meta (`src/app/api/whatsapp/webhook/route.ts`), único chamador do subsistema de áudio.

1. `parseMessageContent` trata o `case 'audio'` (linhas 1057-1065): preenche apenas `mediaUrl` e `mediaType`. O `contentText` do objeto vazio é `null` (linha 1013) — **uma mensagem de áudio nasce sem texto nenhum**.
2. `handleInboundAudio` é chamado na **linha 714**, antes do INSERT. Ele:
   - lê `ai_configs` da conta e normaliza: política desconhecida ou linha ausente vira `ignore` (`src/lib/audio/inbound.ts:69-71`); provedor que não seja exatamente a string `'elevenlabs'` vira `'local'`, inclusive nulo (`:79-82`);
   - **só na política `transcribe` toca em rede** (`:75-77`). As outras três decidem sem baixar nada;
   - busca `ai_scheduling_settings.appointment_label` numa consulta extra ao banco (`:99-103`);
   - baixa o áudio na Meta com `getMediaUrl` + `downloadMedia` (`:105-113`);
   - decifra a chave da ElevenLabs dentro de try/catch (`:85-93`);
   - chama `transcribeAudio` com `language: 'pt'` fixo (`:125`);
   - qualquer erro degrada para `{ policy: 'ignore', action: { action: 'none' } }` (`:55-58` e `:133-135`) — o webhook nunca cai por causa de áudio.
3. A decisão pura fica em `src/lib/audio/policy.ts:60-73`. A regra mais importante do módulo está em `:67-68`: `const text = (input.transcript ?? '').trim(); return text ? { action: 'text', text } : { action: 'notice' }` — **transcrição falha ou vazia vira aviso, nunca silêncio**.
4. Se a ação é `text`, o webhook substitui o texto (linha 721) e o INSERT grava `content_text: effectiveText` (linha 729). É por isso que contexto do agente, palavras-chave e guardrails enxergam a transcrição sem nenhuma alteração.
5. O efeito colateral (`applyAudioSideEffect`, linha 931) só existe para `notice` e `handoff` (`src/lib/audio/side-effect.ts:30`). O aviso é enviado por `engineSendText` com `aiGenerated: true` (`:54-61`); o handoff manda um resumo fixo em português e `assignTo: null` (`:36-44`) — **não atribui a ninguém**.

### Os dois provedores

`src/lib/audio/transcribe.ts` esconde os dois atrás de uma porta só. **Nunca lança**: qualquer erro vira log e `null` (`:68-73`), assim como áudio de zero bytes (`:53`) ou maior que 25 MB (`:54-59`). Timeout de 120 s para ambos (`:48`).

| | Whisper local | ElevenLabs |
| --- | --- | --- |
| Chamada | `POST <WHISPER_URL>/asr` com `output=text`, `task=transcribe`, `language`, `initial_prompt` na query e o arquivo em multipart no campo `audio_file` (`:135-152`) | `POST https://api.elevenlabs.io/v1/speech-to-text` com `model_id=scribe_v1` e campo `file` (`:80-106`) |
| Autenticação | **Nenhuma** — nem Authorization, nem chave | Cabeçalho `xi-api-key` (não Bearer), linha `:103` |
| Vocabulário do ramo | Enviado como `initial_prompt` (`:139`) | **Não é enviado** — só `language_code` (`:98`) |
| Endereço | `input.localUrl` ou `process.env.WHISPER_URL`; vazio devolve `null` sem tentar (`:129-133`). Na prática ninguém passa `localUrl` (`inbound.ts:114-130`) | Fixo no código |

O `initial_prompt` é montado em `src/lib/audio/prompt.ts:61-78`, em três partes nesta ordem: base fixa de agendamento (`BASE_PT`, `:30-35`) → o rótulo do agendamento da conta → o jargão do ramo, cortado em 500 caracteres com espaços normalizados.

### O que o modelo de IA recebe

- O contexto marca a transcrição: `contentType === 'audio' ? '[transcrição de áudio] ' + text : text` (`src/lib/ai/context.ts:100`). Só o áudio leva marca; legenda de imagem e rótulo de botão vão crus.
- O contexto passou a filtrar por `.not('content_text', 'is', null)` em vez de `content_type = 'text'` (`src/lib/ai/context.ts:62`) — é isso que faz o áudio transcrito aparecer na conversa que o modelo lê.
- A instrução de desconfiar de transcrição (`AUDIO_TRANSCRIPT_NOTE`, `src/lib/audio/policy.ts:88-97`) só entra no ambiente quando a conta está em `transcribe` (`src/lib/ai/environment.ts:123` e `src/lib/ai/auto-reply.ts:210`). Ela manda o modelo **pedir confirmação** em vez de transferir para humano quando a transcrição está confusa (`:95-97`).

### A tela de áudio

`src/components/agents/ai-rules.tsx` é a única tela de áudio do produto. Seletor de política (`221-241`), textarea do aviso com `maxLength={300}` (`244-259`, `:252`), seletor de provedor (`262-289`), vocabulário com `maxLength={500}` (`291-310`, `:299`) e campo de chave (`312+`). Salva por `PATCH /api/ai/config` (`127-145`), e só envia `elevenlabs_api_key` quando o operador digitou algo (`:141`).

No servidor, o PATCH revalida tudo: `audio_policy` só passa por `isAudioPolicy()` (`route.ts:328-330`), o provedor colapsa qualquer coisa que não seja `'elevenlabs'` para `'local'` (`331-334`), o aviso é cortado em 300 (`335-340`), o vocabulário em 500 (`341-347`) e a chave é cifrada; **string vazia apaga a chave, campo ausente não mexe** (`348-356`).

### Estrutura de telas, navegação e chrome

- `src/components/layout/app-shell.tsx` é o chrome autenticado (AuthProvider, Sidebar, Header, PresenceHeartbeat) e redireciona para `/login` sem usuário (`31-35`). É compartilhado por `(dashboard)` e `/admin`.
- Só `(dashboard)` tem o portão de cobrança: `src/app/(dashboard)/layout.tsx:37-43` captura `PaymentRequiredError` e redireciona para `/blocked`. `src/app/admin/layout.tsx:32-38` não tem esse portão, de propósito — um admin de plataforma com a própria conta bloqueada ainda alcança o painel que desbloqueia contas.
- `src/components/layout/sidebar.tsx`: `navItems` com 10 entradas (`94-105`), `/settings` no rodapé (`107-109`), `/admin` condicionado a `isPlatformAdmin` (`276-295`) com comentário "Cosmetic gate only" — a página e cada rota `/api/admin` re-checam no servidor. O badge de não lidas do `/inbox` some quando a rota está ativa; o de `/notifications` continua visível (`218-226`).
- `src/middleware.ts` protege 12 caminhos por prefixo (`:73`), redireciona usuário autenticado que cai em `/login|/signup|/forgot-password` (`51-70`) e devolve 401 JSON em `/api/whatsapp/*` não-webhook sem sessão (`81-86`). Toda resposta de redirect recarrega os cookies rotacionados do refresh de token (`38-43`).

### Idioma

`src/i18n/request.ts` tem 19 linhas: `const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en'` (`:5`) e import dinâmico de `messages/<locale>.json` com fallback para `en.json` quando o **arquivo inteiro** falta (`9-12`). Não existe segmento `[locale]` em `src/app`. Três dicionários: `en.json`, `pt-BR.json`, `ko.json`, com 23 namespaces de topo. `src/i18n/messages.test.ts` impede divergência nos dois sentidos (chave faltando e chave órfã), com `en` como fonte da verdade.

A landing, `/privacidade` e `/termos` **não passam pelo catálogo** — são pt-BR escrito no arquivo, por decisão registrada nos comentários das próprias páginas.

### PWA

- `src/app/manifest.ts`: `start_url: '/inbox'`, `display: 'standalone'`, `orientation: 'portrait'`, `theme_color: '#E5484D'`, `lang: 'pt-BR'`, ícones apontando para `/pwa-icon`.
- `public/sw.js` tem **quatro** listeners e só: `install`/`skipWaiting`, `activate`/`clients.claim`, `push` e `notificationclick`. **Nenhum handler de `fetch`**, por decisão documentada nas linhas 8-15: a caixa é multi-inquilino e autenticada por cookie, então não há cache nem offline.
- O service worker é registrado em um único lugar: `src/components/settings/push-notifications.tsx:93`.
- Os ícones não são PNGs no repositório: `src/app/pwa-icon/route.tsx` os gera na edge, com `?size=` clampado entre 48 e 1024 porque o endpoint é público, e `?maskable=1` reduzindo o glifo para 44%.
- O iOS ignora o manifesto e lê só o apple-touch-icon, por isso `src/app/layout.tsx:44-47` declara `/pwa-icon?size=180` separadamente.

### Temas

Dois eixos independentes: accent (`data-theme`, 6 opções) e claro/escuro (`data-mode`), com chaves de localStorage separadas (`imasterchat.theme` / `imasterchat.mode`). Padrão: `elucas` + escuro. Um script inline `beforeInteractive` (`src/app/layout.tsx:78-119`, `145-149`) aplica ambos no `<html>` antes da hidratação — daí o `suppressHydrationWarning` na linha 142. O boot faz uma migração única das chaves antigas `wacrm.*` e as remove (`91-97`, `106-112`). `src/hooks/use-theme.tsx` sincroniza abas pelo evento `storage` (`114-132`).

### Whisper na infraestrutura

`deploy/docker-compose.app.yml`: serviço `whisper` atrás do profile `whisper`, imagem `onerahmet/openai-whisper-asr-webservice:latest`, `ASR_ENGINE=faster_whisper`, `ASR_MODEL=small`, `ASR_QUANTIZATION=int8`, limite de 2 CPUs e 3 GB, volume `whisper-models`, **sem porta publicada**. O app recebe `WHISPER_URL: ${WHISPER_URL:-http://whisper:9000}` (linha 74).

O estudo `docs/whisper-escala.md` mede que o serviço transcreve **um áudio por vez** (mutex de classe no upstream): 1 pedido = 5,3 s, 2 = 10,3 s, 4 = 21,0 s. Combinando com o timeout de 120 s, o 23º áudio simultâneo estoura — e o sintoma para o cliente é o aviso "pode escrever?", não um erro. Leia esse documento antes de refazer o estudo.

---

## Limites e pegadinhas

### Áudio

- **A transcrição roda mesmo com a conta bloqueada por falta de pagamento.** `handleInboundAudio` está na linha 714 do webhook e `sideEffectsAllowed` só é calculado na 797. O portão de cobrança barra apenas o envio do aviso e o handoff (linha 931), não o custo da transcrição.
- **O handoff por áudio não atribui a conversa a ninguém** (`side-effect.ts:36-44`, `assignTo: null`). A equipe recebe o alerta, mas a conversa fica sem dono.
- **O vocabulário do ramo não tem efeito nenhum na ElevenLabs.** A tela esconde o campo quando o provedor é ElevenLabs, mas quem salvou o vocabulário no modo local e depois trocou de provedor deve saber que o texto continua no banco e deixou de ser usado.
- **O idioma da transcrição é `'pt'` fixo.** Não há tela, não há variável. Cliente que manda áudio em outro idioma é transcrito como se fosse português.
- **Trocar a `ENCRYPTION_KEY` quebra a transcrição paga em silêncio**: a chave da ElevenLabs não decifra, `viaElevenLabs` devolve `null` e o cliente passa a receber o aviso "pode me escrever?" em vez da resposta. Não aparece erro na tela.
- **A ElevenLabs sem chave também degrada em silêncio** — mesmo caminho: log no servidor, aviso para o cliente.
- **O Whisper local não tem autenticação nenhuma.** A chamada `POST /asr` não leva cabeçalho de autorização. A proteção é a rede interna do Docker e a ausência de porta publicada.
- **`WHISPER_URL` não está em `.env.local.example`** — ela aparece só em `deploy/README.md:199` e no compose. Quem monta ambiente de desenvolvimento seguindo o `.env.local.example` fica sem a variável, e o provedor local falha com o log `[audio] provedor local escolhido sem WHISPER_URL`.
- **Cada áudio transcrito custa três chamadas à Meta**, não duas: um `getMediaUrl` de verificação em `parseMessageContent` e depois `getMediaUrl` + `downloadMedia` dentro de `handleInboundAudio`.
- **Cada áudio transcrito faz uma consulta extra ao banco** só para buscar `appointment_label`.
- **O Whisper local transcreve um áudio por vez.** Escalar é replicar o serviço, não engordar a máquina. Vinte e poucos áudios simultâneos já estouram o timeout de 120 s — e o cliente recebe o aviso de escrever, sem que ninguém perceba que houve fila.
- **O número de 5,3 s por áudio veio de áudio sintético** (tom + ruído), como o próprio `docs/whisper-escala.md:65-69` registra. Vale como ordem de grandeza, não como constante. A hint da tela cita "cerca de 11 segundos para 7 segundos de áudio" — os dois números convivem na base e não foram reconciliados.
- **A nota de voz que a atendente grava não é transcrita** e não passa pelo subsistema de áudio: ela é gravada em Ogg/Opus no navegador e enviada direto.

### Telas e navegação

- **Deep link de notificação está quebrado.** O push enviado pelo webhook aponta para `/inbox?conversation=<id>` (`webhook/route.ts:918`), e a tela da caixa de entrada lê `?c=` (`src/app/(dashboard)/inbox/page.tsx:44`). O resultado é que tocar na notificação abre a caixa de entrada **sem abrir a conversa**. O mesmo endereço errado aparece em `src/lib/conversations/handoff.ts:145`, nos links da Agenda (`src/components/agenda/agenda-board.tsx:336` e `appointment-detail.tsx:171`) e no texto do evento de calendário (`src/lib/scheduling/event-text.ts:81`).
- **Não existe tela de redefinição de senha.** `/forgot-password` manda o e-mail com `redirectTo` para `/auth/callback?next=/reset-password` (`src/app/(auth)/forgot-password/page.tsx:33`), mas não há arquivo em `src/app` que atenda `/auth/callback` nem `/reset-password` — só existe `src/app/api/google/calendar/callback/route.ts`, que é outra coisa. Quem clica no link do e-mail não chega a uma tela de trocar senha neste código.
- **Responder pelo inbox não assume a conversa nem cala a IA.** Só os botões "Atribuir"/"Assumir" fazem isso. Se a atendente apenas digitar e enviar, a IA volta a responder na próxima mensagem do cliente (`send-message.ts:483-504`).
- **O proxy de mídia repassa o `Content-Type` do remetente** (`src/app/api/whatsapp/media/[mediaId]/route.ts`, no `return new Response`). É XSS armazenado: um arquivo servido como HTML executa na origem do app. A rota também **não confere se o `mediaId` pertence a alguma conversa da conta** — qualquer membro autenticado pode pedir qualquer id que a Meta sirva com o token daquela conta. A resposta traz `Cache-Control: public, max-age=86400`, sem cache no servidor: fora do cache do navegador, cada play refaz a chamada à Meta.
- **O card de instalação do PWA só existe no Painel.** Quem abre o app direto na Caixa de entrada (o `start_url`) nunca vê o convite de instalação.
- **"Não exibir novamente" é definitivo por aparelho** — não há como reexibir pela interface; a recusa fica em `localStorage` sob `imasterchat:pwa-install:never`.
- **O app não funciona offline.** O service worker não tem handler de `fetch`. Isso é decisão, não bug — mas é o motivo de o Chrome não disparar `beforeinstallprompt` em algumas versões, e por isso o card degrada para instruções manuais.
- **Sem chaves VAPID configuradas no servidor não há notificação nenhuma**, e a tela diz isso explicitamente.
- **A assinatura de push é por navegador, não por pessoa.** Nem o administrador da conta enxerga ou altera a preferência do colega: a RLS de `push_subscriptions` é escopada pelo dono (`auth.uid() = user_id`). Trocar de celular exige refazer a escolha.
- **Desligar os avisos apaga a linha, não guarda "off"** — e a permissão concedida ao navegador continua concedida.
- **Tema e modo não acompanham a conta.** Trocar de aparelho é recomeçar do padrão (escuro + `elucas`).
- **O idioma é um por instalação.** Não há seletor de idioma para o usuário nem rota por idioma. E o fallback é **por arquivo inteiro, não por chave**: se o dicionário do idioma existir mas faltar uma chave, ela renderiza como o caminho cru da chave na tela. O teste de paridade dos catálogos é o que segura isso.
- **A entrada "Administração" no menu é gate cosmético.** Esconder o item não protege nada; a proteção real está na página e em cada rota `/api/admin`.
- **O app inteiro é `noindex`**, com três exceções explícitas: a landing, `/privacidade` e `/termos`. Um comentário em `src/app/(dashboard)/layout.tsx:8-9` afirma que "robots.ts already disallows these paths", mas **não existe arquivo `robots*` em `src`** — o comentário está desatualizado e o noindex efetivo vem só do metadata dos layouts.
- **A CSP está em modo Report-Only** (`next.config.ts:39`): ela reporta violação e não bloqueia nada. O `Permissions-Policy` libera `microphone=(self)` por causa do gravador de voz; câmera, geolocalização, pagamento e USB estão negados.
- **A aba Uso de Agentes de IA só aparece para quem pode editar configurações.** E o teto mensal de gasto exibido ali (`monthly_budget_usd`) é apenas informativo: ele é mostrado e projetado, mas **nunca aplicado** — nada é interrompido ao atingi-lo.
- **`PATCH`/`DELETE` de `/api/whatsapp/templates/[id]` não exigem papel** — um visualizador consegue apagar template na Meta a partir de Configurações → Modelos.
- **A tela `/join/[token]` não resgata o convite automaticamente**: é preciso ação explícita do visitante. O layout dessa tela usa `referrer: 'no-referrer'` porque o token está no caminho da URL.

### O que não sabemos (lacunas registradas, não preenchidas)

- **Não sabemos se a transcrição é contabilizada em custo/uso de IA.** Não há escrita em tabela de uso dentro de `src/lib/audio/*`; se o minuto da ElevenLabs aparece em Agentes de IA → Uso, não foi confirmado.
- **Não sabemos o que acontece se a Meta reentregar o mesmo webhook de áudio.** Existe `message_id` na tabela e um caminho de deduplicação, mas a checagem de idempotência que precederia a linha 714 não foi localizada — pode haver retranscrição (gasto de CPU e de ElevenLabs) em reentrega.
- **Não sabemos se há proteção contra dois áudios da mesma conversa serem transcritos em paralelo.** Não foi achado lock, fila nem deduplicação em `src/lib/audio/*`.
- **Não sabemos a duração típica nem o volume real de áudios recebidos** — é dado de produção, não está no código.
- **Não foi mapeada a matriz papel × tela.** `useCan`/`canEditSettings` aparecem em várias telas, mas quais telas exigem quais papéis, além do que o menu e o middleware mostram, não foi levantado.
- **Não sabemos o efeito de um `NEXT_PUBLIC_APP_LOCALE` inválido em runtime**: o catálogo cai em `en.json`, mas o `locale` devolvido continua sendo a string inválida — o impacto no `<html lang>` e nos formatadores de data não foi testado.
- **O conteúdo completo das telas grandes não foi enumerado** — `/contacts` (830 linhas), `/inbox` (641) e `/broadcasts/[id]` (532) têm comportamentos além dos descritos aqui.

---

## Referência

### Tabelas

| Tabela | Para que serve neste subsistema | Migração de origem |
| --- | --- | --- |
| `ai_configs` | Uma linha por conta (UNIQUE `account_id`). Guarda `audio_policy` (default `'ignore'`, CHECK em `ignore/notice/transcribe/handoff`), `audio_notice_text` (1..300), `audio_transcription_provider` (default `'local'`, CHECK em `elevenlabs/local`), `elevenlabs_api_key` (cifrada com `ENCRYPTION_KEY`) e `transcription_vocabulary` (1..500) | `029_ai_reply.sql` (tabela + RLS); `061_audio_policy.sql` (colunas de áudio, linhas 41-45 e CHECKs 53-61); `062_transcription_vocabulary.sql` (vocabulário, 27 e 35-40) |
| `ai_scheduling_settings` | Uma linha por conta. Entra no áudio por `appointment_label` (1..40), que vira parte do `initial_prompt` do Whisper | `043_google_calendar.sql` (tabela: `account_id` na linha 91, `timezone` na 96, bloco de colunas 100-131, RLS 137-153); `054_appointment_label.sql`; `059_agent_rules.sql` |
| `push_subscriptions` | Uma linha por **navegador**, não por usuário. `endpoint` UNIQUE (linha 38), `p256dh`/`auth` (42-43), `notify_mode` do enum `push_notify_mode` com default `'human_needed'` (45), `user_agent` (49), `last_used_at`. Índices por `(account_id, notify_mode)` e `(user_id)` | `051_push_subscriptions.sql` |
| `messages` | Onde a transcrição acaba: o texto vai para `content_text` da própria linha de áudio, antes do INSERT. `content_type` aceita `audio` entre os oito tipos; `media_url` de áudio recebido é `/api/whatsapp/media/<mediaId>` | `001_initial_schema.sql` (tabela); `010_flows.sql:61-66` (CHECK final do `content_type`); `017_account_sharing.sql:509-518` (RLS final) |

**RLS, em resumo:**

| Tabela | Leitura | Escrita |
| --- | --- | --- |
| `ai_configs` | qualquer membro da conta (`is_account_member(account_id)`) | INSERT/UPDATE/DELETE exigem papel `admin`. Treze migrações tocam a tabela, mas só a `029` define policies (linhas 66-67, 71-72, 75-76, 79-80) |
| `ai_scheduling_settings` | qualquer membro | INSERT/UPDATE/DELETE exigem `admin` (`043`, linhas 143-153) |
| `push_subscriptions` | **só o dono** (`auth.uid() = user_id`) — nem admin lê a do colega | só o dono; o INSERT exige também `is_account_member(account_id)` (linhas 70-87) |
| `messages` | membros da conta dona da conversa | `messages_modify` exige papel `agent` |

O caminho do webhook roda em service role e ignora RLS.

### Rotas

| Método | Rota | Autenticação / papel | O que faz |
| --- | --- | --- | --- |
| GET | `/api/ai/config` | sessão, qualquer membro (`getCurrentAccount()`, linha 35) | Devolve a config de IA com `audio_policy`, `audio_notice_text`, `audio_transcription_provider`, `transcription_vocabulary`. As chaves não voltam: viram `has_key`, `has_embeddings_key`, `has_elevenlabs_key` (linhas 58-64) |
| POST | `/api/ai/config` | sessão + **admin** (linha 82) + rate limit `adminAction` | Upsert do formulário inteiro de configuração de IA, validando a chave com o provedor antes de gravar |
| PATCH | `/api/ai/config` | sessão + **admin** (linha 317) | Patch parcial. É por aqui que a aba Regras salva o áudio (linhas 328-356) |
| DELETE | `/api/ai/config` | sessão + **admin** (linha 396) | Remove a config de IA da conta (recuperação de chave cifrada corrompida) |
| POST | `/api/whatsapp/webhook` | assinatura HMAC da Meta (`x-hub-signature-256`, linha 185) — sem sessão | Entrega de mensagens. Único chamador de `handleInboundAudio` (714) e `applyAudioSideEffect` (931) |
| GET | `/api/whatsapp/webhook` | `hub.verify_token` da query (linha 104) | Handshake de verificação do webhook |
| GET | `/api/whatsapp/media/[mediaId]` | sessão (`auth.getUser()`) + `account_id` resolvido do perfil | Proxy que baixa a mídia na Meta e devolve os bytes. É o `src` do player de áudio da caixa de entrada |
| GET | `/api/push/subscribe` | sessão, qualquer membro (linha 22) | Estado do push **deste aparelho**: `available` (VAPID configurada), `subscribed`, `notify_mode` |
| POST | `/api/push/subscribe` | sessão (`getCurrentAccount()` na linha 51) | Registra/atualiza a assinatura, upsert por `endpoint` (86-103). Modo inválido cai em `human_needed`. 400 `push_not_configured` sem VAPID |
| DELETE | `/api/push/subscribe` | sessão (`getCurrentAccount()` na linha 118) | Apaga a linha. Não guarda modo "off"; a permissão do navegador continua concedida |
| GET | `/manifest.webmanifest` | pública | Manifesto de instalação: `start_url: '/inbox'`, `standalone`, `portrait`, `theme_color '#E5484D'`, `lang 'pt-BR'` |
| GET | `/pwa-icon` | pública, runtime edge | Gera o PNG do ícone. `?size=` clampado entre 48 e 1024; `?maskable=1` reduz o glifo a 44%. Cache immutable de 1 ano |
| GET | `/icon` | pública, runtime edge | Favicon 32×32 gerado |
| GET | `/api/scheduling/settings` | sessão, qualquer membro (linha 47) | Devolve as regras de agendamento, inclusive `appointment_label` (linha 60) |
| PUT | `/api/scheduling/settings` | sessão + **admin** (linha 95) | Grava o conjunto completo das regras de agendamento, inclusive `appointment_label` (linha 135). **É PUT, não POST** — o arquivo exporta apenas GET, PUT e PATCH; um POST recebe 405 |
| PATCH | `/api/scheduling/settings` | sessão + **admin** (linha 170) | Patch parcial; `appointment_label` passa por `sanitizeAppointmentLabel` (190-192) |
| POST | `/api/feedback` | sessão + rate limit `feedback` | Recebe o relato do widget flutuante (tipo, comentário, print base64 até 3 MB) |
| GET | `/api/feedback` | sessão | Lista o que o usuário já enviou e em que deu |
| POST | `/api/invitations/[token]/peek` — método GET | pública por desenho; RPC SECURITY DEFINER + rate limit por IP | Alimenta a tela de convite antes de o visitante entrar ou se cadastrar |
| POST | `/api/invitations/[token]/redeem` | sessão + rate limit por IP (`invitationRedeem`) | Aceita o convite. A tela não resgata automaticamente |
| POST | `/api/terms/accept` | sessão crua: `createClient()` + `auth.getUser()` (linhas 64-70), deliberadamente sem `getCurrentAccount` porque no cadastro perfil e conta podem não existir | Registra o aceite dos termos; chamado pela página de cadastro (`signup/page.tsx:113`) |

Correção de leitura na tabela acima: `/api/invitations/[token]/peek` é **GET**, público por desenho.

### Telas

São 27 arquivos `page.tsx` em `src/app`.

**Públicas**

| Nome no produto | Rota | Observação |
| --- | --- | --- |
| Landing | `/` | Marketing, pt-BR fixo fora do catálogo, indexável (`page.tsx:41`). Rodapé com razão social e CNPJ para a verificação de negócio da Meta (linhas 34-35) |
| Política de privacidade | `/privacidade` | Indexável (linha 20), pt-BR fixo. Contato de `NEXT_PUBLIC_BILLING_CONTACT` (linha 24). Tem a âncora `#exclusao-de-dados` exigida pela Meta |
| Termos de uso | `/termos` | Indexável (linha 19), pt-BR fixo. Usa `TERMS_PUBLISHED_LABEL` |
| Convite | `/join/[token]` | Quatro estados; não resgata automaticamente. Layout próprio com `referrer: 'no-referrer'` |
| Conta bloqueada | `/blocked` | Portão de cobrança manual (migração 037). Fora de `(dashboard)` de propósito. Usa `getCurrentAccount({ allowBlocked: true })` |

**Entrada**

| Nome no produto | Rota | Observação |
| --- | --- | --- |
| Entrar | `/login` | Sob `<Suspense>` por usar `useSearchParams`; lê `?invite=` para devolver ao convite depois do login (linha 39) |
| Criar conta | `/signup` | Caixa explícita de aceite dos termos + POST em `/api/terms/accept` (linha 113); carrega `?invite=` no round-trip de verificação de e-mail |
| Esqueci a senha | `/forgot-password` | `resetPasswordForEmail` com redirect para `/auth/callback?next=/reset-password` — destino que não existe neste código |

**App autenticado (menu lateral)**

| Nome no menu | Rota | O que é |
| --- | --- | --- |
| Painel | `/dashboard` | Métricas, gráficos (conversas, funil, tempo de resposta), feed de atividade, ações rápidas, card de custo de IA. **Única tela com o card de instalação do PWA** (linha 139) |
| Caixa de entrada | `/inbox` | Caixa compartilhada (641 linhas). Deep link `?c=<id>` sob Suspense. Lembra o painel de contato por aparelho em `imasterchat:inbox:contact-panel-open`. É o `start_url` do PWA |
| Notificações | `/notifications` | Lista de notificações. Desde a migração 055 a frase é montada no front, no idioma do leitor, a partir de `type`/`actor_name`/`contact_name`; `n.title` só vale para linhas antigas |
| Contatos | `/contacts` | Tabela com busca, seleção múltipla, tags, campos personalizados e diálogos de edição (830 linhas) |
| Funis | `/pipelines` | Quadro kanban, configurações do funil, formulário de negócio e analytics |
| Disparos em massa | `/broadcasts` | Lista com polling enquanto algum disparo estiver enviando; botão travado por permissão (`GatedButton`/`useCan`) |
| Disparos em massa → novo | `/broadcasts/new` | Assistente de 4 passos: template → público → personalizar → agendar/enviar |
| Disparos em massa → detalhe | `/broadcasts/[id]` | Tabela de destinatários e seus status (532 linhas) |
| Automações | `/automations` | Lista com duplicar / editar / excluir e ícone por tipo de gatilho |
| Automações → nova | `/automations/new` | Construtor novo; lê `?template=` sob Suspense para partir de um `AUTOMATION_TEMPLATES` |
| Automações → editar | `/automations/[id]/edit` | Carrega a automação e converte os passos com `fromServerSteps` |
| Automações → histórico | `/automations/[id]/logs` | Execuções da automação, com cada passo expansível |
| Fluxos (Beta) | `/flows` | Lista de fluxos com ativar/pausar/arquivar e criação a partir de template |
| Fluxos → editor | `/flows/[id]` | Editor visual; carrega `{flow, nodes}` de `/api/flows/[id]`. Aberto a qualquer usuário autenticado — o portão de beta foi removido |
| Fluxos → execuções | `/flows/[id]/runs` | As 50 execuções mais recentes, mais novas primeiro |
| Agenda | `/agenda` | Casca de 26 linhas que só renderiza `<AgendaBoard />` |
| Agentes de IA | `/agents` | Sete abas: Playground, Vault, Limites, **Regras** (onde vivem todos os controles de áudio), Contexto, Configuração e Uso. A aba Uso só aparece para quem tem `canEditSettings` (linhas 49, 106 e 144). Primeira visita abre em Configuração; visitas seguintes, no Playground |
| Configurações | `/settings` | Rail à esquerda com 13 seções, `?tab=` deep-linkável: Visão geral, Seu perfil, Login e segurança, Aparência, Avisos no celular, WhatsApp, Modelos, Respostas rápidas, Agendamento, Campos e etiquetas, Negócios e moeda, Membros da equipe, Chaves de API |
| Administração | `/admin` | Painel de plataforma em 3 abas: Eventos (abre primeiro), Contas, Preços e câmbio. Fora de `(dashboard)` para não herdar o portão de cobrança. Acesso checado na página (`isPlatformAdmin`) e de novo em cada rota `/api/admin` |

### Arquivos-chave

| Arquivo | Papel |
| --- | --- |
| `src/lib/audio/policy.ts` | A decisão pura, sem I/O: os quatro valores de `AudioPolicy` (11-16), `DEFAULT_AUDIO_NOTICE` (33-34), `decideAudioAction` (60-73), `AUDIO_TRANSCRIPT_NOTE` (88-97) |
| `src/lib/audio/transcribe.ts` | Os dois provedores atrás de uma porta só. `MAX_AUDIO_BYTES` 25 MB (45), `TIMEOUT_MS` 120 s (48), `viaElevenLabs` (85-115), `viaLocal` (128-160). Nunca lança |
| `src/lib/audio/inbound.ts` | A orquestração: lê `ai_configs`, decide, e só em `transcribe` toca em rede (75-77) |
| `src/lib/audio/prompt.ts` | Monta o `initial_prompt` do faster-whisper: `BASE_PT` (30-35), `MAX_VOCABULARY = 500` (47), ordem base → rótulo → jargão (61-78) |
| `src/lib/audio/side-effect.ts` | O que fala com o cliente: handoff (35-45) ou aviso via `engineSendText` com `aiGenerated: true` (54-61) |
| `src/app/api/whatsapp/webhook/route.ts` | Único chamador do subsistema: 714, 721, 729, 931 |
| `src/components/agents/ai-rules.tsx` | A única tela de áudio (Agentes de IA → Regras) |
| `src/lib/ai/context.ts` | Marca a transcrição com `[transcrição de áudio]` (100) e filtra por `content_text` não nulo (62) |
| `src/lib/ai/environment.ts` | Injeta o `AUDIO_TRANSCRIPT_NOTE` só quando a conta transcreve (123) |
| `src/components/inbox/message-composer.tsx` | Gravador de voz de saída (Ogg/Opus, opus-recorder, 5 min, 16 MB) |
| `src/components/inbox/message-bubble.tsx` | O `<audio controls>` da bolha de áudio (167-173) |
| `src/app/layout.tsx` | Layout raiz: noindex global, apple-touch-icon, script de boot de tema, `NextIntlClientProvider` |
| `src/i18n/request.ts` | Toda a configuração de idioma, em 19 linhas |
| `src/i18n/messages.test.ts` | Guarda a paridade dos três catálogos |
| `messages/` | `en.json`, `pt-BR.json`, `ko.json` — 23 namespaces de topo |
| `src/app/manifest.ts` | Manifesto do PWA e a decisão "instalável e nada mais" |
| `public/sw.js` | Service worker: install, activate, push, notificationclick. Sem `fetch` |
| `src/components/pwa/install-card.tsx` | Card de instalação, com degradação para instruções por plataforma |
| `src/components/pwa/install-rules.ts` | As decisões do card, testáveis sem DOM |
| `src/components/settings/push-notifications.tsx` | Único lugar que registra o service worker (93); três modos por aparelho |
| `src/lib/themes.ts` / `src/hooks/use-theme.tsx` | Catálogo de temas e a persistência por aparelho |
| `src/components/layout/sidebar.tsx` / `app-shell.tsx` | Navegação e chrome autenticado |
| `src/middleware.ts` | Guarda de rota e cookies rotacionados |
| `next.config.ts` | next-intl, `output: 'standalone'`, Permissions-Policy, CSP Report-Only |
| `deploy/docker-compose.app.yml` | Onde o Whisper existe de verdade (profile `whisper`) |
| `docs/whisper-escala.md` | Estudo de escala do Whisper local — leitura obrigatória antes de refazer a medição |
