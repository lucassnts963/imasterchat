#!/usr/bin/env bash
# ============================================================
# Apply every SQL migration, in order, to a self-hosted Supabase.
#
# Replaces the upstream workflow of pasting 37 files into the hosted
# SQL Editor by hand. The migrations are idempotent by project
# convention (IF NOT EXISTS / DROP POLICY IF EXISTS), so re-running
# this script is safe and is the normal way to apply new ones.
#
# ORDERING MATTERS, and not just between the files:
#   - 001 references `auth.users`  → GoTrue must have run its own
#     migrations first.
#   - 008 / 016 / 023 insert into `storage.buckets` → storage-api
#     must have created the storage schema first.
# The wait loop below blocks until both schemas exist, so a
# `docker compose up` that starts everything at once can't race.
#
# Usage:
#   ./deploy/apply-migrations.sh                 # uses .env in repo root
#   POSTGRES_PASSWORD=... DB_HOST=... ./deploy/apply-migrations.sh
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

# Pick up POSTGRES_* from the Supabase stack's .env if it's there.
if [[ -f "$REPO_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$REPO_ROOT/.env"; set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${POSTGRES_PASSWORD:-}"

if [[ -z "$DB_PASS" ]]; then
  echo "error: POSTGRES_PASSWORD is not set (export it, or put it in .env)" >&2
  exit 1
fi

export PGPASSWORD="$DB_PASS"
PSQL=(psql -v ON_ERROR_STOP=1 -q -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME")

# ---- wait for Postgres, then for the schemas the migrations need ----
echo "→ waiting for Postgres at $DB_HOST:$DB_PORT…"
for _ in $(seq 1 60); do
  if "${PSQL[@]}" -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 2
done
"${PSQL[@]}" -c 'SELECT 1' >/dev/null

wait_for_schema() {
  local schema="$1" service="$2"
  echo "→ waiting for the '$schema' schema (created by $service)…"
  for _ in $(seq 1 60); do
    if "${PSQL[@]}" -tAc \
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = '$schema'" \
      | grep -q 1; then
      return 0
    fi
    sleep 2
  done
  echo "error: '$schema' never appeared — is the $service container running?" >&2
  exit 1
}
wait_for_schema auth gotrue
wait_for_schema storage storage-api

# `auth.users` specifically — the schema can exist before GoTrue has
# finished its own migrations, and 001 would then fail on the FK.
echo "→ waiting for auth.users…"
for _ in $(seq 1 60); do
  if "${PSQL[@]}" -tAc "SELECT to_regclass('auth.users') IS NOT NULL" | grep -q t; then
    break
  fi
  sleep 2
done

# ---- ledger, so a failure tells you exactly where it stopped ----
"${PSQL[@]}" -c "
  CREATE TABLE IF NOT EXISTS public.applied_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );"

# ---- apply, in filename order (001_… → 037_…) ----
shopt -s nullglob
applied=0
for file in $(printf '%s\n' "$MIGRATIONS_DIR"/*.sql | sort); do
  name="$(basename "$file")"
  printf '  %-45s' "$name"
  "${PSQL[@]}" -f "$file" >/dev/null
  "${PSQL[@]}" -c "
    INSERT INTO public.applied_migrations (filename) VALUES ('$name')
    ON CONFLICT (filename) DO UPDATE SET applied_at = now();" >/dev/null
  echo 'ok'
  applied=$((applied + 1))
done

echo
echo "✓ $applied migrations applied to $DB_NAME@$DB_HOST"
echo
echo "Next, make yourself the platform admin (once per deployment):"
echo "  psql … -c \"UPDATE public.profiles SET is_platform_admin = true WHERE email = 'you@example.com';\""
