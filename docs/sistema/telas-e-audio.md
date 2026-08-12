# As telas do produto e o tratamento de áudio

Este documento cobre duas coisas que andam juntas na vida do usuário: **o app inteiro** — as 27 telas, o menu, o idioma, as cores, a instalação no celular, os avisos com o app fechado — e **o que o sistema faz quando o cliente manda um áudio no WhatsApp**. Estão no mesmo documento porque o áudio é o único recurso do produto cuja configuração inteira mora em uma seção de uma aba de uma tela só (Agentes de IA → Regras → Áudio), e cujo resultado vaza para todo o resto: quando a conta escolhe transcrever, a transcrição vira o texto da mensagem, e daí em diante o sistema não distingue mais um áudio transcrito de um texto digitado — contexto do agente, palavras-chave, automações e agendamento passam a funcionar sobre ele sem alteração nenhuma.

O app é um Next.js (App Router) organizado em quatro grupos: as telas de entrada (login, cadastro, esqueci a senha), o app autenticado com menu lateral e cabeçalho (que tem portão de cobrança), o painel de plataforma `/admin` (mesmo visual, sem o portão) e as páginas públicas soltas (landing, privacidade, termos, convite, bloqueio). O idioma é **um só por instalação**, definido por variável de ambiente — não existe troca de idioma pelo usuário. O app é instalável no celular e no computador (PWA), mas **não funciona offline**: a instalação existe para receber aviso de mensagem com o app fechado, e nada mais.

---

## Para que serve (visão do cliente)

### O aplicativo

Quem entra encontra um menu lateral fixo com dez seções — **Painel, Caixa de entrada, Notificações, Contatos, Funis, Disparos em massa, Automações, Fluxos, Agenda, Agentes de IA** — e **Configurações** no rodapé do menu. Quem é administrador da plataforma (o dono do produto, não o dono da ótica) vê ainda uma entrada **Administração**. No celular o menu é uma gaveta que abre pelo botão de sanduíche; em tela grande ele fica sempre visível.

O que o usuário final consegue fazer, além de usar cada uma dessas seções:

- **Instalar o app no celular ou no computador.** Vira ícone na tela de início, abre sem a barra do navegador e, ao abrir pelo ícone, cai direto na **Caixa de entrada** — não no Painel. Quem abre o app pelo ícone está atendendo alguém.
- **Receber aviso de mensagem com o app fechado.** Cada aparelho escolhe seu próprio nível: desligado, só o que precisa de gente, ou toda mensagem. O celular da atendente pode avisar de tudo e o computador da recepção ficar quieto.
- **Escolher a aparência**: claro ou escuro, e uma entre seis cores de destaque. Vale por aparelho, muda na hora, e há um botão de sol/lua no cabeçalho em qualquer tela.
- **Mandar um recado para quem desenvolve** pelo botão flutuante de feedback, com print da tela anexado.
- **Entrar numa conta por convite**: o link do convite abre uma tela que mostra para qual conta a pessoa está sendo chamada, antes de ela entrar ou se cadastrar.

### O que acontece quando o cliente manda um áudio

O negócio escolhe um entre quatro comportamentos:

| Escolha na tela | O que o cliente percebe |
| --- | --- |
| **Não fazer nada** | O áudio fica gravado e aparece na conversa para a atendente ouvir, mas ninguém responde automaticamente. Do lado do cliente, é silêncio. |
| **Pedir que escreva** | Chega na hora uma mensagem pedindo que ele escreva o pedido. Não custa nada por minuto e acaba com o silêncio, mas dá trabalho ao cliente. |
| **Transcrever e responder** | O áudio vira texto e o agente responde como se o cliente tivesse digitado. A partir daí tudo funciona: histórico, palavras-chave, automações, agendamento. |
| **Passar para uma pessoa** | O agente nem tenta entender: transfere a conversa para atendimento humano e avisa a equipe. |

O padrão de fábrica é **Não fazer nada**. Nenhuma conta começa a falar sozinha depois de uma atualização.

Detalhes que importam para quem vende e para quem escreve tutorial:

- Se a transcrição **falhar ou vier vazia**, o sistema não fica mudo: cai automaticamente no **Pedir que escreva**. O pior caso do modo Transcrever é o comportamento do modo Pedir que escreva.
- O texto desse pedido é editável, até 300 caracteres. Em branco, usa o padrão: *"Recebi seu áudio! Para eu te ajudar mais rápido, pode me escrever o que você precisa?"*
- Quem transcreve pode ser o **Whisper na nossa VPS** (sem custo por minuto, o áudio não sai da infraestrutura, mais lento) ou a **ElevenLabs** (cobra por minuto, o áudio sai para um terceiro, mais rápida e mais precisa em áudio ruim de celular).
- No Whisper local dá para ensinar o **jargão do ramo** — "armação, lente antirreflexo, multifocal, Ray-Ban" — para reduzir erro de transcrição. Verbos de agendamento e dias da semana já vêm inclusos; não precisa repetir.
- A **atendente também pode gravar áudio** para o cliente, pelo microfone do compositor da caixa de entrada. Isso é um caminho totalmente separado das quatro escolhas acima: a nota de voz que a atendente grava não é transcrita nem passa por nenhum provedor.
- Na caixa de entrada, o áudio do cliente aparece como um player, e a transcrição (quando existe) aparece logo abaixo, em itálico, prefixada com a palavra **transcrição**. É de propósito: quem lê precisa saber que aquilo é o que a máquina ouviu, não o que foi dito.

---

## Como se usa, na prática

### Configurar o que fazer com áudio

1. Menu lateral → **Agentes de IA**.
2. Aba **Regras** (as abas são Playground, Vault, Limites, Regras, Contexto, Configuração e Uso — nessa ordem).
3. Role até a seção **Áudio**.
4. Em **"Quando o cliente manda um áudio"**, escolha uma das quatro opções. Cada opção traz a explicação embaixo dela, e a explicação muda conforme a escolha.
5. Os campos seguintes aparecem e somem conforme a escolha:
   - **"Mensagem quando não der para entender o áudio"** aparece em *Pedir que escreva* e em *Transcrever e responder*.
   - **"Quem transcreve"** só aparece em *Transcrever e responder*.
   - **"Palavras do seu ramo"** só aparece quando o provedor escolhido é *Whisper na nossa VPS*.
   - **"Chave da ElevenLabs"** só aparece quando o provedor escolhido é *ElevenLabs (API)*.
6. Botão de salvar no fim da aba. **O botão só existe para quem pode editar configurações** (papel administrador). Quem não pode vê a aba inteira, com os campos travados e sem botão.

