-- ============================================================
-- Transbordo: quando ninguém pega, passa adiante.
--
-- O 6.1 pôs um relógio na fila e fez alguém ser avisado. Avisar resolve
-- quando existe quem atenda; não resolve o Financeiro numa sexta às 19h.
--
-- O transbordo é o passo seguinte: passado o prazo, a conversa MUDA de
-- fila sozinha, para um lugar onde há gente. É a mesma promessa de
-- sempre — ninguém fica sem resposta — aplicada ao caso em que a fila
-- certa está vazia.
-- ============================================================

ALTER TABLE public.queues
  -- Para onde vai quando ninguém pega. Nulo = não transborda (padrão).
  ADD COLUMN IF NOT EXISTS overflow_queue_id uuid
    REFERENCES public.queues(id) ON DELETE SET NULL,

  -- Depois de quanto tempo. Separado do `sla_seconds` de propósito:
  -- avisar e desistir são decisões diferentes, e quase sempre com prazos
  -- diferentes — avisa-se em 15 minutos, transborda-se em uma hora.
  ADD COLUMN IF NOT EXISTS overflow_after_seconds integer
    CHECK (overflow_after_seconds IS NULL
           OR overflow_after_seconds BETWEEN 60 AND 86400);

-- Uma fila não transborda para si mesma. Sem isto, o primeiro erro de
-- digitação na tela viraria uma conversa mudando de fila para a mesma
-- fila a cada rodada do cron, para sempre.
ALTER TABLE public.queues
  DROP CONSTRAINT IF EXISTS queues_no_self_overflow;
ALTER TABLE public.queues
  ADD CONSTRAINT queues_no_self_overflow
  CHECK (overflow_queue_id IS NULL OR overflow_queue_id <> id);

ALTER TABLE public.conversation_queue_stays
  -- Esta passagem começou por transbordo?
  --
  -- É o que impede o pingue-pongue. Com A → B e B → A configurados (ou
  -- uma corrente mais longa), uma conversa ficaria mudando de fila para
  -- sempre, parecendo movimento e sendo abandono. Só se transborda a
  -- partir de uma passagem que NÃO veio de transbordo: um salto, e
  -- então ela fica onde está até uma pessoa agir.
  ADD COLUMN IF NOT EXISTS entered_by_overflow boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.queues.overflow_queue_id IS
  'Para onde a conversa vai quando ninguém pega dentro de '
  'overflow_after_seconds. Nulo = não transborda (padrão).';

COMMENT ON COLUMN public.conversation_queue_stays.entered_by_overflow IS
  'Passagem iniciada por transbordo. Um salto só: sem isso, filas '
  'apontando uma para a outra fariam a conversa circular para sempre — '
  'movimento que parece atendimento e é abandono.';
