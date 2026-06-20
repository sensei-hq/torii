#!/usr/bin/env bash
# Run the F1 RLS test harness against the configured database.
# Assumes the schema + policies are applied: dbd apply && dbd import && dbd policies
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL, e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
here="$(cd "$(dirname "$0")" && pwd)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$here/rls.sql"