Sobre a chave da ElevenLabs: é guardada criptografada e **nunca volta para a tela**. Depois de salva, o campo mostra "••• chave salva — digite outra para trocar". Deixar em branco mantém a chave atual — a tela não envia campo vazio, justamente porque enviar vazio apagaria a chave.

### Como o negócio chama um agendamento entra na transcrição

Em **Configurações → Agendamento** existe um campo de rótulo do agendamento — como o negócio chama um compromisso: "consulta", "orçamento", "visita técnica", até 40 caracteres. Esse rótulo é usado na agenda **e também é injetado no texto de apoio do Whisper local**, para melhorar a transcrição de frases como "quero marcar uma consulta". Quem mexe em um mexe no outro sem perceber.

### Ouvir e ler o áudio do cliente

Na **Caixa de entrada**, a mensagem de áudio aparece como um player com controles. O arquivo **não fica no servidor do produto**: o player busca os bytes na Meta a cada vez, por um endereço que exige sessão. Se a conta usa transcrição, o texto aparece logo abaixo do player.

### Gravar um áudio para o cliente

No compositor da caixa de entrada há um botão de microfone. A gravação acontece no próprio navegador, em Ogg/Opus, com teto de **5 minutos** e **16 MB**. O navegador vai pedir permissão de microfone na primeira vez.

### Instalar o app no celular

O convite para instalar aparece **só no Painel**, em um card. Não é global: quem só abre a Caixa de entrada nunca vê o convite. No Android/Chrome o card tenta o botão de instalar do próprio navegador e, quando o navegador não oferece, mostra as instruções manuais da plataforma (iPhone, Android, computador). Fechar o card adia até fechar o navegador; marcar "não exibir novamente" some com ele **para sempre naquele aparelho** — não há como reexibir pela interface.

### Ligar os avisos no celular

**Configurações → Avisos no celular**. Três modos, **por aparelho**:

- **Desligado** — nenhum aviso naquele aparelho.
- **Só o que precisa de gente** — chega quando uma conversa é transferida para atendimento humano.
- **Toda mensagem** — chega a cada mensagem nova do cliente.

(Os três rótulos acima são o texto exato da tela: `Settings.push.modeOff`, `modeHuman` e `modeAll` em `messages/pt-BR.json`.)

Ligar aqui é a **única** coisa em todo o app que instala o mecanismo de aviso no aparelho. Quem instalou o app mas nunca entrou nesta tela não recebe nada. Desligar apaga o registro daquele aparelho, mas a permissão que o navegador já concedeu continua concedida — o navegador não vai perguntar de novo se a pessoa religar.

### Mudar a aparência

**Configurações → Aparência**: claro/escuro e seis cores de destaque. Ou o botão de sol/lua no cabeçalho, de qualquer tela. A escolha fica **no aparelho**, não na conta: trocar de computador volta ao padrão (escuro, cor "elucas"). Abas abertas do mesmo navegador se sincronizam sozinhas.

---

## O que dá para configurar

| Ajuste | Onde | O que muda | Exige admin |
| --- | --- | --- | --- |
| O que fazer com áudio do cliente (4 opções) | Agentes de IA → Regras → Áudio | `ai_configs.audio_policy`. Define todo o comportamento descrito acima | Sim (só admin tem o botão salvar) |
| Texto do pedido "me escreve" (até 300 caracteres) | Agentes de IA → Regras → "Mensagem quando não der para entender o áudio" | `ai_configs.audio_notice_text`. Vazio usa o texto padrão do código | Sim |
| Quem transcreve (Whisper na VPS / ElevenLabs) | Agentes de IA → Regras → "Quem transcreve" | `ai_configs.audio_transcription_provider`. Só aparece com a política em Transcrever | Sim |
| Chave da ElevenLabs | Agentes de IA → Regras → "Chave da ElevenLabs" | `ai_configs.elevenlabs_api_key`, criptografada. Em branco mantém a atual | Sim |
| Palavras do ramo (até 500 caracteres) | Agentes de IA → Regras → "Palavras do seu ramo" | `ai_configs.transcription_vocabulary`. **Só afeta o Whisper local** — a ElevenLabs não recebe isso | Sim |
| Como o negócio chama um agendamento (até 40 caracteres) | Configurações → Agendamento | `ai_scheduling_settings.appointment_label`. Usado na agenda **e** no texto de apoio do Whisper local | Sim |
| Aviso no celular: Desligado / Só o que precisa de gente / Toda mensagem | Configurações → Avisos no celular | `push_subscriptions.notify_mode`, uma linha por navegador | Não — qualquer membro, e só para si |
| Cor de destaque (6) e claro/escuro | Configurações → Aparência, ou o botão sol/lua no cabeçalho | Só `localStorage` do aparelho. **Não vai para o banco** | Não |
| Idioma da interface | Variável `NEXT_PUBLIC_APP_LOCALE` | Um idioma por instalação (en, pt-BR, ko). Sem tela | Só quem opera o servidor |
| Endereço do Whisper local | Variável `WHISPER_URL` (padrão `http://whisper:9000`) | Para onde vai o áudio a transcrever no modo local. Não é `NEXT_PUBLIC_`, então trocar não exige rebuild | Só quem opera o servidor |
| Subir ou não o Whisper local | `docker compose ... --profile whisper up -d` | O serviço só sobe com o profile `whisper`; sem ele, o modo local não tem para onde mandar áudio | Só quem opera o servidor |
| Modelo e peso do Whisper | `deploy/docker-compose.app.yml`, serviço `whisper` | `ASR_ENGINE: faster_whisper`, `ASR_MODEL: small`, `ASR_QUANTIZATION: int8`, teto de 2 CPUs e 3 GB | Só quem opera o servidor |
| Chaves de aviso no celular (VAPID) | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Sem elas a tela de Avisos diz que o recurso não está disponível | Só quem opera o servidor |
| Chave de criptografia | `ENCRYPTION_KEY` | Decifra a chave da ElevenLabs em tempo de execução. Trocar sem migrar faz a transcrição por ElevenLabs cair no aviso "me escreve" | Só quem opera o servidor |
| Contato de suporte nas páginas legais | `NEXT_PUBLIC_BILLING_CONTACT` | Texto de contato em /privacidade e /termos | Só quem opera o servidor |
| Idioma da transcrição | Nenhum lugar — é `pt` fixo no código | Não é configurável por conta nem por variável | — |
| Tempo máximo por transcrição (120 s) e tamanho máximo do áudio (25 MB) | Nenhum lugar — código | Áudio maior que 25 MB nem é enviado ao provedor; passar de 120 s aborta | — |
| Modelo da ElevenLabs (`scribe_v1`) | Nenhum lugar — código, deliberadamente | — | — |
| Vocabulário base de agendamento do texto de apoio | Nenhum lugar — código | Verbos de agendamento e dias da semana, sempre enviados ao Whisper local | — |
| Teto de 5 minutos e formato Ogg/Opus da nota de voz da atendente | Nenhum lugar — código | — | — |
| Catálogo de temas e o padrão (elucas + escuro) | Nenhum lugar — código | — | — |
| Ordem e composição do menu lateral | Nenhum lugar — código | — | — |

