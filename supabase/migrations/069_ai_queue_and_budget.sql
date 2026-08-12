-- ============================================================
-- Ninguém fica sem resposta.
--
-- Esta migração escreve em SQL uma decisão de produto, dita assim:
-- "melhor uma mensagem que demorou a ser respondida do que alguém que
-- ficou sem resposta". Tudo aqui serve a isso.
--
-- Dois problemas, uma ideia:
--
-- 1. SOBRECARGA. Hoje 3.000 mensagens viram 3.000 chamadas simultâneas
--    na chave do cliente. O provedor recusa a maioria, e cada recusa é
--    um cliente sem resposta — em silêncio, porque um 429 não vira nada
--    visível em lugar nenhum.
--
-- 2. ORÇAMENTO. `monthly_budget_usd` é gravado, exibido e projetado, e
--    NENHUM código impede o gasto quando estoura. O cliente descobre o
--    limite pela fatura.
--
-- A ideia é a mesma nos dois: em vez de tentar e falhar, ESPERAR NA
-- FILA — e, se a espera passar do aceitável, chamar uma pessoa. O
-- excedente vira espera visível em vez de falha invisível.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Quantos a IA atende ao mesmo tempo, e quanto se aceita esperar
-- ------------------------------------------------------------
ALTER TABLE public.ai_configs
  -- Quantas respostas a IA gera em paralelo NESTA conta. O limite
  -- protege a chave do cliente: acima disso o provedor devolve 429, e
  -- 429 aqui significa cliente sem resposta.
  --
  -- 5 é conservador de propósito. É melhor uma fila que anda do que um
  -- teto alto que descobre o limite do provedor no primeiro pico.
  ADD COLUMN IF NOT EXISTS ai_concurrency_limit integer NOT NULL DEFAULT 5
    CHECK (ai_concurrency_limit BETWEEN 1 AND 50),

  -- Quanto tempo uma mensagem pode esperar na fila antes de virar
  -- assunto de gente. Passou disso, transfere — porque a promessa é que
  -- ninguém fica sem resposta, não que a IA responde tudo.
  --
  -- 300s = 5 minutos, que foi o número dado por quem opera.
  ADD COLUMN IF NOT EXISTS ai_max_wait_seconds integer NOT NULL DEFAULT 300
    CHECK (ai_max_wait_seconds BETWEEN 30 AND 3600),

  -- O que fazer quando o orçamento do mês acaba.
  --
  --   block_and_handoff  para de responder E chama uma pessoa (padrão)
  --   notify_only        continua respondendo, só registra o estouro
  --
  -- O padrão bloqueia porque a alternativa é o cliente descobrir o
  -- limite pela fatura. E chama alguém pelo mesmo motivo de sempre:
  -- parar de responder sem avisar ninguém deixaria o cliente no vácuo,
  -- que é justamente o que não pode acontecer.
  ADD COLUMN IF NOT EXISTS budget_exceeded_action text NOT NULL
    DEFAULT 'block_and_handoff'
    CHECK (budget_exceeded_action IN ('block_and_handoff', 'notify_only'));

-- Desde quando esta conversa espera uma resposta da IA que não coube no
-- teto de concorrência. Nulo = não está esperando.
--
-- Vive em `conversations`, e não numa tabela de fila própria, porque a
-- unidade de espera é a CONVERSA: dez mensagens do mesmo cliente
-- enquanto ele espera não são dez respostas devidas, são uma.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_pending_since timestamptz;

CREATE INDEX IF NOT EXISTS idx_conversations_ai_pending
  ON public.conversations (ai_pending_since)
  WHERE ai_pending_since IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Quem está sendo atendido pela IA agora
--
-- Uma linha por resposta em andamento. Some quando termina.
--
-- Tabela em vez de contador: um contador que só incrementa e decrementa
-- vaza para sempre quando um processo morre no meio, e o teto vai
-- fechando sozinho até a conta parar de responder — uma falha que
-- ninguém liga à causa meses depois. Com linhas, basta ignorar as
-- velhas.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_inflight (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  started_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_inflight_account
  ON public.ai_inflight (account_id, started_at);

ALTER TABLE public.ai_inflight ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_inflight FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3. Reivindicar uma vaga
--
-- Devolve `true` se coube, `false` se a conta está no teto.
--
-- O `INSERT ... ON CONFLICT DO NOTHING` no fim é o que torna isto
-- correto sob concorrência: duas requisições que passem juntas pela
-- contagem não conseguem as duas criar a linha da MESMA conversa.
--
-- Vagas com mais de 2 minutos não contam: o teto de parede do agente é
-- 60s, então uma linha mais velha que isso é processo morto. Sem essa
-- regra, o teto encolheria a cada queda até a conta emudecer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_ai_slot(
  p_account_id uuid,
  p_conversation_id uuid,
  p_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busy integer;
  v_inserted integer;
BEGIN
  DELETE FROM public.ai_inflight
   WHERE account_id = p_account_id
     AND started_at < now() - interval '2 minutes';

  SELECT count(*) INTO v_busy
    FROM public.ai_inflight
   WHERE account_id = p_account_id;

  -- Já é desta conversa? Então já tem vaga — não conta duas vezes.
  IF EXISTS (SELECT 1 FROM public.ai_inflight WHERE conversation_id = p_conversation_id) THEN
    RETURN true;
  END IF;

  IF v_busy >= GREATEST(p_limit, 1) THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_inflight (conversation_id, account_id)
  VALUES (p_conversation_id, p_account_id)
  ON CONFLICT (conversation_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END $$;

CREATE OR REPLACE FUNCTION public.release_ai_slot(p_conversation_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.ai_inflight WHERE conversation_id = p_conversation_id;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_ai_slot(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_ai_slot(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_slot(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_slot(uuid) TO service_role;

COMMENT ON TABLE public.ai_inflight IS
  'Respostas de IA em andamento, uma linha por conversa. Existe para o '
  'teto de concorrência por conta: acima dele a conversa espera na fila '
  'em vez de virar 429 do provedor — que seria cliente sem resposta.';

COMMENT ON COLUMN public.conversations.ai_pending_since IS
  'Desde quando espera resposta da IA que não coube no teto. Passando de '
  'ai_max_wait_seconds, a conversa é transferida para uma pessoa: a '
  'promessa é que ninguém fica sem resposta, não que a IA responde tudo.';
