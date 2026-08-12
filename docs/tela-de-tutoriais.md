# Tela de Tutoriais — projeto

Tudo abaixo saiu de arquivo aberto. Onde não consegui confirmar, está escrito que não consegui.

---

## 0. O que já existe (a base do desenho)

| Fato | Onde confirmei |
|---|---|
| 27 telas, sidebar com 10 itens de trabalho + 1 no rodapé | `src/components/layout/sidebar.tsx:94-105` (navItems) e `:107-109` (bottomNavItems, só `/settings`) |
| Não existe NADA de ajuda/tutorial hoje | `grep -rn -i "tutorial\|onboarding\|ajuda" src/ docs/ messages/pt-BR.json` — só falsos positivos (`helpers`, `varKeyHelp`, `onboarding` da Meta em `embedded-signup-button.tsx:202-213`) |
| Não há ícone de "?" em lugar nenhum | `grep -rn "HelpCircle\|CircleHelp" src/` → só `flows/page.tsx:16,74,81`, e ali é ícone de **template de fluxo**, não de ajuda |
| Padrão de trilho lateral + `?tab=` como fonte da verdade | `src/app/(dashboard)/settings/page.tsx:51-55`, `:101-104`; seções em `src/components/settings/settings-sections.ts:26-72` |
| Padrão de fita de abas rolante | `src/components/ui/section-nav.ts:34-52` e a variante `rail` em `src/components/ui/tabs.tsx:40-43, 84-85` |
| Prosa longa em pt-BR **não** passa pelo catálogo i18n, por decisão registrada | `src/app/privacidade/page.tsx:8-11` ("hardcoded pt-BR: legal text is operator-reviewed prose … running it through the message catalogue would triple the upkeep") |
| Catálogos têm teste de paridade nos dois sentidos | `src/i18n/messages.test.ts` (o mapa cita `:13`, `:34-38`, `:40-45`) |
| Não há renderizador de markdown/MDX nas dependências | `package.json:41-70` — `next`, `next-intl`, `recharts`, `lucide-react`… nada de `mdx`, `remark`, `marked` |
| `next/image` não é usado em lugar nenhum; a casa usa `<img>` cru | `grep -rn "from 'next/image'" src/` → vazio; `<img` aparece em 8 arquivos (`message-bubble.tsx:113`, `template-manager.tsx:858`, …) |
| `public/` **entra** na imagem Docker | `next.config.ts:82-84` — "o build standalone copia só `.next` e `public`" |
| Última migração: `062_transcription_vocabulary.sql` | `ls supabase/migrations/` |

---

## 1. Onde a tela entra na navegação

**Rota: `/tutorials`, dentro de `src/app/(dashboard)/tutorials/page.tsx`. No rodapé da sidebar, ACIMA de Configurações.**

```ts
// src/components/layout/sidebar.tsx:107-109 — hoje
const bottomNavItems = [
  { href: "/settings", labelKey: "settings", icon: Settings },
];
// vira
const bottomNavItems = [
  { href: "/tutorials", labelKey: "tutorials", icon: GraduationCap },
  { href: "/settings", labelKey: "settings", icon: Settings },
];
```

Por quê ali e não em `navItems`:

- Os 10 itens de `navItems` (`sidebar.tsx:94-105`) são todos **onde o trabalho acontece** — Caixa de entrada, Contatos, Funis, Disparos. Tutorial não é trabalho, é o lugar onde se aprende o trabalho. Enfiar um 11º item ali empurra `/agents` (o item que mais precisa ser achado) para baixo da dobra em telas curtas.
- O rodapé já tem exatamente a semântica certa: é onde mora Configurações, o outro destino "meta". Hoje ele tem um item só — é o slot com espaço.
- **Não** pode ser um botão flutuante no canto inferior direito: aquele canto já é do `FeedbackWidget` (`src/app/(dashboard)/layout.tsx:44-49`), e o comentário dele diz por que só cabe um: *"Uma atendente com o cliente esperando não pode ter um botão de feedback competindo por atenção com a conversa"* (`src/components/feedback/feedback-widget.tsx:31-34`). Dois botões flutuantes empilhados é o mesmo erro em dobro.