---

## Como funciona por dentro

### O caminho de um áudio que chega

Tudo começa e termina no webhook da Meta (`src/app/api/whatsapp/webhook/route.ts`). O ponto que explica o resto do desenho: **a decisão sobre o áudio acontece ANTES do INSERT da mensagem**.

1. `parseMessageContent` trata `case 'audio'` (`route.ts:1057-1065`): preenche `mediaUrl` e `mediaType` e deixa `contentText` como `null` (o objeto `empty` traz `contentText: null` em `route.ts:1013`). Sem transcrição, a linha de áudio nasce sem texto nenhum. O `media_url` gravado é `/api/whatsapp/media/<mediaId>` (`route.ts:999-1000`).
2. Se `message.type === 'audio'`, o webhook chama `handleInboundAudio` (`route.ts:714`) — o único chamador do subsistema.
3. `handleInboundAudio` (`src/lib/audio/inbound.ts`) lê `ai_configs` da conta. Política desconhecida, nula ou linha ausente vira `ignore` (`inbound.ts:69-71`). **Se a política não for `transcribe`, a função devolve a decisão sem tocar em rede** (`inbound.ts:75-77`): não baixa áudio, não chama provedor, não gasta nada.
4. Na política `transcribe`: escolhe o provedor (qualquer valor que não seja exatamente `'elevenlabs'` vira `local`, `inbound.ts:79-82`), decifra a chave da ElevenLabs em `try/catch` (`inbound.ts:85-93`), faz **uma consulta extra** a `ai_scheduling_settings` só pelo `appointment_label` (`inbound.ts:99-103`), baixa o áudio da Meta com `getMediaUrl` + `downloadMedia` (`inbound.ts:105-112`) e chama `transcribeAudio` com `language: 'pt'` fixo (`inbound.ts:125`).
5. `decideAudioAction` (`src/lib/audio/policy.ts:60-73`) transforma política + transcrição em ação: `none`, `notice`, `text` ou `handoff`. A regra que mais importa está em `policy.ts:67-68` — transcrição vazia ou nula em `transcribe` vira `notice`, não silêncio.
6. De volta ao webhook: se a ação é `text`, `effectiveText` recebe a transcrição (`route.ts:721`) e o INSERT grava `content_text: effectiveText` (`route.ts:729`). É por isso que nada mais no sistema precisou saber o que é áudio.
7. Depois do INSERT e da conversa atualizada, `applyAudioSideEffect` roda (`route.ts:930-938`), **e só se `sideEffectsAllowed`** — o portão de cobrança. Em `src/lib/audio/side-effect.ts:30`, `text` e `none` saem imediatamente; `notice` envia a mensagem por `engineSendText` com `aiGenerated: true` (`side-effect.ts:54-61`); `handoff` chama `handOffConversation` com `assignTo: null` e um resumo fixo em português (`side-effect.ts:36-44`).

Qualquer erro em qualquer ponto degrada para `{ policy: 'ignore', action: { action: 'none' } }` (`inbound.ts:55-58` e `133-135`), e `applyAudioSideEffect` engole a própria exceção (`side-effect.ts:62-66`). O webhook nunca cai por causa de áudio.

### Os dois provedores

`src/lib/audio/transcribe.ts` é a porta única. Teto de **25 MB** (`MAX_AUDIO_BYTES`, linha 45) e **120 s** de timeout (`TIMEOUT_MS`, linha 48). Áudio de zero byte, áudio grande demais, erro de rede, resposta ruim — tudo vira log e `null` (`transcribe.ts:53`, `54-59`, `68-73`). **A função nunca lança.**

| | Whisper local | ElevenLabs |
| --- | --- | --- |
| Chamada | `POST <WHISPER_URL>/asr` (`transcribe.ts:135-152`) | `POST https://api.elevenlabs.io/v1/speech-to-text` (`transcribe.ts:80`) |
| Autenticação | **nenhuma** — sem Authorization, sem chave | cabeçalho `xi-api-key` (não Bearer), `transcribe.ts:103` |
| Corpo | multipart, campo `audio_file`; query `output=text`, `task=transcribe`, `language`, `initial_prompt` | FormData, campo `file`, `model_id=scribe_v1` (`transcribe.ts:83`, `92-97`) |
| Vocabulário do ramo | vai como `initial_prompt` (`transcribe.ts:139`) | **não é enviado** — a ElevenLabs recebe no máximo `language_code` (`transcribe.ts:98`) |
| Endereço | `input.localUrl` ou `process.env.WHISPER_URL`; vazio → `null` sem tentar nada (`transcribe.ts:129-133`). Na prática ninguém passa `localUrl`, então é sempre a variável de ambiente | fixo no código, por decisão (comentário em `transcribe.ts:81-82`) |

### O texto de apoio do Whisper

`src/lib/audio/prompt.ts` monta o `initial_prompt` em três partes, nesta ordem (`prompt.ts:61-78`): a base fixa em português (`BASE_PT`, `prompt.ts:30-35` — verbos de agendamento, dias da semana, períodos do dia, escrita como frase e não como lista), depois `O cliente costuma pedir uma <appointment_label>.`, depois o vocabulário da conta cortado em 500 caracteres com espaços normalizados (`MAX_VOCABULARY`, `prompt.ts:47`, espelhando o CHECK da migração 062).

### O que o modelo vê

- O contexto do agente deixou de filtrar por `content_type = 'text'` e passou a aceitar qualquer linha com texto: `.not('content_text', 'is', null)` (`src/lib/ai/context.ts:62`). É isso que faz o áudio transcrito aparecer na conversa que o modelo lê.
- A transcrição chega prefixada: `contentType === 'audio' ? '[transcrição de áudio] ' + text : text` (`context.ts:100`). Só áudio leva marca — legenda de imagem e rótulo de botão vão crus.
- A instrução `AUDIO_TRANSCRIPT_NOTE` (`policy.ts:88-97`) entra no ambiente do agente **apenas quando a conta está em `transcribe`**: `src/lib/ai/auto-reply.ts:210` passa `audioTranscripts: config.audioPolicy === 'transcribe'`, e `src/lib/ai/environment.ts:123` só empurra a instrução se a flag for verdadeira. A instrução manda ler por intenção, confirmar palavra suspeita, não mencionar transcrição — e **não transferir para humano só porque a transcrição saiu confusa** (`policy.ts:95-97`).

### A tela de áudio

