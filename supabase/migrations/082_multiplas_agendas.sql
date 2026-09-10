-- ============================================================
-- 082 — mais de uma agenda do Google por conta (fase 6)
--
-- A migração 043 gravou a decisão no banco, com todas as letras:
--
--   account_id uuid NOT NULL UNIQUE REFERENCES accounts(id)
--   -- "UNIQUE, not just a FK: one calendar per account is the decision,
--   --  and the database should be the one enforcing it."
--
-- A decisão mudou, e o motivo é um caso concreto: um consultório com
-- dois profissionais tem duas agendas, e o horário livre de um não é o
-- horário livre do outro. Uma agenda por conta faz o bot marcar dois
-- clientes com o mesmo médico.
--
-- SELETOR ESCOLHIDO: **por profissional/recurso** (decisão D-1 do plano
-- geral). Cada conexão ganha um rótulo — "Dra. Ana", "Sala 2" — e é isso
-- que o cliente escolhe no menu, ou que a IA pergunta. É o palpite que o
-- documento da fase 6 registrou, e o que cobre consultório, salão e
-- oficina; "por serviço" e "disponibilidade agregada" continuam
-- possíveis por cima disto, sem outra migração.
--
-- Toda conta existente sai daqui com exatamente o que tinha: a conexão
-- atual vira a padrão, e nada na tela muda para quem tem uma agenda só.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Conexões: de 1:1 para 1:N
-- ------------------------------------------------------------
ALTER TABLE google_calendar_connections
  DROP CONSTRAINT IF EXISTS google_calendar_connections_account_id_key;

ALTER TABLE google_calendar_connections
  ADD COLUMN IF NOT EXISTS rotulo TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  -- A padrão é o que mantém compatível quem já usava: sem seletor, é
  -- ela que responde — exatamente como a única conexão respondia antes.
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN google_calendar_connections.rotulo IS
  'Como o cliente chama esta agenda: "Dra. Ana", "Sala 2". É o que aparece no menu de escolha. NULL nas conexões anteriores à migração 082.';

-- Uma padrão por conta. Parcial, para as não-padrão não competirem.
CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_default_idx
  ON google_calendar_connections (account_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS google_calendar_connections_account_idx
  ON google_calendar_connections (account_id)
  WHERE is_active;

-- A conexão que já existia vira a padrão. Sem isto, uma conta que
-- agendava normalmente pararia de agendar no deploy — que é o pior
-- desfecho possível de uma migração que só queria PERMITIR mais.
UPDATE google_calendar_connections
   SET is_default = true
 WHERE is_default = false
   AND NOT EXISTS (
     SELECT 1 FROM google_calendar_connections outra
      WHERE outra.account_id = google_calendar_connections.account_id
        AND outra.is_default
   );

-- ------------------------------------------------------------
-- 2. Regras de agendamento por agenda
-- ------------------------------------------------------------
--
-- Horário de funcionamento POR PROFISSIONAL é o caso comum: a Dra. Ana
-- atende de manhã e o Dr. Bruno à tarde, e uma configuração global
-- descreve mal os dois. A linha com `connection_id` nulo continua sendo
-- a da conta, e é o padrão de quem não configurou nada por agenda.
ALTER TABLE ai_scheduling_settings
  DROP CONSTRAINT IF EXISTS ai_scheduling_settings_account_id_key;

ALTER TABLE ai_scheduling_settings
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES google_calendar_connections(id) ON DELETE CASCADE;

-- Uma linha por (conta, agenda), e uma linha de conta com agenda nula.
CREATE UNIQUE INDEX IF NOT EXISTS ai_scheduling_settings_conta_idx
  ON ai_scheduling_settings (account_id)
  WHERE connection_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_scheduling_settings_agenda_idx
  ON ai_scheduling_settings (account_id, connection_id)
  WHERE connection_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Em qual agenda o compromisso entrou
-- ------------------------------------------------------------
--
-- Sem isto, remarcar e cancelar não sabem para qual agenda do Google
-- falar — e a confirmação não sabe dizer COM QUEM é o compromisso, que
-- é metade da informação para o cliente.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES google_calendar_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS appointments_connection_idx
  ON appointments (connection_id, starts_at)
  WHERE status = 'scheduled';
