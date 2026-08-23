# Documentação de referência do iMasterChat

O iMasterChat é um atendimento de WhatsApp com CRM, robô de IA e automação, vendido para pequenos negócios (ótica, loja de bicicleta, revenda de energia solar). Cada empresa é uma **conta** isolada; tudo o que entra vem do WhatsApp da empresa, é decidido por três motores diferentes (o agente de IA, as automações e os fluxos), fica guardado em contatos e conversas, e sai como mensagem no WhatsApp, evento na agenda ou aviso para um sistema de fora.

Esta pasta tem doze documentos de subsistema, um glossário e este índice. Tudo aqui foi levantado lendo o código e as migrações deste repositório e passou por uma revisão de conferência. Onde algo não pôde ser confirmado, o documento diz que é desconhecido em vez de chutar — respeite isso.

---

## O sistema em uma tela

```
                    ┌──────────────────────────────────────────┐
   O QUE ENTRA      │  WhatsApp do negócio (Meta, Graph v21.0)  │
                    └───────────────────┬──────────────────────┘
                                        │ POST /api/whatsapp/webhook
                                        │ (assinatura HMAC; responde 200 e
                                        │  processa depois, em after())
                                        ▼
                    ┌──────────────────────────────────────────┐
   GUARDA PRIMEIRO  │  contato → conversa → mensagem            │
   (sempre, mesmo   │  + contador de não lidas, prévia, reabre   │
   com a conta      │  conversa fechada                         │
   bloqueada)       └───────────────────┬──────────────────────┘
                                        │
                            ┌───────────┴───────────┐
                            │  PORTÃO DE COBRANÇA   │  conta pending/blocked
                            │  para tudo daqui p/   │  → grava e para aqui
                            │  baixo (menos os      │
                            │  webhooks de saída)   │
                            └───────────┬───────────┘
                                        ▼
   O QUE DECIDE     ┌────────────┬──────────────┬──────────────────────┐
   (nesta ordem)    │ 1. FLUXOS  │ 2. AUTOMAÇÕES│ 3. AGENTE DE IA      │
                    │ chatbot de │ regra linear │ lê a conversa e      │
                    │ botões,    │ "quando isso │ escreve a resposta;  │
                    │ guarda em  │ faça aquilo",│ usa Vault, base de   │
                    │ que passo  │ com espera   │ conhecimento, limites│
                    │ cada um    │ agendada     │ e 5 ferramentas      │
                    │ parou      │              │                      │
                    └──────┬─────┴───────┬──────┴──────────┬───────────┘
                           │             │                 │
   O QUE É GUARDADO        ▼             ▼                 ▼
                    ┌──────────────────────────────────────────┐
                    │ contatos · etiquetas · campos · anotações │
                    │ conversas (status, dono, pausa da IA)     │
                    │ negócios no funil · agendamentos          │
                    │ páginas do Vault · logs e execuções       │
                    └───────────────────┬──────────────────────┘
                                        │
   O QUE SAI                            ▼
        ┌──────────────┬────────────────┬─────────────────┬──────────────┐
        │ mensagem no  │ evento na      │ webhook de saída│ aviso interno│
        │ WhatsApp     │ Google Agenda  │ (POST assinado  │ (Notificações│
        │ (texto,      │ + tela Agenda  │ para o sistema  │ e push no    │
        │ modelo,      │                │ do cliente)     │ celular)     │
        │ botões,      │                │                 │              │
        │ mídia, áudio)│                │                 │              │
        └──────────────┴────────────────┴─────────────────┴──────────────┘

   POR FORA:  · a pessoa da equipe, pela Caixa de entrada (responde, atribui, assume)
              · um sistema de fora, pela API pública /api/v1 (chave + escopos)
              · um agendador (contêiner `cron`) que a cada 5 min acorda esperas de
                automação, aposenta fluxos e compromissos vencidos, roda o keeper
                do Vault, atualiza o dólar e faz a ronda de saúde
```

Duas coisas para gravar antes de qualquer coisa:

- **Responder pela Caixa de entrada não assume a conversa e não cala a IA.** Só os botões **Atribuir** e **Assumir** fazem isso. Sem eles, a IA responde de novo por cima do atendente na próxima mensagem do cliente.
- **Sem o agendador rodando**, o passo Espera das automações nunca acorda, nenhum fluxo é aposentado por tempo, nenhum compromisso vencido é liquidado (e aí o bot passa a dizer que o cliente "já tem um agendamento" sobre um horário da semana passada), o keeper do Vault nunca roda sozinho e a saúde nunca é verificada.

---

## Por onde começar

Leia nesta ordem. Cada linha diz o que tem no documento e quando você deveria abri-lo.

| # | Documento | O que você encontra | Quando abrir |
|---|---|---|---|
| 1 | [contas-e-acesso.md](contas-e-acesso.md) | O que é uma conta, os quatro papéis, o convite por link, e a trava comercial: toda conta nova nasce travada e alguém libera à mão. | Antes de tudo. Nada no produto funciona sem entender que cada empresa é uma conta e que uma conta nova está bloqueada até ser aprovada. |
| 2 | [whatsapp.md](whatsapp.md) | A conexão com a Meta, o que acontece quando chega mensagem, o envio, a mídia e o catálogo de modelos. | Quando for explicar como conectar o número, ou quando "parou de chegar mensagem". |
| 3 | [inbox.md](inbox.md) | A Caixa de entrada: conversas, status, atribuição, assumir/devolver do robô, etiquetas como filtro e presença. | Assim que o cliente tiver o número conectado — é a tela onde a equipe vive. Leia antes de escrever qualquer tutorial de atendimento. |
| 4 | [crm.md](crm.md) | Contatos, etiquetas, campos personalizados, anotações, importação de CSV, funis e negócios, respostas rápidas. | Quando for falar de cadastro de cliente, planilha importada ou acompanhamento de venda. |
| 5 | [agente-de-ia.md](agente-de-ia.md) | Como o robô pensa: o prompt montado, o laço de ferramentas, os portões de silêncio, o custo e as três superfícies (resposta automática, rascunho, playground). | Quando for configurar o robô ou explicar por que ele respondeu (ou não respondeu) alguma coisa. |
| 6 | [conhecimento.md](conhecimento.md) | Vault (a wiki que o robô propõe e a equipe aprova), base de conhecimento (o texto colado à mão) e os Limites — assuntos e palavras que forçam transferência. | Logo depois do agente de IA. É o que separa "o robô inventa" de "o robô sabe". |
| 7 | [automacoes-e-fluxos.md](automacoes-e-fluxos.md) | Os dois motores determinísticos — automação linear e fluxo com botões — e o agendador que sustenta os dois. | Quando o cliente quiser "mandar mensagem de boas-vindas sozinho" ou "um menu de opções". |
| 8 | [agendamento.md](agendamento.md) | Regras de horário, conexão com a Google Agenda, as quatro ferramentas de agenda do robô e a tela Agenda. | Quando o negócio marca hora (ótica, clínica, visita técnica). |
| 9 | [disparos-e-avisos.md](disparos-e-avisos.md) | Campanha em massa por modelo aprovado, o catálogo de modelos, a tela Notificações e os avisos no celular. | Quando for falar de "mandar mensagem para toda a base" ou de por que a atendente não foi avisada. |
| 10 | [telas-e-audio.md](telas-e-audio.md) | O mapa das 27 telas, o menu, idioma, temas, instalação no celular — e todo o tratamento de áudio recebido. | Para se orientar no app inteiro, e sempre que o assunto for áudio do cliente. A parte de áudio se lê junto com o documento do agente de IA. |
| 11 | [api-publica.md](api-publica.md) | A porta para máquinas: chaves de API, escopos, as rotas `/api/v1` e os webhooks de saída assinados. | Quando houver integração — n8n, Zapier, ERP, site — ou quando alguém pedir "avisa meu sistema quando chegar mensagem". |
| 12 | [admin-e-saude.md](admin-e-saude.md) | O painel de quem vende o iMasterChat: eventos de erro, feedback dos clientes, cobrança manual, preços de IA e a ronda de saúde com alerta no Telegram. | Só para o dono da plataforma. O cliente final não vê nada disto. |
| — | [glossario.md](glossario.md) | Os termos do produto, o que cada um **não** é, e o nome exato que aparece na tela. | Antes de escrever a primeira frase de qualquer tutorial. É o que impede trocar "atribuir" por "assumir" e "modelo" por "mensagem". |