`src/components/agents/ai-rules.tsx` é a única tela do subsistema. Seletor de política em 221-241, textarea do aviso com `maxLength={300}` em 244-259, seletor de provedor em 262-289, vocabulário com `maxLength={500}` em 291-310 e a chave da ElevenLabs a partir de 312. Os campos aparecem por condição de render (244, 262, 291, 312) — não é `display:none`, é ausência do nó.

O salvamento (`ai-rules.tsx:118-160`) dispara **dois PATCH em paralelo**: `/api/ai/config` (regras de conversa + tudo de áudio) e `/api/scheduling/settings` (`lookahead_days`, `slot_fetch_limit`, `offer_slots_max`). Ambos tratam campo ausente como "não mexer", o que evita que esta tela sobrescreva o que outra acabou de gravar. A chave da ElevenLabs só entra no corpo quando o operador digitou algo (`ai-rules.tsx:141`).

Do lado do servidor, `PATCH /api/ai/config` valida de novo: `audio_policy` só passa por `isAudioPolicy()` (rota, 328-330), o provedor colapsa qualquer coisa que não seja `'elevenlabs'` para `'local'` (331-334), o aviso é cortado em 300 (335-340), o vocabulário em 500 (341-347), e `elevenlabs_api_key` é cifrada com `encrypt()` — string vazia **apaga**, campo ausente não mexe (348-356). O `GET` destrói as chaves antes de responder e devolve só as flags `has_key`, `has_embeddings_key`, `has_elevenlabs_key` (rota, 58-64).

### O áudio de saída

Não passa por `src/lib/audio` nenhuma. `src/components/inbox/message-composer.tsx` grava Ogg/Opus no próprio navegador com `opus-recorder` carregado sob demanda (linha 468), worker em `/opus/encoderWorker.min.js` (linha 138), VOIP / 48 kHz / mono (471-474), teto de 5 minutos (`MAX_RECORDING_SECONDS`, linha 76) e 16 MB (linha 441). Nada é transcodificado no servidor e nada é transcrito.

O microfone só funciona porque `next.config.ts:33-37` libera `microphone=(self)` no `Permissions-Policy`; câmera, geolocalização, pagamento e USB estão negados.

### O Whisper na infraestrutura

`deploy/docker-compose.app.yml`: serviço `whisper` atrás do profile `whisper`, imagem `onerahmet/openai-whisper-asr-webservice:latest`, `ASR_ENGINE: faster_whisper`, `ASR_MODEL: small`, `ASR_QUANTIZATION: int8`, limite de 2 CPUs e 3 GB, volume `whisper-models`, **sem porta publicada** — o app o alcança por nome de serviço na rede interna do Docker. O app recebe `WHISPER_URL: ${WHISPER_URL:-http://whisper:9000}` (linha 74).

`docs/whisper-escala.md` já mediu esse serviço: ele transcreve **um áudio por vez** (mutex de classe no upstream), então escalar é replicar, não engordar a máquina. Medição de 11/08/2026: 1 pedido = 5,3 s, 2 = 10,3 s, 4 = 21,0 s, para áudio de 20 s. Combinando com o timeout de 120 s, o 23º áudio simultâneo estoura — e o sintoma para o cliente não é erro, é o aviso "pode me escrever?".

### O app: estrutura, idioma, temas, PWA

**Os quatro casulos.** `(auth)` — login, cadastro, esqueci a senha. `(dashboard)` — o app autenticado; o layout captura `PaymentRequiredError` e redireciona para `/blocked` (`src/app/(dashboard)/layout.tsx:37-43`). `/admin` — fica **fora** de `(dashboard)` de propósito, para não herdar o portão de cobrança: o administrador de plataforma com a própria conta bloqueada ainda precisa alcançar o painel que desbloqueia contas (`src/app/admin/layout.tsx:11-15, 32-38`). E as páginas soltas: `/`, `/privacidade`, `/termos`, `/join/[token]`, `/blocked`.

**O chrome.** `src/components/layout/app-shell.tsx` monta AuthProvider, Sidebar, Header e PresenceHeartbeat, e manda para `/login` quando não há usuário (31-35). É compartilhado por `(dashboard)` e `/admin`.

**A navegação.** `src/components/layout/sidebar.tsx:94-105` tem as 10 entradas; `bottomNavItems` (107-109) tem só `/settings`. A entrada `/admin` é condicionada a `isPlatformAdmin` (276-295) e o próprio comentário chama isso de "cosmetic gate": a página e todas as rotas `/api/admin` re-checam no servidor. O ponto de não lidas do `/inbox` some quando você já está no inbox; o contador de `/notifications` continua visível na própria tela, porque reflete estado e não "onde estou" (218-226).

**A guarda de rota.** `src/middleware.ts` redireciona quem já está autenticado e cai em `/login|/signup|/forgot-password` (51-70) e quem não está e tenta um dos 12 caminhos protegidos — `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/settings`, `/agents`, `/flows`, `/notifications`, `/admin`, `/blocked` (linha 73). Em `/api/whatsapp/*` não-webhook sem sessão devolve 401 JSON (81-86). Toda resposta de redirect recarrega os cookies rotacionados do refresh de token (38-43) — sem isso a sessão travava depois de ociosa.

**Idioma.** `src/i18n/request.ts` tem 19 linhas: `const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en'` (linha 5) e import dinâmico de `messages/<locale>.json` com fallback para `en.json` **quando o arquivo inteiro falta** (9-12). Não há segmento `[locale]` em `src/app`. Três dicionários — `en.json`, `pt-BR.json`, `ko.json` — com 23 namespaces de topo. `src/i18n/messages.test.ts` impede divergência nos dois sentidos: `en` é a fonte da verdade, e `ko`/`pt-BR` não podem ter chave faltando nem chave órfã (13, 34-45).

**Temas.** Dois eixos independentes: accent (`data-theme`, 6 opções — elucas, violet, emerald, cobalt, amber, rose) e claro/escuro (`data-mode`), com chaves de `localStorage` separadas (`src/lib/themes.ts:16-27, 50-59`). Padrão: `elucas` + `dark`. Um script inline `beforeInteractive` aplica os dois atributos no `<html>` antes da hidratação (`src/app/layout.tsx:78-119, 145-149`), e o `<html>` leva `suppressHydrationWarning` (linha 142) porque a divergência com o SSR é intencional. O boot também faz uma migração única das chaves antigas `wacrm.theme`/`wacrm.mode` e apaga as antigas (91-97, 106-112). `src/hooks/use-theme.tsx` persiste, escreve os atributos e sincroniza abas pelo evento `storage` (114-132). **Nada disso vai para o banco.**

