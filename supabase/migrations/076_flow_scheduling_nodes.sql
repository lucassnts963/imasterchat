-- ============================================================
-- 076 — agendamento como nó de fluxo (fase 1, R-4)
--
-- Até aqui marcar horário só existia como ferramenta do agente de IA.
-- Não porque a regra fosse de IA — `src/lib/scheduling/` sempre foi
-- domínio puro — mas porque só o agente tinha invólucro para ela. O
-- efeito prático era que o cliente que recusa o custo do modelo ficava
-- sem agendamento nenhum: não uma versão pior, ausência.
--
-- Quatro nós novos, todos sobre `src/lib/actions/scheduling.ts`:
--
--   offer_slots            consulta os horários livres e oferece como
--                          lista, esperando a escolha
--   book_appointment       marca o horário escolhido
--   reschedule_appointment move o agendamento vivo do contato
--   cancel_appointment     cancela o agendamento vivo do contato
--
-- Só o CHECK muda. As configurações moram no `config JSONB` que já
-- existe, como todo nó — e é por isso que esta migração é de três
-- linhas e não de três tabelas.
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
    'collect_input',
    'condition',
    'set_tag',
    'offer_slots',
    'book_appointment',
    'reschedule_appointment',
    'cancel_appointment',
    'handoff',
    'http_fetch',
    'end'
  ));
