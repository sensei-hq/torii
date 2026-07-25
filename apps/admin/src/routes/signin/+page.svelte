<script>
	import { goto } from '$app/navigation'
	import { api } from '$lib/api'

	let email = $state('')
	let password = $state('')
	let error = $state('')
	let loading = $state(false)

	async function submit() {
		if (loading) return
		loading = true
		error = ''
		try {
			await api.signIn(email, password)
			goto('/requests')
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-paper">
	<div class="w-full max-w-sm rounded-lg border border-paper-edge bg-paper-soft p-6">
		<h1 class="mb-1 text-lg font-medium text-ink">Strategos Admin</h1>
		<p class="mb-4 text-sm text-ink-mute">Sign in to continue</p>
		<form
			onsubmit={(e) => {
				e.preventDefault()
				submit()
			}}
			class="space-y-3"
		>
			<input
				bind:value={email}
				type="email"
				placeholder="Email"
				autocomplete="username"
				class="w-full rounded border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
			/>
			<input
				bind:value={password}
				type="password"
				placeholder="Password"
				autocomplete="current-password"
				class="w-full rounded border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
			/>
			{#if error}
				<p class="text-xs text-warning">{error}</p>
			{/if}
			<button
				type="submit"
				disabled={loading || !email || !password}
				class="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
			>
				{loading ? 'Signing in…' : 'Sign in'}
			</button>
		</form>
	</div>
</div>