**PWA.** `src/app/manifest.ts` declara `start_url: '/inbox'`, `display: 'standalone'`, `orientation: 'portrait'`, `theme_color: '#E5484D'`, `lang: 'pt-BR'` e três ícones apontando para `/pwa-icon`. Os ícones não são arquivos no repositório: são gerados na edge por `src/app/pwa-icon/route.tsx`, com `?size=` clampado entre 48 e 1024 porque o endpoint é público. O iOS ignora o manifesto e lê só o apple-touch-icon — por isso o layout raiz declara `/pwa-icon?size=180` à parte (`src/app/layout.tsx:44-47`).

`public/sw.js` tem quatro listeners e nada mais: `install`/`skipWaiting`, `activate`/`clients.claim`, `push` e `notificationclick`. **Não há handler de `fetch`** — por decisão documentada nas linhas 8-15: a caixa é multi-inquilino e autenticada por cookie, e cache de resposta autenticada em disco compartilhado é problema, não recurso. O `push` colapsa notificações por `tag` (o webhook manda `tag: 'msg:<conversationId>'`, `route.ts:922`), vibra só quando `payload.urgent` (`sw.js:53`), e o `notificationclick` foca uma aba já aberta e navega nela em vez de empilhar janelas (`sw.js:64-77`).

O service worker é registrado em **um único lugar** do app: `src/components/settings/push-notifications.tsx:93`.

---

## Limites e pegadinhas

### Áudio

- **A política de áudio ignora se o agente de IA está ligado.** `handleInboundAudio` e `applyAudioSideEffect` leem `audio_policy` e mais nada — não consultam `is_active` nem `auto_reply_enabled` (`inbound.ts:60-71`, `side-effect.ts:26-61`, e `engineSendText` em `src/lib/flows/meta-send.ts:65` também não checa). Uma conta que **desligou** o agente e deixou a política em "Pedir que escreva" **continua respondendo automaticamente aos áudios**. O único portão é o de cobrança (`route.ts:930`).
- **Nem se um humano assumiu a conversa.** Não há verificação de atribuição nem de pausa da IA antes de `applyAudioSideEffect`. Se a atendente já assumiu a conversa e o cliente manda um áudio, o "pode me escrever?" automático sai por cima dela.
- **Transcrever custa mesmo com a cobrança bloqueada.** `handleInboundAudio` roda na linha 714 do webhook e `sideEffectsAllowed` só é calculado na 797. Conta bloqueada continua baixando áudio da Meta e chamando o provedor — inclusive a ElevenLabs, que é paga. O que o bloqueio barra é apenas o envio do aviso e o handoff.
- **Três chamadas à Meta por áudio transcrito, não duas**: `getMediaUrl` de verificação dentro de `parseMessageContent` (`route.ts:649-650`, `999-1000`), e depois `getMediaUrl` + `downloadMedia` dentro de `handleInboundAudio` (`inbound.ts:105-112`).
- **O idioma da transcrição é `pt` fixo.** Conta que atende em outro idioma não tem onde mudar (`inbound.ts:125`). Não confunda com `NEXT_PUBLIC_APP_LOCALE`, que só muda a interface.
- **O vocabulário do ramo não vale para a ElevenLabs.** A tela até esconde o campo quando o provedor é ElevenLabs, mas quem já escreveu o vocabulário e depois trocou de provedor pode achar que ele continua valendo. Não continua: `initial_prompt` só existe no caminho local (`transcribe.ts:139` contra `98`).
- **Trocar `ENCRYPTION_KEY` quebra a transcrição por ElevenLabs em silêncio.** A chave fica indecifrável, `viaElevenLabs` devolve `null`, e o cliente passa a receber o aviso "me escreve" em vez da resposta. Nada na tela indica isso — o único sinal é o log `[audio] chave da ElevenLabs indecifrável`.
- **`WHISPER_URL` não está em `.env.local.example`.** Ela só aparece em `deploy/README.md:199` e no compose. Quem monta um ambiente seguindo só o `.env.local.example` e escolhe o provedor local recebe o log `[audio] provedor local escolhido sem WHISPER_URL` e todo áudio cai no aviso.
- **Um áudio por vez no Whisper local.** Não é questão de máquina maior: o mutex é de classe, no upstream. Ótica com fila de áudios na segunda de manhã sente isso.
- **Os números de desempenho do Whisper não batem entre si.** A dica na tela diz "cerca de 11 segundos para 7 segundos de áudio"; `docs/whisper-escala.md` mediu 5,3 s para 20 s de áudio — mas com **áudio sintético** (tom + ruído), e o próprio documento registra a ressalva (linhas 65-69). Nenhum dos dois é medição com fala real. Não prometa número ao cliente.
- **Não há nada em `src/lib/audio/*` que registre custo ou uso.** O minuto gasto na ElevenLabs e o tempo de CPU do Whisper aparentemente não aparecem em Agentes de IA → Uso — não confirmado, porque o subsistema de custos não foi lido aqui. Some isso ao fato de que **`monthly_budget_usd` é exibido e projetado mas nunca aplicado** em lugar nenhum do produto: não existe teto de gasto que efetivamente pare qualquer coisa.
- **Não sabemos se um áudio reentregue pela Meta é transcrito duas vezes.** Existe `message_id` na tabela e um caminho de deduplicação, mas a checagem de idempotência que precederia a linha 714 não foi localizada. Não há lock, fila nem deduplicação em `src/lib/audio/*`.
- **Áudio sem transcrição não gera aviso no celular.** O push de mensagem nova só dispara quando há texto (`route.ts:911`, sobre `inboundText` de `route.ts:852`), e para áudio o texto só existe se a conta transcreve. Nas políticas Não fazer nada / Pedir que escreva / Passar para uma pessoa, quem está em "Tudo" **não recebe aviso do áudio** — em "Passar para uma pessoa" recebe o aviso de handoff, que é outro caminho.
- **Quando transcreve, a transcrição vai no corpo da notificação.** O que a máquina ouviu — certo ou errado — aparece na tela de bloqueio do celular da atendente.
- **Áudio antigo pode não tocar.** O player busca os bytes na Meta a cada vez; a Meta expira mídia. Não há cópia no produto.

### Telas e app

