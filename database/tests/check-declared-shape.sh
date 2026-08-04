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
ddl_dir="$here/../ddl/table"

fail=0
# `add column` (with or without `if not exists`) at the start of an alter statement in a table DDL.
while IFS= read -r hit; do
  echo "  ✗ $hit"
  fail=1
done < <(grep -rniE "^[[:space:]]*alter table[[:space:]]+.*[[:space:]]add column" "$ddl_dir" 2>/dev/null || true)

if [ "$fail" -ne 0 ]; then
  echo "❌ DDL drift-guard FAILED: table column declared via a trailing ALTER (fold it INLINE into CREATE TABLE)."
  echo "   Why: dbd's differ ignores trailing ALTER-add, so reconcile would DROP the column. See db-redesign.md §7."
  exit 1
fi

echo "✅ DDL drift-guard: every table column is declared inline in CREATE TABLE (no trailing ALTER-add)"
