#!/usr/bin/env bash
# F3 BYOK — live connect / rotate / revoke round-trip + read-model reflection against
# the running gateway. Asserts each transition on the real HTTP path for one tenant.
#
# Cross-tenant isolation (tenant B never sees tenant A's key) is proven separately, at
# the query layer that decides which key a tenant receives, by the DB test:
#   cargo test -p torii-gateway -- --ignored connected_is_per_tenant_isolated
# The seed carries a single tenant, so this script covers the single-tenant round-trip;
# together they cover the F3-6 isolation criterion.
#
# Requires: gateway + local Supabase up, the seeded owner. Everything is env-overridable.
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8787}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:55321}"
# Anon key: env override, else read the running local stack (never hardcode a token).
ANON_KEY="${ANON_KEY:-$(supabase status -o json 2>/dev/null |
	python3 -c 'import sys,json;print(json.load(sys.stdin).get("ANON_KEY",""))' 2>/dev/null || true)}"
[ -n "$ANON_KEY" ] || {
	echo "FAIL: set ANON_KEY (get it from: supabase status)"
	exit 1
}
EMAIL="${TORII_E2E_EMAIL:-owner2@strategos.local}"
PASSWORD="${TORII_E2E_PASSWORD:-testpass123}"
ROUTER="${ROUTER:-grok}"
K1="sk-e2e-$$-AAA"
K2="sk-e2e-$$-BBB"

pass=0
fail=0
ok() {
	echo "  PASS: $1"
	pass=$((pass + 1))
}
no() {
	echo "  FAIL: $1"
	fail=$((fail + 1))
}

# Extract one router's field from a /v1/connections body on stdin.
field() {
	ROUTER="$ROUTER" F="$1" python3 -c '
import sys, json, os
d = json.load(sys.stdin)["providers"]
r = next(x for x in d if x["name"] == os.environ["ROUTER"])
print(r[os.environ["F"]])'
}

JWT=$(curl -fsS "$SUPABASE_URL/auth/v1/token?grant_type=password" \
	-H "apikey: $ANON_KEY" -H 'content-type: application/json' \
	-d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" |
	python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')
[ -n "$JWT" ] || {
	echo "FAIL: could not sign in as $EMAIL"
	exit 1
}
A=(-H "authorization: Bearer $JWT")
J=(-H 'content-type: application/json')
conn() { curl -fsS "$GATEWAY_URL/v1/connections" "${A[@]}"; }
rpc() { curl -fsS -X POST "$GATEWAY_URL/rpc/connections/$1" "${A[@]}" "${J[@]}" -d "$2"; }

echo "F3 BYOK round-trip on router '$ROUTER' as $EMAIL"

# Precondition: the router needs a key and the tenant hasn't connected one.
C=$(conn)
[ "$(echo "$C" | field requires_key)" = "True" ] && ok "router requires a key" || no "router is keyless — pick a remote ROUTER"
[ "$(echo "$C" | field connected)" = "False" ] || {
	no "router already connected — revoke it first, aborting"
	exit 1
}
ok "starts not-connected"

# Connect: the key seals into the vault; the read model flips to connected, no secret echoed.
# (Bodies are built with printf so the JSON braces are never brace-expanded by the shell.)
[ "$(rpc connect "$(printf '{"router":"%s","key":"%s"}' "$ROUTER" "$K1")")" = '{"ok":true}' ] && ok "connect → ok:true" || no "connect did not return ok:true"
C=$(conn)
[ "$(echo "$C" | field connected)" = "True" ] && ok "read model shows connected" || no "not connected after connect"
T1=$(echo "$C" | field connected_at)
[ "$T1" != "None" ] && ok "connected_at set ($T1)" || no "connected_at is null"
echo "$C" | grep -q "$K1" && no "SECRET LEAKED in /v1/connections body" || ok "secret never appears in the read model"

# Rotate: same row, new key, timestamp advances.
sleep 1
[ "$(rpc rotate "$(printf '{"router":"%s","key":"%s"}' "$ROUTER" "$K2")")" = '{"ok":true}' ] && ok "rotate → ok:true" || no "rotate did not return ok:true"
T2=$(conn | field connected_at)
[ "$T2" \> "$T1" ] && ok "connected_at advanced on rotate ($T2)" || no "connected_at did not advance on rotate"

# Revoke: the tenant's key is gone; the router returns to not-connected.
[ "$(rpc revoke "$(printf '{"router":"%s"}' "$ROUTER")")" = '{"ok":true}' ] && ok "revoke → ok:true" || no "revoke did not return ok:true"
[ "$(conn | field connected)" = "False" ] && ok "not-connected after revoke" || no "still connected after revoke"

echo
echo "cross-tenant isolation is proven by the query-layer DB test:"
echo "  cargo test -p torii-gateway -- --ignored connected_is_per_tenant_isolated"
echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
