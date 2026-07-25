// W1 · AP0 — the single typed data-access layer for the admin portal.
//
// The admin is a CLIENT, not a trust boundary. Every call carries the browser
// Supabase session's RS256 JWT as `Authorization: Bearer`, and:
//   - READS go to capability-gated C1 GETs (`/v1/whoami`, `/v1/audit`, `/v1/requests`),
//   - WRITES go to C1 `/rpc/*` ONLY (never a direct PostgREST write to a privileged
//     table) — the gateway enforces capability + tenant isolation server-side.
// UX gating uses `whoami().capabilities` (advisory); the server is the only gate.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { GATEWAY_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from './env'

// A browser Supabase client purely to read the persisted session's access token —
// Kavach signs in via Supabase under the hood, so `getSession()` returns the live JWT.
let _sb: SupabaseClient | null = null
function sb(): SupabaseClient {
	if (!_sb) {
		_sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: { persistSession: true, autoRefreshToken: true }
		})
	}
	return _sb
}

async function authHeader(): Promise<Record<string, string>> {
	const { data } = await sb().auth.getSession()
	const token = data.session?.access_token
	return token ? { authorization: `Bearer ${token}` } : {}
}

async function gwGet<T>(path: string): Promise<T> {
	const res = await fetch(`${GATEWAY_URL}${path}`, { headers: await authHeader() })
	if (!res.ok) throw new Error(`${path} → ${res.status}`)
	return res.json() as Promise<T>
}

async function gwPost<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${GATEWAY_URL}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(await authHeader()) },
		body: JSON.stringify(body)
	})
	if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text().catch(() => '')}`)
	return res.json() as Promise<T>
}

export interface WhoAmI {
	sub: string
	tenant_id: string | null
	role: string | null
	capabilities: string[]
}

export interface AuditEvent {
	id: string
	actor_id: string | null
	action: string
	target_type: string | null
	target_id: string | null
	created_at: string
}

export interface RequestRow {
	id: string
	chain_id: string | null
	adapter: string
	model: string
	execution_location: string | null
	input_tokens: number | null
	output_tokens: number | null
	cost_usd: number
	duration_ms: number
	status: string
	recorded_at: string
}

export const api = {
	whoami: () => gwGet<WhoAmI>('/v1/whoami'),
	audit: (limit = 100) => gwGet<{ events: AuditEvent[] }>(`/v1/audit?limit=${limit}`),
	requests: (limit = 100) => gwGet<{ requests: RequestRow[] }>(`/v1/requests?limit=${limit}`),
	// writes (consumed by later screens) — /rpc/* only:
	approveBudgetRequest: (id: string) => gwPost('/rpc/budgets/approve-request', { id }),
	upsertBudgetNode: (node: Record<string, unknown>) => gwPost('/rpc/budgets/upsert-node', node)
}
