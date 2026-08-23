-- ============================================================
-- Filas de atendimento.
--
-- A ideia que unifica o desenho não é minha, é do dono do produto:
-- **toda conversa está sempre em exatamente uma fila**, e a fila diz
-- quem atende — o robô ou um time. Com isso o handoff deixa de ser um
-- estado especial e vira "mudou de fila", e o robô deixa de ser um caso
-- à parte para virar uma fila como qualquer outra.
--
-- Antes disto, "fila" era uma convenção: `status = 'pending'` com
-- `assigned_agent_id IS NULL`. Dava para operar, mas não dava para ver
-- nada — nem quantas esperam, nem há quanto tempo, nem por onde a
-- conversa passou.
--
-- O que esta migração NÃO faz, de propósito: distribuir. `distribution`
-- nasce em 'responsible', que é o comportamento simples (a fila tem um
-- dono e tudo cai nele). Rodízio de verdade é a onda 6 e só vale com
-- três ou mais pessoas na mesma fila — ver docs/plano.md.
-- ============================================================

-- ------------------------------------------------------------
-- 1. As filas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.queues (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),

  -- O que o MODELO lê para escolher a fila. Não é enfeite: é o texto
  -- que decide o encaminhamento. Curto porque cada fila paga o próprio
  -- espaço no prompt de TODA resposta.
  description         text CHECK (description IS NULL OR char_length(description) <= 200),

  -- Quem atende. 'ai' é a fila do robô; 'humans' é um time.
  attended_by         text NOT NULL DEFAULT 'humans'
                      CHECK (attended_by IN ('ai', 'humans')),

  -- Quem RESPONDE pela fila. Um só — e um usuário pode responder por
  -- várias, o que sai de graça de a coluna ser simples. É
  -- responsabilidade, não distribuição.
  responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Encaminhar para esta fila atribui a conversa a alguém?
  --
  -- Importa mais do que parece: ter dono é o portão que cala o bot
  -- (`lib/ai/auto-reply.ts`). Com `auto_assign = true`, encaminhar para
  -- uma fila humana desliga a IA naquela conversa — que é o certo
  -- quando a fila é um time de gente, e seria errado numa fila de
  -- triagem onde o robô deve continuar trabalhando.
  auto_assign         boolean NOT NULL DEFAULT true,

  -- Como escolher a pessoa. 'responsible' é o simples e o padrão.
  -- 'none' deixa na fila sem dono (sala de espera compartilhada).
  -- 'round_robin' e 'least_busy' existem no CHECK para o schema não
  -- precisar mudar depois, mas AINDA NÃO SÃO IMPLEMENTADOS.
  distribution        text NOT NULL DEFAULT 'responsible'
                      CHECK (distribution IN ('responsible', 'none', 'round_robin', 'least_busy')),

  -- Cursor do rodízio. Vive aqui porque o UPDATE que o avança é a trava
  -- que serializa dois encaminhamentos simultâneos — sem isso, duas
  -- mensagens no mesmo instante escolhem a mesma pessoa e o rodízio
  -- desaparece justamente no pico.
  rr_cursor           bigint NOT NULL DEFAULT 0,

  -- Pular quem está offline ao distribuir. Atribuir para quem foi
  -- embora esconde o problema; deixar na fila mostra que falta gente.
  skip_offline        boolean NOT NULL DEFAULT true,

  -- Teto de conversas em atendimento simultâneo. Hoje só faz sentido na
  -- fila da IA: é onde o controle de sobrecarga vai morar, para 3.000
  -- mensagens virarem espera visível em vez de 429 invisível.
  concurrency_limit   integer CHECK (concurrency_limit IS NULL OR concurrency_limit > 0),

  is_default          boolean NOT NULL DEFAULT false,
  position            integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Nome único por conta, sem diferenciar maiúscula: "Financeiro" e
