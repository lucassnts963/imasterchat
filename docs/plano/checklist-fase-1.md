# Checklist de teste — fase 1 (paridade e conexão entre os motores)

Companheiro de [`01-fase-1-paridade.md`](./01-fase-1-paridade.md). Cada
requisito entregue vira um bloco aqui **no mesmo commit**, para o teste nunca
ficar para depois.

Mesma legenda do [checklist de produção](../checklist-producao.md):

| Marcador | Significa |
|---|---|
| ⚡ | Entra no smoke test — o mínimo para dizer que a ponte não quebrou |
| 🔴 | **Manda mensagem de verdade** para o contato de teste |
| 🌐 | Depende de terceiro (Meta, Google) — falha aqui pode não ser bug nosso |
| ❓ | Não observado funcionando; o esperado vem da leitura do código |

**Preparação** — a mesma do checklist de produção, mais:

- [ ] Um **fluxo ativo com gatilho `manual`** na conta de teste, com pelo menos
      um nó que fale (`send_message` ou `send_buttons`). Chame-o de `PONTE`.
- [ ] Um **fluxo ativo com gatilho de palavra-chave**, chame-o de `PALAVRA`.
      Ele existe para provar que o agente **não** consegue iniciá-lo.
- [ ] Uma **etiqueta** chamada `ponte-teste`.

---

## Bloco A — a ponte (R-1, R-2)

### A.1 · Automação inicia fluxo

- [ ] **⚡ 🔴 O passo existe e aparece na tela**
  **Fazer:** `/automations/new` → adicionar passo → **Iniciar fluxo**.
  **Esperar:** o seletor lista os fluxos **ativos** da conta, e abaixo dele o
  aviso de que só um fluxo roda por contato de cada vez.
  **Não pode:** listar fluxo em rascunho ou arquivado — `startFlowRun` recusaria
  no disparo, e oferecer na tela seria construir uma automação que sempre falha.

- [ ] **⚡ 🔴 A ponte funciona**
  **Fazer:** automação com gatilho `tag_added` na etiqueta `ponte-teste`, um
  único passo **Iniciar fluxo → PONTE**. Ativar. Aplicar a etiqueta ao contato
  de teste pela tela de contatos.
  **Esperar:** o celular recebe a primeira mensagem do fluxo `PONTE` em segundos.
  Em `/flows/[id]/runs`, um run novo com o evento `started`.
  **Onde olhar se falhar:** `automation_logs` da execução — o detalhe do passo
  diz o motivo em uma frase.

- [ ] **O run sabe quem o iniciou**
  **Fazer:** abrir o run do teste anterior em `/flows/[id]/runs`.
  **Esperar:** o evento `started` traz `started_by: "automation"`.
  **Por que importa:** é o único lugar onde alguém consegue responder depois
  "por que este cliente recebeu um menu?".

- [ ] **⚡ Cliente já em fluxo não recebe outro**
  **Fazer:** com o contato **no meio** do fluxo `PONTE` (esperando resposta),
  aplicar a etiqueta de novo (remover e recolocar).
  **Esperar:** **nenhuma** mensagem nova no celular. O log da automação registra
  o passo como executado, com o detalhe `flow not started: The contact is
  already in a flow; only one runs at a time.`
  **Não pode:** a automação aparecer como **falha**. Recusa não é falha — se
  aparecer falha, os passos seguintes da automação pararam de rodar, que é o
  defeito que esta regra existe para evitar.

- [ ] **Fluxo arquivado é recusado com o motivo certo**
  **Fazer:** arquivar `PONTE`, disparar a automação de novo.
  **Esperar:** detalhe `flow not started: "..." is not active`.

- [ ] **As variáveis chegam no fluxo**
  **Fazer:** no passo, adicionar var `valor` = `{{ message.text }}`. Usar um nó
  do fluxo que interpole `valor`.
  **Esperar:** o texto da mensagem que disparou a automação aparece na mensagem
  do fluxo.

### A.2 · O agente de IA inicia fluxo

- [ ] **⚡ A ferramenta só aparece quando faz sentido**
  **Fazer:** `/settings` → ferramentas do agente.
  **Esperar:** `start_flow` listada **apenas** se a conta tem ao menos um fluxo
  ativo com gatilho `manual`.
  **Não pode:** aparecer numa conta sem fluxo manual — ferramenta que o modelo
  vê é ferramenta que ele tenta.

