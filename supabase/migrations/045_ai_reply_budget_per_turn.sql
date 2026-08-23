-- ============================================================
-- 045 — The reply budget starts over when the customer speaks
--
-- `ai_reply_count` was a LIFETIME total per conversation. With the
-- default of 3, the bot answered a thread three times ever and then
-- went silent — permanently, since nothing reset it except a human
-- un-pausing the bot from the inbox. A booking dialogue ("quero
-- marcar" / "pode ser segunda" / "14h") spends that budget before it
-- reaches a booking, and the customer is left mid-sentence with a bot
-- that will never speak on that thread again.
--
-- What the cap was really guarding against is a bot that keeps talking
-- when nobody is talking to it. Every reply here answers an inbound
-- message the customer chose to send; a customer who sends twenty
-- messages wants twenty answers. So the counter now measures replies
-- SINCE THE CUSTOMER LAST SPOKE, and the auto-reply path resets it on
-- every inbound.
--
-- The visible effect beyond long dialogues: a thread that hit the cap
-- months ago comes back to life the next time that customer writes,
-- instead of staying mute until somebody notices.
--
-- `ai_reply_total` keeps the lifetime number, because two things still
-- want it. The handoff note says "handed off after N replies", which is
-- only useful if N counts the whole conversation. And an operator who
-- later decides the bot should not own a customer forever needs the
-- number to set that ceiling from — this migration deliberately records
-- it without enforcing it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_reply_total integer NOT NULL DEFAULT 0;

-- Backfill: before this migration the two counters were the same thing.
UPDATE public.conversations
   SET ai_reply_total = ai_reply_count
 WHERE ai_reply_total = 0
   AND ai_reply_count > 0;

-- The atomic claim now advances both: the per-turn budget it checks
-- against, and the lifetime tally it never checks. Signature and return
-- value are unchanged, so the caller and its grant stay as they are.
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1,
        ai_reply_total = ai_reply_total + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- SECURITY DEFINER sets what the function runs WITH, not who may call
-- it; CREATE OR REPLACE keeps the existing grant, but restating it costs
-- nothing and 031 exists precisely because it was once missed.
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;
