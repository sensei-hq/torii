<script>
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { api } from '$lib/api'
	import { postAuthDestination } from '$lib/auth-flow'
	import { BrandMark } from '@torii/ui'

	// 'working' → establishing session + resolving org; 'error' → the org lookup failed
	// transiently (network / 5xx) — offer a retry, not a dead-end. A tenant-less whoami
	// (tenant_id: null) routes straight to /onboarding rather than a dead-end screen.
	let status = $state('working')

	onMount(async () => {
		// supabase-js parses the returned tokens (detectSessionInUrl); getSession awaits
		// that init and returns the persisted session.
		const signedIn = await api.hasSession()
		if (!signedIn) {
			goto(resolve('/signin'))
			return
		}
		try {
			const who = await api.whoami()
			if (postAuthDestination(who) === 'home') {
				goto(resolve('/'))
			} else {
				goto(resolve('/onboarding'))
			}
		} catch {
			// A 401 already hard-redirects to /signin via api's onUnauthorized; any other
			// failure is transient — show a retry rather than the misleading no-org state.
			status = 'error'
		}
	})

	function retry() {
		window.location.reload()
	}
</script>

<div class="grid min-h-screen place-items-center bg-paper px-6">
	<div
		class="w-full max-w-[400px] rounded-lg border border-paper-edge bg-paper-soft p-6 text-center"
		aria-live="polite"
	>
		<div class="mb-4 flex justify-center"><BrandMark size={32} /></div>
		{#if status === 'working'}
			<h1 class="font-heading text-lg text-ink">Signing you in…</h1>
			<p class="mt-2 text-sm text-ink-mute">Confirming your access.</p>
		{:else}
			<h1 class="font-heading text-lg text-ink">Something went wrong</h1>
			<p class="mt-2 text-sm leading-relaxed text-ink-mute">
				We couldn't confirm your access just now. Please try again.
			</p>
			<button
				type="button"
				onclick={retry}
				class="mt-5 flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-on-primary"
			>
				Try again
			</button>
		{/if}
	</div>
</div>