---

## Defeitos confirmados — não escreva tutorial em cima deles

Estes comportamentos estão errados no produto hoje. Não descreva nenhum deles como se funcionasse.

| O que parece | O que acontece de verdade | Documento |
|---|---|---|
| Responder pelo inbox assume a conversa e cala o robô | Não assume e não cala. A IA volta a responder na próxima mensagem do cliente. Só **Atribuir**/**Assumir** silenciam. | [inbox.md](inbox.md) |
| O modo **Rodízio** da automação distribui entre os atendentes | Não distribui: pega um perfil qualquer da conta, sem ordem e sem memória. Use "Agente específico". | [automacoes-e-fluxos.md](automacoes-e-fluxos.md) |
| Importar planilha com etiqueta dispara a automação de "Etiqueta adicionada" | Não dispara. Só a tela do contato, a API pública, o passo de automação e o nó de fluxo disparam. | [crm.md](crm.md) |
| O nó **Transferir para agente** do fluxo faz a transferência completa | Só muda a conversa para Pendente. Não desliga a IA, não grava o motivo e não deixa escolher a pessoa pela tela. | [automacoes-e-fluxos.md](automacoes-e-fluxos.md) |
| Tocar no aviso do celular abre a conversa | Abre a Caixa de entrada sem a conversa selecionada (o link usa `?conversation=` e a tela lê `?c=`). Vale também para o link dentro do evento da Google Agenda. | [disparos-e-avisos.md](disparos-e-avisos.md) |
| Só admin mexe nos modelos de mensagem | `PATCH` e `DELETE` de `/api/whatsapp/templates/[id]` não checam papel: um Visualizador consegue apagar o modelo na Meta. | [whatsapp.md](whatsapp.md) |
| A mídia recebida é servida com segurança | O proxy repassa o `Content-Type` do remetente, sem lista de permitidos — XSS armazenado. | [whatsapp.md](whatsapp.md) |
| O orçamento mensal em dólar corta o gasto | `monthly_budget_usd` é exibido e projetado, e **nunca** aplicado. Nada é bloqueado. | [agente-de-ia.md](agente-de-ia.md) |
| O teto de respostas do robô limita rajada | O contador zera a cada mensagem do cliente. Um cliente que manda cinco mensagens seguidas pode receber mais respostas que o teto. | [agente-de-ia.md](agente-de-ia.md) |
| "Página criada e aprovada" no Vault | A tela mente: a página nasce em rascunho e só vale depois de aprovada na sub-aba **Aprovação**. | [conhecimento.md](conhecimento.md) |
| Desligar o agente de IA cala a conta | A política de áudio é outro caminho e não olha essas chaves: com o agente desligado, o "pode me escrever?" continua saindo sozinho. | [telas-e-audio.md](telas-e-audio.md) |
| Agendar um disparo para depois | Não existe. A tela entende o status "Agendado", mas nada escreve a data e nada executa no futuro. | [disparos-e-avisos.md](disparos-e-avisos.md) |
| Os gatilhos "Baseado em horário" e "Conversa atribuída" | Aparecem no seletor e **nada no sistema os aciona**. | [automacoes-e-fluxos.md](automacoes-e-fluxos.md) |

---

## Como usar esta documentação

- **Nomes de tela**: sempre pelo nome que aparece no menu (Caixa de entrada, Disparos em massa, Agentes de IA…), nunca pela rota. O [glossário](glossario.md) traz a lista.
- **Papéis**: quando um documento diz "exige admin", é o Administrador **da conta**, não o administrador da plataforma. São coisas diferentes e o glossário separa as duas.
- **Citações `arquivo:linha`** existem para quem for mexer no código. Elas envelhecem — confirme antes de confiar num número de linha.
- **Nada aqui foi verificado contra o banco de produção.** Tudo sobre tabelas e regras de acesso vem da leitura dos arquivos de migração.