Nome da rota: `/tutorials` em inglês, como 9 dos 10 itens (`/inbox`, `/contacts`, `/broadcasts`…). A exceção `/agenda` (`sidebar.tsx:103`) existe, mas não é padrão a seguir. Os **arquivos de conteúdo e as pastas de print** ficam em português (`public/tutoriais/…`) porque quem os escreve e os lê é brasileiro; a rota é código.

### Três lugares que precisam ser tocados junto, ou a tela nasce quebrada

1. **`src/middleware.ts:73`** — `protectedPaths` é uma lista literal de 12 caminhos. `/tutorials` precisa entrar. Se esquecer, acontece o que já acontece com `/agenda`: ela **não está** nessa lista, então visitante sem sessão não é redirecionado pelo middleware — cai no redirect client-side do `AppShell` (`app-shell.tsx:31-35`, conforme o mapa). Não é buraco de segurança; é uma tela em branco piscando antes do login.
2. **`src/components/layout/header.tsx:21-34`** — o `pageTitles` mapeia rota → chave de mensagem. Sem entrada, `getPageTitleKey` (`:36-42`) cai no fallback `"dashboard"` e o cabeçalho escreve "Painel" na tela de tutoriais.
3. **Os três catálogos** — `messages/en.json`, `messages/pt-BR.json`, `messages/ko.json`. A chave `Sidebar.tutorials` e `Header.tutorials` tem que existir nos três, ou `src/i18n/messages.test.ts` quebra o CI. E o fallback é **por arquivo inteiro, não por chave** (`src/i18n/request.ts:8-13`), então chave faltando renderiza o keypath cru na tela.

### Ficar dentro de `(dashboard)`: o preço

O layout de `(dashboard)` roda o portão de cobrança e redireciona conta bloqueada para `/blocked` (`src/app/(dashboard)/layout.tsx:36-42`). Consequência: **um cliente inadimplente não consegue ler os tutoriais.** Aceito na v1 — o conteúdo não é o que resolve a inadimplência dele, e sair de `(dashboard)` significa duplicar o `AppShell` como `/admin` e `/blocked` fazem (`src/app/admin/layout.tsx:32-38`). Se depois virar problema, o movimento é o mesmo que o `/admin` fez: pasta própria fora do casulo, `AppShell` chamado à mão.

---

## 2. A estrutura: como um tutorial é modelado

### Recomendação: **nenhuma tabela nova, nenhum bucket novo, na v1.**

O conteúdo é **código versionado**, não dado. Três razões, cada uma verificável:

1. **Não há renderizador de markdown no projeto** (`package.json:41-70`). Guardar markdown no banco ou em `.md` exige uma dependência nova + sanitização de HTML. Passo estruturado em TypeScript não precisa de nada disso — é `<p>` e `<img>`.
2. **A prosa longa em pt-BR já foi decidida como código neste repo**, com o motivo escrito: `src/app/privacidade/page.tsx:8-11`. Tutorial tem exatamente o mesmo perfil — prosa revisada pelo operador, para um mercado, que muda por deploy e não por request.
3. Conteúdo em código atravessa code review, diff e rollback. Conteúdo em banco não atravessa nada.

### O modelo

```
src/lib/tutorials/
  types.ts            // as interfaces abaixo
  catalog.ts          // ORDEM e agrupamento — espelha settings-sections.ts:26-72
  catalog.test.ts     // fs.statSync em todo caminho de imagem (ver §6)
  articles/
    conectar-whatsapp.ts
    ligar-o-agente.ts
    ...
```