- [ ] **🔴 O agente entrega a conversa ao fluxo**
  **Fazer:** com a resposta automática ligada, mandar do celular uma mensagem
  cuja resposta certa seja o menu do `PONTE` (ex.: "quero ver as opções").
  **Esperar:** chega **uma** mensagem — a primeira do fluxo. O agente **não**
  manda uma frase própria junto.
  **Por que importa:** duas mensagens fariam o cliente responder a errada, e a
  resposta cairia no fluxo como se fosse a escolha do menu.

- [ ] **⚡ A conversa NÃO vai para um humano**
  **Fazer:** conferir a conversa na inbox logo depois do teste acima.
  **Esperar:** continua atribuída como estava, sem nota de transferência, e a
  resposta automática **continua ligada**.
  **Não pode:** aparecer transferência. Se aparecer, `yieldTurn` está sendo
  tratado como `handoff` e toda conversa que entra num fluxo vira fila humana.

- [ ] **O agente não consegue iniciar um fluxo de palavra-chave**
  **Fazer:** no Playground, pedir explicitamente: "inicie o fluxo PALAVRA".
  **Esperar:** o modelo não tem esse nome na lista; responde que não pode, ou
  oferece outro. **Nunca** inicia `PALAVRA`.
  **Por que importa:** o texto que entra no prompt é escrito pelo cliente. Se
  ele consegue nomear um fluxo, ele escolhe o roteiro.

- [ ] **❓ O Playground não inicia de verdade**
  **Fazer:** no Playground, conduzir a conversa até o agente querer iniciar o
  fluxo.
  **Esperar:** o passo aparece como executado dizendo `Would start the "..."
  flow (test run)`, **nenhum** run novo em `/flows/[id]/runs`, e o agente
  **continua** respondendo (o turno não encerra).

### A.3 · Laço

- [ ] **❓ Fluxo que reinicia a si mesmo para sozinho**
  **Fazer:** montar o ciclo: fluxo `LAÇO` com um nó `set_tag` que aplica
  `ponte-teste` e termina; automação com gatilho `tag_added` em `ponte-teste`
  que inicia `LAÇO`. Ativar os dois e disparar uma vez.
  **Esperar:** o ciclo roda **3 vezes** e para. No log do servidor,
  `[flows] flow chain depth limit reached`.
  **Não pode:** rodar indefinidamente. Cada volta é uma mensagem cobrada.
  **Nota:** este é o único teste que exige montar algo só para quebrar. Vale
  fazer uma vez por deploy que toque o motor, e desativar as duas peças depois.

### A.4 · O que já existia (regressão)

- [ ] **Etiqueta posta por automação ainda dispara outra automação**
  **Fazer:** automação A (`add_tag` X) e automação B (gatilho `tag_added` em X,
  manda mensagem). Disparar A.
  **Esperar:** a mensagem de B chega.
  **Por que está aqui:** este comportamento já existia e não foi tocado, mas as
  duas cópias da mesma lógica vivem em arquivos diferentes (dívida registrada em
  R-2). É o primeiro lugar onde uma divergência apareceria.

- [ ] **⚡ 🔴 Fluxo por palavra-chave continua funcionando**
  **Fazer:** mandar do celular a palavra-chave de `PALAVRA`.
  **Esperar:** o fluxo começa como sempre começou.
  **Por que está aqui:** a criação de run foi refatorada para uma função só
  (`insertRunAndAdvance`), compartilhada com a ponte. Se o caminho de entrada
  quebrou, quebrou aqui.

---

## Bloco B — agendamento nos três motores (R-3, R-4, R-5)

**Preparação adicional**

- [ ] Agendamento **ligado** em Configurações → Agendamento, com fuso, duração
      do slot, antecedência mínima e horário de funcionamento preenchidos.
- [ ] Uma **agenda do Google conectada**. Metade destes testes existe para
      provar o que acontece quando ela cai, então tenha à mão a tela onde se
      desconecta.
- [ ] `bash deploy/apply-migrations.sh` — a **076** precisa ter aplicado, ou os
      nós novos são recusados pelo CHECK de `flow_nodes.node_type`.

### B.1 · A refatoração não mexeu no que já funcionava (R-3)

