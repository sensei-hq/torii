#!/usr/bin/env bash
# O3-4 device fleet — live HTTP round-trip against the running gateway + local Supabase (55321)
# + dev DB (55322). Proves the gateway's ACTUAL read/write path (the service_role pool bypasses
# RLS, so scoping is reproduced in the handler — the DB-layer authz.sql test guards direct
# PostgREST, this guards the gateway):
#   - GET /v1/devices: owner (device.manage) sees the whole fleet, enriched with a buffer-health
#     verdict + config-drift flag + the operator stale threshold; a plain member sees ONLY their
#     own devices (own-vs-manage); public_key / key material never appears.
#   - POST /rpc/devices/set-sync-policy: owner 200 (persisted + audited device.sync_policy_changed),
#     malformed policy 400, missing device 404 (tenant-scoped), member-without-device.manage 403.
#
# Fixtures are idempotent and cleaned up on exit. Requires: gateway + local Supabase up, the
# seeded owner (owner2@torii.local). Everything is env-overridable; no token is ever hardcoded.
#   Usage: GW=http://127.0.0.1:8790 bash services/gateway/scripts/device-fleet-e2e.sh
set -uo pipefail

GW="${GW:-http://127.0.0.1:8787}"
SB="${SB:-http://127.0.0.1:55321}"
DB="${DBURL:-postgresql://postgres:postgres@127.0.0.1:55322/postgres}"
EMAIL="${TORII_E2E_EMAIL:-owner2@torii.local}"
PASSWORD="${TORII_E2E_PASSWORD:-testpass123}"
MEMBER_EMAIL="${TORII_E2E_MEMBER_EMAIL:-member-o34@torii.local}"

# Anon + service keys: env override, else read the running local stack (never hardcode a token).
sbkey() { supabase status -o json 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null || true; }
ANON="${ANON_KEY:-$(sbkey ANON_KEY)}"
SVC="${SERVICE_ROLE_KEY:-$(sbkey SERVICE_ROLE_KEY)}"
[ -n "$ANON" ] && [ -n "$SVC" ] || { echo "FAIL: set ANON_KEY + SERVICE_ROLE_KEY (get them from: supabase status)"; exit 1; }

# Resolve the seed owner's tenant + a non-`device.manage` role from the live DB (no hardcoded ids).
OW=$(psql "$DB" -tAc "select id from auth.users where email='$EMAIL'")
T=$(psql "$DB" -tAc "select tenant_id from core.memberships where profile_id='$OW' and status='active' limit 1")
MR=$(psql "$DB" -tAc "select role_id from core.effective_roles er where er.tenant_id='$T' and er.key='member' limit 1")
[ -n "$OW" ] && [ -n "$T" ] && [ -n "$MR" ] || { echo "FAIL: could not resolve owner/tenant/member-role (is the owner seeded?)"; exit 1; }

A="d0340000-0000-0000-0000-0000000000a1"   # owner device, drifted (v1<current) + stale buffer
B="d0340000-0000-0000-0000-0000000000a2"   # owner device, in-sync + healthy buffer
C="d0340000-0000-0000-0000-0000000000c1"   # member device, null buffer_health → unknown
BADID="d0340000-0000-0000-0000-00000000dead"

cleanup() { psql "$DB" -q -c "delete from public.devices where tenant_id='$T' and id in ('$A','$B','$C')" >/dev/null 2>&1 || true; }
trap cleanup EXIT

pass=0; fail=0
ok() { echo "  PASS: $1"; pass=$((pass+1)); }
no() { echo "  FAIL: $1"; fail=$((fail+1)); }

echo "== device-fleet e2e as $EMAIL (tenant $T) =="

# Member user (idempotent) + tenant membership + non-manage role.
curl -s -X POST "$SB/auth/v1/admin/users" -H "apikey: $SVC" -H "authorization: Bearer $SVC" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$MEMBER_EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" >/dev/null
MEMBER=$(psql "$DB" -tAc "select id from auth.users where email='$MEMBER_EMAIL'")
[ -n "$MEMBER" ] || { echo "FAIL: could not create/resolve member user"; exit 1; }

OLD2H=$(date -u -v-2H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ)
NEW30=$(date -u -v-30S +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-30 seconds' +%Y-%m-%dT%H:%M:%SZ)
psql "$DB" -v ON_ERROR_STOP=1 -q <<SQL || { echo "FAIL: fixture setup"; exit 1; }
insert into core.profiles(id) values ('$MEMBER') on conflict do nothing;
insert into core.memberships(profile_id, tenant_id, status, active, assigned_by)
  values ('$MEMBER','$T','active', true, 'device-fleet-e2e') on conflict do nothing;
insert into core.profile_roles(tenant_id, profile_id, role_id, assigned_by)
  values ('$T','$MEMBER','$MR','device-fleet-e2e') on conflict do nothing;
delete from public.devices where tenant_id='$T' and id in ('$A','$B','$C');
insert into public.devices(tenant_id,id,profile_id,name,platform,public_key,app_version,config_version,status,sync_policy,buffer_health,last_seen_at) values
 ('$T','$A','$OW','e2e-owner-drifted','macos','SECRET-KEY-AAA','0.1.1',1,'active',
   '{"config_pull":"realtime","pull_interval_s":300,"offline_grace_h":72,"buffer_flush":"on_reconnect"}'::jsonb,
   '{"flush_status":"ok","oldest_pending_at":"$OLD2H","usage_queued":3,"audit_queued":0,"clock_skew_ms":40}'::jsonb, now()),
 ('$T','$B','$OW','e2e-owner-healthy','windows','SECRET-KEY-BBB','0.1.1',
   (select coalesce(max(version),1) from config.config_versions where tenant_id='$T'),'active',
   '{"config_pull":"interval","pull_interval_s":600,"offline_grace_h":24,"buffer_flush":"interval"}'::jsonb,
   '{"flush_status":"ok","oldest_pending_at":"$NEW30","usage_queued":0,"audit_queued":0,"last_flush_at":"$NEW30"}'::jsonb, now()),
 ('$T','$C','$MEMBER','e2e-member-unknown','linux','SECRET-KEY-CCC','0.1.1',
   (select coalesce(max(version),1) from config.config_versions where tenant_id='$T'),'active',
   default, null, now());
SQL

signin() { curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))'; }
OJWT=$(signin "$EMAIL"); MJWT=$(signin "$MEMBER_EMAIL")
[ -n "$OJWT" ] && [ -n "$MJWT" ] || { echo "FAIL: sign-in"; exit 1; }

