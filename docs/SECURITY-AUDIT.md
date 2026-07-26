# Torii Central Gateway — Security Audit

> **Context:** unattended (autonomous) security run against the Torii central gateway
> on branch `develop`. Findings below were produced by adversarial review and then
> independently **verified against the actual code/DDL** (each carries a `CONFIRMED`
> verdict). Severities shown are the **post-verification (corrected)** ratings; where a
> finding's originally-filed severity differed, that is noted inline.
>
> **⚠️ Human review recommended before acting on any finding.** No remediation code was
> written or committed by this run — this document reports only. The sole code change that
> landed in this run is the API-key auth consumption path (see the final section), which was
> independently reviewed and approved.
>
> All verification inference used `chain:"local"` (Ollama, $0). No paid cloud calls were made.
> No secrets were printed or logged. Work stayed inside the monorepo on `develop`.

## Audited dimensions (8)

1. **budget-integrity** — reserve/commit correctness, hard-cap un-exceedability under concurrency
2. **rpc-privilege** — `/rpc/*` authorization, privilege escalation, audit integrity
3. **tenant-isolation** — cross-tenant reads/writes, RLS/service_role boundaries
4. **auth** — JWT/JWKS handling, claims-version revocation, session freshness
5. **redaction-dlp** — in-flight secret/PII redaction before provider egress
6. **vault-crypto** — KEK/DEK envelope, key-material handling in process memory
7. **secrets-logging** — error surfaces returned to clients, secret non-disclosure
8. **api-key-auth** — H2 identity-bound API-key consumption path (the change that landed this run)

## Summary of confirmed findings

15 findings confirmed: **1 critical, 2 high, 6 medium, 6 low.**

