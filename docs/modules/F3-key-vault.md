# F3 · Key vault & crypto

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Foundations · **Status:** Planned — **must land before C1 handles any real provider credential** (§2 W4); gets its own phase plan sequenced ahead of C1 going live · **Depends on:** F1 (storage lands in F1 RW13), F2

## Purpose

The **provider credential vault**: store two credential **types** per router — **API key** (BYOK static secret) **and OAuth account** (e.g. Anthropic OAuth) — safely, and expose them **only** to the central gateway, never to any client or device. This is the core of "managed access for all via BYOK." No deployed phase holds plaintext provider keys.

## Responsibilities

- Envelope encryption, credential lifecycle (rotate/revoke), **OAuth token auto-refresh**, strict access control, audit of credential operations. **Credentials carry no budget** (budget binds to identities/nodes, §2 W2).

## What we build

- **`router_credentials`** (F1 RW13 generalizes `router_keys`, `type = api_key | oauth`): `api_key` stores the encrypted BYOK secret; `oauth` stores encrypted **access + refresh token** plus `expires_at`, `scopes`, `token_url`, and refresh metadata (`last_refreshed_at`, `refresh_status`).
- **Envelope encryption**: per-tenant **DEK** encrypts credential material; DEK is encrypted by a master **KEK**. AES-256-GCM. **Production KEK lives in a cloud KMS/HSM; the `STRATEGOS_KEK` env var is local-dev only** (§2 W4). (Envelope carried from the `database/` design.)
- **Decrypt only in the trusted central gateway** (C1) at call time; neither the key secret nor OAuth tokens are ever returned over any API or RLS view/function.
- **RLS lockdown** on `router_credentials` — deny-all, `service_role`-only, no client `SELECT`.
- **OAuth auto-refresh worker** (F3/central): a background refresher calls `token_url` to swap the access token **before `expires_at`**; the Connections screen supports connect-via-OAuth alongside paste-a-key. (The cloud adapter's bearer-credential support is a **gateway-repo issue** — create → implement → close.)
- **Rotation**: DEK rotation re-encrypts a tenant's credentials; KEK rotation re-encrypts DEKs. **Revocation** invalidates a credential immediately. The uniqueness constraint permits a second credential during cutover (no `unique(tenant_id, router_id)` blocking dual-credential).
- Use vetted crypto libraries (e.g. Tink/Themis-class), not hand-rolled.

## Key contracts / data

- `router_credentials` ciphertext layout `[IV][tag][ciphertext]` for each secret field; `type api_key|oauth`; OAuth fields (`access_token`/`refresh_token`/`expires_at`/`scopes`/`token_url`) all encrypted at rest; `tenant_keys` (encrypted DEK + version). Documented **refresh contract** the worker implements.

## UI surfaces

- Connections (W1): **connect-via-OAuth** (Anthropic-style) or paste-a-key, plus rotate / revoke a router credential — UI never displays the secret or tokens (masked only).

## Reuse / source

`database/` DEK/KEK design and `tenant_keys`/`router_keys` (→ `router_credentials`) tables; existing at-rest custody (RLS deny-all + `service_role`-only + AES-256-GCM envelope, C1 sole decryptor) is already correct — keep it (§2).

## Resolved (by [`../DECISIONS.md`](../DECISIONS.md))

- **KEK custody:** cloud KMS/HSM in production; `STRATEGOS_KEK` env var is local-dev only (§2 W4).
- **Credential scope:** vault holds both `api_key` (BYOK) and `oauth` account types; credentials carry no budget (§2 W2).

## Open questions

- Refresh-worker placement/cadence and failure handling (retry, alert on `refresh_status` failure, grace before a live OAuth call fails).
- Per-router policy `server-proxied` (default; central custody) vs the deferred `device-local` option (would require key re-wrapping for devices — out of scope while we keep central custody).
