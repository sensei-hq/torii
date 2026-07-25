import {
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY,
	PUBLIC_GATEWAY_URL
} from '$env/static/public'

export const SUPABASE_URL = PUBLIC_SUPABASE_URL
export const SUPABASE_ANON_KEY = PUBLIC_SUPABASE_ANON_KEY
// The C1 central gateway — the admin's single privileged read/write target.
export const GATEWAY_URL = PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:8787'
