# Glossário do iMasterChat

Este arquivo existe para uma coisa só: impedir que dois textos chamem a mesma coisa por nomes diferentes, ou coisas diferentes pelo mesmo nome. Quem for escrever tutorial para o cliente final deve usar exatamente os nomes da linha **Onde aparece na interface** — são os nomes que a pessoa vê na tela, conferidos no arquivo de tradução `messages/pt-BR.json`.

Cada verbete diz três coisas: **o que é**, **o que não é** (a confusão que a palavra costuma causar) e **onde aparece na interface**.

---

## Os nomes das telas

O menu lateral tem, nesta ordem: **Painel**, **Caixa de entrada**, **Notificações**, **Contatos**, **Funis**, **Disparos em massa**, **Automações**, **Fluxos** (com o selo "Beta"), **Agenda**, **Agentes de IA** e, no rodapé, **Configurações**. Quem é administrador da plataforma vê ainda **Administração**.

Dentro de **Configurações** há 13 seções: **Visão geral**, **Seu perfil**, **Login e segurança**, **Aparência**, **Avisos no celular**, **WhatsApp**, **Modelos**, **Respostas rápidas**, **Agendamento**, **Campos e etiquetas**, **Negócios e moeda**, **Membros da equipe**, **Chaves de API**.

Dentro de **Agentes de IA** há 7 abas, nesta ordem: **Playground**, **Vault**, **Limites**, **Regras**, **Contexto**, **Configuração**, **Uso**. A aba **Uso** só aparece para quem pode editar configurações.

Nunca use a rota (`/inbox`, `/broadcasts`) como nome de tela num texto para o cliente. Diga "Caixa de entrada", "Disparos em massa".

---

## Conta

**O que é.** A empresa dentro do sistema — a ótica, a loja de bicicleta, a revenda de energia solar. Todo dado (contato, conversa, negócio, automação, modelo, agendamento) pertence a uma conta e é invisível para as outras. Uma conta tem um número de WhatsApp, uma moeda padrão, uma configuração de IA e uma equipe.

**O que não é.** Não é o login da pessoa. Uma pessoa pertence a **exatamente uma** conta — não existe trocar de empresa nem participar de duas. Também não é "assinatura": não há cartão, cobrança automática nem plano dentro do produto; o estado de cobrança é virado à mão pelo dono da plataforma.

**Onde aparece na interface.** O nome da conta aparece no topo do menu lateral e na tela **Conta aguardando aprovação**. Não existe tela para renomear a conta.

---

## Papel (na tela: "Função")

**O que é.** O que cada pessoa da equipe pode fazer. São quatro, em ordem de poder: **Proprietário** > **Administrador** > **Atendente** > **Visualizador**. Regra prática: Visualizador só lê; Atendente responde cliente, mexe em contatos, negócios, automações e fluxos; Administrador ainda mexe em configurações, equipe, etiquetas, campos, modelos e IA; Proprietário é o dono.

**O que não é.** Não é permissão por tela: a trilha de **Configurações** mostra todas as 13 seções para todo mundo — o que muda é o conteúdo de cada painel. E "Visualizador = somente leitura" não é garantia absoluta: há rotas que não checam papel (ver o defeito dos modelos de mensagem).

**Onde aparece na interface.** Em **Configurações → Membros da equipe**, o seletor se chama **Função** e os valores são Proprietário / Administrador / Atendente / Visualizador. Atenção ao descasamento: **no crachá da barra lateral, o papel `agent` aparece como "Agente"**, e não como "Atendente". Nos documentos técnicos e no banco os nomes são `owner`, `admin`, `agent`, `viewer`.

---

## Administrador da plataforma

**O que é.** Quem vende e opera o iMasterChat — não o cliente. É quem aprova contas, vê os erros de todas as contas e mantém os preços de IA e a cotação do dólar.

**O que não é.** **Não é o Administrador da conta.** São dois conceitos independentes: o Administrador da conta é o gerente da ótica; o administrador da plataforma é o fornecedor. Quando um documento diz "exige admin", é sempre o papel da conta, a menos que diga "da plataforma".