- **Não existe tela de redefinição de senha.** `/forgot-password` dispara o e-mail com `redirectTo` para `/auth/callback?next=/reset-password` (`src/app/(auth)/forgot-password/page.tsx:33`), e **nenhum desses dois caminhos existe em `src/app`** — `find src/app -path '*reset*'` e a busca por `auth/callback` não retornam página nem rota. Quem clica no link do e-mail não chega a uma tela de trocar senha por este código. Não escreva tutorial de "recuperar senha" sem testar no ambiente real.
- **O link da notificação abre o inbox sem abrir a conversa.** Webhook, handoff, agenda e o texto dos eventos montam `/inbox?conversation=<id>` (`route.ts:918`, `src/lib/conversations/handoff.ts:145`, `src/components/agenda/agenda-board.tsx:336`, `src/components/agenda/appointment-detail.tsx:171`, `src/lib/scheduling/event-text.ts:81`), mas a tela lê `?c=` (`src/app/(dashboard)/inbox/page.tsx:44`). A atendente toca no aviso, chega no inbox e tem que procurar a conversa na lista.
- **O proxy de mídia repassa o `Content-Type` que o remetente mandou** (`src/app/api/whatsapp/media/[mediaId]/route.ts`, resposta com `'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream'`). Um anexo que se anuncia como HTML é servido como HTML, na origem do app e com a sessão do usuário — é XSS armazenado. A mesma resposta ainda sai com `Cache-Control: public, max-age=86400` apesar de ser conteúdo autenticado.
- **Responder pelo inbox não assume a conversa nem cala a IA.** Só "Atribuir"/"Assumir" fazem isso; a IA volta a responder na próxima mensagem do cliente. Detalhe completo no documento da caixa de entrada.
- **Um pico de mensagens do mesmo contato pode gerar mais respostas de IA que o teto configurado.** Vale para áudio transcrito também, já que ele entra no fluxo como texto comum.
- **O convite para instalar o app só existe no Painel.** `<PwaInstallCard />` é renderizado exclusivamente em `src/app/(dashboard)/dashboard/page.tsx:139`. Quem trabalha o dia inteiro na Caixa de entrada nunca vê o convite — e quem abre pelo ícone do PWA cai justamente na Caixa de entrada.
- **"Não exibir novamente" é definitivo e por aparelho.** Vai para `localStorage` (`imasterchat:pwa-install:never`) e não há botão em lugar nenhum para desfazer; só limpando dados do site. Instalar por qualquer caminho — botão, menu do navegador, outra aba — também marca essa chave.
- **O card de instalação pode não oferecer botão.** O Chrome só dispara `beforeinstallprompt` para PWA com handler de `fetch` no service worker, e este não tem. O card degrada para instruções manuais por plataforma (`install-card.tsx:28-47, 192-207`).
- **Não há modo offline e não haverá pelo desenho atual.** Sem rede, o app não abre. Quem instalou pode presumir o contrário.
- **Ligar aviso é por aparelho, e ninguém liga por outra pessoa.** As policies de `push_subscriptions` são escopadas pelo dono (`auth.uid() = user_id`) — nem administrador consulta ou apaga a assinatura de um colega. Cada atendente precisa entrar em Configurações → Avisos no celular no próprio aparelho.
- **Desligar o aviso não revoga a permissão do navegador.** A linha é apagada; a permissão concedida continua.
- **Tema e cor não seguem a pessoa.** Ficam no `localStorage` do aparelho. Trocar de computador ou limpar dados volta ao padrão escuro.
- **Só existe um idioma por instalação.** Não há seletor de idioma na interface e não há rota por idioma. Trocar o idioma é trocar variável de ambiente e reiniciar — e afeta todo mundo daquela instalação.
- **O fallback de idioma é por arquivo, não por chave.** Se o dicionário existe mas está faltando uma chave, a tela mostra o caminho da chave cru. O teste `src/i18n/messages.test.ts` existe exatamente para isso não chegar em produção.
- **Landing, privacidade e termos não passam pelo catálogo de mensagens.** São pt-BR escrito no arquivo, por decisão registrada (`src/app/privacidade/page.tsx:8-11`, `src/app/termos/page.tsx:11-14`). Numa instalação em outro idioma essas três páginas continuam em português.
- **O app inteiro é `noindex`, com três exceções.** O layout raiz declara `robots: { index: false, follow: false }` (`src/app/layout.tsx:38-41`); `/`, `/privacidade` e `/termos` invertem isso. O comentário em `src/app/(dashboard)/layout.tsx:8-9` afirma que "robots.ts already disallows these paths", mas **não existe nenhum arquivo `robots*` em `src/`** — o comentário está desatualizado e o noindex efetivo vem só do metadata.
- **A CSP está em modo Report-Only** (`next.config.ts:39`): ela reporta violação e não bloqueia nada. Isso agrava o item do `Content-Type` da mídia.
- **A entrada Administração no menu é enfeite de permissão.** Some para quem não é administrador de plataforma, mas quem digitar `/admin` na barra é barrado no servidor, não no menu.
- **A aba Uso de Agentes de IA só aparece para quem pode editar configurações** (`src/app/(dashboard)/agents/page.tsx:49` e `106`, e o conteúdo escondido em `144`). Um agente comum não enxerga custo de IA.
- **A aba Regras salva dois lugares ao mesmo tempo.** Se um dos dois PATCH falhar, a tela mostra um erro genérico — mas o outro já gravou. Salvar de novo é seguro, porque ambos tratam campo ausente como "não mexer".
- **PATCH/DELETE de `/api/whatsapp/templates/[id]` não exige papel:** um visualizador apaga template na Meta. Não é deste subsistema, mas é da tela de Configurações → Modelos, que aparece no mesmo menu.
- **O que não foi lido por inteiro:** telas grandes como `/contacts` (830 linhas), `/inbox` (641) e `/broadcasts/[id]` (532) foram mapeadas por cabeçalho, imports e comentários. Elas certamente têm comportamentos não enumerados aqui. Também não foi mapeada a matriz completa de papel × tela: `useCan`/`canEditSettings` aparecem em várias telas, e o que cada papel vê em cada uma não foi verificado item a item.
- **Desconhecido:** se o proxy de mídia tem cache do lado do servidor (a rota devolve `Cache-Control` para o navegador, mas não se verificou se cada play sem cache refaz as duas chamadas à Meta); se `NEXT_PUBLIC_APP_LOCALE` afeta a formatação de datas nos componentes; e o que acontece quando essa variável traz um valor inválido em runtime — o fallback cai em `en.json`, mas o `locale` devolvido continua sendo a string inválida (`src/i18n/request.ts:16`), e o efeito disso em `<html lang>` e nos formatadores não foi testado.
- **Desconhecido, dado de produção:** a duração típica dos áudios que chegam e quantos chegam na mesma janela. Sem isso não dá para dizer se o Whisper local aguenta uma conta específica.

---

## Referência

### Tabelas

