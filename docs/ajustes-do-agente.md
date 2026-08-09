# Onde se ajusta o agente

Mapa do que dá para mudar pela interface, do que só dá por variável de
ambiente, e do que hoje está no código.

Existe mais coisa configurável do que parece. O que falta é um lugar
onde os **números de comportamento** morem juntos — hoje eles estão
espalhados entre uma tela, o `.env` e constantes.

---

## Pela interface, hoje

### Agentes → Configurar

| ajuste | o que faz |
|---|---|
| Provedor, modelo, chave | qual IA responde e com que chave |
| **Instruções do seu negócio** | texto livre: contexto, persona, tom |
| Ligar o assistente | liga/desliga tudo |
| Resposta automática | responder sozinho ou só sugerir rascunho |
| Máximo de respostas por conversa | quantas vezes seguidas o bot fala antes de parar |
| Agente do handoff | quem recebe a conversa transferida |
| Orçamento mensal | ⚠ exibido e projetado, **não aplicado** (ver `pendencias.md`) |
| Passos de ferramenta | quantas idas ao provedor uma resposta pode custar |
| Datas nas mensagens | marcar cada mensagem com quando foi dita |
| Avisar ao transferir | mandar mensagem antes de passar para uma pessoa |

**"Instruções do seu negócio" é a válvula mais poderosa e a menos
usada.** É texto livre que entra em toda resposta, depois do andaime e
antes dos guardrails. Boa parte do que parece exigir código cabe ali.

### Agentes → Vault

As páginas aprovadas que entram em **toda** resposta. É a casa dos
fatos e das regras do negócio: "trocas em 30 dias", "não atendemos
sábado", "o Dr. João não atende convênio".

Cinco tipos, e a diferença importa: `rule` entra sempre e deve ser
curta; `entity_customer` é sobre uma pessoa; `state` é o que vale agora
e vai mudar.

### Agentes → Guardrails

Os assuntos e palavras que o bot não pode tratar. Palavra-chave é
verificada **antes** do modelo — não há como argumentar com ela.

### Agentes → Ferramentas

Liga e desliga cada ferramenta (agendar, remarcar, cancelar, chamar
humano) individualmente.

### Agentes → Contexto

Não ajusta nada — **mostra** exatamente o que o modelo lê, seção por
seção, com o link para onde cada uma se muda. É o lugar de começar
quando o bot fez algo inesperado.

### Configurações → Agendamento

| ajuste | o que faz |
|---|---|
| Como vocês chamam isso | "demonstração", "visita técnica" — o termo do agente |
| Fuso | o relógio do negócio |
| Duração | tamanho do bloco |
| Antecedência mínima | quanto tempo antes dá para marcar |
| Máximo de dias à frente | horizonte de agendamento |
| Janelas por dia da semana | expediente |
| Deixar o agente marcar | liga/desliga as ferramentas de agenda |

---

## Só por variável de ambiente

Valem para o **servidor inteiro**, não por conta. Mudar exige editar
`apps/imasterchat/.env` e **reiniciar** (não precisa rebuild — nenhuma
delas é `NEXT_PUBLIC_*`).

| variável | padrão | o que faz |
|---|---|---|
| `AI_CONTEXT_MESSAGE_LIMIT` | 20 | quantas mensagens do histórico vão ao modelo |
| `AI_REQUEST_TIMEOUT_MS` | 30000 | timeout de UMA chamada ao provedor |
| `AI_AGENT_TIMEOUT_MS` | 60000 | teto de relógio da execução inteira do agente |

`AI_CONTEXT_MESSAGE_LIMIT` é a que mais parece candidata a subir para a
tela de Regras: mexe direto no tamanho do contexto, ou seja no custo de
toda resposta, e o número certo depende de quão longas são as conversas
do ramo. As outras duas são infraestrutura — quem atende numa ótica não
tem como opinar sobre timeout de provedor, e errar ali quebra de um
jeito que parece bug da IA.

> **`AI_MAX_TOOL_STEPS` NÃO pertence a esta lista.** Ela é só o piso do
> servidor: `ai_configs.max_tool_steps` sobrescreve por conta, e esse
> campo já existe na tela ("Passos de ferramenta"). A precedência está
> em `maxToolSteps()` — conta primeiro, variável depois, padrão por
> último.

E há uma quarta variável que não é ajuste de comportamento:
`WHATSAPP_TEMPLATES_DRY_RUN`, um interruptor de desenvolvimento que
impede o envio real de modelos à Meta.

---

## Hoje só no código

São os que ainda exigem alterar arquivo e rebuildar. Divididos pelo que
eu acho que deve virar campo e o que acho que não deve.

### ~~Deveriam ser configuráveis~~ — resolvido, migração 059

Os quatro números de comportamento viraram campos em **Agentes →
Regras**. Os padrões são exatamente os valores que estavam no código,
então a migração não mudou o comportamento de conta nenhuma.

| campo | padrão | onde estava |
|---|---|---|
| Horas de silêncio para conversa nova | 8 | `lib/ai/conversation-gap.ts` |
| Horários oferecidos por mensagem | 3 | `lib/scheduling/availability.ts` |
| Dias à frente que ele procura | 7 | `lib/ai/tools/scheduling.ts` |
| Vagas trazidas por consulta | 12 | `lib/scheduling/availability.ts` |

Cada campo mostra o que se paga ao aumentá-lo, porque todos são troca —
mais dias e mais vagas custam tokens em toda consulta, e mais horários
por mensagem transformam a oferta em formulário.

### Deveriam continuar no código — são texto que vai ao MODELO

| onde | o que é |
|---|---|
| `lib/ai/defaults.ts` | o andaime: como responder, não inventar, formato |
| `lib/scheduling/refusal.ts` | como explicar cada motivo de recusa |
| `lib/ai/transcript-stamp.ts` | como ler as marcas de tempo |
| `lib/ai/conversation-gap.ts` | o que fazer com um intervalo longo |

O critério: **o cliente final nunca lê esse texto.** Ele é instrução
para o modelo, que reescreve tudo com as próprias palavras e no idioma
da conversa. Deixar editável dá ao operador uma forma de quebrar o
agente que é difícil de diagnosticar — e ele já tem a válvula certa
para influenciar o mesmo resultado: as instruções do negócio e o vault.

A exceção é texto que sai **literal** para o cliente. Aí tem que ser
configurável, e é: o aviso de transferência é campo, não constante.

---

## A regra daqui para frente

**Número que varia entre negócios nasce campo, não constante.** Texto
que só o modelo lê continua no código.

O par Regras + Contexto fecha o ciclo: ver o que o modelo lê, ajustar o
que governa, ver de novo.