-- "financeiro" seriam duas filas que ninguém consegue distinguir na tela.
CREATE UNIQUE INDEX IF NOT EXISTS queues_account_name
  ON public.queues (account_id, lower(name));

-- Uma fila padrão por conta, no máximo.
CREATE UNIQUE INDEX IF NOT EXISTS queues_one_default
  ON public.queues (account_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_queues_account_active
  ON public.queues (account_id, active, position);

-- ------------------------------------------------------------
-- 2. Quem recebe de cada fila
--
-- Separado do responsável porque são perguntas diferentes: "quem
-- responde por isto" tem uma resposta, "entre quem eu reparto" tem
-- várias. Com esta tabela vazia e distribution='responsible', o
-- comportamento é o simples — tudo cai no responsável.
--
-- `account_id` denormalizado para a RLS não precisar de subconsulta em
-- toda linha.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.queue_members (
  queue_id   uuid NOT NULL REFERENCES public.queues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_members_user
  ON public.queue_members (user_id);

-- ------------------------------------------------------------
-- 3. Onde a conversa está agora
-- ------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS queue_id uuid REFERENCES public.queues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_account_queue
  ON public.conversations (account_id, queue_id, status);

-- ------------------------------------------------------------
-- 4. Por onde passou, e quanto tempo ficou
--
-- NÃO é uma tabela de eventos, e o nome evita isso de propósito: já
-- existem `platform_events` e `flow_run_events` com sentidos
-- diferentes, e um terceiro `*_events` seria confusão garantida.
--
-- É um registro de ESTADAS: uma linha por passagem, aberta na entrada e
-- fechada na saída. Assim "quanto tempo esperou" é uma subtração
-- (`left_at - entered_at`) em vez de uma agregação sobre pares de
-- eventos, e "o que está esperando agora" é um índice parcial.
--
-- Aviso que vale repetir: isto só responde sobre o que for gravado a
-- partir de hoje. Passado não gravado não volta.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_queue_stays (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  queue_id         uuid NOT NULL REFERENCES public.queues(id) ON DELETE CASCADE,
  entered_at       timestamptz NOT NULL DEFAULT now(),
  left_at          timestamptz,
  -- Quem estava com ela NESTA passagem, se alguém.
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  exit_reason      text CHECK (exit_reason IS NULL OR exit_reason IN
                     ('handoff', 'resolved', 'reopened', 'manual', 'closed'))
);

-- Uma conversa só pode ter UMA estada aberta. É esta restrição que
-- torna o histórico confiável: sem ela, um caminho esquecido de fechar
-- a estada anterior produz duas passagens simultâneas e todo cálculo de
-- tempo passa a mentir.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_queue_stays_open
  ON public.conversation_queue_stays (conversation_id) WHERE left_at IS NULL;

-- "O que está esperando agora, e há quanto tempo" — a consulta que o
-- alerta de SLA vai fazer.
CREATE INDEX IF NOT EXISTS idx_stays_queue_open
  ON public.conversation_queue_stays (queue_id, entered_at) WHERE left_at IS NULL;

-- Histórico por conversa.
CREATE INDEX IF NOT EXISTS idx_stays_conversation
  ON public.conversation_queue_stays (conversation_id, entered_at DESC);

-- ------------------------------------------------------------
-- 5. RLS
--
-- Mesmo desenho já usado para `tags`: ler é de qualquer membro;
-- CRIAR/EDITAR/APAGAR exige admin. Encaminhar uma conversa para uma
-- fila é escrever em `conversations`, que já exige 'agent'.
--
-- As estadas são só de leitura pelo cliente: quem as escreve é o
-- servidor, com a chave de serviço, nos caminhos que mudam a fila.
-- Deixar o navegador escrever aqui permitiria forjar tempo de espera.
-- ------------------------------------------------------------
ALTER TABLE public.queues                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_queue_stays  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS queues_select ON public.queues;
CREATE POLICY queues_select ON public.queues
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS queues_modify ON public.queues;
CREATE POLICY queues_modify ON public.queues
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS queue_members_select ON public.queue_members;
CREATE POLICY queue_members_select ON public.queue_members
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS queue_members_modify ON public.queue_members;
CREATE POLICY queue_members_modify ON public.queue_members
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS stays_select ON public.conversation_queue_stays;
CREATE POLICY stays_select ON public.conversation_queue_stays
  FOR SELECT USING (public.is_account_member(account_id));
-- Sem policy de INSERT/UPDATE/DELETE: com RLS ligada, o que não tem
-- policy é negado. Só a chave de serviço escreve.

-- Permissões de coluna explícitas, como manda a lição da 063: nada de
-- GRANT amplo que uma migração futura reabra sem ninguém notar.
GRANT SELECT ON public.queues, public.queue_members, public.conversation_queue_stays
  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.queues, public.queue_members TO authenticated;

-- ------------------------------------------------------------
-- 6. Toda conta tem a fila do robô
--
-- Trigger em `accounts`, e não dentro de `handle_new_user`: aquela
-- função tem um `EXCEPTION WHEN OTHERS` que engole falhas, e uma conta
-- sem fila padrão seria um estado inconsistente descoberto tarde. Aqui
-- também cobre conta criada por qualquer outro caminho.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_default_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.queues
    (account_id, name, description, attended_by, is_default, auto_assign,
     distribution, position)
  VALUES
    (NEW.id,
     'Atendimento automático',
     'Onde a conversa começa: o assistente responde sozinho até precisar de uma pessoa.',
     'ai', true, false, 'none', 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_default_queue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_create_default_queue ON public.accounts;
CREATE TRIGGER trg_create_default_queue
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.create_default_queue();

-- ------------------------------------------------------------
-- 7. Backfill
-- ------------------------------------------------------------

-- A fila padrão para as contas que já existem.
INSERT INTO public.queues
  (account_id, name, description, attended_by, is_default, auto_assign, distribution, position)
SELECT a.id,
       'Atendimento automático',
       'Onde a conversa começa: o assistente responde sozinho até precisar de uma pessoa.',
       'ai', true, false, 'none', 0
  FROM public.accounts a
 WHERE NOT EXISTS (
   SELECT 1 FROM public.queues q WHERE q.account_id = a.id AND q.is_default
 );

-- As conversas existentes entram na fila padrão da conta delas.
UPDATE public.conversations c
   SET queue_id = q.id
  FROM public.queues q
 WHERE q.account_id = c.account_id
   AND q.is_default
   AND c.queue_id IS NULL;

-- E ganham uma estada ABERTA — só as que ainda estão vivas. Conversa
-- fechada não está esperando ninguém, e abrir estada para ela encheria
-- de ruído a consulta de "o que está na fila agora".
--
-- `entered_at` é AGORA, e não a data de criação da conversa. Fingir que
-- uma conversa de março esperou cinco meses produziria um relatório
-- falso no primeiro dia. O histórico começa hoje, e isso está dito em
-- docs/plano.md.
INSERT INTO public.conversation_queue_stays
  (account_id, conversation_id, queue_id, entered_at, assigned_user_id)
SELECT c.account_id, c.id, c.queue_id, now(), c.assigned_agent_id
  FROM public.conversations c
 WHERE c.queue_id IS NOT NULL
   AND c.status <> 'closed'
   AND NOT EXISTS (
     SELECT 1 FROM public.conversation_queue_stays s
      WHERE s.conversation_id = c.id AND s.left_at IS NULL
   );

COMMENT ON TABLE public.conversation_queue_stays IS
  'Uma linha por PASSAGEM de uma conversa por uma fila, aberta na entrada '
  'e fechada na saída. Não é log de eventos (ver platform_events e '
  'flow_run_events, que são outra coisa). Tempo de espera = left_at - entered_at.';
