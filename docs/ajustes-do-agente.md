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

Valem para o servidor inteiro, não por conta. Mudar exige editar
`apps/imasterchat/.env` e reiniciar.

| variável | padrão | o que faz |
|---|---|---|
| `AI_CONTEXT_MESSAGE_LIMIT` | 20 | quantas mensagens do histórico vão ao modelo |
| `AI_MAX_TOOL_STEPS` | 6 | teto de passos (sobrescrito por conta) |
| `AI_REQUEST_TIMEOUT_MS` | 30000 | timeout de uma chamada ao provedor |
| `AI_AGENT_TIMEOUT_MS` | 60000 | teto de relógio da execução inteira |

---

## Hoje só no código

São os que ainda exigem alterar arquivo e rebuildar. Divididos pelo que
eu acho que deve virar campo e o que acho que não deve.

### Deveriam ser configuráveis — são números de negócio

| onde | valor | por que varia entre negócios |
|---|---|---|
| `lib/ai/conversation-gap.ts` | 8 horas | a partir de quanto silêncio um "oi" é conversa nova. Uma consultoria pensaria em dias; uma pizzaria, em duas horas |
| `lib/ai/tools/scheduling.ts` | 7 dias | quanto o agente olha à frente ao procurar horário |
| `lib/scheduling/availability.ts` | 12 vagas | quantas vagas a consulta traz |
| `lib/scheduling/availability.ts` | "no máximo 3" | quantos horários o bot oferece por mensagem |

Os dois últimos foram ajustados esta semana justamente porque o bot
despejou 42 horários numa mensagem. Se voltar a incomodar, hoje só se
resolve mexendo em código — que é exatamente o problema.

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

## O que falta: uma tela de Regras

Os quatro números da primeira tabela não têm casa. Espalhá-los em
"Configurar" misturaria credencial com comportamento numa tela que já
está cheia.

A proposta é **Agentes → Regras**: os números de comportamento juntos,
cada um com o que ele custa e o que quebra se for mudado. E a ligação
natural com **Agentes → Contexto**, que mostra o efeito — ver o que o
modelo lê, ajustar o que governa, ver de novo.
