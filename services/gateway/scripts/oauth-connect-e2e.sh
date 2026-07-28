#!/usr/bin/env bash
# F3 OAuth (#16) — live paste-token connect / revoke round-trip + read-model reflection +
# api_key/oauth coexistence, against the running gateway, for one tenant.
#
# Proves the real HTTP path for O-3a (oauth-connect/oauth-revoke) and the O-6 read model
# (oauth_connected). The Bearer auth-header selection (O-1) is proven by the adapter unit test
# (`apply_request_headers_uses_bearer_for_an_oauth_credential`); at-rest sealing by the crate DB
# test (`postgres_oauth_lifecycle_coexists_with_api_key`). Anthropic only in v1.
#
# Requires: gateway + local Supabase up, the seeded owner. Everything is env-overridable.
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8787}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:55321}"
ANON_KEY="${ANON_KEY:-$(supabase status -o json 2>/dev/null |
	python3 -c 'import sys,json;print(json.load(sys.stdin).get("ANON_KEY",""))' 2>/dev/null || true)}"
[ -n "$ANON_KEY" ] || {
	echo "FAIL: set ANON_KEY (get it from: supabase status)"
	exit 1
}
EMAIL="${TORII_E2E_EMAIL:-owner2@strategos.local}"
PASSWORD="${TORII_E2E_PASSWORD:-testpass123}"
ROUTER="${ROUTER:-anthropic}"
TOKEN="oauth-e2e-$$-tok"   # a stand-in setup-token; write-only, never echoed
APIKEY="sk-e2e-$$-static"  # for the coexistence check

pass=0
fail=0
ok() { echo "  PASS: $1"; pass=$((pass + 1)); }
no() { echo "  FAIL: $1"; fail=$((fail + 1)); }

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
[ -n "$JWT" ] || { echo "FAIL: could not sign in as $EMAIL"; exit 1; }
A=(-H "authorization: Bearer $JWT")
J=(-H 'content-type: application/json')
conn() { curl -fsS "$GATEWAY_URL/v1/connections" "${A[@]}"; }
rpc() { curl -fsS -X POST "$GATEWAY_URL/rpc/connections/$1" "${A[@]}" "${J[@]}" -d "$2"; }

echo "F3 OAuth round-trip on router '$ROUTER' as $EMAIL"

# Precondition: router needs a credential and no oauth is connected yet.
C=$(conn)
[ "$(echo "$C" | field requires_key)" = "True" ] && ok "router requires a credential" || no "router is keyless — pick an OAuth-capable ROUTER"
[ "$(echo "$C" | field oauth_connected)" = "False" ] || { no "oauth already connected — revoke first, aborting"; exit 1; }
ok "starts not oauth-connected"

# oauth-connect: token seals into the vault; read model flips oauth_connected; secret not echoed.
[ "$(rpc oauth-connect "$(printf '{"router":"%s","token":"%s"}' "$ROUTER" "$TOKEN")")" = '{"ok":true}' ] && ok "oauth-connect → ok:true" || no "oauth-connect did not return ok:true"
C=$(conn)
[ "$(echo "$C" | field oauth_connected)" = "True" ] && ok "read model shows oauth_connected" || no "not oauth_connected after connect"
[ "$(echo "$C" | field oauth_connected_at)" != "None" ] && ok "oauth_connected_at set" || no "oauth_connected_at is null"
echo "$C" | grep -q "$TOKEN" && no "TOKEN LEAKED in /v1/connections body" || ok "token never appears in the read model"

# Coexistence: an api_key credential for the SAME router is independent (O-7 partial unique).
[ "$(rpc connect "$(printf '{"router":"%s","key":"%s"}' "$ROUTER" "$APIKEY")")" = '{"ok":true}' ] && ok "api_key connect → ok:true" || no "api_key connect failed"
C=$(conn)
[ "$(echo "$C" | field connected)" = "True" ] && [ "$(echo "$C" | field oauth_connected)" = "True" ] && ok "api_key AND oauth both active for the router" || no "coexistence not reflected"

# oauth-revoke: oauth goes away; the api_key credential stays.
[ "$(rpc oauth-revoke "$(printf '{"router":"%s"}' "$ROUTER")")" = '{"ok":true}' ] && ok "oauth-revoke → ok:true" || no "oauth-revoke did not return ok:true"
C=$(conn)
[ "$(echo "$C" | field oauth_connected)" = "False" ] && ok "not oauth-connected after revoke" || no "still oauth-connected after revoke"
[ "$(echo "$C" | field connected)" = "True" ] && ok "api_key credential survived the oauth revoke" || no "api_key lost on oauth revoke"

# Cleanup: revoke the api_key too so the tenant ends where it started.
rpc revoke "$(printf '{"router":"%s"}' "$ROUTER")" >/dev/null && ok "api_key revoked (cleanup)" || no "api_key cleanup failed"

echo
echo "Bearer header selection is proven by the adapter unit test; at-rest sealing by the crate DB test."
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
