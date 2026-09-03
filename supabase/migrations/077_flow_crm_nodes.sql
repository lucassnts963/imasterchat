-- ============================================================
-- 077 — o fluxo aprende o que só a automação sabia (fase 1, R-6 a R-8)
--
-- A matriz de capacidades da fase 1 mostrou vinte e uma capacidades com
-- apenas quatro presentes nos três motores. Estas seis fecham o lado do
-- fluxo:
--
--   send_template          manda template aprovado — o item que DESTRAVA
--                          o fluxo fora da janela de 24h, e com ele a
--                          régua de cobrança
--   update_contact_field   escreve num campo do contato
--   create_deal            abre um negócio no funil
--   assign_conversation    põe a conversa na mão de alguém
--   close_conversation     fecha a conversa
--   route_to_queue         encaminha para uma fila humana e ENCERRA o run
--
-- Todos sobre `src/lib/actions/` — os mesmos módulos que a automação e o
-- agente usam. O fluxo não ganhou regra nova, ganhou acesso.
-- ============================================================

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
    'handoff',
    'http_fetch',
    'end'
  ));
