-- ============================================================
-- A fila de entrada: gravar antes de confirmar.
--
-- Hoje o webhook responde 200 à Meta e SÓ ENTÃO processa, dentro de
-- `after()`. É correto para o timeout deles e tem um custo que só
-- aparece sob carga: se o container morrer no meio do processamento —
-- que é exatamente o que um pico provoca — aquelas mensagens somem. Já
-- dissemos à Meta que recebemos, e ela não reentrega o que foi
-- confirmado.
--
-- A troca:
--
--   hoje      valida → responde 200 → processa na memória
--   a partir  valida → GRAVA o evento cru → responde 200 → drena do banco
--
-- A durabilidade passa a vir de a linha já estar no banco, não de o
-- processo sobreviver. O dreno continua acontecendo na mesma requisição
-- (a latência de hoje não muda); o cron é só a rede para o que ficou
-- para trás.
--
-- ------------------------------------------------------------
-- A CHAVE DE IDEMPOTÊNCIA, que é onde é fácil errar
--
-- Não é o `wamid` sozinho. A migração 009 já registra por quê: os ids da
-- Meta NÃO são únicos entre números de telefone. Um índice global
-- funcionaria com um cliente e rejeitaria mensagem legítima do segundo.
--
-- E também não é `(phone_number_id, wamid)`: uma mesma mensagem gera
-- VÁRIOS eventos de status (sent → delivered → read), todos carregando o
-- mesmo wamid. Essa chave colapsaria os três em um e o status pararia de
-- avançar.
--
-- Por isso a chave é `(phone_number_id, dedupe_key)`, com a `dedupe_key`
-- montada pelo app conforme o tipo:
--
--   mensagem   msg:<wamid>
--   status     st:<wamid>:<status>
--   template   tpl:<nome>:<evento>
--
-- ------------------------------------------------------------
-- POR QUE NÃO REDIS
--
-- Com fila no Redis e dados no Postgres, "recebi" e "guardei" viram dois
-- commits em sistemas diferentes, sem ordem correta possível: confirma
-- antes e perde na queda, confirma depois e duplica. Aqui é um commit
-- só. `FOR UPDATE SKIP LOCKED` sustenta ordens de grandeza mais do que
-- este produto vai ver. (E o app sequer alcança o Redis: ele está só na
-- rede `edge`, e o Redis na `data`, que é `--internal`.)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- De qual número da Meta veio. É metade da chave de idempotência e é
  -- o que liga o evento a uma conta na hora de processar.
  phone_number_id text NOT NULL,
  dedupe_key      text NOT NULL,

  -- 'messages' | 'statuses' | o field de template. Só para diagnóstico
  -- e para a métrica de profundidade da fila por tipo.
  kind            text NOT NULL,

  -- O `value` do change, reconstruído com UM evento dentro. Guardar
  -- assim permite reprocessar chamando exatamente o mesmo caminho de
  -- hoje, sem uma segunda implementação do processamento para divergir.
  payload         jsonb NOT NULL,

  received_at     timestamptz NOT NULL DEFAULT now(),
  -- Nulo = ainda não drenado. É este campo que a ronda de saúde conta.
  processed_at    timestamptz,
  -- Enquanto reivindicado, outro dreno não pega. Nulo de novo se falhar.
  claimed_at      timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);

-- O coração da idempotência. Uma reentrega da Meta — que acontece por
-- até 7 dias quando ela acha que falhamos, e para TODOS os apps
-- inscritos na WABA — encontra esta restrição e não vira mensagem
-- duplicada na conversa.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_dedupe
  ON public.webhook_events (phone_number_id, dedupe_key);

-- A consulta do dreno: o que falta, na ordem em que chegou. Índice
-- parcial porque a tabela vai ser 99% de linhas já processadas, e o
-- dreno nunca olha para elas.
CREATE INDEX IF NOT EXISTS webhook_events_pending
  ON public.webhook_events (received_at)
  WHERE processed_at IS NULL;

-- Para a retenção poder varrer por data sem tropeçar no índice parcial.
CREATE INDEX IF NOT EXISTS webhook_events_processed_at
  ON public.webhook_events (processed_at)
  WHERE processed_at IS NOT NULL;

-- Ninguém além do servidor tem o que fazer aqui: são payloads crus da
-- Meta, de todas as contas, antes de qualquer recorte por conta. Sem
-- policy de leitura — com RLS ligada, o que não tem policy é negado.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_events FROM anon, authenticated;

-- ------------------------------------------------------------
-- Reivindicar um lote.
--
-- `FOR UPDATE SKIP LOCKED` é o que deixa dois drenos rodarem ao mesmo
-- tempo — o da requisição e o do cron — sem processarem a mesma linha e
-- sem um esperar pelo outro.
--
-- `claimed_at` mais velho que 5 minutos volta a ser elegível: é um
-- processo que morreu no meio, e sem isso a linha ficaria reivindicada
-- para sempre — a fila pararia em silêncio, que é exatamente o modo de
-- falha que esta mudança veio evitar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_webhook_events(p_limit integer)
RETURNS SETOF public.webhook_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.webhook_events e
     SET claimed_at = now(), attempts = e.attempts + 1
   WHERE e.id IN (
     SELECT c.id
       FROM public.webhook_events c
      WHERE c.processed_at IS NULL
        AND (c.claimed_at IS NULL OR c.claimed_at < now() - interval '5 minutes')
      ORDER BY c.received_at
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING e.*;
END $$;

REVOKE EXECUTE ON FUNCTION public.claim_webhook_events(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_events(integer) TO service_role;

COMMENT ON TABLE public.webhook_events IS
  'Eventos crus da Meta, gravados ANTES do 200 e drenados depois. A '
  'durabilidade vem daqui: o 200 já foi dado e a Meta não reentrega o '
  'que confirmamos. Chave de idempotência (phone_number_id, dedupe_key) '
  '— nunca wamid sozinho (ver migração 009).';
