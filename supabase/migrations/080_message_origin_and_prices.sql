-- ============================================================
-- 080 — de onde veio a mensagem, e quanto ela custa (fase 3)
--
-- A 075 passou a gravar o que a META cobrou por mensagem. Faltavam duas
-- coisas para isso virar uma tela útil:
--
--   1. QUANTO. A Meta diz a categoria; a tabela de preços transforma
--      contagem em dinheiro.
--   2. DE ONDE. Um total mensal sem quebra por origem informa que a
--      conta subiu e não o que cortar. "Trinta dólares em resposta
--      automática de IA" e "trinta dólares em broadcast" pedem decisões
--      opostas.
--
-- `messages.origin` é gravado no ENVIO, por quem envia — a única hora em
-- que se sabe. O webhook de status, que grava o custo, não tem como
-- descobrir isso depois.
-- ============================================================

-- ------------------------------------------------------------
-- 1. De onde veio cada mensagem
-- ------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS origin TEXT;

COMMENT ON COLUMN messages.origin IS
  'Qual superfície enviou: ai | inbox | automation | flow | broadcast | api. NULL nas mensagens gravadas antes desta migração e em toda mensagem recebida. Sem CHECK de propósito — uma superfície nova não pode derrubar um envio que já chegou na Meta.';

-- O único padrão de leitura: juntar custo com origem dentro de um mês.
CREATE INDEX IF NOT EXISTS messages_message_id_idx
  ON messages (message_id)
  WHERE message_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Quanto custa uma mensagem
-- ------------------------------------------------------------
--
-- Mesmo padrão de `ai_model_prices`: uma tabela que o administrador da
-- plataforma preenche, por cima de constantes no código. Preço ausente
-- ou tabela inacessível cai na constante — mostrar preço levemente
-- defasado é melhor que mostrar erro onde devia haver número.
--
-- `effective_from` existe porque 1º/10/2026 MUDA a tarifa de serviço, e
-- o histórico anterior tem de continuar sendo lido pelo preço da época.
-- Sem vigência, corrigir a tabela reescreveria o passado.
CREATE TABLE IF NOT EXISTS whatsapp_message_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ISO 3166-1 alfa-2, ou '*' para o preço padrão de qualquer país.
  country_code    text NOT NULL DEFAULT '*',
  -- marketing | utility | service | authentication
  category        text NOT NULL,
  price_usd       numeric(12, 6) NOT NULL,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Um preço por país, categoria e vigência.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_message_prices_key_idx
  ON whatsapp_message_prices (country_code, category, effective_from);

ALTER TABLE whatsapp_message_prices ENABLE ROW LEVEL SECURITY;

-- Tabela da plataforma, não da conta: qualquer membro autenticado lê
-- (as telas de custo precisam), e só o admin de plataforma escreve.
DROP POLICY IF EXISTS whatsapp_message_prices_select ON whatsapp_message_prices;
CREATE POLICY whatsapp_message_prices_select ON whatsapp_message_prices FOR SELECT
  TO authenticated USING (true);

-- ------------------------------------------------------------
-- 3. Segundo teto de orçamento
-- ------------------------------------------------------------
--
-- `monthly_budget_usd` protege o gasto de LLM. A partir de outubro
-- existem DOIS custos por conversa, e um teto que enxerga um só não é
-- teto.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS whatsapp_monthly_budget_usd numeric(12, 2);

COMMENT ON COLUMN ai_configs.whatsapp_monthly_budget_usd IS
  'Teto mensal de gasto com MENSAGENS da Meta, em dólares. NULL = sem teto. Independente de monthly_budget_usd, que é o teto de LLM.';

-- ------------------------------------------------------------
-- 4. Quando uma mensagem foi barrada por orçamento
-- ------------------------------------------------------------
--
-- Mensagem que não saiu não pode sumir em silêncio: sem registro, "o
-- cliente não recebeu" vira indepurável, e o operador culpa a Meta.
CREATE TABLE IF NOT EXISTS whatsapp_blocked_sends (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  -- ai | automation | flow | broadcast | api
  origin          text,
  reason          text NOT NULL,
  blocked_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_blocked_sends_account_idx
  ON whatsapp_blocked_sends (account_id, blocked_at DESC);

ALTER TABLE whatsapp_blocked_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_blocked_sends_select ON whatsapp_blocked_sends;
CREATE POLICY whatsapp_blocked_sends_select ON whatsapp_blocked_sends FOR SELECT
  USING (is_account_member(account_id, 'admin'));