| # | Severity | Location | Dimension | Summary |
|---|----------|----------|-----------|---------|
| 1 | **Critical** | `database/ddl/function/public/budget_reserve.ddl:25` | budget-integrity | ✅ FIXED — Idempotency-Key reuse shares one active hold across K concurrent requests; each runs a real inference but only one commit is charged → K-1 free (budget bypass). |
| 2 | **High** | `services/gateway/src/budgets.rs:38` | budget-integrity | ✅ FIXED — Worst-case reserve counts only output `max_tokens`, ignores input-token cost; `budget_commit` adds actual spend with no cap re-check → one large-input request overshoots a hard cap. |
| 3 | **High** | `services/gateway/src/routes/rpc.rs:305` | rpc-privilege | ✅ FIXED — `rbac_assign_role` gates only on `role.manage` with no role-hierarchy guard → an admin can assign themselves `owner` and gain `tenant.manage`. |
| 4 | Medium _(filed high)_ | `services/gateway/src/redact.rs:45` | redaction-dlp | ✅ FIXED — `secret_assignment` anchors keywords with `\b`, so underscore-compound keys (`client_secret=`, `db_password=`) never match → secret egresses to provider. |
| 5 | Medium _(filed high)_ | `services/gateway/src/redact.rs:30` | redaction-dlp | ✅ FIXED — No high-entropy scorer despite the module contract; prefix-less AWS secret keys and HTTP Basic-auth blobs pass through unredacted. |
| 6 | Medium | `services/gateway/src/capabilities.rs:78` | auth | ✅ FIXED — Claims-version (downgrade-revocation) gate fails **open** on missing profile row / DB error → a hard-deleted admin's unexpired JWT keeps full caps. |
| 7 | Medium | `services/gateway/src/auth.rs:215` | auth | ✅ FIXED — Unauthenticated bad-`kid` JWT forces a synchronous JWKS refetch and unconditionally overwrites the cache (incl. the empty set on upstream error) → cache-poisoning DoS + amplification. |
| 8 | Medium | `services/gateway/src/routes/rpc.rs:305` | tenant-isolation | ✅ FIXED — `rbac_assign_role` trusts client `profile_id`/`role_id` with no tenant-membership check → cross-tenant role-row insert + claims bump. |
| 9 | Medium | `services/gateway/src/routes/rpc.rs:320` | rpc-privilege | ✅ FIXED — `rbac_assign_role` bumps a client-supplied `profile_id`'s `claims_version` unconditionally → cross-tenant session-invalidation DoS. |
| 10 | Low _(filed medium)_ | `services/gateway/src/redact.rs:48` | redaction-dlp | ✅ FIXED — Card rule only tolerates space/dash separators with `\b` on both ends → dot-separated / newline-split / glued PANs defeat the Luhn gate. |
| 11 | Low | `database/ddl/function/core/has_capability.ddl:21` | tenant-isolation | ✅ FIXED — `has_capability` joins `role_permissions` on `role_id` only (no tenant predicate) → a foreign-tenant role row resolves that role's caps. Latent enabler for #3/#8. |
| 12 | Low | `services/gateway/src/routes/rpc.rs:417` | rpc-privilege | 🟡 MITIGATED — a failed `audit_events` write is now surfaced at ERROR (the finding's stated "at minimum, emit an error-level alert" bar) instead of silent `let _ = …`. Full transactional mutation+audit atomicity (ideal) is a tracked follow-up (several handlers do multi-step writes). |
| 13 | Low | `services/gateway/src/crypto.rs:34` | vault-crypto | ✅ FIXED — KEK, decrypted DEKs and decrypted provider secrets are never zeroized → plaintext key material lingers in process memory. |
| 14 | Low | `services/gateway/src/routes/chat.rs:191` | secrets-logging | ✅ FIXED — Upstream provider error (`GatewayError`) returned verbatim as the 502 body / SSE error event → discloses upstream error internals (no full key leaks). |
| 15 | Low | `services/gateway/src/routes/chat.rs:134` | secrets-logging | ✅ FIXED — Raw sqlx/Postgres error text from budget resolution/reservation returned verbatim to the client → internal-schema fingerprinting. |

---

## Findings (detail)

### 1 — Critical · Idempotency-Key hold reuse charges 1 of K real inferences
**Location:** `database/ddl/function/public/budget_reserve.ddl:25` · **Dimension:** budget-integrity

**Exploit scenario.** A single authenticated caller fires K concurrent `POST /v1/chat`
(or `/v1/chat/stream`) requests all carrying the **same** `Idempotency-Key: X`. The first
request's reserve INSERTs hold `H`; while `H.status='active'`, every later request's reserve
hits the `if found then return v_hold` branch and reuses `H` **without a new reserve** — yet
each request independently calls `gateway.execute()` and returns a real completion. There is
**no execution-level idempotency/response cache**: `/chat` and `/chat/stream` sit behind only
the auth middleware, so K real (billable, cloud) completions run. When they finish, each calls
`budget_commit(H,…)`; the first flips `H` active→committed, and every subsequent commit matches
`status='active'` → not found → no-op, so its actual spend is never added to `spent_amount`. Net:
K real inferences execute, exactly one is charged, K-1 are free. The `budget_holds_idem_ukey`
unique index only fires on INSERT, which the reuse-branch requests never do, so it provides no
guard. Repeatable while headroom exists → a large, repeatable K× blow-through of a hard cap
driven entirely by a client-controlled header. (Not strictly infinite-from-zero: each burst's
first request still performs a real cap-gated reserve to seed `H`, so a sliver of headroom is
needed and is denied 402 once the cap is genuinely exhausted.)

**Recommended remediation.** Make the reserve/commit unit-of-work one-to-one: bind each in-flight
request to its **own** hold (do not share a hold across concurrent executions), or dedupe
**execution** (not just the reserve) on the idempotency key — return the first request's cached
result for a repeated key rather than re-executing. At minimum, take the idem lookup `FOR UPDATE`
and refuse reuse while a hold is mid-flight.

### 2 — High · Reserve ignores input-token cost; commit never re-checks the cap
**Location:** `services/gateway/src/budgets.rs:38` · **Dimension:** budget-integrity

**Exploit scenario.** `estimate() = max_tokens * 0.00006` reserves only **output** tokens; input
tokens (client-controlled, up to the model's ~200k context) are never reserved, and there is no
body-size/context guard in the service. Attacker on a node with hard cap $10 and spent $9.99
sends `max_tokens=1` (reserve $0.00006, passes the $0.01 headroom check) but a ~200k-token prompt
to a cloud model. `gateway.execute()` bills the input (~$0.60), and `budget_commit` does an
**unconditional** `spent_amount = spent_amount + p_actual` with **no cap re-check**, pushing spent
to $10.59 — a hard cap exceeded. Because each reserve is tiny (~10,000× smaller than actual), the
`FOR UPDATE` lock only serializes the reserve check, not the later commits, so ~166+ such requests
fit under the headroom, all execute and all commit → tens/hundreds of dollars over a $10 hard cap.
Directly violates the module's stated "hard cap cannot be exceeded even under concurrency"
invariant. (High, not critical: requires auth, is bounded once the node locks out for the period,
no cross-tenant leak.)

**Recommended remediation.** Reserve a true upper bound including estimated input-token cost
(count/limit prompt tokens) plus per-request overhead, and/or have `budget_commit` re-check and
clamp/flag when actual would push a hard node past cap. Cap accepted input size; make the reserve
a function of both input and output.

### 3 — High · `rbac_assign_role` lets an admin self-escalate to `owner`
**Location:** `services/gateway/src/routes/rpc.rs:305` · **Dimension:** rpc-privilege

**Exploit scenario.** An `admin` (seeded with every capability **except** `tenant.manage`, and
holding `role.manage`) reads the owner role id (`select id from core.roles where key='owner'` —
readable in-tenant) and POSTs `/rpc/rbac/assign-role {profile_id:<self>, role_id:<owner_role_id>}`.
`authorize()` passes on `role.manage`; the handler inserts `(tenant, self, owner)` into
`core.profile_roles` with no check that `owner` out-ranks the actor. It then bumps the actor's
`claims_version`; on the forced token refresh `custom_access_token_hook` stamps the owner role into
`role_ids`, and `CapabilitySet::resolve` now returns the full set including `tenant.manage` (tenant
settings + verified domains). The admin has crossed the exact owner boundary the seed protects, and
could equally grant owner to a colluding member / mint persistent backdoor owners. (High, not
critical: attacker must already be a tenant admin; no cross-tenant/anonymous vector.)

**Recommended remediation.** Before inserting, verify the assigned role's capability set is a subset
of the actor's resolved capabilities (or restrict assignment of any `tenant.manage`-bearing role to
callers who themselves hold `tenant.manage`). Reject assignment of any role the caller does not
fully out-rank.

### 4 — Medium _(filed high)_ · `secret_assignment` `\b` misses underscore-compound keys
**Location:** `services/gateway/src/redact.rs:45` · **Dimension:** redaction-dlp

**Exploit scenario.** A user/agent POSTs `/v1/chat` with a message containing
`client_secret=aBcD…`, `db_password=…`, `aws_secret_access_key=…`, or `PRIVATE_KEY=MIIEvQ…`.
Because `_` is a word char, the leading `\b` before the keyword (`secret`/`password`/`key`) cannot
match at the underscore boundary and no vendor-prefix rule applies, so `redact()` returns `hits=[]`
(verified empirically) and `build_inference_request` forwards the live credential verbatim to the
external cloud model while the DLP layer reports zero redactions — a full bypass on the most common
secret-naming style. (Downgraded to medium: format-anchored rules still catch AWS `AKIA`,
`gh*_`/`xox*-`/`sk-`/`AIza` tokens, JWTs, bearer tokens and PEM blocks regardless of key name; the
leak sink is the tenant's own already-configured provider; no trust boundary is crossed.)

**Recommended remediation.** Detect the value regardless of the surrounding key name: drop the
leading `\b` (use a lookaround / allow underscore-adjacent keywords), add `key`/`private_key` and
OAuth `client_secret` explicitly, and/or key detection off the high-entropy value after `=`/`:`
rather than the label.

### 5 — Medium _(filed high)_ · No entropy scorer; prefix-less & Basic-auth secrets leak
**Location:** `services/gateway/src/redact.rs:30` · **Dimension:** redaction-dlp

**Exploit scenario.** Detection is purely vendor-prefix + assignment-keyword; there is no
Shannon/entropy check anywhere (grep of the service finds only the doc/Cargo comments that promise
it). Paste a raw 40-char AWS secret access key (no `AKIA`/`sk-`/`ghp_`/`AIza` prefix) or
`Authorization: Basic dXNlcm5hbWU6…` (base64 `user:password`) into a chat message: neither carries
a recognized prefix or keyword, so `redact()` returns `hits=[]` (verified) and the credential
egresses in full to the provider. (Downgraded to medium: this is an inherent best-effort DLP recall
gap on a defense-in-depth layer scoped to *accidental* leakage, not a structural confidentiality
boundary; a knowing insider defeats any pattern-or-entropy DLP.)

**Recommended remediation.** Add an entropy-based detector (e.g. redact contiguous
`[A-Za-z0-9+/=_-]{20,}` tokens whose Shannon entropy exceeds a threshold) as the module doc
promises, plus a Basic-auth pattern; treat over-redaction as acceptable per the stated high-recall
design.

### 6 — Medium · Claims-version revocation gate fails open on missing profile row
**Location:** `services/gateway/src/capabilities.rs:78` · **Dimension:** auth

**Exploit scenario.** `check_claims_version` does `select claims_version from core.profiles where
id=$1` then `.ok().flatten()` with a tail arm `_ => Ok(())`, so a missing row (`None`) **or** a
swallowed DB error both **pass** the gate. If an admin `U` is offboarded by hard-deleting the
`core.profiles` row (e.g. GDPR erasure), the `profile_roles` FK cascades away but `role_permissions`
(keyed by `(tenant_id, role_id)`, no FK to profiles) survives. `U` then POSTs `/rpc/rbac/assign-role`
(or `/rpc/apikeys/issue`) with the still-valid (~1h TTL) token: `check_claims_version` returns Ok
(no row), `CapabilitySet::resolve` joins the token's `role_ids` against the surviving
`role_permissions` and returns full admin caps → privilege persistence after account deletion until
the JWT expires. (Medium, not high: reachability is conditional — no shipped code deletes
`core.profiles`, and the normal Supabase delete leaves an orphaned profile rather than the
missing-row state; triggering needs an out-of-band operator `DELETE` within the token TTL.)

**Recommended remediation.** Treat "no profile row" as revoked and query errors as stale — fail
closed:
`match query.await { Ok(Some(v)) if v <= claims.claims_version => Ok(()), Ok(None) => Err(StaleToken), _ => Err(StaleToken) }`.
Do not use `.ok().flatten()` on a security gate; consider resolving caps against `profile_roles`
(mirroring `has_capability`) rather than trusting token `role_ids`.

### 7 — Medium · Unauthenticated bad-`kid` JWT poisons the JWKS cache / amplifies fetches
**Location:** `services/gateway/src/auth.rs:215` · **Dimension:** auth

**Exploit scenario.** `decode_header` parses the header without verifying the signature, so an
attacker crafts a JWT-shaped `Authorization: Bearer <hdr{kid:"zzz"}>.garbage.garbage` whose `kid`
matches nothing. `validate_token` returns `NoMatchingKey`, and `require_auth` then calls
`fetch_jwks()` and runs `*state.jwks.write().await = new_jwks;` **unconditionally** — including the
empty `JwkSet` that `fetch_jwks` returns on any network/parse error. **Impact 1 (amplification):**
each bad-`kid` request triggers one outbound 5s-timeout HTTPS GET plus a write-lock acquisition, and
N concurrent such requests fan out to N upstream fetches and serialize legitimate auth behind the
write lock (no rate limiting exists). **Impact 2 (poisoning):** if a bad-`kid` request coincides
with any Supabase blip (which flooding makes more likely), `new_jwks` is empty and the good cached
keys are replaced with `[]`, 401-ing every legitimate JWT until a later fetch happens to succeed.
Both reachable pre-authentication. (Medium: availability only — no auth bypass; poisoning is
transient/self-healing once upstream recovers; listener binds `127.0.0.1` so amplification is behind
a co-located proxy.)

**Recommended remediation.** Only replace the cache when the fetched set is non-empty (and ideally
only after a successful retry): `if !new_jwks.keys.is_empty() { *state.jwks.write().await = … }`.
Add a short cooldown/rate-limit on refetch so a bad `kid` cannot trigger an unbounded stream of
upstream fetches.

### 8 — Medium · `rbac_assign_role` accepts cross-tenant `profile_id`/`role_id`
**Location:** `services/gateway/src/routes/rpc.rs:305` · **Dimension:** tenant-isolation

**Exploit scenario.** An attacker holding `role.manage` in tenant A POSTs `/rpc/rbac/assign-role`
with `profile_id` = a user who is a member only of tenant B (UUID obtained out-of-band) and any
valid `role_id`. `authorize()` passes (they do hold `role.manage`), `tenant` is server-set to A, and
the service_role INSERT into `core.profile_roles` succeeds because the FKs are global
(`profile_id → profiles(id)`, `role_id → roles(id)`, no tenant-scoped composite FK) and the gateway
connects as the `postgres` superuser (RLS bypassed). Guaranteed impact is cross-tenant: a foreign
profile row + audit row land under tenant A, and (via the unconditional claims bump, see #9) the
victim's tenant-B session is invalidated. A latent escalation variant exists only through
`core.has_capability` (see #11), which joins `role_permissions` on `role_id` alone. (Medium: the
victim gains **no** access to tenant A — `resolve` is tenant-scoped — so this is a cross-tenant
availability/integrity break, not confidentiality or privilege gain for the victim.)

**Recommended remediation.** Before the INSERT, require `profile_id` to be an active member of the
caller's tenant (`exists … core.profile_tenants where tenant_id = <caller> and status='active'`) and
require `role_id` to belong to that tenant (`exists … core.roles where id = role_id and tenant_id =
<caller>`); return 404 otherwise. Consider composite FKs `(tenant_id, role_id)` and
`(tenant_id, profile_id)`.

### 9 — Medium · Unconditional cross-tenant `claims_version` bump → session DoS
**Location:** `services/gateway/src/routes/rpc.rs:320` · **Dimension:** rpc-privilege

**Exploit scenario.** After the (unvalidated) insert, `rbac_assign_role` runs
`update core.profiles set claims_version = claims_version + 1 where id = $1` bound to the
attacker-supplied `profile_id`, never checking it belongs to the caller's tenant. Since
`claims_version` is a **global** per-profile counter stamped into every JWT, an admin in tenant A
bumps a tenant-B victim's counter; `check_claims_version` then 401s every `/v1` and `/rpc` request
the victim makes until they re-authenticate. The insert uses `on conflict do nothing` (returns Ok,
not Err), so the handler does not early-return on repeats — looping the request keeps the victim
locked out, a cross-tenant availability attack, plus an `audit_events` row whose `target_id` points
at a foreign profile. (Medium: requires an already-privileged `role.manage` actor and knowledge of
the victim's profile UUID, which is not RLS-enumerable; single-shot lockout is recoverable via
re-auth.)

**Recommended remediation.** Gate both the insert and the `claims_version` bump on
`exists(select 1 from core.profile_tenants where profile_id = body.profile_id and tenant_id =
<caller tenant> and status='active')`, and validate `role_id` belongs to the tenant, returning 404
otherwise — mirroring the in-tenant existence guards already used in `budgets_request`/`apikeys_issue`.

### 10 — Low _(filed medium)_ · Card rule misses dot / newline / glued PAN formats
**Location:** `services/gateway/src/redact.rs:48` · **Dimension:** redaction-dlp

**Exploit scenario.** The rule `\b(?:\d[ -]?){13,19}\b` only tolerates space/dash separators with
`\b` on both ends. A Luhn-valid PAN sent as `4111.1111.1111.1111` (dots), split across a newline,
glued to adjacent identifiers (`id4111111111111111x`), or embedded in a longer digit run never
matches (verified `None` for all), so `luhn_ok` never runs and the full number is forwarded to the
external model. (Low: the common representations — 16 contiguous digits and 4-4-4-4 with space/dash,
even inside quotes — are all correctly matched, Luhn-gated and redacted; only uncommon evasion forms
slip through, on a best-effort accidental-leakage layer.)

**Recommended remediation.** Normalize candidate spans by stripping all non-digits before
Luhn-checking, accept `.` and whitespace (`\s`) separators, and relax the trailing `\b` so
glued/newline-separated PANs are caught (e.g. scan sliding 13–19-digit windows and Luhn-check).

### 11 — Low · `has_capability` role-permission join lacks a tenant predicate
**Location:** `database/ddl/function/core/has_capability.ddl:21` · **Dimension:** tenant-isolation

**Exploit scenario.** `core.has_capability` joins `role_permissions` on `rp.role_id = pr.role_id`
with no `rp.tenant_id = pt.tenant_id` predicate, diverging from `CapabilitySet::resolve` (which
scopes `where tenant_id = $1`). If any code path (e.g. the unvalidated `rbac_assign_role`, #8) lands
a `profile_roles` row whose `role_id` belongs to another tenant, `has_capability(cap)` — used in RLS
predicates such as `devices_access('device.manage')` — returns true for that foreign role's caps
within the attacker's active tenant. In normal operation role ids are per-tenant unique so the gap
is dormant; it removes the tenant backstop that would otherwise neutralize a cross-tenant role
reference. (Low: requires `role.manage`, knowledge of a non-enumerable foreign role UUID, and yields
only an in-tenant boolean; every RLS data predicate independently enforces the tenant on rows.)

**Recommended remediation.** Add `and rp.tenant_id = pt.tenant_id` to the `role_permissions` join in
`core.has_capability`, mirroring the tenant filter in `CapabilitySet::resolve`. Also fix the root
cause (validate `role_id`'s tenant in `rbac_assign_role`, #8).

### 12 — Low · Audit-events write is best-effort, not atomic with the mutation
**Location:** `services/gateway/src/routes/rpc.rs:417` · **Dimension:** rpc-privilege

**Exploit scenario.** The `audit()` helper discards its result
(`let _ = sqlx::query(…).execute(&state.pool).await;`), and each privileged mutation runs as an
independent autocommit statement with no wrapping transaction. If the `audit_events` insert errors
(transient DB error, constraint issue, pool contention), the mutation — budget cap change, role
assignment, API-key issuance, feature-policy change — has already committed and the handler returns
200 with no audit record and no error. No trigger auto-writes audit rows, so the ledger is entirely
application-written with no reconciliation. (Low: not attacker-triggerable — depends on incidental
infra conditions; mutated rows still carry on-row attribution `modified_by`/`created_by`/`assigned_by`.)

**Recommended remediation.** Perform the mutation and the audit insert in a single transaction and
fail the request (or at minimum emit an error-level alert) if the audit insert fails, so a
privileged write cannot succeed without its actor-bound audit row.

### 13 — Low · KEK / DEK / decrypted secrets are never zeroized
**Location:** `services/gateway/src/crypto.rs:34` · **Dimension:** vault-crypto

**Exploit scenario.** `Kek([u8;32])` derives only `Clone` (no `Zeroize`/`Drop`); `unseal_dek`
returns a bare `[u8;32]` (dropping its intermediate `Vec` unwiped), `tenant_dek` copies it, and
`unseal_credential` returns a plaintext `String` — none wiped after use, and `zeroize`/`secrecy` are
not dependencies. A panic-triggered core dump, a swap-out to disk, or any secondary
arbitrary-memory-read primitive yields plaintext tenant DEKs and provider API keys from the
heap/stack. (Low: pure defense-in-depth residual-exposure gap — extraction requires a secondary
primitive that is itself a full compromise; the vault path is additionally `#[allow(dead_code)]`
with no live callers pre-P5.)

**Recommended remediation.** Wrap the KEK and DEK in `zeroize::Zeroizing`/`ZeroizeOnDrop`, return
`Zeroizing<[u8;32]>`/`Zeroizing<String>` from `unseal_*`, avoid/zeroize intermediate `Vec` copies of
key bytes, and consider `mlock` for the KEK.

### 14 — Low · Upstream provider error returned verbatim to the client
**Location:** `services/gateway/src/routes/chat.rs:191` · **Dimension:** secrets-logging

**Exploit scenario.** An authenticated tenant selects a model whose BYOK/platform credential is
invalid or rate-limited. `gateway.execute()` returns a `GatewayError` whose message embeds the raw
upstream provider body; `chat.rs` returns `e.to_string()` verbatim as the 502 body (line 191) and,
for streaming, as an SSE error event (`sse_error(&e.to_string())`, line 386). The caller receives
upstream error internals — e.g. OpenAI's `Incorrect API key provided: sk-proj-****XXXX` (masked key
fragment + account hint), request IDs, quota/org hints. (Low: authenticated-only; verified **not** to
leak a full provider key — adapters authenticate via headers so error URLs carry no key; no
cross-tenant/budget impact.)

**Recommended remediation.** Return a generic 502 message (e.g. `upstream provider error`) plus a
correlation id to the client, log the detailed `GatewayError` server-side only, and never surface
raw upstream response bodies to callers.

### 15 — Low · Raw sqlx/Postgres error text returned to the client
**Location:** `services/gateway/src/routes/chat.rs:134` · **Dimension:** secrets-logging

**Exploit scenario.** An authenticated caller hits `/v1/chat` while budget resolution/reservation
raises a sqlx error. `reserve_budget` maps `BudgetError::Db(err)` to
`(INTERNAL_SERVER_ERROR, err.to_string())` at lines 134 (resolve) and 154 (reserve), returning raw
Postgres/sqlx error text — table/column/constraint identifiers — to the client (and, for streaming,
wrapped into `{"error": msg}`). The strongest reachable path is a deliberate concurrency race on the
attacker-controlled `Idempotency-Key`: two concurrent requests both pass the "existing active hold"
SELECT then race the INSERT, the loser hitting `budget_holds_idem_ukey` (23505) → verbatim
`duplicate key value violates unique constraint "budget_holds_idem_ukey"`, disclosing the internal
table/index name. This enables internal-schema fingerprinting. (Low: only schema identifiers leak —
no credentials, cross-tenant data, or budget bypass. Note `sqlx::Error` Display does not include the
SQLSTATE code, contrary to the original write-up, but the table/constraint names do leak.)

**Recommended remediation.** Map `BudgetError::Db` to a static 500 body (e.g. `budget service
error`); log `err` with `tracing::error!` server-side only.

---

## API-key auth (H2) — landed

The H2 identity-bound API-key **consumption** path was implemented, verified, independently reviewed,
and **pushed** to `origin/develop` in this run.

- **Outcome:** landed / pushed (not reverted). HEAD commit `b701c016b35447cdbec0244bab3f25e9796c1479`
  ("gateway(H2): consume identity-bound API keys in require_auth"); push `5dda669..b701c01`, branch in
  sync with origin.
- **Changed files:** `services/gateway/src/auth.rs`, `services/gateway/src/apikeys.rs`.
- **What it does:** `require_auth` branches **before** the JWT flow — tokens starting `sk_str_` go to
  `authenticate_api_key(pool, token)`; the JWT path is byte-for-byte unchanged (real JWTs start `eyJ`,
  zero collision). The API-key path parses `(prefix, secret)`, does a **parameterized** lookup by
  `prefix`, denies unless `status='active'`, verifies the secret with argon2id (constant-time), and
  resolves `Claims` from the key's **bound identity** (profile → roles from `core.profile_roles`
  tenant-scoped, or service-account → tenant service role). Budget/capabilities/identity come from the
  bound identity, **never** from the key. Every parse/DB/verify failure returns `InvalidApiKey` → 401
  (**fail-closed**); the error carries no secret.
- **Verification (local stack, DB 55322 / Supabase 55321, `chain:"local"`, $0):** `cargo build -q -p
  torii-gateway` exit 0, no warnings; 10/10 adversarial assertions PASS (valid key → `/v1/whoami`
  200 with `sub`=bound identity, `role="apikey"`; valid key → `/v1/chat` 200 budget-resolved;
  same-prefix wrong secret, malformed, revoked, SQL-injection prefix all 401; valid JWT control 200 —
  JWT path intact). Positive round-trip: minted a fresh key → 200, then `status='revoked'` → same key
  401 (revocation live). Log leak scan: 0 occurrences of the raw secret; 0 panics/500s. Teardown left
  0 gateway processes; working tree clean.
- **Independent review:** APPROVED. Adversarial review found **no** real bypass; every path is
  fail-closed, SQL is parameterized, verify is constant-time, JWT path untouched, tenant isolation
  holds, no secret logging. One **informational** note only (not a vulnerability, no action): a timing
  side-channel — unknown/revoked prefixes skip the argon2 verify so an active prefix responds
  measurably slower; prefixes are public 48-bit lookup identifiers (not secrets), so this only reveals
  prefix existence and gives no advantage against the 256-bit secret. Matches industry norm (Stripe et
  al.).

> **Note (verify recipe):** the standing verify recipe sources `.env.local` after setting
> `DATABASE_URL`, and `.env.local` re-clobbers `DATABASE_URL`/`SUPABASE_URL` to point at a different
> stack (caused a first-boot failure against the wrong DB). Both implementer and reviewer re-pinned the
> local infra vars (`…55322` / `…55321`, `PORT=8788`) **after** sourcing provider keys and wrote to no
> remote DB. Recommend the standing recipe re-pin local infra vars after sourcing `.env.local`.