**Onde aparece na interface.** Item **Administração** no menu lateral, visível só para ele. Não existe tela para conceder esse papel — é um comando SQL direto no banco.

---

## Contato

**O que é.** A pessoa do outro lado: telefone, nome, e-mail, empresa, etiquetas, campos personalizados e anotações. Nasce sozinho quando alguém manda mensagem no WhatsApp da empresa, e também pode ser criado à mão, por planilha CSV ou por API. Um telefone só existe uma vez por conta.

**O que não é.** Não é a conversa. E o nome do contato não é seu: **o nome do perfil do WhatsApp sobrescreve o que o operador digitou** na próxima mensagem que a pessoa mandar.

**Onde aparece na interface.** Menu **Contatos**. Também no painel direito da **Caixa de entrada**, quando há conversa aberta.

---

## Conversa

**O que é.** O fio de mensagens com um contato. Tem status (Aberta / Pendente / Fechada), contador de não lidas, prévia da última mensagem e, opcionalmente, um dono.

**O que não é.** Não é "um atendimento". **Existe no máximo uma conversa por contato** — não se abre um chamado novo a cada assunto. Fechar e o cliente escrever de novo **reabre a mesma conversa**, e essa reabertura **perde o dono, reativa o robô e apaga a nota de transferência**. Conversa também não carrega etiqueta (a etiqueta é do contato).

**Onde aparece na interface.** Lista à esquerda da **Caixa de entrada**. O status é o menu **Status** no cabeçalho da conversa, com os valores **Aberta**, **Pendente** e **Fechada**.

---

## Atribuição / Atribuir

**O que é.** Dizer de quem é aquele atendimento. Coloca uma pessoa da equipe como dona da conversa. Tem um efeito colateral importante: **conversa com dono cala o agente de IA** — o robô não responde mais ali enquanto houver dono.

**O que não é.** Não é distribuição automática: nada atribui uma conversa sozinho quando ela chega; ela nasce sem dono. Não é exclusividade: qualquer Atendente pode atribuir qualquer conversa a qualquer pessoa, inclusive tirar de um colega. E **não é o que acontece quando você simplesmente responde** — responder não atribui nada.

**Onde aparece na interface.** Botão **Atribuir** no cabeçalho da conversa (quando já tem dono, ele mostra **Atribuída** com o nome). Dentro dele, cada colega aparece com uma bolinha de presença, o seu nome aparece com "(eu)", e há a opção **Remover atribuição**. A lista de conversas **não** mostra o dono — só dá para ver abrindo a conversa.

---

## Assumir / Retomar IA

**O que é.** **Assumir** é o botão da tarja que aparece acima da caixa de escrita enquanto o robô está respondendo. Um clique faz duas coisas: pausa o robô naquela conversa e coloca a conversa no seu nome. **Retomar IA** é o inverso: devolve a conversa ao robô, apaga a nota de transferência, zera o contador de respostas do robô e **remove o dono da conversa — inclusive se o dono for outra pessoa**.

**O que não é.** **Assumir não é responder.** Escrever e enviar uma mensagem não pausa o robô e não coloca a conversa no seu nome. Este é o mal-entendido número um do produto: o atendente responde, o cliente responde de volta, e a IA responde de novo por cima dele.

**Onde aparece na interface.** Tarja acima da caixa de escrita, na **Caixa de entrada**: "O assistente de IA está respondendo automaticamente" + botão **Assumir**; ou "O assistente de IA está pausado aqui" + botão **Retomar IA**. A tarja some quando a conversa já tem dono.

---

## Handoff (transferência para uma pessoa)

