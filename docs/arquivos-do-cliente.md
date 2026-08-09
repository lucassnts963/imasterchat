# Arquivos do cliente (boleto e o que vier depois)

Plano. Nada disto está implementado.

O pedido nasceu do boleto — o cliente pergunta pelo WhatsApp, o bot
manda. Mas boleto é só o primeiro: contrato, nota fiscal, orçamento,
receita e laudo têm o mesmo formato. Então o modelo é **arquivo de um
cliente**, com um `kind` que diz qual é.

## O risco que decide o desenho

Mandar o boleto do cliente A para o cliente B não é bug de usabilidade,
é incidente de LGPD com valor financeiro dentro. Tudo abaixo existe em
função disso.

A regra central: **o agente nunca nomeia o destinatário.** Ele pede
"o boleto" e o servidor resolve pelo `contact_id` da conversa em que a
mensagem chegou. O modelo não recebe telefone, não recebe caminho de
arquivo, não recebe id de contato. É o mesmo princípio que já vale nas
ferramentas de agenda, e pelo mesmo motivo escrito lá:

> um modelo que nunca vê um UUID é um modelo que não pode inventar um

## Onde o arquivo mora

Bucket **privado**, e não o `chat-media` que já existe.

O `chat-media` é público (migração 023) porque a Meta busca a URL no
momento do envio. Para uma foto que a loja mandou, tudo bem. Para o
boleto de um cliente, um bucket público significa um documento
financeiro numa URL que vive para sempre e não pede credencial.

A saída é **URL assinada de vida curta**: o bucket fica privado, e no
instante do envio geramos uma URL com validade de poucos minutos. A
Meta busca uma vez, e o link morre. `sendMediaMessage` já aceita
qualquer link, então nada muda no envio.

> Alternativa considerada e descartada por ora: subir o arquivo para a
> API de mídia da Meta e enviar por `media_id`. Some com o link, mas
> acrescenta uma chamada e um id que expira — complexidade que a URL
> assinada resolve sem.

## Modelo de dados

```sql
-- migração 0XX
create table public.client_files (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  kind text not null,              -- boleto | contrato | nota | orcamento | outro
  label text,                      -- "Boleto agosto/2026"
  reference text,                  -- "2026-08", "NF 1234" — o que o cliente diz
  storage_path text not null,      -- caminho no bucket privado
  mime_type text not null,
  size_bytes integer not null,
  expires_at timestamptz,          -- boleto vencido não se manda
  uploaded_by uuid references auth.users(id),
  sent_count integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
```

Decisões que valem comentário no arquivo da migração:

- **`contact_id` é NOT NULL.** Não existe arquivo "solto" à espera de
  dono. Um arquivo cujo dono não foi determinado não entra nesta
  tabela — fica na fila de pendências (abaixo). Permitir nulo aqui
  seria abrir a porta para o agente encontrar um arquivo sem dono e
  decidir de quem é.
- **`expires_at`.** Boleto vencido é o caso mais provável de reclamação:
  o cliente pede, recebe, tenta pagar, não dá. A ferramenta recusa o
  vencido e explica, em vez de mandar.
- **`sent_count` / `last_sent_at`.** Rastro de quem recebeu o quê e
  quando. É o que se olha quando alguém diz "nunca recebi".
- **Índice** `(account_id, contact_id, kind, created_at desc)` — é
  exatamente a consulta da ferramenta.

RLS: leitura e escrita por membro da conta; a ferramenta usa chave de
serviço mas filtra por `account_id` **e** `contact_id` da conversa.

## Como o arquivo entra

Duas portas, e a ordem importa.

### 1. Escolher o contato, depois enviar o arquivo (padrão)

É o caminho principal, e é o que a interface oferece primeiro.

```
Contatos → [contato] → Arquivos → Enviar arquivo
   ou
Arquivos → Enviar → [busca o contato] → [arquivo] → [tipo] → [validade]
```

O vínculo vem de uma escolha explícita na tela, não de uma string no
nome do arquivo. Ninguém precisa acertar dígito de telefone, e não há o
que interpretar errado.

### 2. Lote por convenção de nome (para quem tem muitos)

Só faz sentido no fim do mês, quando são 200 boletos de uma vez. Aí
pedir escolha um a um seria pior.

```
5591992417473-boleto-2026-08.pdf
└─ telefone ─┘ └tipo┘ └─ referência ─┘
```

Regras que a tela precisa deixar explícitas, **na própria tela**:

- o telefone é o primeiro campo, só dígitos, com DDI e DDD
- o resto é opcional; sem tipo, entra como `outro`
- **nada é adivinhado**: telefone que não casa com contato nenhum
  daquela conta vai para uma fila de pendências, com o nome do arquivo
  visível e um seletor de contato ao lado
- casou com mais de um contato (mesmo telefone em dois cadastros):
  também vai para a fila. Empate não é decisão do sistema

A fila de pendências é o coração da segurança deste caminho. **Um
arquivo que o sistema não soube atribuir nunca é enviado, e nunca
some** — ele espera uma pessoa.

## A ferramenta do agente

```
send_client_file(kind?, reference?)
```

O que ela NÃO recebe: telefone, `contact_id`, caminho, id de arquivo.

O que o servidor faz:

1. resolve o `contact_id` pela conversa
2. busca os arquivos daquele contato, filtrando por `kind`/`reference`
   quando vieram
3. **zero resultados** → devolve ao modelo que não há arquivo e o que
   dizer ao cliente
4. **um resultado** → gera URL assinada, envia, incrementa `sent_count`
5. **vários** → NÃO escolhe. Devolve a lista de rótulos para o modelo
   perguntar qual. Adivinhar entre dois boletos é mandar o mês errado
6. **vencido** → recusa e explica, mesmo se for o único

O passo 5 é onde uma implementação apressada erraria: "pega o mais
recente" parece razoável e manda o boleto de setembro para quem pediu o
de agosto.

## Telas

**Contato → aba Arquivos.** Lista, envio, remoção, e o histórico de
envio de cada um.

**Arquivos (nível da conta).** A visão de lote: envio múltiplo, a fila
de pendências, e filtro por tipo. É aqui que mora a instrução da
convenção de nome — escrita na tela, não num manual.

**Inbox.** Quando o bot manda um arquivo, ele aparece na conversa como
qualquer mídia. Já funciona; nada a fazer.

## Ordem de implementação

1. Migração + bucket privado + RLS
2. Upload com contato escolhido na tela (caminho 1) — já é útil sozinho,
   porque a atendente pode mandar manualmente
3. A ferramenta do agente, com os seis casos acima
4. Upload em lote + fila de pendências (caminho 2)
5. Validade e alerta de boleto vencendo

Os passos 1–3 entregam a funcionalidade inteira para quem tem poucos
clientes. O 4 é otimização para volume.

## O que testar antes de confiar

- pedir boleto sem ter nenhum
- pedir com dois disponíveis (deve perguntar, não escolher)
- pedir com um vencido (deve recusar e explicar)
- pedir de uma conversa cujo contato não tem arquivo, com OUTRO contato
  da mesma conta tendo — o teste que pega vazamento entre contatos
- lote com um telefone inexistente (deve ir para a fila, não sumir)
- lote com telefone repetido em dois contatos (deve ir para a fila)
