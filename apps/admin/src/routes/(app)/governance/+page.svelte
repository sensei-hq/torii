<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').Feature[]} */
	let features = $state([])
	let error = $state('')
	let loading = $state(true)

	onMount(async () => {
		try {
			features = (await api.governance()).features
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	const on = $derived(features.filter((f) => f.enabled).length)
	const locked = $derived(features.filter((f) => f.mandatory).length)
</script>

<AppShell app="admin" title="Governance">
	<PageHeader
		eyebrow="Govern"
		title="Feature governance"
		sub="Every governed capability and its posture. Mandatory features are locked on for the whole tenant; the rest are overridable per space and role (resolved server-side)."
	/>

	{#if loading}
		<p class="px-5 text-sm text-ink-mute">Loading…</p>
	{:else if error}
		<div class="px-5">
			<Card pad
				><p class="text-sm text-danger">
					{error}{error.includes('403') ? ' — needs the governance.manage capability.' : ''}
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<div class="grid grid-cols-3 gap-4">
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Features</div>
					<div class="font-heading text-2xl font-light text-ink">{features.length}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Enabled</div>
					<div class="font-heading text-2xl font-light text-ink">{on}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Locked</div>
					<div class="font-heading text-2xl font-light text-ink">{locked}</div>
				</Card>
			</div>

			<Card flush>
				<CardHead title="Governed features" meta={`${features.length}`} />
				<div>
					{#each features as f (f.slug)}
						<div class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0">
							<Glyph
								icon={f.mandatory ? 'i-solar-lock-keyhole-minimalistic-bold-duotone' : 'i-solar-widget-bold-duotone'}
								tone={f.enabled ? 'accent' : 'mute'}
							/>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-semibold text-ink">{f.title}</span>
									{#if f.mandatory}<Chip tone="accent">locked</Chip>{/if}
								</div>
								{#if f.description}
									<div class="mt-0.5 truncate text-[13px] text-ink-mute">{f.description}</div>
								{/if}
							</div>
							<Chip tone={f.enabled ? 'success' : 'mute'}>{f.enabled ? 'enabled' : 'off'}</Chip>
						</div>
					{/each}
					{#if features.length === 0}
						<p class="px-4 py-3 text-sm text-ink-mute">No governed features.</p>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-keyhole-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-[11px] leading-relaxed text-ink-mute">
						Posture resolves server-side: a mandatory feature can't be overridden, and a per-space or
						per-role override can only tighten (never loosen) the tenant default.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
