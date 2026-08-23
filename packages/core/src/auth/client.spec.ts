import { expect, test } from 'vitest'
import { createToriiKavach } from './client'

// Composition smoke test: createToriiKavach wires supabase-js + the kavach
// adapter into one client-only session bundle. Pure construction — no network.
test('createToriiKavach returns a supabase client and a kavach instance', () => {
	const tk = createToriiKavach('https://example.supabase.co', 'anon-key')
	expect(tk.client).toBeTruthy()
	expect(typeof tk.client.auth.getSession).toBe('function')
	expect(tk.kavach).toBeTruthy()
})

test('each call builds independent instances', () => {
	const a = createToriiKavach('https://a.supabase.co', 'key-a')
	const b = createToriiKavach('https://b.supabase.co', 'key-b')
	expect(a.client).not.toBe(b.client)
	expect(a.kavach).not.toBe(b.kavach)
})