| Tabela | Para que serve neste subsistema | Migração de origem |
| --- | --- | --- |
| `ai_configs` | Uma linha por conta (`account_id` UNIQUE). Guarda `audio_policy` (default `'ignore'`, CHECK em ignore/notice/transcribe/handoff), `audio_notice_text` (CHECK 1–300 quando não nulo), `audio_transcription_provider` (default `'local'`, CHECK em elevenlabs/local), `elevenlabs_api_key` (cifrada com `ENCRYPTION_KEY`) e `transcription_vocabulary` (CHECK 1–500 quando não nulo) | `029_ai_reply.sql` (tabela + RLS); `061_audio_policy.sql` (colunas de áudio, linhas 41-45 e CHECKs 53-61); `062_transcription_vocabulary.sql` (vocabulário, linha 27 e CHECK 35-40). Treze migrações tocam a tabela; **só a 029 define policies** |
| `ai_scheduling_settings` | Entra no áudio por uma coluna só: `appointment_label` (CHECK 1–40 quando não nulo), que vira parte do texto de apoio do Whisper | `043_google_calendar.sql` (tabela, `account_id` na linha 91, `timezone` na 96, bloco de colunas 100-131, RLS 137-153); `054_appointment_label.sql` (coluna); `059_agent_rules.sql` (novos CHECKs) |
| `push_subscriptions` | Uma linha por **navegador**, não por usuário. `endpoint` UNIQUE (linha 38) é a base do upsert; `p256dh`/`auth` (42-43); `notify_mode` do ENUM `push_notify_mode` ('all','human_needed'), default `'human_needed'` (45); `user_agent` (49); `last_used_at`. Índices por `(account_id, notify_mode)` e por `(user_id)` | `051_push_subscriptions.sql` (RLS na 64, policies 70-87) |
| `messages` | Onde a transcrição acaba: vira o `content_text` da própria linha de áudio, antes do INSERT. `content_type` aceita `audio` no CHECK; `media_url` recebe `/api/whatsapp/media/<mediaId>` | `001_initial_schema.sql` (tabela); `010_flows.sql` (CHECK final do `content_type`, 61-66); `017_account_sharing.sql` (RLS final, 509-518) |

**RLS, em uma frase por tabela.** `ai_configs`: qualquer membro lê, só admin escreve. `ai_scheduling_settings`: idem. `push_subscriptions`: **escopo do dono** — `auth.uid() = user_id` em SELECT/UPDATE/DELETE, e no INSERT ainda exige ser membro da conta; nem admin vê a de colega. `messages`: lê quem é membro da conta da conversa, escreve quem tem papel `agent` ou acima. O webhook roda com service role e passa por cima de tudo isso.

### Rotas

| Método | Caminho | Papel exigido | O que faz |
| --- | --- | --- | --- |
| GET | `/api/ai/config` | sessão, qualquer membro (`getCurrentAccount()`, linha 35) | Lê a config de IA com `audio_policy`, `audio_notice_text`, `audio_transcription_provider`, `transcription_vocabulary` (linha 42). Chaves não voltam — viram `has_key`, `has_embeddings_key`, `has_elevenlabs_key` (58-64) |
| POST | `/api/ai/config` | **admin** (`requireRole('admin')`, linha 82) + rate limit `adminAction` (84) | Upsert do formulário inteiro de configuração de IA; valida a chave com o provedor antes de gravar |
| PATCH | `/api/ai/config` | **admin** (linha 317) | Patch parcial — é por aqui que a aba Regras grava o áudio (328-356) |
| DELETE | `/api/ai/config` | **admin** (linha 396) | Remove a config de IA da conta; serve para recuperar de chave cifrada corrompida |
| POST | `/api/whatsapp/webhook` | assinatura HMAC da Meta (`x-hub-signature-256`, linha 185). Sem sessão | Entrega de mensagens. Único chamador de `handleInboundAudio` (714) e `applyAudioSideEffect` (931) |
| GET | `/api/whatsapp/webhook` | `hub.verify_token` da query (linha 104) | Handshake de verificação da Meta |
| GET | `/api/whatsapp/media/[mediaId]` | sessão (21-31) + `account_id` resolvido do perfil (36-48) | Proxy que baixa a mídia na Meta e devolve os bytes. É o `src` do player de áudio na caixa de entrada |
| GET | `/api/push/subscribe` | sessão, qualquer membro (linha 22) | Estado de push **deste aparelho**: `available` (VAPID configurada), `subscribed`, `notify_mode` |
| POST | `/api/push/subscribe` | sessão (chamada na linha 51) | Registra/atualiza a assinatura; upsert por `endpoint` (86-103). Modo inválido cai em `human_needed`; sem VAPID devolve 400 com código `push_not_configured` |
| DELETE | `/api/push/subscribe` | sessão (exportada na 116, `getCurrentAccount()` na 118) | Apaga a linha. Não guarda modo "off" e não revoga a permissão do navegador |
| GET | `/api/scheduling/settings` | sessão (linha 47) | Devolve as regras de agendamento, incluindo `appointment_label` (linha 60) |
| PUT | `/api/scheduling/settings` | **admin** (linha 95) | Grava o conjunto completo das regras, incluindo `appointment_label` (linha 135). **É PUT, não POST** — o arquivo exporta apenas GET (45), PUT (93) e PATCH (168) |
| PATCH | `/api/scheduling/settings` | **admin** (linha 170) | Patch parcial; `appointment_label` passa por `sanitizeAppointmentLabel` (190-192). É o que a aba Regras chama |
| POST | `/api/feedback` | sessão (linha 38) + rate limit `feedback` (44) | Recebe o relato do widget flutuante: tipo, comentário e print em base64 até 3 MB |
| GET | `/api/feedback` | sessão | Lista o que o usuário já mandou e em que deu |
| GET | `/api/invitations/[token]/peek` | **nenhuma** — pública por desenho; RPC SECURITY DEFINER + rate limit por IP | Alimenta a tela `/join/[token]` antes de o visitante entrar ou se cadastrar |
| POST | `/api/invitations/[token]/redeem` | sessão (linha 88) + rate limit por IP (70) | Aceita o convite. A tela não resgata sozinha ao carregar |
| POST | `/api/terms/accept` | sessão crua — `createClient()` na 65 e `auth.getUser()` na 68, com 401 em 69-70; **não** usa `getCurrentAccount` porque no cadastro perfil e conta podem ainda não existir | Registra o aceite dos termos; chamado pela tela de cadastro |
| GET | `/manifest.webmanifest` | **nenhuma** — pública | Manifesto de instalação: `start_url: '/inbox'`, `display: standalone`, `orientation: portrait`, `theme_color: '#E5484D'`, `lang: 'pt-BR'` |
| GET | `/pwa-icon` | **nenhuma** — pública, runtime edge | Gera o PNG do ícone. `?size=` clampado entre 48 e 1024 porque é público; `?maskable=1` reduz o glifo para 44%. Cache de 1 ano |
| GET | `/icon` | **nenhuma** — pública, runtime edge | Favicon 32×32 gerado (quadrado vermelho + chevron branco) |

### Telas (27 arquivos `page.tsx`)