```ts
// src/lib/tutorials/types.ts
export type TutorialGroup = 'primeiros-passos' | 'atendimento' | 'agente' | 'crescimento';

export interface TutorialStep {
  /** Frase única, imperativa. "Clique em Conectar WhatsApp." */
  title: string;
  /** 1–3 frases. O porquê, não a repetição do título. Opcional. */
  body?: string;
  /** Caminho root-absoluto em public/. Ver a convenção de nome em §6. */
  shot?: string;
  /** Texto alternativo do print — obrigatório quando há shot. */
  shotAlt?: string;
  /** Deep link para a tela do passo. Ex.: '/settings?tab=whatsapp' */
  href?: string;
  /** Aviso destacado. "Sem isso o webhook da Meta não entrega nada." */
  warn?: string;
}

export interface Tutorial {
  slug: string;                 // kebab-case, é o ?a= da URL e o nome da pasta de prints
  group: TutorialGroup;
  icon: LucideIcon;             // mesmo padrão de SECTION_META (settings-sections.ts:58-72)
  title: string;                // pt-BR literal
  summary: string;              // uma linha, para o card do índice
  minutes: number;              // "5 min de leitura"
  /** Telas cujo "?" aponta para cá. Ver §4. */
  anchors: string[];            // ex.: ['settings:whatsapp', 'agents:setup']
  steps: TutorialStep[];
  video?: TutorialVideo;        // v2 — ver abaixo
}
```

### Prints

`public/tutoriais/<slug>/NN-<verbo>.png`, servidos como estático same-origin e renderizados com `<img>` cru (é o padrão da casa — `next/image` não é usado em lugar nenhum de `src/`).

### Vídeos — recomendo UM caminho: **arquivo `.mp4` same-origin em `public/tutoriais/<slug>/`**

Nem Supabase Storage, nem YouTube não-listado. O argumento decisivo é a CSP, e ele elimina as duas alternativas de uma vez:

```
// next.config.ts:41-63 (Content-Security-Policy-Report-Only, linha 40)
"default-src 'self'",
"img-src 'self' data: blob: https:",
"media-src 'self' blob: https://*.supabase.co",
"frame-ancestors 'none'",
```

- **YouTube não listado → viola.** Não existe `frame-src` na política; sem ele, `<iframe>` cai em `default-src 'self'`. Um embed de `youtube-nocookie.com` é violação. Hoje ela só reporta (`Report-Only`, `next.config.ts:40`), mas o comentário `next.config.ts:10-13` diz que a intenção é virar a chave para enforce. O dia em que virar, os tutoriais quebram — e ninguém vai ligar uma coisa à outra.
- **Supabase Storage do self-hosted → também viola.** `media-src` permite `https://*.supabase.co`, mas o Supabase deste deploy fica em `https://api.imasterchat.com.br` (`deploy/README.md:37-39`, `API_EXTERNAL_URL`). Não casa com o wildcard. Precisaria editar a CSP de qualquer jeito.
- **`'self'` já passa.** É a única fonte que a política existente aceita sem edição.

Argumentos secundários, na mesma direção:

- O vídeo é **igual para todos os inquilinos**. Bucket com RLS por `account_id` (o padrão de `src/lib/storage/upload-media.ts:5-14`, `account-<uuid>/…`) modela "arquivo de um cliente" — modelo errado para conteúdo do operador.
- Storage self-hosted divide a mesma VPS com o Postgres (`deploy/README.md:1-4`: "Sobe o app e o Supabase completo … num único docker compose, na mesma máquina"). E o backup documentado é `pg_dump` (`deploy/README.md:375-381`) — **não cobre o bucket**. Vídeo no Storage é estado novo, fora do backup.
- **Não consegui confirmar o tamanho do disco da VPS** nem o backend de storage do stack (o `supabase-stack` é clonado do upstream no deploy — `deploy/README.md:22-24`, não está neste repositório). Então não dou número de "custo em disco" como fato.

**O preço do caminho que recomendo, dito na cara:** `public/` entra na imagem Docker (`next.config.ts:82-84`), então cada vídeo engorda a imagem e **trocar um print exige rebuild + deploy**, não um upload. Isso é aceitável enquanto o volume for pequeno, e por isso o orçamento é explícito:

| Item | Teto por peça | Quantidade v1 | Total |
|---|---|---|---|
| Print `.png` | 200 KB | ~40 | ~8 MB |
| Clipe `.mp4` (v2) | 3 MB | ~10 | ~30 MB |