**O que é.** O momento em que o robô desiste e a conversa passa a esperar gente. Faz exatamente quatro coisas: põe o status em **Pendente**, desliga a resposta automática naquela conversa, grava uma nota interna dizendo por que transferiu, e atribui a conversa à pessoa configurada — **só se ninguém já for dono**. Também dispara aviso no celular para a conta inteira. Três caminhos levam a isso: o modelo chama a ferramenta de pedir humano; a mensagem bate numa palavra dos Limites; ou o modelo termina sem conseguir responder. A API pública também consegue disparar o mesmo efeito.

**O que não é.** **Não é o nó "Transferir para agente" dos Fluxos.** Esse nó é mais fraco: só muda o status para Pendente, não desliga a IA, não grava motivo e não deixa escolher a pessoa pela tela. Também **não é uma mensagem para o cliente**: o handoff em si não avisa ninguém do lado de fora. Existe um aviso opcional ao cliente, que é enviado depois, e só se a conta tiver ligado.

**Onde aparece na interface.** Para o cliente final, o handoff se manifesta como: a conversa vira **Pendente**, e a tarja da **Caixa de entrada** passa a mostrar a nota do robô com o botão **Retomar IA**. Quem recebe as conversas transferidas é definido em **Agentes de IA → Configuração**, no campo "Passar para", que também aceita "Fila sem atribuição (qualquer atendente pode assumir)".

---

## Guardrail (na tela: "Limites")

**O que é.** A lista de coisas que o robô não pode tratar. Tem dois tipos. **Por assunto**: entra no prompt como instrução ("qualquer negociação de preço") — pega quem negocia sem escrever a palavra desconto, mas depende do julgamento do modelo. **Por palavra**: é conferido antes de o robô pensar; se a palavra aparece na mensagem, a conversa é transferida na hora, sem gastar nenhuma chamada de IA. Toda conta nasce com 8 regras prontas (5 assuntos e 3 palavras: advogado, procon, processar).

**O que não é.** Não é filtro de palavrão nem bloqueio de contato. E o **Playground não testa os Limites** — um ensaio pode responder tranquilamente uma pergunta que em produção seria transferida. Também: no caminho da palavra, o cliente **não recebe nenhuma resposta** — fica em silêncio até uma pessoa abrir a conversa.

**Onde aparece na interface.** Aba **Limites** de **Agentes de IA** (título interno da tela: "Quando chamar uma pessoa"), com duas listas: **Por assunto** e **Por palavra**. Escrever exige Administrador; qualquer membro lê.

---

## Vault

**O que é.** A wiki interna da conta que o próprio sistema propõe. Um programa (o *keeper*) lê conversas que já terminaram, escreve páginas em **rascunho**, e alguém da equipe aprova ou recusa. Só página **aprovada** chega ao cliente. São cinco tipos de página: **Regra** e **Estado atual** entram em toda resposta; **Sobre um cliente** entra só na conversa daquele cliente; **Sobre o negócio** e **Conceito** vão para a busca e aparecem quando têm a ver com a pergunta.

**O que não é.** Não é a base de conhecimento (veja o próximo verbete). Não é automático: página proposta não vale nada até ser aprovada — e **página criada à mão também nasce em rascunho**, apesar de a tela dizer que "entra aprovada". Nenhuma ferramenta do keeper aprova nada; a aprovação é sempre humana.

**Onde aparece na interface.** Aba **Vault** de **Agentes de IA**, com cinco sub-abas: **Rede**, **Aprovação**, **Páginas**, **Saúde** e **Keeper**.

---

## Base de conhecimento

**O que é.** O texto longo que o operador cola à mão: FAQ inteira, política de troca, catálogo, descrição de produto. O sistema fatia esse texto em pedaços e, a cada pergunta do cliente, busca os pedaços mais parecidos e manda só esses para o modelo.

**O que não é.** Não é o Vault. Regra prática: **se é curto e vale sempre, é página de Vault do tipo Regra; se é comprido e só interessa quando o cliente pergunta, é documento da base de conhecimento.** Também não é busca inteligente por padrão: sem uma chave de embeddings cadastrada, a busca é só por palavra, e depois de cadastrar a chave é obrigatório clicar em **Reindexar** para os documentos antigos passarem a ser encontrados por sentido.

