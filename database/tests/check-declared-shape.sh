#!/usr/bin/env bash
# Static DDL drift-guard (no DB) — the cheap half of the redesign's CI gate.
#
# dbd's differ parses only `CREATE TABLE`, NOT trailing `alter table … add column …`. Columns
# added that way are invisible to `dbd diff`/`reconcile` → reconcile would DROP live columns
# (the GH-5/RAG landmine, docs/design/db-redesign.md §7). The fold (8a0d024/a4d1f8a) removed
# every such trailing-add; THIS guard keeps them from creeping back: it fails if any table DDL
# declares a column via a trailing ALTER instead of inline in CREATE TABLE.
#
# The other half of the gate (a full fresh-build: `dbd reset && dbd deploy` against a Supabase
# instance, then assert a clean diff) needs a live DB and is `fresh-build-check.sh`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
table_dir="$here/../ddl/table"
mv_dir="$here/../ddl/materialized_view"

fail=0
# Check 1 — trailing `add column` (with or without `if not exists`) in a table DDL. dbd's differ
# ignores it → reconcile would DROP the column (the GH-5/RAG landmine, db-redesign.md §7).
while IFS= read -r hit; do
  echo "  ✗ trailing ALTER-add: $hit"
  fail=1
done < <(grep -rniE "^[[:space:]]*alter table[[:space:]]+.*[[:space:]]add column" "$table_dir" 2>/dev/null || true)

# Check 2 — self-DROP in versioned table/matview DDL. A `drop … cascade;` before `create …` is
# non-idempotent: any re-apply/reconcile DROPs+rebuilds and WIPES live data (the O2 analytics-rollup
# landmine). Declarative DDL must be idempotent via `create … if not exists`.
while IFS= read -r hit; do
  echo "  ✗ non-idempotent self-DROP: $hit"
  fail=1
done < <(grep -rniE "^[[:space:]]*drop[[:space:]]+(table|materialized[[:space:]]+view)[[:space:]]" "$table_dir" "$mv_dir" 2>/dev/null || true)

if [ "$fail" -ne 0 ]; then
  echo "❌ DDL drift-guard FAILED:"
  echo "   • trailing ALTER-add → fold the column INLINE into CREATE TABLE (dbd's differ ignores it, so reconcile DROPs it; db-redesign.md §7)."
  echo "   • self-DROP → use 'create … if not exists'; a drop+create in versioned DDL wipes live data on re-apply."
  exit 1
fi

echo "✅ DDL drift-guard: columns inline (no trailing ALTER-add) + no non-idempotent self-DROP in table/matview DDL"
