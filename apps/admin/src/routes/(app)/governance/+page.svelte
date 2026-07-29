<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip, Async } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').Feature[]} */
	let features = $state([])
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')

	/** @type {{ v: import('$lib/api').FeatureState, label: string }[]} */
	const STATES = [
		{ v: 'locked', label: 'Locked' },
		{ v: 'default-on', label: 'On' },
		{ v: 'default-off', label: 'Off' },
		{ v: 'user-overridable', label: 'User' }
	]

	async function load() {
		try {
			features = (await api.governance()).features
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	/** @param {import('$lib/api').Feature} f → the effective posture (policy override, else default) */
	const effective = (f) =>
		f.policy_state ?? (f.mandatory ? 'locked' : f.enabled ? 'default-on' : 'default-off')

	/**
	 * @param {string} slug
	 * @param {import('$lib/api').FeatureState} state
	 */
	async function set(slug, state) {
		if (busy) return
		busy = slug
		error = ''
		try {
			await api.setFeature(slug, state)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	const overrides = $derived(features.filter((f) => f.policy_state).length)
</script>

<AppShell app="admin" title="Governance">
	<PageHeader
		eyebrow="Govern"
		title="Feature governance"
		sub="Set each governed capability's workspace posture — locked on, default on/off, or user-overridable. Overrides resolve server-side and can only tighten per space and role."
	/>

	{#if loading}
		<Async loading />
	{:else if error}
		<div class="px-5">
			<Card pad
				><p class="text-sm text-danger">
					{error}{error.includes('403')
						? ' — needs the governance.manage / feature.manage capability.'
						: ''}
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<div class="grid grid-cols-3 gap-4">
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
						Features
					</div>
					<div class="font-heading text-2xl font-light text-ink">{features.length}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
						Overridden
					</div>
					<div class="font-heading text-2xl font-light text-ink">{overrides}</div>
				</Card>
				<Card pad>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Locked</div>
					<div class="font-heading text-2xl font-light text-ink">
						{features.filter((f) => effective(f) === 'locked').length}
					</div>
				</Card>
			</div>

			<Card flush>
				<CardHead title="Governed features" meta={`${features.length}`} />
				<div>
					{#each features as f (f.slug)}
						{@const eff = effective(f)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0"
						>
							<Glyph
								icon={eff === 'locked'
									? 'i-solar-lock-keyhole-minimalistic-bold-duotone'
									: 'i-solar-widget-bold-duotone'}
								tone={eff === 'default-off' ? 'mute' : 'accent'}
							/>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-semibold text-ink">{f.title}</span>
									{#if f.policy_state}<Chip tone="accent">override</Chip>{/if}
								</div>
								{#if f.description}
									<div class="mt-0.5 truncate text-[13px] text-ink-mute">{f.description}</div>
								{/if}
							</div>
							<!-- 4-state posture control -->
							<div
								class="inline-flex overflow-hidden rounded-md border border-paper-edge"
								class:opacity-50={busy === f.slug}
							>
								{#each STATES as s (s.v)}
									<button
										type="button"
										disabled={busy === f.slug}
										onclick={() => set(f.slug, s.v)}
										aria-pressed={eff === s.v}
										class="border-l border-paper-edge px-2.5 py-1 text-[11px] font-medium first:border-l-0 {eff ===
										s.v
											? 'bg-ink text-paper'
											: 'text-ink-soft hover:bg-paper-mute'}">{s.label}</button
									>
								{/each}
							</div>
						</div>
					{/each}
					{#if features.length === 0}
						<p class="px-4 py-3 text-sm text-ink-mute">No governed features.</p>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-keyhole-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-[11px] leading-relaxed text-ink-mute">
						Posture writes to the tenant's workspace scope and resolves server-side; a per-space or
						per-role override can only tighten (never loosen) it, and every change is audited.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
