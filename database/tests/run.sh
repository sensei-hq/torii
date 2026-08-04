#!/usr/bin/env bash
# Run the full Seiki DB security + logic test suite.
# Assumes the schema is applied+seeded: dbd -e dev reset && apply && policies && import
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL, e.g. postgresql://postgres:postgres@127.0.0.1:55322/postgres}"
here="$(cd "$(dirname "$0")" && pwd)"

# Static DDL drift-guard first (no DB needed) — fails fast if a column was declared via a
# trailing ALTER (dbd-invisible → reconcile would drop it). See check-declared-shape.sh.
bash "$here/check-declared-shape.sh"

# Each harness raises on any failed assertion (ON_ERROR_STOP) → non-zero exit.
suite=(
  enums.sql     # db-redesign §3: varchar+CHECK → Postgres enum (core.execution_location)
  moves.sql     # db-redesign §D: table schema-moves landed + shield views + invariants
  rls.sql       # F1: RLS coverage + cross-tenant/confidential/secrets isolation
  authz.sql     # RW12: adversarial authz — escalation/budget/self-join/declassify/forge/anon
  budget.sql    # C3: hard budget reserve cannot be exceeded
  tools.sql     # X1: MCP tool allow-list default-deny
  routing.sql   # C2: chain-binding resolution precedence
  dataset.sql   # §3c: sensitive-data safe schema + k-anonymity
  retrieval.sql # C5: hybrid_search dual-write + cross-tenant/classification isolation
  analytics.sql # O2: daily usage rollup + idempotency
)

for t in "${suite[@]}"; do
  echo "── $t ──"
  # Capture output so a psql failure (ON_ERROR_STOP → non-zero) fails the suite.
  # grep is display-only; piping psql to `grep … || true` previously swallowed
  # harness failures (a broken security test would report PASSED — dangerous).
  if ! out="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$here/$t" 2>&1)"; then
    echo "$out"
    echo "❌ FAILED: $t"
    exit 1
  fi
  echo "$out" | grep -E 'NOTICE|PASSED' || true
done
echo "✅ ALL DB SECURITY TESTS PASSED"
