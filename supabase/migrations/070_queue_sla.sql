-- ============================================================
-- O relógio da fila.
--
-- A Onda 5 fez a fila existir e o histórico de passagens existir. Falta
-- a parte que transforma isso em produto: alguém avisar quando uma
-- conversa está parada.
--
-- Sem isto, "7 conversas esperando há 40 minutos no Financeiro" é uma
-- consulta que ninguém faz. O alerta é o que fecha a promessa de que
-- ninguém fica sem resposta — a fila da IA já garante isso do lado do
-- robô; do lado das pessoas, quem garante é o relógio.
-- ============================================================

ALTER TABLE public.queues
  -- Quanto se aceita esperar NESTA fila antes de alguém ser avisado.
  -- Nulo = sem SLA, que é o padrão: um alerta que ninguém pediu vira
  -- ruído, e ruído treina a equipe a ignorar alerta.
  ADD COLUMN IF NOT EXISTS sla_seconds integer
    CHECK (sla_seconds IS NULL OR sla_seconds BETWEEN 60 AND 86400);

ALTER TABLE public.conversation_queue_stays
  -- Quando o aviso saiu, para esta passagem.
  --
  -- Vive na ESTADA, e não na conversa: uma conversa que passa duas vezes
  -- pela mesma fila merece dois avisos, e um carimbo na conversa daria
  -- só um — o segundo atraso passaria calado.
  ADD COLUMN IF NOT EXISTS sla_alerted_at timestamptz;

-- A consulta do vigia: estadas abertas, não avisadas, mais velhas que o
-- SLA da fila. Índice parcial porque ele nunca olha para as fechadas nem
-- para as que já geraram aviso.
CREATE INDEX IF NOT EXISTS idx_stays_sla_watch
  ON public.conversation_queue_stays (entered_at)
  WHERE left_at IS NULL AND sla_alerted_at IS NULL;

COMMENT ON COLUMN public.queues.sla_seconds IS
  'Espera aceitável nesta fila antes do alerta. Nulo = sem SLA (padrão), '
  'porque alerta que ninguém pediu vira ruído e ruído treina a equipe a '
  'ignorar alerta.';
