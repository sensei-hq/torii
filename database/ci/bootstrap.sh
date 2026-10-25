#!/usr/bin/env bash
# Apply torii's schema, seeds and RLS policies to a FRESH supabase/postgres instance — the
# database CI's `rust-tests-db` job (.github/workflows/coverage.yml) tests against, and the way
# to reproduce that job locally:
#
#   docker run -d --name torii-ci -e POSTGRES_PASSWORD=postgres -p 55499:5432 \
#     public.ecr.aws/supabase/postgres:17.6.1.143
#   export DATABASE_URL=postgresql://supabase_admin:postgres@localhost:55499/postgres
#   bash database/ci/bootstrap.sh
#   cargo test -p torii-cli -p torii-core -p torii-orchestrator-store -p tools
#   bash database/tests/run.sh
#   docker rm -f torii-ci
#
# Two steps, both what a developer already runs:
#   1. auth.jwt() — the one function the schema needs that a lone supabase/postgres image lacks
#      (GoTrue creates it; see gotrue-auth-jwt.sql). A full `supabase start` stack has it already,
#      and re-creating it there is a no-op.
#   2. `dbd -e dev deploy` from database/ — apply every DDL entity, import the catalog + dev seeds
#      (the boot tests bind the catalog's `chat` chain), then apply the RLS policies.
#
# Set DBD_VERSION to fail fast when the dbd on PATH is not the pinned one (CI does).
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a fresh supabase/postgres instance}"
here="$(cd "$(dirname "$0")" && pwd)"

if [ -n "${DBD_VERSION:-}" ]; then
  have="$(dbd --version)"
  if [ "$have" != "dbd $DBD_VERSION" ]; then
    echo "❌ expected dbd $DBD_VERSION, found: $have" >&2
    exit 1
  fi
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$here/gotrue-auth-jwt.sql"
( cd "$here/.." && dbd -e dev deploy )
