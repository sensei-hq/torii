# F3 · Key vault & crypto

**Plane:** Foundations · **Status:** Planned · **Depends on:** F1, F2

## Purpose
Store BYOK provider keys safely and expose them **only** to the central gateway — never to any client or device. This is the core of "managed access for all via BYOK."

## Responsibilities
- Envelope encryption, key lifecycle (rotate/revoke), strict access control, audit of key operations.

## What we build
- **Envelope encryption**: per-tenant **DEK** encrypts `router_keys`; DEK is encrypted by a master **KEK** (env var → cloud KMS later). AES-256-GCM. (Carried from the `database/` design.)
- **Decrypt only in the trusted central gateway** (C1) at call time; keys are never returned over any API or RLS view.
- **RLS lockdown** on `router_keys` — no client `SELECT`.
- **Rotation**: DEK rotation re-encrypts a tenant's keys; KEK rotation re-encrypts DEKs. **Revocation** invalidates a key immediately.
- Use vetted crypto libraries (e.g. Tink/Themis-class), not hand-rolled.

## Key contracts / data
- `router_keys` ciphertext layout `[IV][tag][ciphertext]`; `tenant_keys` (encrypted DEK + version).

## UI surfaces
- Connections (W1): connect / rotate / revoke a router credential — UI never displays the key (masked only).

## Reuse / source
`database/` DEK/KEK design and `tenant_keys`/`router_keys` tables.

## Open questions
- KEK custody: env var vs cloud KMS/HSM (lean KMS for prod).
- Per-router policy `server-proxied` (default; central custody) vs the deferred `device-local` option (would require key re-wrapping for devices — out of scope while we keep central custody).