- [ ] **⚡ 🔴 🌐 A IA ainda agenda**
  **Fazer:** conversa normal com o agente: peça um horário, escolha, confirme.
  **Esperar:** exatamente como antes — oferece no máximo 3 horários, marca, e o
  evento aparece no Google Calendar.
  **Por que está aqui:** as quatro ferramentas foram reescritas por cima de
  `src/lib/actions/scheduling.ts`. O comportamento devia ser idêntico; este é o
  teste que diz se foi.

- [ ] **A recusa continua explicando qual regra pegou**
  **Fazer:** peça um horário dentro da antecedência mínima (ex.: "daqui a 10
  minutos", com antecedência de 2h configurada).
  **Esperar:** a resposta diz **a razão** — "preciso de 2h de antecedência; o
  mais cedo hoje é …" — e **não** "não está disponível".

- [ ] **⚡ 🌐 Agenda desconectada para o bot, não o faz inventar**
  **Fazer:** desconectar o Google, e pedir um horário ao agente.
  **Esperar:** o bot **não** oferece horário nenhum e a conversa vai para uma
  pessoa.
  **Não pode:** oferecer horários "livres". Sem ler o Google, livre é um palpite,
  e um palpite marca dois clientes no mesmo espaço.

### B.2 · O ensaio do Playground não escreve mais nada

> **Correção de defeito, não funcionalidade nova.** Antes desta fase o
> Playground só retinha a escrita de **agendar**. Ensaiar "remarcar" movia de
> verdade o agendamento de um cliente real, e ensaiar "cancelar" cancelava.

- [ ] **⚡ Ensaiar agendar não marca**
  **Fazer:** Playground → conduzir até o agente marcar.
  **Esperar:** "Test run: this would book …". **Nada** em `/agendamentos`, nada
  no Google.

- [ ] **Ensaiar remarcar não move**
  **Fazer:** com um agendamento real existente, ensaiar uma remarcação no
  Playground.
  **Esperar:** texto de ensaio, e o agendamento **no mesmo horário de antes** —
  confira em `/agendamentos` **e** no Google Calendar.

- [ ] **Ensaiar cancelar não cancela**
  **Fazer:** idem, pedindo cancelamento.
  **Esperar:** texto de ensaio; o agendamento continua `scheduled`.

### B.3 · Agendamento no fluxo (R-4)

Monte um fluxo `AGENDA` assim, uma vez, e reutilize nos testes abaixo:

```
início → Oferecer horários ─── escolheu ──→ Agendar ─── agendado ──→ mensagem "confirmado" → fim
                            ├─ sem horário ──→ mensagem "me avisa depois" → fim
                            └─ erro agenda ──→ passar para humano
                                              Agendar ─┬ horário tomado → volta para Oferecer horários
                                                       └ erro          → passar para humano
```

- [ ] **⚡ Os nós aparecem no menu**
  **Fazer:** abrir um fluxo → adicionar nó.
  **Esperar:** **Oferecer horários**, **Agendar**, **Remarcar** e **Cancelar
  agendamento**, todos em verde.

- [ ] **O validador exige todas as saídas**
  **Fazer:** adicionar **Oferecer horários** e tentar ativar o fluxo sem ligar
  as três saídas.
  **Esperar:** o painel de validação acusa cada saída faltando, por nome.
  **Por que importa:** um `erro de agenda` sem destino mata o run no meio e o
  cliente fica falando sozinho.

- [ ] **⚡ 🔴 🌐 O caminho feliz, sem IA nenhuma**
  **Fazer:** disparar `AGENDA` pelo gatilho, do celular. Tocar num horário.
  **Esperar:** a lista chega com os horários **no fuso da conta**; ao tocar,
  vem a confirmação; o evento aparece no Google Calendar.
  **Não pode:** o agente de IA responder em nenhum momento. Este é o teste que
  prova que existe caminho para quem não paga modelo.

- [ ] **Os horários batem com as regras da conta**
  **Fazer:** comparar a lista recebida com o que o agente ofereceria na mesma
  hora.
  **Esperar:** os mesmos horários. Fluxo e IA leem a mesma configuração; se
  divergirem, existem duas regras onde devia haver uma.

- [ ] **⚡ Agenda cheia e agenda fora do ar tomam caminhos DIFERENTES**
  **Fazer:** (a) bloquear o período inteiro no Google e disparar; (b)
  desconectar o Google e disparar.
  **Esperar:** (a) segue por **sem horário**; (b) segue por **erro agenda**.
  **Não pode:** os dois caírem no mesmo lugar. Dizer "estou sem horário" quando
  o Google caiu perde a venda e mente para o cliente.

- [ ] **❓ 🔴 O horário que sumiu no meio do caminho**
  **Fazer:** receber a lista, e **antes de tocar**, ocupar aquele horário pelo
  Google. Só então tocar.
  **Esperar:** o fluxo segue por **horário tomado** e volta a oferecer.
  **Por que importa:** é o caso comum de verdade — o cliente demora a responder.

- [ ] **Resposta que não é um horário cai no fallback**
  **Fazer:** em vez de tocar, escrever "oi" enquanto a lista está aberta.
  **Esperar:** a política de fallback do fluxo (reprompt / handoff / end),
  igual a qualquer menu.

- [ ] **🔴 Remarcar e cancelar pelo fluxo**
  **Fazer:** dois fluxos curtos, um com **Remarcar** e outro com **Cancelar
  agendamento**, para um contato que tem agendamento.
  **Esperar:** o agendamento muda / é cancelado, e o Google acompanha. Para um
  contato **sem** agendamento, o run segue pela saída **não tem agendamento** —
  não por erro.

### B.4 · Agendamento na automação (R-5)

- [ ] **Os passos aparecem**
  **Fazer:** `/automations/new` → adicionar passo.
  **Esperar:** **Agendar**, **Remarcar** e **Cancelar agendamento**.
  **Não pode:** existir um passo de "consultar horários". A ausência é
  deliberada: apresentar horários exige esperar a escolha, e esperar uma pessoa
  é fluxo. A automação que precisa disso usa **Iniciar fluxo**.

- [ ] **🔴 Cancelar por tag**
  **Fazer:** automação com gatilho `tag_added` em `cancelou` → **Cancelar
  agendamento**. Aplicar a tag a um contato com agendamento.
  **Esperar:** o agendamento é cancelado e o horário volta a aparecer como livre.

- [ ] **Contato sem agendamento não quebra a automação**
  **Fazer:** aplicar a mesma tag a um contato **sem** agendamento.
  **Esperar:** a automação termina como **sucesso**, com o detalhe do passo
  dizendo que não havia agendamento. Os passos seguintes rodam.
  **Não pode:** aparecer como falha.

- [ ] **Conta com agendamento desligado também não quebra**
  **Fazer:** desligar o agendamento em Configurações e disparar a automação.
  **Esperar:** detalhe `scheduling is not set up for this account`, execução
  como sucesso.

- [ ] **❓ O horário vem de fora**
  **Fazer:** passo **Agendar** com `{{ vars.inicio }}` / `{{ vars.fim }}`,
  disparado por um fluxo que coletou essas variáveis e entregou pela ponte.
  **Esperar:** marca no horário coletado.
  **Por que está assim:** uma automação não pergunta nada, então ela não tem
  como descobrir um horário sozinha — só agir sobre um já decidido.

---

## Bloco C — encher a matriz (R-6, R-7, R-8)

**Preparação adicional**

- [ ] `bash deploy/apply-migrations.sh` — a **077** precisa ter aplicado.
- [ ] Um **template APROVADO** na conta, com pelo menos duas variáveis.
- [ ] Uma **fila humana ativa** (`attended_by = humans`), chamada `FINANCEIRO`.
- [ ] Um **funil** com pelo menos uma etapa.

### C.1 · Template no fluxo (R-7) — *o item que destrava a régua*

- [ ] **⚡ 🔴 🌐 O fluxo manda template**
  **Fazer:** fluxo com um nó **Enviar modelo** apontando para o template
  aprovado, disparado manualmente (pela automação, com **Iniciar fluxo**).
  **Esperar:** a mensagem chega no celular.
  **Por que importa:** sem isto um fluxo só sabe *reagir*. Com isto, cada degrau
  de uma régua de cobrança é um fluxo, e a resposta do cliente cai num menu.

- [ ] **🔴 Fora da janela de 24 horas**
  **Fazer:** o mesmo, para um contato que não manda mensagem há mais de 24h.
  **Esperar:** chega assim mesmo. É o ponto inteiro do template.

- [ ] **As variáveis saem na ordem certa**
  **Fazer:** template com 10+ variáveis, preenchidas `{{1}}`…`{{10}}` na tela.
  **Esperar:** cada valor na lacuna certa.
  **Por que está aqui:** ordenar "1", "2", …, "10" como texto dá "1", "10",
  "2" — e o cliente recebe o nome no lugar do valor **sem erro nenhum**, porque
  para a Meta a mensagem foi entregue.

- [ ] **Template recusado derruba o run com motivo**
  **Fazer:** apontar o nó para um nome de template que não existe.
  **Esperar:** o run termina como `failed`, com o evento `send_template_failed`
  em `/flows/[id]/runs`.
  **Não pode:** o run seguir para o próximo nó. O template **é** a mensagem;
  seguir deixaria o cliente esperando um texto que nunca chegou.

- [ ] **🔴 Automação manda mídia**
  **Fazer:** automação com o passo **Enviar mídia**, apontando para uma URL
  pública de imagem.
  **Esperar:** a imagem chega.

### C.2 · Ações de CRM no fluxo (R-6)

- [ ] **⚡ Os nós aparecem**
  **Fazer:** abrir um fluxo → adicionar nó.
  **Esperar:** **Enviar modelo**, **Atualizar campo**, **Criar negócio**,
  **Atribuir**, **Fechar conversa**, **Encaminhar para fila**.

- [ ] **Escrever num campo do contato**
  **Fazer:** fluxo que coleta um texto e grava com **Atualizar campo** em
  `name`, usando `{{vars.…}}`.
  **Esperar:** o contato aparece com o nome novo em `/contacts`.

- [ ] **Campo não gravável não quebra o fluxo**
  **Fazer:** apontar o campo para `phone` (fora da lista branca).
  **Esperar:** o run **segue** para o nó seguinte, e o evento registra
  `field phone not writable`.
  **Por que assim:** o cliente não está esperando nada dessa escrita. Abandonar
  alguém no meio de um menu por causa dela seria pior.

- [ ] **Criar negócio**
  **Fazer:** nó **Criar negócio** apontando para funil e etapa.
  **Esperar:** o negócio aparece no funil, **na moeda da conta** — não em USD.

- [ ] **Trocar o funil zera a etapa**
  **Fazer:** no editor do nó, escolher um funil, depois outro.
  **Esperar:** a etapa volta a vazio. Uma etapa do funil anterior não existe no
  novo, e salvá-la criaria um negócio que o banco recusa.

### C.3 · Fila e humano (R-8)

- [ ] **⚡ 🔴 Fluxo encaminha para a fila e PARA**
  **Fazer:** fluxo com **Encaminhar para fila** → `FINANCEIRO`. Disparar.
  **Esperar:** a conversa aparece na fila; o run termina como `handed_off`; e
  **nenhuma** mensagem do fluxo chega depois disso.
  **Não pode:** o fluxo continuar. Falar por cima de uma pessoa atendendo é o
  pior desfecho possível.

- [ ] **Fila apagada não prende o contato**
  **Fazer:** apontar o nó para uma fila, desativá-la, e disparar.
  **Esperar:** o run termina (`queue_not_available` nos eventos) e o contato
  fica livre para entrar em outro fluxo.
  **Por que importa:** um run preso segura o índice de um run ativo por contato
  e bloqueia todo gatilho futuro daquele contato.

- [ ] **🔴 Automação encaminha para fila**
  **Fazer:** automação com o passo **Encaminhar para fila**.
  **Esperar:** mesma coisa, pelo lado da automação.

- [ ] **🔴 Automação passa para humano**
  **Fazer:** automação com o passo **Passar para humano**, sem escolher
  atendente.
  **Esperar:** a conversa fica pausada para o robô e cai na **fila
  compartilhada**; a resposta automática da IA para de responder nela.

- [ ] **Nunca rouba conversa que já tem dono**
  **Fazer:** atribuir a conversa a alguém à mão, e então disparar o
  encaminhamento.
  **Esperar:** o dono atual **não** é trocado.
  **Por que está aqui:** é uma garantia de `handOffConversation`, e agora três
  caminhos diferentes chegam nela.

### C.4 · Regressão do que foi mexido por baixo

- [ ] **⚡ Automação de campo personalizado continua gravando**
  **Fazer:** automação com **Atualizar campo do contato** num campo
  personalizado (`custom:<id>`).
  **Esperar:** grava, e reexecutar **sobrescreve** em vez de duplicar.
  **Por que está aqui:** os cinco passos de CRM da automação passaram a chamar
  `src/lib/actions/crm.ts`. Se a extração quebrou algo, quebrou aqui.

- [ ] **Automação de template continua mandando**
  **Fazer:** automação com **Enviar modelo**, com variáveis.
  **Esperar:** igual a antes — a ordenação posicional agora é compartilhada com
  o fluxo.

- [ ] **⚡ O agente ainda encaminha para fila**
  **Fazer:** conversa em que a IA decide encaminhar.
  **Esperar:** igual a antes. A ferramenta passou a chamar
  `src/lib/actions/queue-routing.ts`.

---

## Bloco C (continuação) — espera e webhook no fluxo (R-9)

**Preparação adicional**

- [ ] `bash deploy/apply-migrations.sh` — a **078** precisa ter aplicado
      (`flow_runs.resume_at`).
- [ ] O **cron do fluxo** rodando. Sem ele nada do que está abaixo volta.
      Confira `docker compose logs cron` como na Fase 0 do checklist de produção.
- [ ] Uma URL de teste que aceite POST e que você consiga inspecionar
      (webhook.site ou equivalente).

- [ ] **⚡ 🔴 O fluxo espera e volta**
  **Fazer:** fluxo: mensagem "vou verificar" → **Esperar 2 minutos** → mensagem
  "obrigado por aguardar". Disparar.
  **Esperar:** a primeira mensagem chega na hora; a segunda chega depois de
  ~2 minutos **mais** o intervalo do cron.
  **Onde olhar se falhar:** a resposta de `/api/flows/cron` traz `resumed`.

- [ ] **⚡ Uma espera longa NÃO é varrida como abandono**
  **Fazer:** fluxo com **Esperar 2 dias**. Disparar e deixar passar mais de 24h
  (ou baixar `on_timeout_hours` do fluxo para 1 e esperar uma hora).
  **Esperar:** o run continua `active`, com `resume_at` no futuro.
  **Não pode:** virar `timed_out`. Sem esta guarda, um degrau de régua de
  "espera 3 dias" morre no segundo degrau — e ninguém vê, porque a régua
  simplesmente para.

- [ ] **Mensagem durante a espera vai para o agente, não para o fluxo**
  **Fazer:** com o run parado num **Esperar**, mandar uma mensagem do celular.
  **Esperar:** o agente de IA (ou as automações) respondem normalmente. O fluxo
  **não** reprompta nem transfere, e o run continua parado.
  **Por que assim:** o fluxo não está escutando. Tratar aquilo como resposta
  faria o fallback disparar por causa de uma frase que não foi dirigida a ele.

- [ ] **❓ Duas voltas do cron não mandam a mensagem duas vezes**
  **Fazer:** disparar `/api/flows/cron` duas vezes seguidas, rápido, com um run
  vencido.
  **Esperar:** **uma** mensagem. A segunda chamada devolve `resumed: 0`.

- [ ] **⚡ O webhook é chamado e o fluxo desvia pelo resultado**
  **Fazer:** nó **Chamar webhook** para a URL de teste, com as duas saídas
  ligadas a mensagens diferentes.
  **Esperar:** o POST chega com as variáveis do run em JSON, e o fluxo segue
  pela saída de sucesso.

- [ ] **🔴 Resposta de erro segue a outra saída**
  **Fazer:** apontar para uma URL que devolva 500.
  **Esperar:** o fluxo segue pela saída de falha.

- [ ] **⚡ Endereço interno é recusado**
  **Fazer:** apontar o nó para `http://127.0.0.1:3000/` ou `http://169.254.169.254/`.
  **Esperar:** **nenhuma** requisição sai; o run segue pela saída de falha, com
  `webhook_destination_not_allowed` nos eventos.
  **Por que importa:** a URL é escrita por quem configura e quem faz a
  requisição é o servidor. Sem a guarda, um fluxo alcança qualquer coisa dentro
  da rede — incluindo o metadata do provedor de nuvem.

- [ ] **O validador exige as duas saídas do webhook**
  **Fazer:** adicionar o nó e tentar ativar sem ligar a saída de falha.
  **Esperar:** o painel de validação acusa. Um webhook que falha sem destino
  deixa o run morto no meio.

---

## Fase 2 — fluxos para GA (R-10 a R-13)

**Preparação adicional**

- [ ] `bash deploy/apply-migrations.sh` — a **079** precisa ter aplicado
      (`flow_runs.resume_kind`).
- [ ] O cron do fluxo rodando (o prazo por nó depende dele, como a espera).

### F2.1 · Prazo por nó (R-10)

- [ ] **⚡ 🔴 Um menu que ninguém responde desvia sozinho**
  **Fazer:** menu com **Desistir depois de** 2 minutos e a saída **Sem resposta
  no prazo** ligada a uma mensagem. Disparar e **não** responder.
  **Esperar:** depois de ~2 min + o intervalo do cron, a mensagem da saída de
  prazo chega.

- [ ] **⚡ Responder cancela o prazo**
  **Fazer:** o mesmo menu, mas tocar num botão dentro do prazo.
  **Esperar:** o fluxo segue normalmente e **nada** da saída de prazo chega
  depois.
  **Por que importa:** sem isso o cron acorda um run que já andou e o manda pela
  aresta de "ninguém respondeu" — depois de alguém ter respondido.

- [ ] **Sem saída de prazo, o run encerra**
  **Fazer:** pôr o prazo e deixar a saída vazia.
  **Esperar:** o run vira `timed_out` na hora do prazo, e o contato fica livre.

- [ ] **O conector só aparece quando existe prazo**
  **Fazer:** abrir um menu sem prazo no canvas.
  **Esperar:** **nenhum** conector de "sem resposta". Ele aparece assim que você
  preenche os minutos.

- [ ] **❓ O menor dos dois prazos vence**
  **Fazer:** fluxo com `on_timeout_hours` de 1 hora e um nó com prazo de 5 min.
  **Esperar:** o nó vence primeiro.
  **E o contrário:** um nó com prazo de 48h num fluxo de 24h — a varredura de
  abandono leva o run em 24h. Prazo de nó mede cliente calado, e é isso que a
  varredura também mede.

### F2.2 · Handoff que pausa (R-12)

- [ ] **⚡ 🔴 A conversa vai para uma pessoa e o run continua vivo**
  **Fazer:** nó **Passar para humano** com **Pausar — alguém pode devolver**, a
  continuação ligada, e prazo de 4 horas. Disparar até chegar nele.
  **Esperar:** a conversa aparece transferida na inbox; em `/flows/[id]/runs` o
  run continua **ativo**, parado no nó.

- [ ] **⚡ Devolver retoma o roteiro**
  **Fazer:** `POST /api/flows/runs/resume` com `{"contactId":"…"}`, ou uma
  automação com o passo **Retomar fluxo pausado**.
  **Esperar:** a mensagem do nó seguinte chega, e a resposta automática da IA
  **volta a funcionar** naquela conversa.
  **Não pode:** o fluxo retomar falando enquanto a inbox ainda marca a conversa
  como transferida.

- [ ] **Ninguém devolve → o run encerra sozinho**
  **Fazer:** deixar o prazo vencer.
  **Esperar:** `timed_out` com `handoff_pause_expired`, e o contato liberado.
  **Por que importa:** um run pausado para sempre bloqueia todo gatilho futuro
  daquele contato.

- [ ] **Devolver quem não está pausado responde 404**
  **Fazer:** chamar a rota para um contato sem fluxo pausado.
  **Esperar:** 404 com `no_paused_run` — e não 500.

### F2.3 · GA (R-13)

- [ ] **⚡ Nenhuma tela diz "beta"**
  **Fazer:** olhar a barra lateral e o cabeçalho de `/flows`.
  **Esperar:** sem chip. As rotas já estavam abertas desde o PR #134.

---

## Fase 3 — custo de mensagem (R-14 a R-17)

**Preparação adicional**

- [ ] `bash deploy/apply-migrations.sh` — a **080** precisa ter aplicado
      (`messages.origin`, `whatsapp_message_prices`,
      `ai_configs.whatsapp_monthly_budget_usd`, `whatsapp_blocked_sends`).
- [ ] Pelo menos um dia de tráfego real depois do deploy: as telas leem do
      **mês corrente**, e uma conta recém-migrada mostra zero com razão.

### F3.1 · O card do painel

- [ ] **⚡ O painel mostra os dois custos e a soma**
  **Fazer:** entrar no painel como **admin**.
  **Esperar:** um card com o total do mês, a linha de IA (tokens) e a linha de
  WhatsApp (mensagens), com a contagem de mensagens.
  **Não pode:** dois cards separados. O número que importa é a soma.

- [ ] **Agente e visualizador não veem**
  **Fazer:** entrar com um usuário de papel `agent`.
  **Esperar:** o card não aparece. Gasto é classe de faturamento.

- [ ] **⚡ A previsão de outubro aparece enquanto fizer sentido**
  **Fazer:** olhar a linha "Pelas regras de outubro, este mês custaria…".
  **Esperar:** um valor **maior** que o cobrado, enquanto ainda houver mensagem
  chegando como `free_customer_service`. Depois da virada as duas convergem, e a
  linha some — que é o comportamento certo.

- [ ] **A quebra por origem diz o que cortar**
  **Esperar:** "O que mais pesa: Respostas da IA … · Broadcasts …".
  **Por que importa:** um total sem quebra informa que a conta subiu, não o que
  fazer a respeito.

- [ ] **Mensagens antigas ficam em "Desconhecida"**
  **Esperar:** toda mensagem gravada **antes** da migração 080 cai nesse balde.
  É esperado, e some sozinho com o tempo.

### F3.2 · A origem é gravada no envio

- [ ] **❓ Cada superfície se identifica**
  **Fazer:** mandar uma mensagem por cada caminho — resposta da IA, atendente na
  inbox, automação, fluxo, API pública — e conferir `messages.origin` no banco.
  **Esperar:** `ai`, `inbox`, `automation`, `flow`, `api`.
  **Por que testar:** a origem só pode ser gravada no envio. Se um caminho
  esquecer, aquele custo vira "Desconhecida" para sempre.

### F3.3 · O segundo teto (R-16)

- [ ] **⚡ 🔴 O teto cala o robô**
  **Fazer:** Configurações → IA → **Orçamento do WhatsApp** = `0,01`. Disparar
  uma automação que manda mensagem.
  **Esperar:** a mensagem **não** sai; o card mostra "1 mensagem barrada pelo
  orçamento"; e `whatsapp_blocked_sends` tem a linha com o motivo.

- [ ] **⚡ 🔴 O teto NÃO cala o atendente** — *o teste mais importante da fase*
  **Fazer:** com o teto ainda estourado, responder pela inbox.
  **Esperar:** a mensagem **sai normalmente**.
  **Por que importa:** calar uma pessoa que está respondendo um cliente para
  economizar quatro centavos é pior que a fatura que o teto existe para evitar.

- [ ] **Sem teto configurado, nada é barrado**
  **Fazer:** apagar o campo.
  **Esperar:** tudo volta a sair, e a consulta do gasto nem chega a ser feita.

- [ ] **❓ O teto falha aberto**
  **Fazer:** (em ambiente de teste) derrubar o acesso à tabela de custos.
  **Esperar:** as mensagens continuam saindo, com um erro no log.
  **Por que assim:** um teto que derruba o atendimento quando o banco tosse
  troca um problema de conta por um problema de cliente.

### F3.4 · Preço e cópia

- [ ] **A tabela interna avisa que é a interna**
  **Esperar:** sem nenhuma linha em `whatsapp_message_prices`, o card diz
  "Preços da tabela interna — nenhum override configurado".

- [ ] **Um override manda no cálculo**
  **Fazer:** inserir uma linha em `whatsapp_message_prices` (`BR`, `service`,
  preço, vigência de hoje).
  **Esperar:** o valor da tela muda, e o aviso da tabela interna some.

- [ ] **Os dois controles de custo se explicam**
  **Fazer:** ler os textos de **Máximo de respostas automáticas** e **Avisar o
  cliente ao transferir**.
  **Esperar:** os dois dizem, com todas as letras, quanto custam. O aviso de
  transferência é **uma mensagem cobrada a mais** por transferência.