Teto da árvore `public/tutoriais/` inteira: **50 MB**, verificado por teste (§6). Os ~3 MB por clipe são **estimativa minha** para 30 s de captura de tela a 1280×800, H.264, sem áudio — não medi. Se estourar o teto, aí sim promove para um bucket **público novo** (`tutorial-media`, mesma forma da migração `023_chat_media.sql:38-71`, mas sem `account-<uuid>` no caminho) **e** acrescenta o host à CSP. Não antes.

---

## 3. Quem escreve o conteúdo

**O operador da plataforma, para TODOS os clientes. Uma versão só, sem edição por conta.**

E a consequência boa dessa escolha é que ela **elimina a questão de RLS inteira**: não há tabela, não há política, não há `account_id`. Zero superfície de vazamento entre inquilinos numa feature que não tem por que ter nenhuma.

Por que não "cada conta escreve o seu":

1. **O material já existe e é do operador.** `docs/ajustes-do-agente.md` é literalmente o sumário do tutorial — 170 linhas mapeando o que o cliente pode ajustar, tabela por tabela ("Agentes → Configurar", "Agentes → Vault", "Configurações → Agendamento"). Foi escrito pelo operador, para o dono da ótica. Não há nada que a ótica saiba sobre a tela de Regras que o operador não saiba melhor.
2. **O dono da ótica não vai escrever.** Ele comprou um produto para não ter que pensar nisso. A funcionalidade seria construída para um usuário que não existe.
3. **O custo de fazer por conta é um CMS inteiro**, não uma tela: tabela `tutorials` + `tutorial_steps` com `account_id`, 8 policies (`SELECT` com `is_account_member(account_id)`, `INSERT/UPDATE/DELETE` com `is_account_member(account_id,'admin')` — o padrão de `029_ai_reply.sql:66-80`), um bucket com caminho `account-<uuid>/` e as 4 policies de `storage.objects` (`023_chat_media.sql:83-122`), um editor com upload, ordenação e preview, e mais um lugar onde conteúdo de um inquilino pode aparecer para outro se uma policy sair errada.
4. **Precedente registrado no próprio repo:** as páginas legais são prosa pt-BR revisada pelo operador, fora do catálogo, e o comentário explica que dar mais um caminho de edição multiplica manutenção sem benefício para o leitor (`src/app/privacidade/page.tsx:8-11`; `src/app/termos/page.tsx:11-14`).

**Onde conteúdo por conta seria legítimo, e como ficaria a RLS quando chegar a hora:** uma aba "Anotações da equipe" — o procedimento interno da loja ("quem confirma a entrega da lente é a Márcia"). Aí sim tabela `account_notes(id, account_id, title, body, updated_by)`, `SELECT` para qualquer membro e escrita só para `admin`, exatamente como `ai_configs` (`029_ai_reply.sql:66-67` / `:71-80`). Coisa diferente, tela diferente, projeto diferente. Não entra agora.

**Sobre o painel `/admin`:** poderia ser lá que o operador edita. Não recomendo. `/admin` tem 3 abas (Eventos, Contas, Preços — `src/app/admin/admin-tabs.tsx:25-42`) e o comentário do arquivo diz que Eventos abre primeiro porque *"é a razão de alguém entrar aqui num dia ruim"* (`:15-17`). É a tela de plantão. Editor de conteúdo não pertence ao plantão — pertence ao repositório.

---

## 4. Como o cliente chega no tutorial certo na hora certa

Existe ponto na interface, e já existe **precedente exato do mecanismo inverso** para copiar.

`src/components/agents/ai-context.tsx:55-61` mantém um mapa de conceito → tela:

```ts
agent_settings: '/agents?tab=setup',
scheduling_settings: '/settings?tab=scheduling',
vault: '/agents?tab=vault',
guardrails: '/agents?tab=guardrails',
```

…renderizado como um link com `ExternalLink` em `:176-183`. O `docs/ajustes-do-agente.md:68-72` descreve o efeito: *"Não ajusta nada — mostra exatamente o que o modelo lê, seção por seção, com o link para onde cada uma se muda."*

