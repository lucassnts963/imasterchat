# Agendamento e Google Agenda

Este subsistema é a agenda do negócio dentro do iMasterChat. Ele faz duas coisas que se apoiam uma na outra: dá ao agente de IA quatro ferramentas para consultar horários, marcar, remarcar e cancelar direto na conversa de WhatsApp, e dá à equipe uma tela de **Agenda** para ver e mexer no que está marcado. A regra de qual horário vale não fica no texto do prompt — fica em tabela (`ai_scheduling_settings`) e é aplicada no servidor. O modelo escolhe **qual ferramenta chamar**; quem decide se o horário é legal é o código, cruzando o expediente da conta, a antecedência mínima, o horizonte de agendamento e o que já está ocupado. O "ocupado" vem de duas fontes somadas: a consulta de livre/ocupado da Google Agenda conectada e as próprias linhas da tabela `appointments`. Três índices únicos no banco são a última linha de defesa contra dois clientes marcarem o mesmo horário no mesmo segundo.

A conexão com o Google é por conta (uma só) e guarda o refresh token criptografado. Ela **não é obrigatória**: sem Google, o agendamento continua funcionando com base apenas nas marcações feitas dentro do iMasterChat — pior produto, porque um dia bloqueado à mão no Google fica invisível, mas funciona.

---

## Para que serve (visão do cliente)

**O bot marca sozinho, no WhatsApp, sem a equipe entrar.**
O cliente pergunta "tem horário quinta?", o agente consulta os horários realmente livres e oferece alguns. O cliente escolhe, o agente marca. O compromisso aparece na tela de Agenda e, se a Google Agenda estiver conectada, também no calendário que a loja já usa — com o nome do cliente, o telefone e o assunto no corpo do evento.

**A Google Agenda é a fonte da verdade da disponibilidade.**
Bloquear a tarde de sexta direto no Google basta: o bot passa a não oferecer aquele período. Não é preciso avisar o sistema, nem apagar nada aqui.

**Você define as regras uma vez, e elas valem sempre.**
Em que fuso o negócio funciona, quanto dura um atendimento, quantos minutos de antecedência mínima (nada é oferecido "para daqui a 10 minutos"), até quantos dias à frente dá para marcar, e o horário de funcionamento de cada dia da semana, com quantas janelas você quiser (por exemplo, 09:00–12:00 e 14:00–18:00, com o almoço fora). Um dia sem janela é um dia fechado.

**Você ensina ao bot como o seu negócio chama isso.**
Existe um campo para o termo do ramo: "consulta", "avaliação", "visita técnica", "exame de vista". Quando preenchido, o agente usa aquela palavra exata na conversa em vez de dizer "agendamento".

**O cliente remarca e cancela pela mesma conversa.**
Sem precisar falar com ninguém: "dá para mudar para sexta?" e o bot move o horário, apagando o evento antigo do Google e criando o novo. Cancelar libera a vaga na hora.

**Cada cliente tem no máximo um compromisso vivo por vez.**
É uma trava de propósito: um cliente não consegue acumular três horários marcados. Se ele pedir outro, o agente é instruído a remarcar o que já existe em vez de criar um segundo.

**A equipe marca à mão quando precisa.**
Na tela Agenda dá para criar um agendamento para qualquer contato, inclusive fora do horário de funcionamento — o atendente vê a agenda e pode ter motivo para isso. Também dá para remarcar e cancelar, com registro do motivo.

**Você escolhe o que o bot pode fazer.**
Dá para deixar o bot só consultar e marcar, e tirar dele o poder de cancelar. Cada ferramenta tem um interruptor próprio.

**Se a agenda não puder ser lida, o bot não chuta.**
Quando a conexão com o Google cai ou é revogada, o agente não oferece nem confirma horário nenhum: ele para e chama uma pessoa.

---

## Como se usa, na prática

### 1. Conectar a Google Agenda e definir as regras

Menu **Configurações** → seção **Agendamento** (grupo "Espaço de trabalho").

