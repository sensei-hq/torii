<script>
	import { api } from '$lib/api'
	import { BrandMark } from '@torii/ui'

	let name = $state('')
	let error = $state('')
	let loading = $state(false)

	async function create() {
		if (loading || !name.trim()) return
		loading = true
		error = ''
		try {
			await api.createOrg(name.trim())
			// New membership/role are live in the DB; refresh the JWT so the shell sees them.
			await api.refreshSession()
			window.location.assign('/')
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
</script>

<div class="grid min-h-screen place-items-center bg-paper px-6">
	<div class="w-full max-w-[400px] rounded-lg border border-paper-edge bg-paper-soft p-6">
		<div class="mb-4 flex justify-center"><BrandMark size={32} /></div>
		<h1 class="mb-1 text-center font-heading text-lg text-ink">Create your organization</h1>
		<p class="mb-5 text-center text-sm text-ink-mute">
			You're not part of an organization yet. Create one to get started — you'll be its owner.
		</p>
		<form
			onsubmit={(e) => {
				e.preventDefault()
				create()
			}}
			class="space-y-3"
		>
			<div>
				<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
					>Organization name</span
				>
				<input
					bind:value={name}
					type="text"
					placeholder="Acme, Inc."
					aria-label="Organization name"
					class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
				/>
			</div>
			{#if error}
				<p class="text-xs text-danger" role="alert">{error}</p>
			{/if}
			<button
				type="submit"
				disabled={loading || !name.trim()}
				class="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-on-primary disabled:opacity-40"
			>
				{loading ? 'Creating…' : 'Create organization'}
			</button>
		</form>
	</div>
</div>