**Onde aparece na interface.** **Agentes de IA → Configuração**, card **Base de conhecimento**. É a única porta — este card **não** aparece em Configurações.

---

## Automação

**O que é.** Uma regra linear: "quando acontecer isso, faça aquilo, na ordem". Ela é acionada por um evento (chegou mensagem, o contato recebeu uma etiqueta, um contato novo apareceu, o cliente tocou num botão) e executa uma lista de passos de cima para baixo, com uma bifurcação "se/senão" e um passo de **Espera** que adia a continuação por minutos, horas ou dias.

**O que não é.** Não é um chatbot: ela não faz perguntas nem guarda em que ponto cada pessoa parou. E dois dos gatilhos que aparecem no seletor — **Baseado em horário** e **Conversa atribuída** — **não são acionados por nada no sistema**: uma automação "todo dia às 9h" nunca vai rodar sozinha.

**Onde aparece na interface.** Menu **Automações**. Cada linha tem interruptor de ativar/pausar e um menu com **Editar**, **Duplicar**, **Ver logs** e **Excluir**.

---

## Fluxo (Flow)

**O que é.** O chatbot de verdade: um mapa de perguntas, botões e listas em que o cliente escolhe caminhos, e o sistema guarda em que passo cada contato parou para retomar quando ele responder. Tem bloco de coletar resposta (que guarda o que o cliente escreveu numa variável), bifurcação, etiquetar e transferir.

**O que não é.** Não é automação, e os dois **não são intercambiáveis**: quando a mensagem chega, o fluxo é avaliado **primeiro**; se ele consumir a mensagem, os gatilhos de conteúdo das automações são suprimidos. Também não substitui o agente de IA — fluxo é determinístico, o agente é generativo.

**Onde aparece na interface.** Menu **Fluxos** (com o selo "Beta", que não restringe nada). O editor tem duas visões, **Canvas** e **Lista**, e o histórico fica em **Execuções**.

---

## Modelo de mensagem (template)

**O que é.** Um texto pré-aprovado pela Meta. É a **única** forma de iniciar conversa com quem não escreveu para a empresa nas últimas 24 horas, e é o que os disparos em massa usam. Tem nome (só letras minúsculas, números e `_`), idioma, categoria, corpo com variáveis (`{{1}}`, `{{2}}`…), cabeçalho e botões opcionais.

**O que não é.** Não é a mensagem livre que o atendente digita na caixa de escrita. Não é imediato: todo modelo novo vai para análise da Meta e nasce como PENDENTE. Editar um modelo aprovado o joga de volta para PENDENTE. E nome e idioma ficam congelados depois que o modelo existe na Meta — `pt_BR` e `pt` são idiomas diferentes para ela.

**Onde aparece na interface.** **Configurações → Modelos** (o painel se chama "Modelos de mensagem"), com os botões **Novo modelo**, **Editar**, **Excluir** e **Sincronizar da Meta**. Na conversa, o seletor de modelo fica dentro da caixa de escrita.

---

## Mensagem livre

**O que é.** Qualquer mensagem escrita na hora — texto, foto, vídeo, documento, nota de voz, botões ou lista — enviada pela **Caixa de entrada**, por um fluxo, por uma automação ou pelo agente de IA.

**O que não é.** Não serve para iniciar conversa com quem está fora da janela de 24 horas. Não precisa de aprovação da Meta.

**Onde aparece na interface.** A caixa de escrita no rodapé da conversa, na **Caixa de entrada**.

---

## Janela de 24 horas

**O que é.** A regra da Meta: depois de 24 horas sem o cliente mandar mensagem, a empresa só consegue falar com ele por **modelo aprovado**. O sistema conta essas 24 horas a partir da última mensagem **do cliente** naquela conversa.

**O que não é.** Não é uma regra do iMasterChat, e **não é verificada no servidor**: o único cálculo acontece no navegador, e o efeito é travar a caixa de escrita. Quem de fato recusa a mensagem fora da janela é a Meta.

