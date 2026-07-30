<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip, Async } from '@torii/ui'
	import { api } from '$lib/api'
	import { scopeOptions } from '$lib/governance'

	/** @type {import('$lib/api').Feature[]} */
	let features = $state([])
	/** @type {import('$lib/api').Role[]} */
	let roles = $state([])
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')

	/** the selected scope's stable key (see scopeOptions: `workspace` | `role:<uuid>`). */
	let scopeKey = $state('workspace')
	/**
	 * Optimistic record of what THIS session wrote to each non-workspace scope, keyed
	 * `${scopeKey}::${slug}`. `/v1/governance` only returns the WORKSPACE-scope posture, so a
	 * per-role write can't be read back — we reflect the last write rather than fabricate a
	 * value we never fetched.
	 * @type {Record<string, import('$lib/api').FeatureState>}
	 */
	let scopeWrites = $state({})

	/** @type {{ v: import('$lib/api').FeatureState, label: string }[]} */
	const STATES = [
		{ v: 'locked', label: 'Locked' },
		{ v: 'default-on', label: 'On' },
		{ v: 'default-off', label: 'Off' },
		{ v: 'user-overridable', label: 'User' }
	]

	const scopes = $derived(scopeOptions(roles))
	const scope = $derived(scopes.find((s) => s.key === scopeKey) ?? scopes[0])
	const isWorkspace = $derived(scope.type === 'workspace')

	async function load() {
		try {
			// Roles power the scope switcher — best-effort (needs `role.manage`; a caller with
			// only `governance.manage` degrades gracefully to the workspace-default scope).
			const [gov, org] = await Promise.all([api.governance(), api.org().catch(() => null)])
			features = gov.features
			roles = org?.roles ?? []
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	/** @param {import('$lib/api').Feature} f → the effective WORKSPACE posture (override, else default) */
	const effective = (f) =>
		f.policy_state ?? (f.mandatory ? 'locked' : f.enabled ? 'default-on' : 'default-off')

	/**
	 * The state shown as current for the ACTIVE scope: workspace = server truth; a role/space
	 * scope = this session's last write (undefined ⇒ inherits the workspace default).
	 * @param {import('$lib/api').Feature} f
	 */
	const current = (f) => (isWorkspace ? effective(f) : scopeWrites[`${scope.key}::${f.slug}`])

	/**
	 * @param {string} slug
	 * @param {import('$lib/api').FeatureState} state
	 */
	async function set(slug, state) {
		if (busy) return
		busy = slug
		error = ''
		try {
			await api.setFeature(slug, state, scope)
			if (isWorkspace) {
				await load() // re-read server truth
			} else {
				scopeWrites = { ...scopeWrites, [`${scope.key}::${slug}`]: state }
			}
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
		sub="Set each governed capability's posture — locked on, default on/off, or user-overridable — for the workspace default or a specific role. Overrides resolve server-side and can only tighten per space and role."
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
					<div class="text-xs font-semibold uppercase tracking-wider text-ink-mute">Features</div>
					<div class="font-heading text-2xl font-light text-ink">{features.length}</div>
				</Card>
				<Card pad>
					<div class="text-xs font-semibold uppercase tracking-wider text-ink-mute">Overridden</div>
					<div class="font-heading text-2xl font-light text-ink">{overrides}</div>
				</Card>
				<Card pad>
					<div class="text-xs font-semibold uppercase tracking-wider text-ink-mute">Locked</div>
					<div class="font-heading text-2xl font-light text-ink">
						{features.filter((f) => effective(f) === 'locked').length}
					</div>
				</Card>
			</div>

			<!-- scope switcher — target the workspace default, or a specific role -->
			<Card flush>
				<CardHead title="Editing scope" meta={scope.label} />
				<div class="flex flex-wrap items-center gap-2 px-4 py-3">
					<span class="text-xs font-semibold uppercase tracking-wider text-ink-mute">Scope</span>
					{#each scopes as s (s.key)}
						<button
							type="button"
							onclick={() => (scopeKey = s.key)}
							aria-pressed={scope.key === s.key}
							class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium {scope.key ===
							s.key
								? 'border-ink bg-ink text-paper'
								: 'border-paper-edge text-ink-soft hover:bg-paper-mute'}"
						>
							{#if s.type !== 'workspace'}<span class="font-mono uppercase opacity-70">{s.type}</span
								>{/if}{s.label}
						</button>
					{/each}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span
						class="i-solar-layers-minimalistic-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"
					></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						{#if isWorkspace}
							Editing the <span class="text-ink">workspace default</span> — the posture every space
							and role inherits unless it tightens below.
						{:else}
							Editing <span class="text-ink">{scope.type} · {scope.label}</span>. A scope override can
							only <b>tighten</b> the workspace default (never loosen it); resolution runs server-side
							and every change is audited.
						{/if}
					</span>
				</div>
			</Card>

			<Card flush>
				<CardHead title="Governed features" meta={`${features.length}`} />
				<div>
					{#each features as f (f.slug)}
						{@const eff = effective(f)}
						{@const cur = current(f)}
						<div class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0">
							<Glyph
								icon={eff === 'locked'
									? 'i-solar-lock-keyhole-minimalistic-bold-duotone'
									: 'i-solar-widget-bold-duotone'}
								tone={eff === 'default-off' ? 'mute' : 'accent'}
							/>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-semibold text-ink">{f.title}</span>
									{#if isWorkspace && f.policy_state}<Chip tone="accent">override</Chip>{/if}
									{#if !isWorkspace && cur}<Chip tone="accent">{scope.type} override</Chip>{/if}
								</div>
								{#if f.description}
									<div class="mt-0.5 truncate text-sm text-ink-mute">{f.description}</div>
								{/if}
							</div>
							<div class="flex flex-col items-end gap-1">
								<!-- 4-state posture control (writes to the active scope) -->
								<div
									class="inline-flex overflow-hidden rounded-md border border-paper-edge"
									class:opacity-50={busy === f.slug}
								>
									{#each STATES as s (s.v)}
										<button
											type="button"
											disabled={busy === f.slug}
											onclick={() => set(f.slug, s.v)}
											aria-pressed={cur === s.v}
											class="border-l border-paper-edge px-2.5 py-1 text-xs font-medium first:border-l-0 {cur ===
											s.v
												? 'bg-ink text-paper'
												: 'text-ink-soft hover:bg-paper-mute'}">{s.label}</button
										>
									{/each}
								</div>
								{#if !isWorkspace}
									<span class="font-mono text-xs text-ink-mute">
										{cur ? `${scope.label} · set` : `inherits workspace · ${STATES.find((s) => s.v === eff)?.label}`}
									</span>
								{/if}
							</div>
						</div>
					{/each}
					{#if features.length === 0}
						<p class="px-4 py-3 text-sm text-ink-mute">No governed features.</p>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-keyhole-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						{#if isWorkspace}
							Posture writes to the tenant's workspace scope and resolves server-side; a per-space or
							per-role override can only tighten (never loosen) it, and every change is audited.
						{:else}
							Posture writes to <span class="text-ink">{scope.type} · {scope.label}</span> and layers
							over the workspace default — resolution (workspace → space → role → user) runs
							server-side, and every change is audited.
						{/if}
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
