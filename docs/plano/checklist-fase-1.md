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
