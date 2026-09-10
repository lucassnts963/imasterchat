-- ============================================================
-- 078 — espera de relógio e webhook no fluxo (fase 1, R-9)
--
-- As duas últimas células da matriz da fase 1. A automação sempre teve
-- `wait` e `send_webhook`; o fluxo não, e sem eles não existe "se não
-- responder em 1 hora, insista" — que é metade de uma régua de cobrança.
--
-- A espera precisa de estado, ao contrário de todo o resto que esta fase
-- acrescentou. Um fluxo suspende esperando o CLIENTE, e quem o acorda é
-- a mensagem dele; um fluxo parado num `wait` não tem quem o acorde, e é
-- por isso que `resume_at` existe: é o cron que volta para buscá-lo.
--
-- O índice é parcial de propósito. Runs esperando relógio são uma fração
-- pequena dos ativos, e a varredura roda a cada poucos minutos — indexar
-- só quem tem hora marcada mantém a consulta barata e o índice pequeno.
-- ============================================================

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS resume_at TIMESTAMPTZ;

COMMENT ON COLUMN flow_runs.resume_at IS
  'Quando o cron deve retomar um run parado num nó `wait`. NULL para todo o resto — inclusive para um run suspenso esperando o cliente, que é acordado pela mensagem dele e não pelo relógio.';

CREATE INDEX IF NOT EXISTS idx_flow_runs_resume_at
  ON flow_runs (resume_at)
  WHERE status = 'active' AND resume_at IS NOT NULL;

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'send_template',
    'collect_input',
    'condition',
    'set_tag',
    'update_contact_field',
    'create_deal',
    'assign_conversation',
    'close_conversation',
    'route_to_queue',
    'offer_slots',
    'book_appointment',
    'reschedule_appointment',
    'cancel_appointment',
    'wait',
    'send_webhook',
    'handoff',
    'http_fetch',
    'end'
  ));