# --- GET /v1/devices: owner sees the whole fleet, enriched ---
curl -s "$GW/v1/devices" -H "authorization: Bearer $OJWT" > /tmp/dfe2e-owner.json
A="$A" B="$B" C="$C" python3 - <<'PY' && ok "owner fleet enriched (drift + buffer verdict + threshold, no key material)" || no "owner fleet assertions"
import json,os,sys
A,B,C=os.environ['A'],os.environ['B'],os.environ['C']
d=json.load(open('/tmp/dfe2e-owner.json')); dv={x["id"]:x for x in d["devices"]}
blob=json.dumps(d)
assert isinstance(d.get("stale_threshold_s"),int) and d["stale_threshold_s"]>0, "no stale_threshold_s"
assert {A,B,C} <= set(dv), "owner should see all three tenant devices"
assert dv[A]["drifted"] is True and dv[A]["buffer_verdict"]=="stale", "A should be drifted+stale"
assert dv[B]["drifted"] is False and dv[B]["buffer_verdict"]=="healthy", "B should be in-sync+healthy"
assert dv[C]["buffer_verdict"]=="unknown", "C should be unknown (null buffer_health)"
assert all("config_pull" in v.get("sync_policy",{}) for v in dv.values()), "sync_policy missing"
assert "public_key" not in blob and "SECRET-KEY" not in blob, "KEY MATERIAL LEAKED in fleet body"
PY

# --- GET /v1/devices: member (no device.manage) sees only their own device ---
curl -s "$GW/v1/devices" -H "authorization: Bearer $MJWT" > /tmp/dfe2e-member.json
A="$A" B="$B" C="$C" python3 - <<'PY' && ok "member sees own device only (own-vs-manage)" || no "member own-only scoping"
import json,os
A,B,C=os.environ['A'],os.environ['B'],os.environ['C']
d=json.load(open('/tmp/dfe2e-member.json')); ids={x["id"] for x in d["devices"]}
assert C in ids, "member should see their own device"
assert A not in ids and B not in ids, "member must NOT see the owner's devices"
PY

# --- POST /rpc/devices/set-sync-policy: 200 / 400 / 404 / 403 ---
sp() { curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/rpc/devices/set-sync-policy" \
  -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2"; }
GOOD=$(printf '{"id":"%s","sync_policy":{"config_pull":"manual","offline_grace_h":48,"buffer_flush":"on_reconnect"}}' "$A")
BAD=$(printf '{"id":"%s","sync_policy":{"config_pull":"weekly","offline_grace_h":1,"buffer_flush":"interval"}}' "$A")
MISS=$(printf '{"id":"%s","sync_policy":{"config_pull":"manual","offline_grace_h":1,"buffer_flush":"interval"}}' "$BADID")
MEMW=$(printf '{"id":"%s","sync_policy":{"config_pull":"manual","offline_grace_h":1,"buffer_flush":"interval"}}' "$C")
[ "$(sp "$OJWT" "$GOOD")" = "200" ] && ok "owner set-sync-policy → 200" || no "owner set-sync-policy not 200"
[ "$(sp "$OJWT" "$BAD")"  = "400" ] && ok "malformed policy → 400"      || no "malformed policy not 400"
[ "$(sp "$OJWT" "$MISS")" = "404" ] && ok "missing device → 404 (tenant-scoped)" || no "missing device not 404"
[ "$(sp "$MJWT" "$MEMW")" = "403" ] && ok "member (no device.manage) → 403" || no "member not 403"

# --- write landed + audited (live DB) ---
CP=$(psql "$DB" -tAc "select sync_policy->>'config_pull' from public.devices where id='$A' and tenant_id='$T'")
[ "$CP" = "manual" ] && ok "sync_policy persisted (config_pull=manual)" || no "sync_policy not persisted (got '$CP')"
AUD=$(psql "$DB" -tAc "select count(*) from public.audit_events where tenant_id='$T' and action='device.sync_policy_changed' and target_id='$A' and actor_id='$OW'")
[ "${AUD:-0}" -ge 1 ] && ok "audit row device.sync_policy_changed (actor=owner, target=A)" || no "no audit row"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