1. No cartão **Google Agenda**, clique em **Conectar Google Agenda**. O navegador sai do sistema e vai para a tela de consentimento do Google. Escolha a conta do negócio e aceite. O Google devolve para a mesma tela de Agendamento e aparece um aviso de sucesso ou de erro.
   - Se o servidor não tiver as credenciais do Google configuradas, o botão não aparece; no lugar dele há um aviso pedindo `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `NEXT_PUBLIC_SITE_URL`. Isso é tarefa de quem instalou o sistema, não do lojista.
   - Depois de conectado, a tela mostra o e-mail da conta Google e o botão **Desconectar**.
2. No cartão **Regras de agendamento**, ligue **Deixar o agente marcar sozinho**. Com essa chave desligada, as ferramentas de agendamento nem existem para o modelo — ele responde como um chatbot comum e não sabe que poderia marcar.
3. Preencha: **Fuso horário**, **Como vocês chamam isso?** (até 40 caracteres; em branco, o agente usa o termo genérico), **Duração (minutos)**, **Antecedência mínima (minutos)**, **Agendar até quantos dias à frente** e o **Horário de funcionamento** dia a dia, com **Adicionar janela** / **Remover janela**.
4. **Salvar**.

A tela avisa nos dois estados incoerentes: agendamento ligado sem Google conectado, e Google conectado com o agendamento desligado.

Tudo nesse painel exige papel **admin**. Um agente ou visualizador consegue abrir e ler, mas não salvar.

### 2. Ajustar o comportamento do bot ao oferecer horários

Menu **Agentes de IA** → aba **Regras** → seção **Agendamento**. São três números:

- **Horários oferecidos por mensagem** — quantos horários o bot chega a nomear de uma vez.
- **Dias à frente que ele procura** — quanto ele olha adiante quando o cliente não diz uma data.
- **Vagas trazidas por consulta** — quantas vagas a busca devolve ao modelo. Ele oferece apenas as primeiras, mas conhece todas para responder "e na quinta?" sem consultar de novo. Cada vaga custa tokens.

Essa tela salva **só** esses campos, sem tocar em fuso, expediente e antecedência. Se a conta ainda não passou pela tela de Configurações → Agendamento, salvar aqui falha com a mensagem pedindo para abrir aquela tela primeiro.

### 3. Ligar e desligar ferramentas

Menu **Agentes de IA** → aba **Limites** → cartão **O que o agente pode fazer**. Cada ferramenta tem um interruptor:

| Nome na tela | Ferramenta |
|---|---|
| Chamar uma pessoa | `request_human` — **sempre ligada**, não tem interruptor |
| Consultar horários livres | `check_availability` |
| Marcar horário | `book_appointment` |
| Remarcar horário | `reschedule_appointment` |
| Cancelar horário | `cancel_appointment` |

Uma ferramenta desligada não fica "indisponível": ela some do catálogo do modelo, que nem chega a oferecer aquilo — e para de custar tokens em toda mensagem. A tela também explica quando a ferramenta está ausente por pré-requisito (agendamento desligado, ou conexão do Google quebrada) em vez de desligada pela conta, porque os consertos ficam em telas diferentes. Só admin pode mexer nos interruptores.

### 4. Ver e mexer no que está marcado

Menu **Agenda**.

- Alternância **Semana** / **Dia**, botões **Hoje**, **Período anterior** e **Próximo período**. A semana começa na segunda-feira.
- Os dias vêm em colunas de lista (não é uma grade de horas), ancorados na meia-noite do **fuso do negócio**, não do navegador de quem está olhando.
- Um ícone distingue **Marcado pelo agente** de **Marcado manualmente**.
- Agendamentos cancelados continuam aparecendo, riscados: são eles que explicam um buraco no dia.
- Um triângulo âmbar com **Não está na Google Agenda** marca o compromisso que foi gravado aqui mas não chegou ao Google. A equipe que trabalha olhando o Google não vai vê-lo.
- **Novo agendamento** abre o diálogo de marcação manual: busca o contato por nome ou telefone, data, hora, duração e assunto. Data e hora são interpretadas no fuso do negócio. Se o evento não for para o Google, aparece o aviso "Agendamento criado, mas não foi para a Google Agenda. Confira antes de confirmar com o cliente."
- Clicar num agendamento abre o detalhe: status, aviso de "não está na Google Agenda", motivo do cancelamento, link **Abrir conversa**, **Remarcar** (nova data e novo horário, mantendo a duração original) e **Cancelar agendamento** com motivo opcional.
- **Não existe excluir**, de propósito. Cancelar preserva o histórico.

Ver a Agenda: qualquer membro. Criar, remarcar e cancelar: papel **agent** ou acima.

### 5. Ensaiar antes de soltar no cliente

Menu **Agentes de IA** → aba **Playground**. O ensaio monta exatamente o mesmo catálogo de ferramentas da produção e roda em modo seco: as ferramentas validam tudo (regras, disponibilidade, colisão) e relatam o que **teriam** feito, sem gravar nada e sem tocar na agenda real. Exige papel **agent** ou acima e tem limite de uso por usuário.

---

## O que dá para configurar

### Na interface

| Ajuste | Onde | O que muda | Papel |
|---|---|---|---|
| Conectar / desconectar a conta Google | Configurações → Agendamento, cartão Google Agenda | Passa a ler o livre/ocupado do Google e a criar eventos lá | admin |
| Deixar o agente marcar sozinho (`is_active`) | Configurações → Agendamento | Interruptor mestre. Desligado, as quatro ferramentas somem do catálogo do modelo | admin |
| Fuso horário (`timezone`) | Configurações → Agendamento | O relógio do negócio: horários oferecidos, agendados e exibidos | admin |
| Como vocês chamam isso (`appointment_label`) | Configurações → Agendamento | A palavra que o agente usa na conversa. Até 40 caracteres; em branco grava nulo e volta ao termo genérico | admin |
| Duração (`slot_minutes`) | Configurações → Agendamento | A grade em que o dia é cortado. 1 a 480 minutos | admin |
| Antecedência mínima (`lead_time_minutes`) | Configurações → Agendamento | Nada é oferecido dentro dessa janela a partir de agora | admin |
| Agendar até quantos dias à frente (`max_advance_days`) | Configurações → Agendamento | Horizonte. 1 a 365 dias | admin |
| Horário de funcionamento (`weekly_hours`) | Configurações → Agendamento | Janelas por dia da semana. Dia sem janela = fechado | admin |
| Horários oferecidos por mensagem (`offer_slots_max`) | Agentes de IA → Regras | Quantos horários o bot nomeia de uma vez. 1 a 10 | admin |
| Dias à frente que ele procura (`lookahead_days`) | Agentes de IA → Regras | Janela padrão quando o cliente não diz data. 1 a 90 | admin |
| Vagas trazidas por consulta (`slot_fetch_limit`) | Agentes de IA → Regras | Quantas vagas vão para o modelo (custo em tokens). 3 a 60 | admin |
| Interruptor por ferramenta | Agentes de IA → Limites | Remove a ferramenta do catálogo do modelo | admin |

Ler todas essas telas: qualquer membro da conta. Salvar: admin, em todas.

### Variáveis de ambiente (quem instala o sistema)

| Variável | O que muda |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sem os dois, a integração com o Google não existe no deploy: o botão de conectar não aparece e a tela explica o que falta |
| `GOOGLE_OAUTH_REDIRECT_URI` | Precisa bater byte a byte com o registrado no Google Cloud Console. Ausente, é derivado de `NEXT_PUBLIC_SITE_URL` + `/api/google/calendar/callback` |
| `NEXT_PUBLIC_SITE_URL` | Dupla função: deriva o redirect do OAuth **e** monta o link "Conversa:" dentro da descrição do evento no Google |
| `ENCRYPTION_KEY` | Cifra o refresh token e o access token do Google (AES-256-GCM), o mesmo mecanismo dos tokens do WhatsApp. Rotacionar sem migrar torna as credenciais ilegíveis e obriga a reconectar |
| `AUTOMATION_CRON_SECRET` | Sem ele, `/api/health/cron` responde 503 e agendamentos vencidos **nunca** são aposentados — o que trava o índice "um vivo por contato" (ver Limites e pegadinhas) |
| `CRON_INTERVAL_SECONDS` (padrão 300) e `HEALTH_EVERY_TICKS` (padrão 12) | Juntos definem de quanto em quanto tempo o cron de saúde roda; 300 × 12 = 1 hora |

### Só no código (não há tela)

| Constante | Valor | Onde |
|---|---|---|
| `calendar_id` da conexão | `'primary'` | `supabase/migrations/043_google_calendar.sql:47`. Nenhuma tela ou rota escreve esse campo |
| Limite padrão de vagas quando o chamador não passa nada | 12 | `src/lib/scheduling/availability.ts:54` |
| Teto rígido de dias varridos | 400 | `src/lib/scheduling/availability.ts:56` |
| Lookahead padrão do `check_availability` | 7 dias | `src/lib/ai/tools/scheduling.ts:39` |
| Horários oferecidos quando as settings não chegam ao `describeSlots` | 3 | `src/lib/scheduling/availability.ts:160` |
| Folga antes de aposentar um compromisso vencido | 60 minutos | `src/lib/scheduling/settle.ts:37` |
| Duração máxima aceita para um slot | 8 horas | `src/lib/api/v1/appointments.ts:84` |
| Timeout das chamadas ao Google | 15 s | `src/lib/google/oauth.ts:31`; `src/lib/google/calendar.ts:19` |
| Escopos OAuth pedidos | `calendar.events`, `calendar.freebusy`, `userinfo.email` | `src/lib/google/oauth.ts:25-29` |
| Folga de expiração do access token e fallback | 60 s a menos; 3600 s | `src/lib/google/oauth.ts:228-231` |
| Palavra do título do evento sem assunto e sem rótulo | `Atendimento` | `src/lib/scheduling/event-text.ts:50` |
| Contas verificadas por execução do cron de saúde | 25 | `src/app/api/health/cron/route.ts:31` |
| Todo o texto que **o modelo** lê (descrições das ferramentas, recusas, lista de vagas) | em inglês, no código | decisão declarada em `supabase/migrations/059_agent_rules.sql:14-17` |

---

## Como funciona por dentro

### O cálculo de disponibilidade

`computeAvailableSlots` aplica quatro filtros, todos no servidor (`src/lib/scheduling/availability.ts:11-25`):

1. **Expediente** — o dia da semana é lido de `weekly_hours` com `0 = domingo` (`availability.ts:91`). As vagas nascem numa grade que começa no início de cada janela e avança de `slot_minutes` em `slot_minutes`; só entra a vaga que cabe **inteira** na janela (`start + slotMs <= windowEnd`, `availability.ts:113-117`). Um horário fora dessa grade nunca aparece como livre.
2. **Antecedência mínima** — `earliest = max(from, agora + lead_time_minutes)` (`availability.ts:62-64`).
3. **Horizonte** — o fim da janela é o menor entre o `to` pedido e `agora + max_advance_days`; se `earliest >= latest`, a lista volta vazia (`availability.ts:65-69`).
4. **Ocupado** — intervalo meio-aberto `[início, fim)`: uma vaga que termina exatamente quando um compromisso começa continua livre (`availability.ts:134-141`).

A varredura anda por dias de calendário locais, ancorada ao meio-dia UTC e relendo as partes no fuso a cada passo, para que uma virada de horário de verão não pule nem repita uma data (`availability.ts:75-89`). O teto é de 400 dias, independentemente do que for pedido (`availability.ts:56`).

O "ocupado" é a **união** de duas fontes (`src/lib/scheduling/store.ts:334-379`): os intervalos devolvidos pelo `freeBusy` do Google e as linhas de `appointments` com `status='scheduled'` que cruzam a janela. Falha ao consultar o Google é relançada como `GoogleError` e nunca engolida; falha na consulta do próprio banco é só logada e o cálculo segue (`store.ts:352-374`).

A lista devolvida ao modelo é agrupada por dia, com horas locais, e carrega junto a instrução de nomear no máximo `offer_slots_max` horários e nunca colar a lista inteira (`availability.ts:160-183`). A nota explicando a antecedência mínima só é anexada quando o corte morde **hoje** (`availability.ts:184-197`). Sem vaga nenhuma, o texto é exatamente `No free slots in that range.` (`availability.ts:161`).

Consulta de livre/ocupado, e não listagem de eventos: não é preciso saber **o que** está marcado, só que algo está — uma chamada para toda a faixa, sem vazar o conteúdo da agenda da loja nos logs (`src/lib/google/calendar.ts:11-16`). A resposta é lida pela primeira entrada de `calendars`, seja qual for a chave, porque o Google indexa pelo id que resolveu — que para `'primary'` é o endereço real da conta (`calendar.ts:103-107`). Intervalos com data inválida são descartados em vez de virarem `NaN` (`calendar.ts:112-114`).

### O portão: quando o agente tem as ferramentas

`resolveSchedulingContext` (`src/lib/ai/tools/registry.ts:44-77`):

- `is_active` falso → devolve `null`, e as ferramentas nem entram no catálogo (`registry.ts:47-48`).
- Sem conexão Google → devolve contexto **com** `connection: null`. As marcações continuam sendo gravadas em `appointments` e a disponibilidade sai só das linhas próprias (`registry.ts:50-56`).
- Conexão existente mas inutilizável (token revogado, `ENCRYPTION_KEY` trocada) → registra um evento de plataforma com severidade `error` e devolve `null`: as ferramentas **saem** do catálogo (`registry.ts:57-76`).

`request_human` está sempre no catálogo e não pode ser desligada nem por linha em `ai_disabled_tools` nem pela rota `PATCH` (`registry.ts:86,155-157`). Ferramenta desligada é **removida** do catálogo, não sinalizada (`registry.ts:150-157`). Se a lista de desligadas não puder ser lida, o código **falha aberto** e trata como se nada estivesse desligado (`registry.ts:104-110`).

### As quatro ferramentas

São exatamente quatro: `check_availability`, `book_appointment`, `reschedule_appointment`, `cancel_appointment` (`src/lib/ai/tools/scheduling.ts:49-54`).

- `check_availability` passa `settings.slotFetchLimit` como limite (`scheduling.ts:113`) e, quando o cliente não diz data, `date_to` vira `date_from + lookahead_days` (`scheduling.ts:88-93`). As datas só aceitam `YYYY-MM-DD`, e `date_to` é interpretado como a meia-noite do dia seguinte — o dia nomeado entra inteiro (`scheduling.ts:527-545`).
- `reschedule_appointment` e `cancel_appointment` **não recebem id**: o cliente tem no máximo um compromisso vivo, então o modelo nunca vê um UUID e não consegue inventar um para cancelar o horário de um estranho (`scheduling.ts:29-33`). O "compromisso vivo" é a primeira linha `status='scheduled'` daquele contato, por `starts_at` ascendente, limite 1 (`scheduling.ts:377-386`).
- Antes de gravar, `book` e `reschedule` revalidam chamando o próprio `computeAvailableSlots` com limite 1 e exigindo casamento exato de início **e** fim — o que apanha os quatro filtros de uma vez (`scheduling.ts:452-464`). Numa remarcação, o intervalo do próprio agendamento é retirado da lista de ocupados, senão "mesmo dia, uma hora depois" seria impossível sempre que os dois se sobrepusessem (`scheduling.ts:445-449`).
- `book_appointment` exige contato anexado à conversa, exceto em modo seco (`scheduling.ts:157-162`). O título vindo do modelo é cortado em 200 caracteres e o motivo de cancelamento em 500 (`scheduling.ts:194,347`).
- Qualquer falha ao ler a agenda devolve erro com `handoff=true` e a instrução de não oferecer nem confirmar horário nenhum (`scheduling.ts:501-521`); quando o Google diz que o acesso acabou (`not_authorized` / `invalid_grant` / `credentials_unreadable`), a mensagem vira "The business calendar is no longer connected" (`scheduling.ts:506-517`).

Quando um horário é recusado, o servidor diz **qual** regra o derrubou, na ordem `too_soon → too_far → taken → outside_hours`, da razão mais acionável para a menos (`src/lib/scheduling/refusal.ts:52-66`). A recusa por antecedência devolve a hora mais cedo possível hoje e manda dizer em palavras claras que é a regra de antecedência, não conflito de agenda (`refusal.ts:102-115`). "Fora do expediente" exige que início e fim caibam dentro de **uma mesma** janela do dia: um compromisso que atravessa o intervalo do almoço é recusado (`refusal.ts:69-87`).

### A ordem de escrita

`src/lib/scheduling/store.ts` é a **única** implementação de marcar/remarcar/cancelar, usada tanto pelo agente quanto pela tela.

- **Nossa linha primeiro, Google depois** (`store.ts:21-28`): são os índices únicos do banco que tornam a concorrência segura, e escrever no Google antes deixaria evento órfão na agenda da loja.
- `INSERT` com erro 23505 citando `one_live_per_contact` vira `already_booked` (com a orientação de remarcar o existente); qualquer outro 23505 vira `slot_taken` (`store.ts:95-111`).
- Se o evento no Google falhar **depois** da linha gravada, a marcação fica com `google_event_id` nulo e a função devolve `ok:true` com `calendarSynced:false` — estado visível, não rejeitado (`store.ts:198-204`). Nesse caso o agente **não confirma** ao cliente: a ferramenta devolve `isError:true` e `handoff:true` (`scheduling.ts:204-215`).
- Remarcar grava `status='scheduled'` junto com os novos horários (`store.ts:229-233`) e envia ao Google **só** o horário, sem `summary`/`description`, porque mandar o título reescrevia o evento apagando o nome do cliente (`store.ts:251-259`).
- Cancelar **apaga** o evento no Google em vez de marcá-lo como cancelado: a loja trabalha olhando aquela agenda (`store.ts:306-312`). Um 404 do Google ao apagar é tratado como sucesso (`src/lib/google/calendar.ts:194-212`).
- Os dados do contato para o evento (nome, telefone, e-mail, empresa) são buscados dentro do store, não exigidos de quem chama, para que os dois caminhos de marcação produzam eventos igualmente ricos; a busca é best-effort (`store.ts:164-181,395-430`).

O texto do evento (`src/lib/scheduling/event-text.ts`): título `assunto — nome`, com o assunto na frente porque na grade da semana o texto é cortado por largura; sem assunto usa o `appointment_label`; sem os dois, `Atendimento` (`event-text.ts:44-53`). A descrição é texto puro, sem HTML, porque o subconjunto aceito pelo Google varia entre web, Android e iOS (`event-text.ts:19-22`), e tem blocos separados por linha em branco: quem é o cliente, `Pedido:`, `Observações:`, o link da conversa e o rodapé de origem (`event-text.ts:65-88`). O rodapé distingue "Marcado pelo agente de IA, a partir da conversa no WhatsApp." de "Marcado manualmente pela equipe."; se for o único bloco, a descrição volta indefinida (`event-text.ts:84-93`). O evento é criado mandando o `timeZone` junto do `dateTime` (`calendar.ts:117-144`).

### OAuth do Google

Escrito à mão com `fetch` (`src/lib/google/oauth.ts`).

- Escopos: exatamente `calendar.events`, `calendar.freebusy` e `userinfo.email`. O escopo amplo `calendar` é deliberadamente evitado (`oauth.ts:25-29`).
- A URL de consentimento leva `access_type=offline` **e** `prompt=consent`; sem o prompt explícito o Google só devolve refresh token na primeira autorização, e quem reconectasse depois de desconectar ficaria com uma conexão que morre em uma hora (`oauth.ts:77-97`).
- O redirect URI é configuração e nunca derivado da requisição: o header `Host` de um atacante não pode moldá-lo (`oauth.ts:51-70`).
- Se o Google não devolver refresh token, o código recusa gravar meia conexão e instrui a remover o iMasterChat das permissões da conta Google e conectar de novo (`oauth.ts:163-171`).
- `invalid_grant` é nomeado à parte, com status 401: significa refresh token revogado; o conserto é reconectar, não repetir (`oauth.ts:128-137`).
- A validade do access token é gravada com um minuto a menos que o informado pelo Google, com 3600 s de fallback (`oauth.ts:223-231`).
- O e-mail da conta Google é cosmético: se a busca falhar, a conexão é gravada mesmo assim (`oauth.ts:207-221`).

`src/lib/google/connection.ts`: o access token é reaproveitado do cache enquanto a validade gravada for futura; só então há um refresh, cujo resultado é gravado criptografado (`connection.ts:105-130`). Gravar o cache é best-effort (`connection.ts:119-130`). Um cache que não descriptografa não é fatal — devolve nulo e um token novo é gerado (`connection.ts:142-153`). Um **refresh token** que não descriptografa é fatal e barulhento: loga o `account_id` e lança `GoogleError` com code `credentials_unreadable` (`connection.ts:90-103`). `loadGoogleConnection` devolve nulo, e não erro, quando não há conexão ou quando o deploy não tem credenciais OAuth (`connection.ts:61-76`).

O fluxo é protegido por cookie httpOnly de state com 32 bytes aleatórios, `sameSite lax`, path `/api/google/calendar` e validade de 10 minutos; o state **não** carrega `account_id` — a conta vem da sessão (`src/app/api/google/calendar/connect/route.ts:11-17,38-46`). O callback consome (apaga) o cookie aconteça o que acontecer, antes de qualquer validação (`callback/route.ts:38-40`), recusa quando não há cookie ou o state não bate (`callback/route.ts:60-62`), e nunca devolve JSON: sempre redireciona para `/settings?tab=scheduling` com o resultado em `?google=` — `connected`, `state_mismatch`, `not_configured`, `store_failed`, `invalid_response`, `no_refresh_token`, `invalid_grant`, ou o erro que o Google mandou (`callback/route.ts:18-33,49,55,61,66,90,93,97`). Reconectar faz upsert por `account_id`: as credenciais são trocadas no lugar, e `calendar_id` e os `appointments` que já apontam para eventos continuam válidos (`callback/route.ts:72-86`).

### Marcação manual e API pública

A marcação manual pela tela (rota de sessão) valida o slot com `parseSlot` mas **não** passa por `computeAvailableSlots` (`src/app/api/appointments/route.ts:97-101`): o atendente vê a agenda e pode ter motivo para marcar fora do horário; quem barra o duplo agendamento é o banco. Se o Google estiver inutilizável, a marcação segue com `connection = null` e o evento simplesmente não é criado (`route.ts:102-108`).

Todo caminho de escrita valida o slot pela mesma função `parseSlot`: ISO 8601 válidos, fim depois do início, duração máxima de 8 horas e início não pode estar no passado (`src/lib/api/v1/appointments.ts:97-123`). O teto de 8 horas existe para pegar o erro que um agente autônomo realmente comete — mistura de unidades (`v1/appointments.ts:82-84`).

As rotas `/api/v1` usam cliente **service role** (`supabaseAdmin`) e portanto passam por cima da RLS; o isolamento por conta é feito manualmente com `.eq('account_id', ctx.accountId)` em cada consulta (`src/lib/auth/api-context.ts:110-117`). O `POST /api/v1/appointments` insere **direto** na tabela: não chama o store, não cria evento no Google e não checa disponibilidade (`src/app/api/v1/appointments/route.ts:5-9,151-180`); confere que o `contact_id` pertence à conta antes de inserir (`route.ts:118-132`) e traduz os três índices únicos em 409 distintos (`route.ts:182-205`).

O caminho de auto-reply também roda com cliente service role — as ferramentas não podem supor que exista `auth.uid()` (`src/lib/ai/auto-reply.ts:62`; `src/lib/ai/tools/types.ts:15-17`). Cada execução de ferramenta é gravada em `ai_agent_steps` com os argumentos escolhidos pelo modelo e o texto devolvido; é best-effort e nunca quebra a resposta ao cliente (`src/lib/ai/steps.ts:5-13,28-40`).

### A aposentadoria dos compromissos vencidos

`settlePastAppointments` vira `completed` o que já passou, com 60 minutos de folga (`src/lib/scheduling/settle.ts:22-27,37,55-61`). É `completed` e não `no_show` porque "veio ou não veio" só a equipe sabe. Sem essa varredura, o primeiro agendamento de um cliente vira permanente: o índice "um vivo por contato" recusa qualquer marcação futura e o bot responde "você já tem um agendamento" sobre um compromisso da semana passada (`settle.ts:11-21`). Não dá para resolver no índice porque `now()` não é imutável. A função nunca lança (`settle.ts:66-71`).

Quem chama é `GET /api/health/cron`, **antes** das verificações de saúde, e o total sai no JSON como `appointments_settled` (`src/app/api/health/cron/route.ts:50-55,116`).

### Fuso horário

`src/lib/time/zone.ts` faz a matemática sem biblioteca. A conversão de hora de parede para instante faz **duas passadas**, relendo o offset no instante candidato, porque numa virada de horário de verão uma passada só erra por uma hora (`zone.ts:78-99`). O índice de dia da semana usado em todo o subsistema é `0 = domingo`, batendo com `getDay()` do JS e com as chaves de `weekly_hours` (`zone.ts:22-34`).

### O que vai para o prompt

`src/lib/ai/environment.ts` informa a data e a hora atuais no fuso do negócio e proíbe explicitamente adivinhar a data (`environment.ts:105-108`). O expediente é declarado como **fato** (`describeWeeklyHours`, `src/lib/scheduling/settings.ts:148-155`) para o modelo não oferecer sábado e ser recusado depois — uma recusa custa uma ida ao provedor e soa ao cliente como o bot mudando de ideia; a frase termina informando duração, antecedência mínima e horizonte (`settings.ts:172`). Se o cliente já tem compromisso futuro `scheduled`, o prompt recebe "This customer already has X booked for ..." com a ordem de remarcar em vez de criar um segundo (`environment.ts:176-186`); essa consulta é escopada a `status='scheduled'` **e** `starts_at >= agora`, de propósito (`environment.ts:212-232`).

O `appointment_label` é saneado antes de virar contexto: caracteres de controle e quebras de linha viram espaço, espaços são colapsados, o texto é cortado em 40 caracteres e vazio vira nulo — porque um campo que aceita parágrafo é porta lateral para instrução disfarçada de configuração (`src/lib/scheduling/label.ts:17-38`). Quando existe, o prompt recebe a frase mandando usar aquela palavra exata, entre aspas, sem traduzir (`label.ts:48-55`), e essa linha entra cedo no bloco de ambiente, antes dos fatos do cliente (`environment.ts:114-118`).

### Leitura das regras

`loadSchedulingSettings` devolve nulo quando a conta não tem linha — significa "não está configurado", não "está quebrado"; um erro de consulta também vira nulo, apenas logado (`settings.ts:59-77`). Um `timezone` vazio ou só com espaços cai para `America/Sao_Paulo` (`settings.ts:80`). `weekly_hours` malformado é **descartado** em vez de lançar erro: janela que não é par, hora que não parseia e janela cujo fim é menor ou igual ao início (que atravessaria a meia-noite) somem, e o dia aparece fechado (`settings.ts:93-133`); chaves fora de 0..6 e valores que não são array são ignorados, e as janelas de cada dia são ordenadas por hora de início (`settings.ts:106-132`).

### Saúde

A verificação `google_calendar` chama `loadGoogleConnection`: chegar ao fim já é a prova de que há token utilizável. Sem conexão, o status é `skipped` (não é falha); com `invalid_grant`, a mensagem manda reconectar em Configurações → Agendamento (`src/lib/observability/health.ts:192-221`). O resultado vai para `account_health`, que **só o administrador de plataforma** lê.

---

## Limites e pegadinhas

**O link "Conversa:" dentro do evento do Google não abre a conversa.** A descrição do evento monta `{siteUrl}/inbox?conversation={id}` (`src/lib/scheduling/event-text.ts:79-82`), mas a tela de Caixa de entrada lê o parâmetro `c` (`src/app/(dashboard)/inbox/page.tsx:44`). Clicar no link abre a caixa de entrada sem selecionar a conversa. Não instrua o cliente a "clicar no link do evento para ver a conversa".

**"Conectado" na tela não significa "funcionando".** O status responde olhando apenas se **existe linha** de conexão, não se o token vale (`src/app/api/google/calendar/status/route.ts:48`). Um refresh token revogado (o operador removeu o acesso na conta Google, ou trocou a senha) deixa a tela dizendo "conectado" enquanto as ferramentas de agendamento saem silenciosamente do catálogo do agente — o bot passa a se comportar como se nunca tivesse sabido agendar. Quem detecta isso é a verificação de saúde `google_calendar`, e ela só é visível para o administrador da plataforma, não para o dono da conta.

**Sem o cron, a agenda entope.** Se `AUTOMATION_CRON_SECRET` não estiver configurado, `/api/health/cron` responde 503, `settlePastAppointments` nunca roda e o índice "um vivo por contato" nunca é liberado: a partir do primeiro agendamento de cada cliente, o bot passa a responder que ele "já tem um agendamento" — sobre um compromisso que já passou. Este é o sintoma mais provável de uma instalação sem o sidecar de cron ativo. **Não foi verificado** se o sidecar do `deploy/docker-compose.app.yml` está de fato rodando nas instalações reais.

**Remarcar um agendamento cancelado o ressuscita.** A remarcação grava `status='scheduled'` junto com os novos horários (`src/lib/scheduling/store.ts:229-233`). Não há confirmação nem aviso na tela sobre isso.

**A marcação manual não respeita o expediente nem a antecedência** — de propósito. O que ela respeita são as travas do banco: um horário já ocupado e "um compromisso vivo por contato". Se o contato já tem um compromisso marcado, criar outro pela tela falha com conflito; a saída é remarcar o existente.

**Não existe excluir agendamento.** Nem na tela, nem na API pública. Só cancelar. É deliberado.

**Um agendamento pode existir aqui e não existir no Google.** Quando o evento falha depois da linha gravada, ele fica com o triângulo âmbar "Não está na Google Agenda" na tela de Agenda — mas a equipe que trabalha olhando o Google não vai vê-lo em lugar nenhum. Quando isso acontece numa marcação feita pelo agente, o agente **não confirma** ao cliente e chama uma pessoa.

**Desconectar o Google não limpa nada.** Os eventos já criados continuam existindo no calendário e os `appointments` mantêm o `google_event_id`. Reconectar reaproveita esses vínculos. Não existe tela para "apagar tudo do Google".

**Não dá para escolher qual calendário usar.** O campo `calendar_id` nasce como `'primary'` e **nenhuma rota ou tela o escreve** — o upsert do callback do OAuth não o inclui (`src/app/api/google/calendar/callback/route.ts:75-86`). Trocar de calendário exige alterar a linha direto no banco. (O mapa registra que a varredura por gravações desse campo não cobriu diretórios fora de `src/`.)

**A etiqueta "conecte a Google Agenda" na tela de ferramentas é praticamente inalcançável.** A rota `/api/ai/tools` pode devolver `requirement: 'google_disconnected'`, mas isso exigiria que o agendamento estivesse ativo, sem conexão, **e** as ferramentas fora do catálogo — e a ausência de conexão não tira as ferramentas do catálogo (`src/lib/ai/tools/registry.ts:50-56`; `src/app/api/ai/tools/route.ts:98-107`). Na prática, uma conta com agendamento ligado e sem Google recebe as ferramentas normalmente e o bot marca usando só as próprias linhas.

**Se a lista de ferramentas desligadas não puder ser lida, todas voltam ligadas.** O código falha aberto de propósito (`registry.ts:104-110`). Um problema de banco pode, por alguns minutos, devolver ao bot uma ferramenta que a conta havia desligado — inclusive `cancel_appointment`.

**Duração que não divide a janela deixa sobra.** A grade avança de `slot_minutes` a partir do início de cada janela e só aceita a vaga que cabe inteira (`src/lib/scheduling/availability.ts:113-117`). Numa janela 09:00–12:00 com duração de 50 minutos, o final da janela fica sem vaga. Esse caso específico **não foi executado nem testado** — é leitura do código.

**Um compromisso não pode atravessar o intervalo do almoço.** Início e fim precisam caber dentro da **mesma** janela do dia (`src/lib/scheduling/refusal.ts:69-87`).

**A semana da tela de Agenda começa na segunda, o editor de expediente começa no domingo.** O editor segue o `getDay()` do JS, a tela segue a semana da loja (`src/components/agenda/agenda-board.tsx:85-88`).

**A tela de Agenda traz no máximo 500 agendamentos por consulta**, sem paginação e sem aviso de truncamento (`src/app/api/appointments/route.ts:40`). O mapa registra que o cenário de uma faixa grande o bastante para estourar esse limite não foi testado.

**A API pública `/api/v1/appointments` não é um atalho para agendar.** Ela grava o registro no CRM e mais nada: não checa disponibilidade, não cria evento no Google e não chama o store. Quem integra por ali é responsável por ter conferido o calendário e criado o evento antes.

**Todo o texto que o modelo lê está em inglês.** Descrições das ferramentas, mensagens de recusa e a lista de horários. Isso não vaza para o cliente (o modelo responde no idioma da conversa), mas quem for depurar `ai_agent_steps` vai ler inglês.

**As políticas de UPDATE de `ai_scheduling_settings` e `google_calendar_connections` têm apenas `USING`, sem `WITH CHECK`** (`043_google_calendar.sql:73-74,148-149`). Registrado aqui como fato de implementação.

**O `PATCH /api/scheduling/settings` nunca cria linha:** conta que nunca passou pela tela de Configurações → Agendamento recebe 409 com code `not_configured`. É por isso que a tela de Regras avisa para abrir Agendamento primeiro.

**O `PUT /api/scheduling/settings` grava o formulário inteiro:** qualquer campo ausente do corpo volta ao padrão (60 min de duração, 120 de antecedência, 30 dias de horizonte, lookahead 7, fetch 12, oferta 3). Só a tela de Configurações → Agendamento usa esse verbo; a tela de Regras usa `PATCH` justamente para não apagar o que a outra gravou.

### O que este documento não sabe

- Os passos no Google Cloud Console (ativar a Calendar API, tela de consentimento, publicação/verificação do app, usuários de teste) **não estão no código** e não foram verificados. Um tutorial de cliente vai precisar dessa informação de fora deste repositório.
- Não foi encontrado nenhum caminho de tela que grave o status `no_show`. A API pública aceita o valor (`src/app/api/v1/appointments/[id]/route.ts:89-94`), mas a varredura das telas por esse valor não foi exaustiva.
- Não foi verificado se algo limpa ou arquiva `ai_agent_steps`.
- Não foi aberta a função `is_platform_admin()` usada na RLS de `account_health`; só a política que a invoca.

---

## Referência

### Tabelas

| Tabela | O que guarda | Migração de origem |
|---|---|---|
| `appointments` | O registro da marcação: contato, conversa, início/fim, status, título, notas, id do evento no Google, origem (`manual`/`n8n`/`native`), motivo do cancelamento | `041_appointments.sql`; `043_google_calendar.sql:168-169` (`cancellation_reason`) |
| `ai_scheduling_settings` | As regras por conta: fuso, duração, antecedência, horizonte, expediente semanal, `is_active`, termo do negócio e os três números do agente | `043_google_calendar.sql:89-159`; `054_appointment_label.sql`; `059_agent_rules.sql:49-81` |
| `google_calendar_connections` | A credencial OAuth, uma por conta: refresh token cifrado, access token cacheado com validade, `calendar_id`, e-mail Google, escopo, quem conectou | `043_google_calendar.sql:30-84` |
| `ai_disabled_tools` | Lista de **negação**: quais ferramentas do agente estão desligadas naquela conta. PK `(account_id, tool_name)` | `049_ai_tool_toggles.sql` |
| `ai_agent_steps` | Trilha de auditoria de cada chamada de ferramenta: nome, argumentos, resultado, erro, duração | `042_ai_agent_tools.sql:23-66` (intenção declarada em `042:4-13`) |
| `account_health` | Resultado das verificações periódicas, incluindo `google_calendar` com status `ok` / `failing` / `skipped` | `053_account_health.sql` |

Detalhes que importam:

- `appointments` tem três índices **únicos parciais**: um por horário (`account_id, starts_at` onde `status='scheduled'`, `041:74-76`), um vivo por contato (`contact_id` onde `status='scheduled'`, `041:81-83`) e um por evento do Google (`google_event_id` quando não nulo, `041:87-89`). Mais o CHECK `ends_at > starts_at` (`041:61`).
- `google_event_id` é anulável **de propósito**: uma marcação cujo evento no Google falhou continua visível (`041:18-20,49`).
- `weekly_hours` é jsonb com chaves `'0'`..`'6'` (0 = domingo, igual ao `getDay()` do JS) e valores como lista de pares `[início, fim]` em `'HH:MM'`. Chave ausente ou lista vazia = dia fechado. O padrão é segunda a sexta, 09:00–12:00 e 14:00–18:00 (`043:111-126`).
- Faixas dos CHECK: `slot_minutes` 1–480, `lead_time_minutes` ≥ 0, `max_advance_days` 1–365, `appointment_label` nulo ou 1–40 caracteres, `lookahead_days` 1–90, `slot_fetch_limit` 3–60, `offer_slots_max` 1–10.
- `ai_disabled_tools.tool_name` é texto livre, **não** é chave estrangeira (`049:27-29`), e a tabela não tem política de UPDATE: o fluxo é inserir/apagar.
- `ai_agent_steps` tem política apenas de SELECT; a escrita vem do cliente service role do caminho de auto-reply (`042:64-66`).
- Os GRANTs amplos para `anon`/`authenticated`/`service_role` foram restaurados pela migração 044 (`044:40,43-45`, com `ALTER DEFAULT PRIVILEGES` em `044:49-50`); a justificativa de que a RLS é a fronteira está em `044:33-35`.

**RLS, por tabela** (a hierarquia owner > admin > agent > viewer está em `is_account_member`, `017_account_sharing.sql:136-164`):

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `appointments` | qualquer membro | agent+ | agent+ | admin+ |
| `ai_scheduling_settings` | qualquer membro | admin+ | admin+ (só `USING`) | admin+ |
| `google_calendar_connections` | qualquer membro | admin+ | admin+ (só `USING`) | admin+ |
| `ai_disabled_tools` | qualquer membro | admin+ | (não existe) | admin+ |
| `ai_agent_steps` | qualquer membro | (não existe) | (não existe) | (não existe) |
| `account_health` | só administrador de plataforma (`FOR ALL`, `053:95-97`) | idem | idem | idem |

### Rotas

| Método e caminho | Quem pode chamar | O que faz |
|---|---|---|
| `GET /api/google/calendar/connect` | sessão + **admin** (`route.ts:24`) | Inicia o consentimento OAuth: gera state de 32 bytes, grava o cookie httpOnly `imasterchat_google_oauth_state` (path `/api/google/calendar`, 600 s) e redireciona ao Google. 400 com code `google_not_configured` se faltarem as credenciais |
| `GET /api/google/calendar/callback` | sessão + **admin** (`route.ts:43`) + conferência do state (`60-62`) | Troca o código por tokens, busca o e-mail e faz upsert em `google_calendar_connections` por `account_id`, com os tokens cifrados. Sempre redireciona para `/settings?tab=scheduling` com `?google=<resultado>` |
| `GET /api/google/calendar/status` | sessão, qualquer membro (`route.ts:27`) | `{ available, connected, calendar_id, google_email, connected_at }`. Nunca devolve token. `connected` é apenas "existe linha" (`route.ts:48`); `available` é "o deploy tem credenciais OAuth" (`44-47`) |
| `DELETE /api/google/calendar/status` | sessão + **admin** (`route.ts:60`) | Apaga a linha de conexão. Não mexe nos `google_event_id` dos agendamentos (`75-78`) |
| `GET /api/scheduling/settings` | sessão, qualquer membro (`route.ts:47`) | Lê as regras. Conta sem linha recebe os padrões com `configured: false` |
| `PUT /api/scheduling/settings` | sessão + **admin** (`route.ts:95`) | Grava o formulário inteiro por upsert. Valida o fuso com `Intl.DateTimeFormat` (400, code `invalid_timezone`), passa `weekly_hours` por parse/serialize e saneia o `appointment_label` |
| `PATCH /api/scheduling/settings` | sessão + **admin** (`route.ts:170`) | Atualização parcial de `lookahead_days`, `slot_fetch_limit`, `offer_slots_max` e `appointment_label`. Usa `update`, não upsert: sem linha, 409 code `not_configured` |
| `GET /api/appointments` | sessão, qualquer membro (`route.ts:32`) | Lista para a tela de Agenda: filtro `?from=&to=` sobre `starts_at`, ordem crescente, limite 500, join com `contacts(name, phone)`, devolve também o fuso das regras |
| `POST /api/appointments` | sessão + **agent** (`route.ts:69`) | Marcação manual. Valida o slot, **não** checa disponibilidade, grava por `bookAppointment` com `created_via='manual'`. 409 em `slot_taken`/`already_booked`; 201 com `{ appointment, calendar_synced }` |
| `PATCH /api/appointments/{id}` | sessão + **agent** (`route.ts:26`) | Remarca ou cancela. `status: 'cancelled'` → cancela com motivo cortado em 500 caracteres; caso contrário exige `starts_at`/`ends_at` válidos. 404 e 409 conforme o caso. **Não existe DELETE** |
| `GET /api/v1/appointments` | API key com escopo `appointments:read` (`route.ts:38`); service role | Lista pública paginada por keyset, com `?contact_id=`, `?status=`, `?from=`, `?to=` |
| `POST /api/v1/appointments` | API key com escopo `appointments:write` (`route.ts:101`); service role | Insere direto na tabela: sem Google, sem checagem de disponibilidade. Confere que `contact_id` e `conversation_id` são da conta. `created_via` vira `n8n` salvo se o corpo pedir `native`. Traduz os três índices únicos em 409 distintos |
| `GET /api/v1/appointments/{id}` | API key com escopo `appointments:read` (`route.ts:32`); service role | Lê um agendamento da conta; 404 quando não existe |
| `PATCH /api/v1/appointments/{id}` | API key com escopo `appointments:write` (`route.ts:59`); service role | Remarca (`starts_at` e `ends_at` obrigatoriamente juntos), muda status, `title`, `notes`, `google_event_id`. Update direto: não toca no Google. Sem DELETE |
| `GET /api/ai/tools` | sessão, qualquer membro (`route.ts:48`) | Lista todas as ferramentas que o build conhece, se estão no catálogo agora e por quê não. Distingue `blocked_by` `prerequisite` de `disabled` e devolve `requirement` `scheduling_off` \| `google_disconnected` \| `calendar_unusable` |
| `PATCH /api/ai/tools` | sessão + **admin** (`route.ts:119`) | Liga/desliga uma ferramenta escrevendo ou apagando linha em `ai_disabled_tools`. Recusa qualquer tentativa sobre `request_human` com code `always_on` |
| `GET /api/health/cron` | header `x-cron-secret` comparado com `timingSafeEqual` a `AUTOMATION_CRON_SECRET`; 503 sem segredo configurado, 401 se não bater (`route.ts:34-46`); service role | Roda `settlePastAppointments` **antes** de tudo, depois `checkAccount` em até 25 contas por execução — incluindo a verificação `google_calendar`. Devolve `appointments_settled` |
| `POST /api/ai/playground` | sessão + **agent** (`route.ts:37`) + limite de uso por usuário (`39-40`) | Ensaio. Monta o mesmo catálogo da produção (`117-125`) e roda com `dryRun = true` (`142`): as ferramentas validam tudo e relatam o que fariam, sem escrever |

Escopos da API pública: `appointments:read` = "List and read appointments"; `appointments:write` = "Create, reschedule and cancel appointments" (`src/lib/api-keys/scopes.ts:39-40`).

### Telas

| No menu | Rota | Arquivo |
|---|---|---|
| **Agenda** | `/agenda` | `src/app/(dashboard)/agenda/page.tsx` |
| Agenda — quadro semana/dia | `/agenda` | `src/components/agenda/agenda-board.tsx` |
| Agenda — diálogo "Novo agendamento" | `/agenda` | `src/components/agenda/new-appointment-dialog.tsx` |
| Agenda — detalhe do agendamento (remarcar / cancelar) | `/agenda` | `src/components/agenda/appointment-detail.tsx` |
| **Configurações** → **Agendamento** | `/settings?tab=scheduling` | `src/components/settings/scheduling-settings.tsx` |
| Registro da seção Agendamento (grupo "Espaço de trabalho", ícone `CalendarClock`) | `/settings` | `src/components/settings/settings-sections.ts:35,67` |
| **Agentes de IA** → **Regras** → seção Agendamento | `/agents` | `src/components/agents/ai-rules.tsx:339-341` |
| **Agentes de IA** → **Limites** → "O que o agente pode fazer" | `/agents` | `src/components/agents/ai-tools.tsx`, renderizado em `src/components/agents/ai-guardrails.tsx:161` |
| **Agentes de IA** → **Contexto** (fatia `scheduling_settings`) | `/agents` | `src/components/agents/ai-context.tsx:30,56`; conteúdo em `src/lib/ai/context-preview.ts:87-124` |
| **Administração** → faixa de saúde ("Google Agenda") | `/admin` | `src/app/admin/health-strip.tsx:40` — só administrador de plataforma |

### Arquivos principais

| Arquivo | Papel |
|---|---|
| `src/lib/scheduling/availability.ts` | `computeAvailableSlots` (os quatro filtros) e `describeSlots` (como a lista chega ao modelo) |
| `src/lib/scheduling/settings.ts` | `loadSchedulingSettings`, `parseWeeklyHours`, `serializeWeeklyHours`, `describeWeeklyHours`; `DEFAULT_TIMEZONE = 'America/Sao_Paulo'` |
| `src/lib/scheduling/store.ts` | A única implementação de marcar/remarcar/cancelar; `loadBusyIntervals`; `describeAppointment` |
| `src/lib/scheduling/event-text.ts` | `buildEventSummary` e `buildEventDescription` — título e corpo do evento no Google |
| `src/lib/scheduling/refusal.ts` | `classifyRefusal` / `describeRefusal` — qual regra derrubou o horário |
| `src/lib/scheduling/label.ts` | `sanitizeAppointmentLabel` e `describeAppointmentLabel` |
| `src/lib/scheduling/settle.ts` | `settlePastAppointments` |
| `src/lib/google/oauth.ts` | Escopos, URL de consentimento, `exchangeCode`, `refreshAccessToken`, `fetchGoogleEmail`, `GoogleError` |
| `src/lib/google/connection.ts` | `loadGoogleConnection` (descriptografa, cacheia e renova) e `hasGoogleConnection` |
| `src/lib/google/calendar.ts` | Calendar API v3: `queryFreeBusy`, `insertEvent`, `patchEvent`, `deleteEvent` |
| `src/lib/ai/tools/scheduling.ts` | As quatro ferramentas do agente, a revalidação e o parsing de datas no fuso do negócio |
| `src/lib/ai/tools/registry.ts` | `resolveSchedulingContext` (o portão) e `buildToolCatalog` |
| `src/lib/api/v1/appointments.ts` | `parseSlot` / `SLOT_ERROR_MESSAGE`, serialização e escopos da API pública |
| `src/lib/time/zone.ts` | Matemática de fuso sem biblioteca |
| `src/lib/ai/environment.ts` | Bloco de ambiente do prompt (data/hora, expediente, termo do negócio, compromisso vivo do cliente) |
| `src/lib/observability/health.ts` | `checkGoogle` |
| `src/lib/whatsapp/encryption.ts` | AES-256-GCM com `ENCRYPTION_KEY`, o mesmo mecanismo dos tokens do Google |
| `deploy/docker-compose.app.yml` | O sidecar `cron` que chama `/api/health/cron` |

> `docs/agendamento-google-calendar.md` é um documento de **planejamento**, anterior à implementação (afirma que a IA não tem tool calling e que não existe tabela de agendamentos). Serve para entender as decisões de produto, não para descrever o comportamento atual.