| Nome no menu / na navegação | Rota | O que é |
| --- | --- | --- |
| — (site) | `/` | Landing pública de marketing, pt-BR fixo fora do catálogo. Indexável. Rodapé com razão social e CNPJ para a verificação de negócio da Meta (`page.tsx:34-35`) |
| — (rodapé/legal) | `/privacidade` | Política de privacidade pública e indexável (metadata linha 20), pt-BR fixo. Contato de `NEXT_PUBLIC_BILLING_CONTACT` (linha 24). Tem a âncora `#exclusao-de-dados` exigida pela Meta |
| — (rodapé/legal) | `/termos` | Termos de uso públicos e indexáveis (`robots` na linha 19), pt-BR fixo. Usa `TERMS_PUBLISHED_LABEL` |
| Entrar | `/login` | Sob `<Suspense>` por usar `useSearchParams` (26-31); lê `?invite=` (linha 39) para devolver o usuário a `/join` depois do login |
| Criar conta | `/signup` | Cadastro com caixa explícita de aceite dos termos e POST em `/api/terms/accept` (linha 113). Carrega `?invite=` pelo round-trip de verificação de e-mail |
| Esqueci a senha | `/forgot-password` | `resetPasswordForEmail` com `redirectTo` para `/auth/callback?next=/reset-password` — **destino que não existe neste código** |
| Painel | `/dashboard` | Métricas, gráficos (conversas, funil, tempo de resposta), feed de atividade, ações rápidas e card de custo de IA. **Única tela que renderiza o convite de instalação do app** (linha 139) |
| Caixa de entrada | `/inbox` | Caixa compartilhada. Deep link por `?c=<id>`, sob Suspense. Lembra o painel de contato por aparelho em `imasterchat:inbox:contact-panel-open`. É o `start_url` do PWA |
| Notificações | `/notifications` | Lista de notificações. Desde a migração 055 a frase é montada no front, no idioma do leitor, a partir de `type`/`actor_name`/`contact_name`; `n.title` só é respeitado nas linhas antigas |
| Contatos | `/contacts` | Tabela de contatos com busca, seleção múltipla, etiquetas, campos personalizados e diálogos de edição |
| Funis | `/pipelines` | Quadro kanban, configurações do funil, formulário de negócio e analytics |
| Disparos em massa | `/broadcasts` | Lista de disparos, com atualização automática enquanto algum estiver enviando e botão travado por permissão |
| Disparos em massa → novo | `/broadcasts/new` | Assistente de 4 passos: escolher modelo → selecionar público → personalizar → agendar/enviar |
| Disparos em massa → detalhe | `/broadcasts/[id]` | Detalhe do disparo com a tabela de destinatários e seus status |
| Automações | `/automations` | Lista com duplicar, editar e excluir, e ícone por tipo de gatilho |
| Automações → nova | `/automations/new` | Construtor novo; lê `?template=` (sob Suspense) para partir de um modelo pronto |
| Automações → editar | `/automations/[id]/edit` | Carrega a automação e converte os passos do servidor antes de entregar ao construtor |
| Automações → histórico | `/automations/[id]/logs` | Histórico de execuções, com cada passo expansível |
| Fluxos (Beta) | `/flows` | Lista de fluxos, com ativar, pausar, arquivar e criar a partir de modelo |
| Fluxos → editor | `/flows/[id]` | Editor visual. Aberto a qualquer usuário autenticado — o portão de beta foi removido |
| Fluxos → execuções | `/flows/[id]/runs` | As 50 execuções mais recentes, mais novas primeiro |
| Agenda | `/agenda` | Agenda de compromissos; a página é uma casca que só renderiza o quadro da agenda |
| Agentes de IA | `/agents` | Sete abas: Playground, Vault, Limites, **Regras** (onde vivem todos os controles de áudio), Contexto, Configuração e Uso. A aba Uso só aparece para quem pode editar configurações. Primeira visita cai em Configuração; visitas seguintes, em Playground |
| Configurações | `/settings` | Rail à esquerda com 13 seções, `?tab=` é a fonte da verdade e é deep-linkável: Visão geral, Seu perfil, Login e segurança, Aparência, Avisos no celular, WhatsApp, Modelos, Respostas rápidas, Agendamento, Campos e etiquetas, Negócios e moeda, Membros da equipe, Chaves de API |
| Administração | `/admin` | Painel de plataforma em 3 abas — Eventos (abre primeiro), Contas, Preços e câmbio. Fora de `(dashboard)` para não herdar o portão de cobrança. Acesso checado duas vezes: na página e de novo em cada rota `/api/admin` |
| — (redirecionamento) | `/blocked` | Tela do portão de cobrança manual. Fora de `(dashboard)` de propósito — não pode renderizar o shell do qual a conta bloqueada está barrada. Usa `getCurrentAccount({ allowBlocked: true })` para dizer qual conta está barrada e por quê |
| — (link de convite) | `/join/[token]` | Resgate de convite, quatro estados. Não resgata automaticamente ao carregar. Layout próprio com `referrer: 'no-referrer'`, porque o token está no caminho da URL |

### Arquivos-chave do subsistema de áudio

| Arquivo | Papel |
| --- | --- |
| `src/lib/audio/policy.ts` | A decisão pura, sem I/O: os quatro valores de `AudioPolicy` (11-16), `DEFAULT_AUDIO_NOTICE` (33-34), `decideAudioAction` (60-73) e `AUDIO_TRANSCRIPT_NOTE` (88-97) |
| `src/lib/audio/transcribe.ts` | Os dois provedores atrás de uma porta só. `MAX_AUDIO_BYTES` (45), `TIMEOUT_MS` (48), `viaElevenLabs` (85-115), `viaLocal` (128-160). Nunca lança |
| `src/lib/audio/inbound.ts` | A orquestração: lê `ai_configs`, decide, e só em `transcribe` toca em rede (75-77) |
| `src/lib/audio/prompt.ts` | Monta o `initial_prompt` do faster-whisper: `BASE_PT` (30-35), `MAX_VOCABULARY` (47), a ordem base → rótulo → jargão (61-78) |
| `src/lib/audio/side-effect.ts` | O que fala com o cliente: handoff (35-45) ou envio do aviso (54-61). Só age em `notice` e `handoff`; nunca lança |
| `src/components/agents/ai-rules.tsx` | A única tela de áudio (Agentes de IA → Regras) |
| `src/components/inbox/message-bubble.tsx` | A bolha de áudio: player em 167-173 e a transcrição em itálico logo abaixo |
| `src/components/inbox/message-composer.tsx` | O áudio de saída, gravado no navegador |
| `deploy/docker-compose.app.yml` | Onde o Whisper existe de verdade |
| `docs/whisper-escala.md` | Estudo de escala já feito — leitura obrigatória antes de refazer a medição |
