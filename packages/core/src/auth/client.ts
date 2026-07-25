import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from '@kavach/adapter-supabase'
import { createKavach } from 'kavach'

export interface ToriiKavach {
	client: SupabaseClient
	kavach: ReturnType<typeof createKavach>
}

// UPSTREAM(kavach): package this client-only composition as a first-class kavach client-only session mode.
// Client-only session: supabase-js persists + refreshes the session in localStorage
// (persistSession/autoRefreshToken). No SvelteKit server hook, no /auth/session endpoint.
export function createToriiKavach(url: string, anonKey: string): ToriiKavach {
	const client = createClient(url, anonKey, {
		auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
	})
	const adapter = getAdapter(client)
	const kavach = createKavach(adapter, {})
	return { client, kavach }
}
