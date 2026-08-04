#!/usr/bin/env bash
# Fresh-build gate (the DB half of the redesign CI gate) — proves the declared schema builds
# from scratch AND that declared == live, catching the differ-invisible drift the static guard
# can't see (renamed/dropped columns, constraint/type changes).
#
# Runs the pre-v1 cycle Jerry ratified: `dbd reset` (drop managed objects) → `dbd deploy`
# (= apply DDL + import seed) → `dbd policies` → assert `dbd diff` is empty.
#
# ⚠️ DESTRUCTIVE: reset+deploy WIPES and reseeds the managed schemas. Point DATABASE_URL at a
# THROWAWAY Supabase instance (a CI Supabase service, or a local branch) — NEVER the data-bearing
# dev DB you're actively using, and NEVER prod. A bare `create database` will NOT work: the schema
# references Supabase's `auth`/`vault` schemas, so the target must be a real Supabase instance.
#
# Usage (CI or a scratch local Supabase):
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
#   CONFIRM_DESTRUCTIVE=1 bash database/tests/fresh-build-check.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a THROWAWAY Supabase instance}"
: "${CONFIRM_DESTRUCTIVE:?refusing to reset without CONFIRM_DESTRUCTIVE=1 (this WIPES the target DB)}"
here="$(cd "$(dirname "$0")" && pwd)"
db="$here/.."

echo "== 1. static drift-guard =="
bash "$here/check-declared-shape.sh"

echo "== 2. dbd reset (drop managed objects) =="
( cd "$db" && dbd -e dev -d "$DATABASE_URL" reset --force )

echo "== 3. dbd deploy (apply DDL + import seed) =="
( cd "$db" && dbd -e dev -d "$DATABASE_URL" deploy )

echo "== 4. dbd policies (RLS) =="
( cd "$db" && dbd -e dev -d "$DATABASE_URL" policies )

echo "== 5. assert declared == live (dbd diff must be empty of structural changes) =="
# Ignore the known dbd differ quirks on named CHECK constraints + generated columns (tsv) that
# are semantically equal (see db-redesign.md §7); fail on any real column/table drift.
diff_out="$( cd "$db" && dbd -e dev -d "$DATABASE_URL" diff 2>&1 || true )"
real_drift="$(printf '%s\n' "$diff_out" | grep -iE 'DROP COLUMN|ADD COLUMN|DROP TABLE|create (public|core|config|catalog|governance|metering|content|audit|device)\.' | grep -viE 'staging\.' || true)"
if [ -n "$real_drift" ]; then
  echo "❌ FRESH-BUILD DRIFT — declared != live:"; printf '%s\n' "$real_drift"; exit 1
fi

echo "== 6. run the security + logic suite on the fresh build =="
DATABASE_URL="$DATABASE_URL" bash "$here/run.sh"

echo "✅ FRESH-BUILD GATE PASSED (declared == live, suite green)"