**Onde aparece na interface.** Um relógio no cabeçalho da conversa e, quando expira, o aviso na caixa de escrita: "A sessão de 24 horas expirou. Use um modelo para retomar o contato."

---

## Etiqueta (tag)

**O que é.** Um rótulo colorido que classifica um **contato** ("comprou lente multifocal", "orçamento enviado"). Serve para filtrar listas, escolher o público de um disparo e disparar automações.

**O que não é.** **Não é da conversa.** Não existe etiquetar uma conversa — a Caixa de entrada usa as etiquetas do contato apenas como filtro da lista, e o painel do contato dentro da conversa é só leitura. O filtro é sempre "qualquer uma das marcadas", nunca "todas ao mesmo tempo". E não é uma etiqueta por pessoa: um contato pode ter várias.

**Onde aparece na interface.** Criar, renomear, colorir e apagar: **Configurações → Campos e etiquetas** (exige Administrador). Colocar e tirar de alguém: menu **Contatos**, na ficha do contato, aba **Etiquetas** (exige Atendente). Filtrar: **Etiquetas**, no topo da lista da **Caixa de entrada** e da tela **Contatos**.

---

## Campo personalizado

**O que é.** Uma informação extra que o negócio quer guardar de cada cliente: "grau do olho direito", "modelo da bike", "kWh da conta de luz".

**O que não é.** Não é um formulário com tipos: **só existe campo de texto livre** — não há lista de opções, número, data nem sim/não. Excluir a definição de um campo apaga o valor guardado em todos os contatos.

**Onde aparece na interface.** **Configurações → Campos e etiquetas** (ou o botão **Campos personalizados** na tela **Contatos**) para criar a definição; a aba **Campos personalizados** da ficha do contato para preencher o valor.

---

## Funil, etapa e negócio

**O que é.** O **funil** é um quadro de colunas; cada coluna é uma **etapa**; cada card é um **negócio** — uma oportunidade de venda com título, contato, valor, moeda, data prevista, responsável e notas. O negócio anda de etapa em etapa até virar ganho ou perdido, e dá para ter mais de um funil.

**O que não é.** Negócio não é conversa e não é contato — mas **todo negócio precisa de um contato**. Não existe histórico de movimentação: o sistema guarda a etapa atual, não por onde o card passou. Os totais do topo do quadro **ignoram a moeda de cada negócio** e não existe conversão cambial em lugar nenhum. E o "valor ponderado" não é configurável: a probabilidade sai da posição da etapa.

**Onde aparece na interface.** Menu **Funis**. O funil que o sistema cria sozinho na primeira visita se chama **Sales Pipeline** e as etapas nascem em inglês (New Lead, Qualified, Proposal Sent, Negotiation, Won) — renomear é manual, em **Gerenciar funis**.

---

## Resposta rápida

**O que é.** Um texto pronto (ou uma mensagem com botões pronta) que o atendente insere na conversa sem digitar tudo de novo.

**O que não é.** Não é modelo da Meta: resposta rápida não passa por aprovação e **não reabre conversa fora da janela de 24 horas**. E escolher uma resposta rápida de texto **acrescenta** ao que já está escrito na caixa — não substitui.

**Onde aparece na interface.** Catálogo em **Configurações → Respostas rápidas**; uso na caixa de escrita da **Caixa de entrada**, em **Respostas rápidas**.

---

## Disparo em massa (campanha)

**O que é.** Mandar o mesmo modelo aprovado para muitos contatos de uma vez, escolhendo o público por etiquetas, por campo personalizado, por planilha CSV ou "todos os contatos", com as variáveis do modelo preenchidas por pessoa.

**O que não é.** **Não é agendável**: não há campo de data e nada executa um envio no futuro, apesar de a tela entender um status "Agendado". **Não roda no servidor**: quem manda os lotes é a aba aberta do navegador — fechar a aba para o envio no meio. Não dá para pausar, cancelar, retomar um rascunho nem reenviar só para quem falhou.

