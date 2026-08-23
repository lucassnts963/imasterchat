-- ============================================================
-- Quantas mensagens do histórico vão ao modelo, por conta
--
-- Era só `AI_CONTEXT_MESSAGE_LIMIT`, variável do servidor inteiro. E o
-- número certo depende do ramo: uma ótica resolve em seis mensagens,
-- uma consultoria tem conversas de quarenta. Com uma variável só,
-- atender os dois significa pagar o pior caso para todo mundo — porque
-- este número é o tamanho do contexto, ou seja o custo de TODA
-- resposta.
--
-- Anulável, e não com DEFAULT 20, de propósito: nulo significa "usa o
-- que o servidor manda". Assim a variável de ambiente continua valendo
-- para quem a definiu, e a coluna só entra em cena quando alguém
-- realmente escolheu.
--
-- É a mesma semântica de `max_tool_steps`, e a precedência é a mesma
-- que `maxToolSteps()` implementa: conta primeiro, variável depois,
-- padrão por último. Duas colunas com regra igual é uma regra a menos
-- para lembrar.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS context_message_limit integer;

ALTER TABLE public.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_context_message_limit_check;

-- Piso de 4: abaixo disso o modelo perde o fio de uma conversa comum —
-- pergunta, resposta, contrapergunta e resposta já são quatro.
-- Teto de 60 porque cada mensagem é paga em toda resposta, e uma
-- conversa que precise de mais que isso é caso de vault, não de
-- histórico maior.
ALTER TABLE public.ai_configs
  ADD CONSTRAINT ai_configs_context_message_limit_check
  CHECK (
    context_message_limit IS NULL
    OR context_message_limit BETWEEN 4 AND 60
  );

COMMENT ON COLUMN public.ai_configs.context_message_limit IS
  'Mensagens do histórico enviadas ao modelo. NULO usa '
  'AI_CONTEXT_MESSAGE_LIMIT e, na falta dela, 20. É o tamanho do '
  'contexto: mexe no custo de toda resposta.';