O tutorial é a mesma seta virada: **tela → tutorial**, via o campo `anchors` do §2, e o link é `/tutorials?a=<slug>#p<NN>`.

### Os quatro pontos de ancoragem, do mais barato ao mais caro

**a) `SettingsPanelHead` — um "?" para as 13 seções de Configurações de uma vez.**

O componente já tem um slot de ação alinhado à direita (`src/components/settings/settings-panel-head.tsx:10-20, 38`). Basta um prop novo:

```ts
export function SettingsPanelHead({ title, description, action, helpSlug, className }: {...})
// e ao lado do action: helpSlug ? <TutorialLink slug={helpSlug} /> : null
```

Cada painel passa o seu (`whatsapp-config.tsx`, `scheduling-settings.tsx`, `template-manager.tsx`…). Isso é o maior retorno por linha da feature inteira.

**b) As 7 abas de `/agents`.**

`src/app/(dashboard)/agents/page.tsx:32-44` declara `TABS` como uma lista tipada com `value`, `icon`, `labelKey` — acrescentar `tutorial: 'ligar-o-agente'` a cada entrada é uma linha por aba, e o "?" renderiza ao lado do `<h1>` (`:88-96`), variando com a aba ativa.

**c) O momento de maior valor: a primeira visita a `/agents`.**

`agents/page.tsx:70-83` faz `GET /api/ai/config` e cai em `setup` quando `data.configured` é falso — visita seguinte cai em `playground`. Esse `setup` de primeira visita é literalmente o cliente parado na frente da tela que ele nunca viu. É lá que o "?" tem que ser um card, não um ícone.

**d) A aba Regras → Áudio.**

`src/components/agents/ai-rules.tsx:221-241` é o seletor de política de áudio; os campos aparecem e somem conforme a escolha (`:244`, `:262`, `:291`, `:312`). É a decisão mais difícil de entender da tela toda ("ignorar / pedir por escrito / transcrever / passar para uma pessoa"), e a que tem consequência visível para o cliente final da ótica. Um tutorial com print de cada uma das quatro escolhas resolve.

### O contrato da URL

`/tutorials?a=<slug>` — `useSearchParams` como fonte da verdade, igual a Configurações (`settings/page.tsx:51-61`). Isso **obriga** o wrapper de Suspense: sem ele o build de produção estoura o erro de "missing Suspense with CSR bailout" e a página inteira vai para client-side, com o trilho sem handler de clique. O comentário em `settings/page.tsx:28-35` documenta o incidente e a solução — copiar a estrutura de `SettingsPage`/`SettingsPageInner` (`:36-44`), não reinventar.

---

## 5. V1 pequena que já serve, e o que fica para depois

### V1 — cabe num PR, sem migração

- Rota `/tutorials` em `(dashboard)`, `Suspense` + `?a=`, trilho à esquerda com `SettingsRail` como molde (`src/components/settings/settings-rail.tsx:53-107`: vertical em `lg:`, fita rolante abaixo, `scrollIntoView` do item ativo em `:43-51`). O grid `lg:grid-cols-[236px_minmax(0,1fr)]` de `settings/page.tsx:101` serve como está.
- Índice (o "overview" da tela): cards por grupo, molde `SettingsOverview` (`src/components/settings/settings-overview.tsx`) **sem** as consultas de contagem — é conteúdo estático.
- Um artigo é uma lista vertical de passos numerados, print à direita em `lg:`, empilhado no mobile. `<img>` cru, `loading="lazy"`, `max-w-full`.
- **6 artigos**, tirados direto do que confirmei que existe:

| slug | cobre | telas reais |
|---|---|---|
| `conectar-whatsapp` | ligar o número | `/settings?tab=whatsapp` (`settings/page.tsx:80`) |
| `ligar-o-agente` | provedor, chave, ligar, resposta automática | `/agents?tab=setup` (`agents/page.tsx:38`), tabela em `docs/ajustes-do-agente.md:16-27` |
| `ensinar-o-negocio` | Instruções + Vault (os 5 tipos) | `/agents?tab=vault`, `docs/ajustes-do-agente.md:29-42` |
| `audio-do-cliente` | as 4 políticas | `/agents?tab=rules`, `src/components/agents/ai-rules.tsx:221-241` |
| `agendamento` | rótulo, fuso, duração, janelas | `/settings?tab=scheduling`, `docs/ajustes-do-agente.md:74-84` |
| `atender-na-caixa` | assumir, responder, transferir | `/inbox` |

- "?" ligado em **(a)** e **(b)** do §4 — as 13 seções e as 7 abas.
- Namespace `Tutorials` novo nos **três** catálogos, só com o cromo (título da página, "Passo", "min de leitura", "Ver tutorial", rótulos dos 4 grupos). ~12 chaves. A prosa **não** vai para lá.
- `catalog.test.ts` (§6).

### Explicitamente fora da v1

Busca. Vídeo. Estado de "já li" (é tabela e RLS). Anotações por conta. Edição pelo `/admin`. Versão para impressão. Tour guiado por cima da interface. Tradução para en/ko dos artigos — o app tem locale único por instalação (`src/i18n/request.ts:5`), e esta instalação é pt-BR.

### Ordem de trabalho

1. Rota + trilho + tipos + catálogo com **um** artigo escrito de ponta a ponta. É o que fixa o formato.
2. `helpSlug` no `SettingsPanelHead` + os 13 painéis.
3. Os outros 5 artigos e os prints (agente de conteúdo, §6).
4. `?` nas abas de `/agents` + o card na primeira visita.

O passo 1 sozinho já é publicável.

---

## 6. Como o agente que vai ESCREVER recebe o material

### Formato: um módulo TypeScript por artigo. Não markdown, não JSON, não banco.

`src/lib/tutorials/articles/<slug>.ts`, exportando `const article: Tutorial`. Motivos concretos: o tipo `TutorialStep` obriga `shotAlt` quando há `shot`; `tsc --noEmit` (`package.json:35`) pega slug errado, campo faltando e grupo inexistente antes do merge; e não precisa de dependência nenhuma para renderizar.

### Esqueleto que o agente preenche

```ts
// src/lib/tutorials/articles/conectar-whatsapp.ts
import { PlugZap } from 'lucide-react';
import type { Tutorial } from '../types';

export const conectarWhatsapp: Tutorial = {
  slug: 'conectar-whatsapp',
  group: 'primeiros-passos',
  icon: PlugZap,
  title: 'Conectar seu WhatsApp',
  summary: 'Ligar o número do seu negócio ao sistema. Feito uma vez só.',
  minutes: 6,
  anchors: ['settings:whatsapp'],
  steps: [
    {
      title: 'Abra Configurações → WhatsApp.',
      body: 'É a primeira seção do grupo "Espaço de trabalho", no trilho da esquerda.',
      href: '/settings?tab=whatsapp',
      shot: '/tutoriais/conectar-whatsapp/01-abrir-configuracoes.png',
      shotAlt: 'Trilho de Configurações com a seção WhatsApp destacada.',
    },
    // ...
  ],
};
```

### Nome dos prints — a regra, sem exceção

```
public/tutoriais/<slug>/<NN>-<verbo-curto>.png
                  │       │    └─ 2 a 4 palavras, kebab-case, o QUE se faz
                  │       └─ 2 dígitos, mesma ordem do passo: 01, 02, 03…
                  └─ idêntico ao campo `slug` do artigo
```

Exemplos reais:

```
public/tutoriais/conectar-whatsapp/01-abrir-configuracoes.png
public/tutoriais/conectar-whatsapp/03-colar-o-token.png
public/tutoriais/audio-do-cliente/02-escolher-a-politica.png
```

Referência no artigo é sempre root-absoluta com `/tutoriais/…` — é o que `<img src>` precisa para um arquivo de `public/`.

### Regras de captura (o agente segue, o revisor cobra)

