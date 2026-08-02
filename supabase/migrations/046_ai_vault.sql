-- ============================================================
-- 046 — The account vault
--
-- Today the AI's knowledge is `ai_knowledge_documents`: text a human
-- pastes, retrieved for one question, and forgotten. Retrieve, generate,
-- discard. Nothing accumulates — after a thousand conversations the bot
-- knows exactly what it knew after the first.
--
-- This is the other model (Karpathy's LLM Wiki): the agent MAINTAINS a
-- wiki of the account, and it gets richer with every conversation. The
-- shape mirrors the methodology directly:
--
--   raw/ (immutable sources)  → ai_vault_sources
--   wiki/entidades/           → pages of kind entity_customer / entity_business
--   wiki/_regras/             → pages of kind rule — always in the prompt
--   wiki/_estado/             → pages of kind state — what is true right now
--   [[links]]                 → ai_vault_links
--   log.md                    → ai_vault_revisions
--   inbox → approved → raw    → status draft → approved
--
-- FAITHFULNESS is the rule the methodology puts above all others: every
-- claim must be grounded in a source. Here it is not advice, it is a
-- table — `ai_vault_page_sources`. A page with no source is a page the
-- agent invented, and an invented page reaches a paying customer as a
-- price or a policy.
--
-- Nothing here is retrieved until a human approves it. That is the whole
-- difference between a bot that learns and a bot that repeats its own
-- mistakes with growing confidence.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- Sources — immutable, and the only thing a page may cite
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.vault_source_kind AS ENUM (
    'conversation',  -- a transcript the keeper read
    'document',      -- an ai_knowledge_documents entry
    'note'           -- something a human wrote straight into the vault
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ai_vault_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind        public.vault_source_kind NOT NULL,
  -- What it came from: a conversation id, a document id. Not a foreign
  -- key: the source must outlive the row it was taken from, or a deleted
  -- conversation would silently un-ground every page that cited it.
  ref_id      uuid,
  title       text,
  content     text NOT NULL,
  -- Ingesting the same conversation twice is a no-op rather than a
  -- duplicate the keeper then has to reconcile with itself.
  content_hash text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_vault_sources_account_hash_unique UNIQUE (account_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_vault_sources_account
  ON public.ai_vault_sources (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_vault_sources_ref
  ON public.ai_vault_sources (ref_id) WHERE ref_id IS NOT NULL;

-- ============================================================
-- Pages — what the agent maintains
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.vault_page_kind AS ENUM (
    'rule',            -- durable business rule; ALWAYS in the prompt
    'entity_customer', -- one per contact: preferences, history, context
    'entity_business', -- the shop itself: services, prices, policies
    'concept',         -- anything else worth knowing
    'state'            -- true right now: a promotion, a closure, a notice
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.vault_page_status AS ENUM (
    'draft',    -- proposed by the agent, invisible to customers
    'approved', -- curated by a human; retrievable
    'archived'  -- superseded or rejected; kept for the record
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ai_vault_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  kind        public.vault_page_kind NOT NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  status      public.vault_page_status NOT NULL DEFAULT 'draft',

  -- Set on entity_customer pages. ON DELETE CASCADE because a page about
  -- a deleted contact is about nobody.
  contact_id  uuid REFERENCES public.contacts(id) ON DELETE CASCADE,

  -- Bumped on every approved edit, so the revision log can say what
  -- changed between which versions.
  version     integer NOT NULL DEFAULT 1,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- One page per slug per account. The keeper proposing an update to an
  -- existing page must edit it, not create a rival with the same name —
  -- two pages disagreeing about the price is the failure the lint pass
  -- exists to catch, and the database can refuse the easy half of it.
  CONSTRAINT ai_vault_pages_account_slug_unique UNIQUE (account_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_ai_vault_pages_account_status
  ON public.ai_vault_pages (account_id, status, kind);
-- The two hot reads: every approved rule (loaded on every reply) and
-- this customer's page.
CREATE INDEX IF NOT EXISTS idx_ai_vault_pages_rules
  ON public.ai_vault_pages (account_id, kind)
  WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_ai_vault_pages_contact
  ON public.ai_vault_pages (contact_id)
  WHERE contact_id IS NOT NULL;

-- ============================================================
-- FAITHFULNESS, as a table
--
-- Every page cites at least one source. Enforcing "at least one" needs a
-- trigger or a deferred constraint and would fight the write order, so
-- it is enforced in the code that creates pages — but the join table
-- makes an ungrounded page VISIBLE, which is what the lint pass reports
-- and what a curator sees before approving.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_vault_page_sources (
  page_id    uuid NOT NULL REFERENCES public.ai_vault_pages(id) ON DELETE CASCADE,
  source_id  uuid NOT NULL REFERENCES public.ai_vault_sources(id) ON DELETE CASCADE,
  -- The sentence or line the claim came from, so a curator can check a
  -- page against its evidence without reading a whole transcript.
  excerpt    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_vault_page_sources_source
  ON public.ai_vault_page_sources (source_id);

-- ============================================================
-- Links — the correlations
--
-- `[[slug]]` in the methodology. What makes the vault a graph rather
-- than a folder: "this customer" → "this product" → "this policy".
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_vault_links (
  from_page_id uuid NOT NULL REFERENCES public.ai_vault_pages(id) ON DELETE CASCADE,
  to_page_id   uuid NOT NULL REFERENCES public.ai_vault_pages(id) ON DELETE CASCADE,
  -- Free text: 'mentions', 'contradicts', 'supersedes', 'prefers'. Kept
  -- open because the useful relations are not knowable in advance, and a
  -- closed enum would force the keeper to lie.
  relation     text NOT NULL DEFAULT 'mentions',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_page_id, to_page_id, relation),
  CONSTRAINT ai_vault_links_no_self CHECK (from_page_id <> to_page_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_vault_links_to
  ON public.ai_vault_links (to_page_id);

-- ============================================================
-- Revisions — log.md, append-only
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_vault_revisions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  page_id    uuid REFERENCES public.ai_vault_pages(id) ON DELETE SET NULL,
  -- 'proposed' | 'approved' | 'edited' | 'rejected' | 'archived'
  operation  text NOT NULL,
  -- Null when the agent did it; set when a human did.
  actor_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The page body as it stood, so an approval can be audited against
  -- what was actually approved rather than what the page says today.
  snapshot   text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_vault_revisions_account
  ON public.ai_vault_revisions (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_vault_revisions_page
  ON public.ai_vault_revisions (page_id, created_at DESC);

-- ============================================================
-- Retrieval reuses the existing pipeline
--
-- An approved page is chunked and embedded by the same `ingestDocument`
-- that handles knowledge documents, into the same table, searched by the
-- same two RPCs. One nullable column instead of a parallel pipeline —
-- and `document_id` becomes nullable because a vault chunk has no
-- document behind it.
-- ============================================================
ALTER TABLE public.ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS vault_page_id uuid
    REFERENCES public.ai_vault_pages(id) ON DELETE CASCADE;

ALTER TABLE public.ai_knowledge_chunks
  ALTER COLUMN document_id DROP NOT NULL;

-- Exactly one owner per chunk. Without this, a bug that forgot to set
-- either would leave orphan chunks retrievable by everyone in the
-- account and traceable to nothing.
ALTER TABLE public.ai_knowledge_chunks
  DROP CONSTRAINT IF EXISTS ai_knowledge_chunks_one_owner;
ALTER TABLE public.ai_knowledge_chunks
  ADD CONSTRAINT ai_knowledge_chunks_one_owner
  CHECK (num_nonnulls(document_id, vault_page_id) = 1);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_vault_page
  ON public.ai_knowledge_chunks (vault_page_id)
  WHERE vault_page_id IS NOT NULL;

-- ============================================================
-- RLS
--
-- Reading is member-wide: an attendant benefits from what the bot knows
-- about a customer. Writing is 'agent' — the same bar as sending a
-- message — because proposing and curating knowledge is attendant work,
-- not settings work. Deleting is admin: the vault is a record.
--
-- The keeper writes under the service-role client and bypasses all of
-- this; these policies guard the dashboard.
-- ============================================================
ALTER TABLE public.ai_vault_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_vault_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_vault_page_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_vault_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_vault_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_vault_sources_select ON public.ai_vault_sources;
CREATE POLICY ai_vault_sources_select ON public.ai_vault_sources
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS ai_vault_sources_insert ON public.ai_vault_sources;
CREATE POLICY ai_vault_sources_insert ON public.ai_vault_sources
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
-- No UPDATE policy: sources are immutable. That is the whole point of
-- having them — a page's evidence must not be editable after the fact.
DROP POLICY IF EXISTS ai_vault_sources_delete ON public.ai_vault_sources;
CREATE POLICY ai_vault_sources_delete ON public.ai_vault_sources
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_vault_pages_select ON public.ai_vault_pages;
CREATE POLICY ai_vault_pages_select ON public.ai_vault_pages
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS ai_vault_pages_insert ON public.ai_vault_pages;
CREATE POLICY ai_vault_pages_insert ON public.ai_vault_pages
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS ai_vault_pages_update ON public.ai_vault_pages;
CREATE POLICY ai_vault_pages_update ON public.ai_vault_pages
  FOR UPDATE USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS ai_vault_pages_delete ON public.ai_vault_pages;
CREATE POLICY ai_vault_pages_delete ON public.ai_vault_pages
  FOR DELETE USING (public.is_account_member(account_id, 'admin'));

-- The join tables carry no account_id of their own; membership is
-- whatever the page says it is.
DROP POLICY IF EXISTS ai_vault_page_sources_all ON public.ai_vault_page_sources;
CREATE POLICY ai_vault_page_sources_all ON public.ai_vault_page_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.ai_vault_pages p
       WHERE p.id = page_id AND public.is_account_member(p.account_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_vault_pages p
       WHERE p.id = page_id AND public.is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS ai_vault_links_all ON public.ai_vault_links;
CREATE POLICY ai_vault_links_all ON public.ai_vault_links
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.ai_vault_pages p
       WHERE p.id = from_page_id AND public.is_account_member(p.account_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_vault_pages p
       WHERE p.id = from_page_id AND public.is_account_member(p.account_id, 'agent')
    )
  );

DROP POLICY IF EXISTS ai_vault_revisions_select ON public.ai_vault_revisions;
CREATE POLICY ai_vault_revisions_select ON public.ai_vault_revisions
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS ai_vault_revisions_insert ON public.ai_vault_revisions;
CREATE POLICY ai_vault_revisions_insert ON public.ai_vault_revisions
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
-- Append-only: no UPDATE, no DELETE. A log you can edit is not a log.

DROP TRIGGER IF EXISTS set_ai_vault_pages_updated_at ON public.ai_vault_pages;
CREATE TRIGGER set_ai_vault_pages_updated_at
  BEFORE UPDATE ON public.ai_vault_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
