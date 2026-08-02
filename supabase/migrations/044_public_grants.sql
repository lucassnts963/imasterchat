-- ============================================================
-- 044 — Table grants for anon / authenticated / service_role
--
-- Every migration in this repo secures its tables with RLS and says
-- nothing about GRANTs, because for years it did not have to: Supabase
-- projects shipped with
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated, service_role;
--
-- so a table created by a migration was reachable through PostgREST the
-- moment it existed, and RLS decided who saw which rows.
--
-- Recent Supabase Postgres images tightened that default to
-- `Dxtm` — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — with no
-- SELECT/INSERT/UPDATE/DELETE. On a database provisioned from one of
-- those images, EVERY table in this schema is unreadable:
--
--   set role authenticated; select count(*) from public.contacts;
--   ERROR:  permission denied for table contacts
--
-- Not a new-table problem: `contacts` dates from 001. An existing
-- deployment is unaffected (it already carries the old grants, so this
-- migration is a no-op there); a fresh one gets an app that cannot read
-- its own data, with a 401 from PostgREST as the only symptom.
--
-- This restores the historical grants exactly, rather than taking the
-- opportunity to narrow them. Tightening what `anon` may touch is a
-- real conversation — /join/[token] is served to logged-out visitors,
-- for one — but it is a security change, and bundling it into a fix for
-- "the app does not start" is how a security change ships unreviewed.
--
-- RLS remains the boundary. A GRANT here lets a role reach a table; the
-- policies on that table decide which rows come back, and every table in
-- this schema has them.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Existing objects.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Objects created later, by whichever role runs the migrations. Without
-- this, migration 045 would reintroduce the exact same problem.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