| Regra | Por quê |
|---|---|
| Viewport **1440×900** | Acima de `lg:` (1024px, `settings-rail.tsx:21`), onde o trilho é coluna vertical — que é como o print deve mostrar |
| Modo **escuro**, accent **elucas** | São os padrões: `DEFAULT_MODE = "dark"` (`src/lib/themes.ts:54`) e `DEFAULT_THEME = "elucas"` (`:27`). Um print claro não parece a tela de quem nunca mexeu em Aparência |
| PNG, **≤ 200 KB** | Teto da §2. Recorte a região relevante em vez de comprimir a tela inteira |
| **Zero dado real** | Contatos "Cliente Exemplo", telefones `+55 11 90000-0000`, nenhum token/chave visível — a tela de WhatsApp mostra credencial |
| Destaque é **retângulo de 2px na cor de destaque**, sem seta, sem balão, sem número desenhado | O número já está no passo; desenho por cima envelhece com o redesign e não dá para traduzir |
| Um print por passo, no máximo | Passo que precisa de dois prints são dois passos |

### O teste que impede o print quebrado de chegar na tela

`src/lib/tutorials/catalog.test.ts` — mesma função que `src/i18n/messages.test.ts` cumpre para as mensagens (existe para impedir que uma chave vire keypath cru na tela):

1. `fs.statSync` em todo `shot` do catálogo → falha se o arquivo não existe.
2. Cada arquivo ≤ 200 KB (vídeo ≤ 3 MB).
3. Soma de `public/tutoriais/` ≤ 50 MB.
4. `slug` único, e todo `NN` do nome do print bate com o índice do passo.
5. Todo `anchors[]` referencia uma seção/aba que existe (cruza com `SETTINGS_SECTIONS` de `settings-sections.ts:26-40` e com `TABS` de `agents/page.tsx:32-44`).

Sem o item 5, uma seção renomeada deixa um "?" apontando para o nada e ninguém percebe.

### Voz do texto

O leitor é o dono da ótica, não um técnico. Título de passo é **imperativo e curto** ("Cole o token", não "Configuração do token de acesso"). O `body` explica **por que**, nunca repete o título. Jargão só quando a tela usa a palavra — se a tela diz "Vault", o tutorial diz "Vault" e explica na primeira vez. Nada de "simplesmente", "basta", "é só".

### O que o agente de conteúdo recebe junto

- `docs/ajustes-do-agente.md` inteiro — é o sumário; as tabelas das linhas 16-27, 58-66 e 76-84 são artigos prontos esperando prosa.
- Este documento (a §6, principalmente).
- `src/lib/tutorials/types.ts` e o artigo-modelo do passo 1 da ordem de trabalho.
- Uma conta de demonstração populada, com o WhatsApp já conectado — sem ela não há o que capturar.

---

## O que não consegui confirmar

- **Tamanho do disco da VPS** e o backend de storage do Supabase self-hosted. O `supabase-stack` é clonado do upstream no momento do deploy (`deploy/README.md:22-24`), não está neste repositório. Por isso não dou número de "custo em disco" — dou orçamento e teto, que dependem só de nós.
- **Peso real de um clipe de 30 s.** Os ~3 MB da tabela do §2 são estimativa minha, não medição.
- **Se `robots.ts` existe.** O comentário de `src/app/(dashboard)/layout.tsx:8-9` afirma que sim; o mapa registra que `find src -name 'robots*'` não retorna nada (o gap está em `frontend-audio.json`, seção `gaps`). Não refiz a busca. Relevante só se alguém quiser a tela de tutoriais indexável — e a recomendação aqui é que ela não seja.
- **Não li o corpo inteiro de `whatsapp-config.tsx`, `template-manager.tsx` nem `scheduling-settings.tsx`** — li `settings-panel-head.tsx` e o `settings/page.tsx` que os monta. A afirmação de que "cada painel passa o seu `helpSlug`" pressupõe que todos usam `SettingsPanelHead`; **não verifiquei painel por painel.** Antes de implementar o item (a) do §4, rodar `grep -rn "SettingsPanelHead" src/components/settings/` e conferir os 13.