**Onde aparece na interface.** Menu **Disparos em massa**, botão **Novo disparo** (assistente de 4 passos: Modelo, Público, Personalizar, Revisar e enviar).

---

## Notificação (aviso no app) vs. Aviso no celular (push)

**O que é.** São **dois sistemas separados**, com gatilhos diferentes. A **Notificação** é o aviso dentro do app e hoje existe para um único fato: alguém atribuiu uma conversa a você. O **Aviso no celular** alcança a pessoa com o app fechado, e existe para dois fatos: chegou mensagem nova de cliente, e o robô transferiu uma conversa para uma pessoa.

**O que não é.** Atribuir uma conversa **não** gera aviso no celular. Chegar mensagem nova **não** gera notificação no app. Não existe aviso de "a campanha terminou" nem de "o cliente respondeu". Quem se atribui a si mesmo não recebe notificação. E a escolha do aviso no celular **vale por aparelho**, não por pessoa: ligar no celular não liga no computador.

**Onde aparece na interface.** Menu **Notificações** (com contador de não lidas ao lado, no menu lateral). O aviso no celular se configura em **Configurações → Avisos no celular**, com três opções por aparelho: **Desligado**, **Só o que precisa de gente**, **Toda mensagem**.

---

## Agendamento / compromisso

**O que é.** Um horário marcado com um contato: início, fim, assunto e status. Pode ser marcado pelo robô durante a conversa ou à mão pela equipe. Se a Google Agenda estiver conectada, também vira evento lá.

**O que não é.** Não é um bloqueio de agenda genérico — todo compromisso é de um contato. **Cada cliente tem no máximo um compromisso vivo por vez**, de propósito: pedir outro é remarcar o existente. **Não existe excluir**, só cancelar. E conectar o Google não é obrigatório: sem ele o agendamento funciona só com as marcações feitas dentro do iMasterChat.

**Onde aparece na interface.** Menu **Agenda** (alternância Semana/Dia, botão **Novo agendamento**, e o detalhe com **Remarcar** e **Cancelar agendamento**). As regras de horário ficam em **Configurações → Agendamento**.

---

## Ferramenta (do agente)

**O que é.** Uma ação que o modelo pode executar durante a conversa, além de escrever texto. Hoje são cinco: chamar uma pessoa, consultar horários livres, marcar, remarcar e cancelar horário.

**O que não é.** Não é tudo o que se imagina: **a IA não põe etiqueta, não cria negócio, não muda o status da conversa e não atribui conversa a ninguém.** Ferramenta desligada não fica "indisponível" — ela some do catálogo, e o modelo nem sabe que existia. A de chamar uma pessoa não pode ser desligada.

**Onde aparece na interface.** **Agentes de IA → Limites**, no card **O que o agente pode fazer** (acima das listas de limites). Só Administrador mexe nos interruptores.

---

## Playground e rascunho

**O que é.** O **Playground** é a aba de ensaio: conversa de teste com o mesmo cérebro, mostrando quais ferramentas o modelo chamou; as ferramentas de agenda rodam em modo seco e não gravam nada. O **rascunho** é o botão de varinha na caixa de escrita: o modelo escreve um texto, o atendente lê, edita e decide se envia.

**O que não é.** Nenhum dos dois é a resposta automática. **O Playground não recebe os Limites de assunto** — uma pergunta sobre reembolso pode ser respondida no ensaio e transferida em produção. **O rascunho é ainda mais diferente**: não recebe Vault, nem Limites, nem ferramentas, nem os fatos do momento. Não use nenhum dos dois para concluir "a IA sabe" ou "a IA não sabe" alguma coisa.

**Onde aparece na interface.** Aba **Playground** de **Agentes de IA**; o rascunho é o botão de varinha (✨) na caixa de escrita da **Caixa de entrada**.

---

## Chave de API e escopo

