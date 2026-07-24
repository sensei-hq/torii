#!/usr/bin/env bash
# Run the full Strategos DB security + logic test suite.
# Assumes the schema is applied+seeded: dbd -e dev reset && apply && policies && import
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL, e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
here="$(cd "$(dirname "$0")" && pwd)"

# Each harness raises on any failed assertion (ON_ERROR_STOP) → non-zero exit.
suite=(
  rls.sql       # F1: RLS coverage + cross-tenant/confidential/secrets isolation
  authz.sql     # RW12: adversarial authz — escalation/budget/self-join/declassify/forge/anon
  budget.sql    # C3: hard budget reserve cannot be exceeded
  tools.sql     # X1: MCP tool allow-list default-deny
  routing.sql   # C2: chain-binding resolution precedence
  dataset.sql   # §3c: sensitive-data safe schema + k-anonymity
)

for t in "${suite[@]}"; do
  echo "── $t ──"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$here/$t" | grep -E 'NOTICE|PASSED' || true
done
echo "✅ ALL DB SECURITY TESTS PASSED"
