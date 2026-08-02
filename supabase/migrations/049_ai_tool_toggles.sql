-- ============================================================
-- 049 — Turning a tool off
--
-- The catalogue is assembled per account (buildToolCatalog): a tool
-- whose prerequisite is unmet simply does not exist for the model.
-- That is the right default and it is not enough — an account may have
-- Google connected and scheduling on and still not want the bot
-- cancelling appointments.
--
-- Stored as a DENY list rather than an allow list on purpose. A tool
-- shipped in a later release should be available without every
-- existing account having to opt in, and an allow list would silently
-- withhold it from everyone who set theirs up before it existed.
--
-- `request_human` is deliberately absent from anything this table can
-- affect: the code refuses to remove it. It is the only way the agent
-- can stop, and an account that switched it off would have a bot that
-- never calls a person — which is precisely the account that would
-- switch it off by mistake.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_disabled_tools (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- The tool's `name`, matching the string the model sees. Not a
  -- foreign key: tools live in code, and a row naming a tool that no
  -- longer exists is harmless — it disables nothing.
  tool_name  text NOT NULL,
  disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, tool_name)
);

ALTER TABLE public.ai_disabled_tools ENABLE ROW LEVEL SECURITY;

-- Any member may see what the agent can do — that is the whole point of
-- the screen. Only admin+ may change it.
DROP POLICY IF EXISTS ai_disabled_tools_select ON public.ai_disabled_tools;
CREATE POLICY ai_disabled_tools_select ON public.ai_disabled_tools
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS ai_disabled_tools_insert ON public.ai_disabled_tools;
CREATE POLICY ai_disabled_tools_insert ON public.ai_disabled_tools
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_disabled_tools_delete ON public.ai_disabled_tools;
CREATE POLICY ai_disabled_tools_delete ON public.ai_disabled_tools
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));