**O que é.** A **chave de API** é a credencial que um sistema de fora usa para falar com o iMasterChat (mandar mensagem, criar contato, ler conversa, marcar agendamento, disparar campanha). O **escopo** é cada permissão marcada na criação da chave — são 10, e a chave só faz o que os escopos dela permitem.

**O que não é.** Não é login e senha, e não herda o papel de quem a criou: **o escopo é a única autorização**, avaliada a cada chamada. Uma chave com permissão de disparo continua disparando mesmo que o Administrador que a criou saia da empresa — até alguém revogar. A chave completa **aparece uma única vez**; perdeu, revoga e cria outra. Revogar não apaga a linha da lista.

**Onde aparece na interface.** **Configurações → Chaves de API**, botões **Nova chave de API** e **Revogar** (ambos só para Administrador ou Proprietário; qualquer membro vê a lista).

---

## Webhook

**O que é.** Cuidado: a palavra tem **dois sentidos opostos** neste sistema.
O **webhook de entrada** é o endereço do iMasterChat que a Meta chama quando chega mensagem — configurado uma vez, no painel de apps da Meta, na hora de conectar o número.
O **webhook de saída** é o endereço HTTPS do cliente que o iMasterChat chama, com um POST assinado, quando acontece algo (chegou mensagem, mudou status de entrega, conversa criada, conversa reaberta).

**O que não é.** O de saída **não tem tela**: só se cria, edita e apaga chamando a própria API com uma chave que tenha o escopo de gerenciar webhooks. Um tutorial que mande o cliente "ir em Configurações → Webhooks" está errado. Também não tem repetição: é **uma tentativa por evento**, sem fila e sem reenvio; 15 falhas seguidas desativam o endereço sozinho.

**Onde aparece na interface.** O de entrada: **Configurações → WhatsApp**, no bloco **Configuração do webhook** (é de onde se copia a URL de callback). O de saída: em lugar nenhum.

---

## Agendador (o `cron`)

**O que é.** Um processo que roda ao lado da aplicação e, a cada poucos minutos, bate em algumas portas do sistema: executa as esperas vencidas das automações, aposenta execuções de fluxo abandonadas, liquida compromissos que já passaram, roda o keeper do Vault, atualiza a cotação do dólar e faz a ronda de saúde.

**O que não é.** Não é o "Baseado em horário" das automações — esse gatilho não é acionado por nada. Não tem tela: liga-se por variável de ambiente no servidor. E **não é opcional**: sem ele, o passo Espera nunca acorda, nenhum fluxo é encerrado por tempo e, o mais visível para o cliente, o bot passa a dizer que a pessoa "já tem um agendamento" sobre um compromisso da semana passada.

**Onde aparece na interface.** Só indiretamente, na faixa de saúde do painel **Administração**, que acusa atraso depois de 2 horas sem sinal. O dono da conta não tem como saber.

---

## Presença

**O que é.** A bolinha ao lado do nome de cada colega: **online**, **ausente** ou **offline**. O app manda um sinal a cada 30 segundos enquanto a aba está aberta; 5 minutos sem interação viram "ausente"; fechar a aba leva a "offline" 75 segundos depois.

**O que não é.** Não é controle de jornada e não tem nada a ver com estar disponível para atender. Não há nada para configurar.

**Onde aparece na interface.** No menu **Atribuir** da conversa e no roster de **Configurações → Membros da equipe**.

---

## Fila

**O que é.** Nada. **Fila não existe como estrutura do sistema** — não há tabela de fila, time, departamento nem especialidade.

**O que não é.** O que o produto chama de "fila" é apenas a combinação status **Pendente** + sem dono: qualquer Atendente pode abrir e assumir. É por isso que a opção de destino do handoff se chama "Fila sem atribuição (qualquer atendente pode assumir)" — é a ausência de dono, não uma fila de verdade. Não existe distribuição automática, nem rodízio que funcione, nem roteamento por assunto.

**Onde aparece na interface.** Como texto, em **Agentes de IA → Configuração**, no campo "Passar para". Na prática, filtre a **Caixa de entrada** por **Pendentes**.
