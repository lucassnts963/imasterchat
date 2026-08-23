-- ============================================================
-- Os números de comportamento saem do código
--
-- Quatro constantes governavam como o agente conversa, e duas delas
-- foram escolhidas esta semana em resposta a um problema concreto: o
-- bot despejou 42 horários numa mensagem, e a correção foi trocar
-- números dentro de arquivos .ts.
--
-- Isso não escala como decisão de produto. São números que variam
-- entre negócios — uma consultoria e uma pizzaria não concordam sobre
-- quanto silêncio faz um "oi" ser conversa nova — e mudá-los exigia
-- rebuild da imagem.
--
-- A regra que fica: número que varia entre negócios nasce coluna, não
-- constante. Texto que só o MODELO lê continua no código, porque o
-- cliente final nunca o vê e editá-lo mal quebra o agente de um jeito
-- difícil de diagnosticar.
--
-- Os padrões abaixo são exatamente os valores que estavam no código, de
-- propósito: aplicar esta migração não muda o comportamento de nenhuma
-- conta. Ela só abre a porta.
-- ============================================================

-- ------------------------------------------------------------
-- Conversa
-- ------------------------------------------------------------
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS new_session_hours integer NOT NULL DEFAULT 8;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_new_session_hours_check;

-- Teto de uma semana: acima disso a regra deixa de distinguir coisa
-- alguma, porque quase todo retorno vira "conversa nova". Piso de uma
-- hora porque abaixo disso ela dispararia no meio de um atendimento —
-- o cliente que demora para responder viraria contato novo.
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_new_session_hours_check
  CHECK (new_session_hours BETWEEN 1 AND 168);

COMMENT ON COLUMN public.ai_configs.new_session_hours IS
  'A partir de quantas horas de silêncio um retorno do cliente é tratado '
  'como conversa NOVA — o agente para de assumir o assunto anterior e '
  'para de transferir por causa de fio solto no passado.';

-- ------------------------------------------------------------
-- Agendamento
-- ------------------------------------------------------------
ALTER TABLE public.ai_scheduling_settings
  ADD COLUMN IF NOT EXISTS lookahead_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS slot_fetch_limit integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS offer_slots_max integer NOT NULL DEFAULT 3;

ALTER TABLE public.ai_scheduling_settings
  DROP CONSTRAINT IF EXISTS ai_scheduling_settings_lookahead_days_check,
  DROP CONSTRAINT IF EXISTS ai_scheduling_settings_slot_fetch_limit_check,
  DROP CONSTRAINT IF EXISTS ai_scheduling_settings_offer_slots_max_check;

ALTER TABLE public.ai_scheduling_settings
  ADD CONSTRAINT ai_scheduling_settings_lookahead_days_check
    CHECK (lookahead_days BETWEEN 1 AND 90),
  -- Teto de 60: a lista vai inteira para o modelo e é paga em tokens
  -- toda vez. Foi um teto de 40 que produziu a parede de 42 horários.
  ADD CONSTRAINT ai_scheduling_settings_slot_fetch_limit_check
    CHECK (slot_fetch_limit BETWEEN 3 AND 60),
  -- Teto de 10 porque acima disso volta a ser uma parede, que é o
  -- problema que este número existe para evitar.
  ADD CONSTRAINT ai_scheduling_settings_offer_slots_max_check
    CHECK (offer_slots_max BETWEEN 1 AND 10);

COMMENT ON COLUMN public.ai_scheduling_settings.lookahead_days IS
  'Quantos dias à frente o agente procura horário quando o cliente não '
  'diz uma data.';

COMMENT ON COLUMN public.ai_scheduling_settings.slot_fetch_limit IS
  'Quantas vagas a consulta traz. Vão todas para o modelo e custam '
  'tokens; ele oferece apenas offer_slots_max delas ao cliente.';

COMMENT ON COLUMN public.ai_scheduling_settings.offer_slots_max IS
  'Quantos horários o bot nomeia por mensagem. Acima de 3 a resposta '
  'começa a parecer formulário em vez de oferta.';
