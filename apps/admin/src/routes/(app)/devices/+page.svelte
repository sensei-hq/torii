<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').Device[]} */
	let devices = $state([])
	let loading = $state(true)
	let error = $state('')
	let busy = $state('')

	async function load() {
		try {
			devices = (await api.devices()).devices
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	const activeCount = $derived(devices.filter((d) => d.status === 'active').length)

	/** @param {import('$lib/api').Device} d */
	async function revoke(d) {
		if (busy) return
		if (
			!confirm(
				`Revoke ${d.name}? Its next request is denied immediately, even with a live session.`
			)
		)
			return
		busy = d.id
		error = ''
		try {
			await api.revokeDevice(d.id)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/** @param {string | null} ts */
	function ago(ts) {
		if (!ts) return 'never'
		const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
		if (s < 90) return 'just now'
		if (s < 5400) return `${Math.round(s / 60)}m ago`
		if (s < 129600) return `${Math.round(s / 3600)}h ago`
		return `${Math.round(s / 86400)}d ago`
	}
</script>

<AppShell app="admin" title="Devices">
	<PageHeader
		eyebrow="Governance"
		title="Device fleet"
		sub="Every desktop app that enrolled against this workspace. Revoking a device denies its next request on the gateway hot path — a revoked device can't keep spending even while its session token is still valid."
	/>

	{#if loading}
		<Async loading />
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			{#if error}
				<Card pad
					><p class="text-sm text-danger" role="alert">
						{error}{error.includes('403')
							? ' — needs the device.manage capability (owner/admin).'
							: ''}
					</p></Card
				>
			{/if}

			<Card flush>
				<CardHead
					title="Enrolled devices"
					meta={`${activeCount} active · ${devices.length} enrolled`}
				/>
				<div>
					{#each devices as d (d.id)}
						{@const revoked = d.status === 'revoked'}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0"
							class:opacity-55={revoked}
						>
							<span class="i-solar-laptop-bold-duotone h-5 w-5 flex-shrink-0 text-ink-mute"></span>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm text-ink">{d.name}</span>
									<Chip tone={revoked ? 'danger' : 'success'}>{d.status}</Chip>
									{#if d.owner}<Chip tone="mute">{d.owner}</Chip>{/if}
								</div>
								<div class="font-mono text-xs text-ink-mute">
									{d.platform ?? '—'}{d.app_version ? ` · v${d.app_version}` : ''}{d.config_version
										? ` · cfg ${d.config_version}`
										: ''} · seen {ago(d.last_seen_at)}
								</div>
							</div>
							{#if !revoked}
								<button
									disabled={busy === d.id}
									onclick={() => revoke(d)}
									class="flex-shrink-0 rounded-md border border-danger/30 px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
								>
									Revoke
								</button>
							{:else}
								<span class="flex-shrink-0 px-3 py-1.5 text-xs text-ink-faint">revoked</span>
							{/if}
						</div>
					{/each}
					{#if devices.length === 0}
						<Empty
							icon="i-solar-laptop-bold-duotone"
							message="No devices enrolled"
							hint="A desktop app enrolls on first sign-in."
							pad="py-8"
						/>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-keyhole-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						Enforced server-side — the gateway checks device status on every request carrying an
						<code class="font-mono">X-Torii-Device</code> header. Revocation takes effect on the very
						next call.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
