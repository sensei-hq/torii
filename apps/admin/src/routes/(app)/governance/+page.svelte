<script>
	import { onMount } from 'svelte'
	import { resolve } from '$app/paths'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import { scopeOptions } from '$lib/governance'
	import {
		fleetSummary,
		sortFleet,
		execPlane,
		seenFreshness,
		agoLabel,
		categorize,
		actionLabel,
		categoryCounts,
		filterByCategory,
		auditToCsv,
		auditCsvFilename,
		AUDIT_CATEGORY_LABELS
	} from '$lib/governance-cards'

	/** @type {import('$lib/api').Feature[]} */
	let features = $state([])
	/** @type {import('$lib/api').Role[]} */
	let roles = $state([])
	/** @type {import('$lib/api').Device[]} — enrolled fleet (/v1/devices), best-effort. */
	let devices = $state([])
	/** @type {import('$lib/api').AuditEvent[]} — privileged-change ledger (/v1/audit), best-effort. */
	let audit = $state([])
	/** @type {'all' | import('$lib/governance-cards').AuditCategory} */
	let auditCat = $state('all')
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
			// Roles power the scope switcher, devices the fleet card, audit the SIEM card — all
			// best-effort. Each rides its own capability (`role.manage` / `device.manage` /
			// `audit.read`); a caller with only `governance.manage` still gets the feature editor,
			// and a denied side-read degrades to an empty card rather than blanking the screen.
			const [gov, org, dev, aud] = await Promise.all([
				api.governance(),
				api.org().catch(() => null),
				api
					.devices()
					.then((r) => r.devices)
					.catch(() => []),
				api
					.audit(100)
					.then((r) => r.events)
					.catch(() => [])
			])
			features = gov.features
			roles = org?.roles ?? []
			devices = dev
			audit = aud
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

	// ── device fleet + audit/SIEM cards (real /v1/devices + /v1/audit) ──────────
	const fleet = $derived(fleetSummary(devices))
	const fleetTop = $derived(sortFleet(devices).slice(0, 6))
	const auditCounts = $derived(categoryCounts(audit))
	const auditRows = $derived(filterByCategory(audit, auditCat))

	/** category → text tone, mirroring the mock (policy=accent, access=success, export=warning). */
	const catTone = (/** @type {import('$lib/governance-cards').AuditCategory} */ c) =>
		c === 'policy'
			? 'text-accent'
			: c === 'access'
				? 'text-success'
				: c === 'export'
					? 'text-warning'
					: 'text-ink-mute'

	/** Client-side download of the visible (category-filtered) audit slice — no backend write. */
	function exportAuditCsv() {
		const blob = new Blob([auditToCsv(auditRows)], { type: 'text/csv;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = auditCsvFilename()
		a.click()
		URL.revokeObjectURL(url)
	}
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
							{#if s.type !== 'workspace'}<span class="font-mono uppercase opacity-70"
									>{s.type}</span
								>{/if}{s.label}
						</button>
					{/each}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-layers-minimalistic-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"
					></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						{#if isWorkspace}
							Editing the <span class="text-ink">workspace default</span> — the posture every space and
							role inherits unless it tightens below.
						{:else}
							Editing <span class="text-ink">{scope.type} · {scope.label}</span>. A scope override
							can only <b>tighten</b> the workspace default (never loosen it); resolution runs server-side
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
										{cur
											? `${scope.label} · set`
											: `inherits workspace · ${STATES.find((s) => s.v === eff)?.label}`}
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
							Posture writes to the tenant's workspace scope and resolves server-side; a per-space
							or per-role override can only tighten (never loosen) it, and every change is audited.
						{:else}
							Posture writes to <span class="text-ink">{scope.type} · {scope.label}</span> and layers
							over the workspace default — resolution (workspace → space → role → user) runs server-side,
							and every change is audited.
						{/if}
					</span>
				</div>
			</Card>

			<!-- Device fleet · where inference lands (reuses /v1/devices) -->
			<Card flush>
				<CardHead title="Device fleet" icon="i-solar-laptop-bold-duotone">
					{#snippet right()}
						<span class="font-mono text-xs text-ink-mute">
							{fleet.total} enrolled · <b class="text-ink">{fleet.onDevice}</b> on-device
						</span>
					{/snippet}
				</CardHead>

				<!-- summary tiles: enrollment + execution-plane split, from the real fleet -->
				<div class="grid grid-cols-2 sm:grid-cols-4">
					{#each [{ label: 'Enrolled', value: fleet.total, hint: `${fleet.active} active · ${fleet.revoked} revoked` }, { label: 'On-device', value: fleet.onDevice, hint: 'run models on-box' }, { label: 'Via gateway', value: fleet.viaGateway, hint: 'route to the cloud' }, { label: 'Online now', value: fleet.online, hint: 'seen in the last 5m' }] as t (t.label)}
						<div class="border-b border-r border-paper-edge p-4">
							<div class="text-xs font-semibold uppercase tracking-wider text-ink-mute">
								{t.label}
							</div>
							<div class="font-heading text-2xl font-light text-ink">{t.value}</div>
							<div class="mt-0.5 font-mono text-xs text-ink-mute">{t.hint}</div>
						</div>
					{/each}
				</div>

				<!-- compact fleet list (top 6, active + freshest first) -->
				<div>
					{#each fleetTop as d (d.id)}
						{@const revoked = d.status === 'revoked'}
						{@const plane = execPlane(d)}
						{@const fresh = seenFreshness(d.last_seen_at)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-2.5 last:border-b-0"
							class:opacity-55={revoked}
						>
							<span
								class="h-2 w-2 shrink-0 rounded-full {fresh === 'online'
									? 'bg-success'
									: fresh === 'idle'
										? 'bg-warning'
										: 'bg-ink-faint'}"
								title={fresh}
							></span>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-mono text-sm text-ink">{d.name}</span>
									{#if d.owner}<span class="font-mono text-xs text-ink-mute">{d.owner}</span>{/if}
									{#if d.platform}<span class="font-mono text-xs text-ink-faint">{d.platform}</span
										>{/if}
									{#if revoked}<Chip tone="danger">revoked</Chip>{/if}
								</div>
							</div>
							<Chip tone={plane === 'on-device' ? 'success' : 'mute'}
								>{plane === 'on-device' ? 'on device' : 'via gateway'}</Chip
							>
							<span class="w-16 text-right font-mono text-xs text-ink-mute"
								>{agoLabel(d.last_seen_at)}</span
							>
						</div>
					{/each}
					{#if devices.length === 0}
						<Empty
							icon="i-solar-laptop-bold-duotone"
							message="No devices enrolled"
							hint="A desktop app enrolls on first sign-in."
							pad="py-8"
						/>
					{:else if devices.length > fleetTop.length}
						<a
							href={resolve('/devices')}
							class="flex items-center gap-1.5 px-4 py-2.5 text-xs text-accent hover:bg-paper-mute"
						>
							<span class="i-solar-arrow-right-bold-duotone h-3.5 w-3.5"></span>
							{devices.length - fleetTop.length} more device{devices.length - fleetTop.length === 1
								? ''
								: 's'} in Devices
						</a>
					{/if}
				</div>

				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-info-circle-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						Where inference lands is read from each device's enrolled platform — desktop apps can
						run models on-box; the web client always routes via the gateway. Manage or revoke
						devices in
						<a class="text-accent hover:underline" href={resolve('/devices')}>Devices</a>.
					</span>
				</div>
			</Card>

			<!-- Audit trail · streamed to SIEM (reuses /v1/audit) -->
			<Card flush>
				<CardHead title="Audit trail" icon="i-solar-history-bold-duotone">
					{#snippet right()}
						<div class="flex items-center gap-3">
							<span class="inline-flex items-center gap-1.5 font-mono text-xs text-ink-mute">
								<span class="h-2 w-2 rounded-full bg-success"></span>
								immutable · append-only
							</span>
							<button
								type="button"
								onclick={exportAuditCsv}
								disabled={auditRows.length === 0}
								class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute disabled:cursor-not-allowed disabled:opacity-50"
							>
								<span class="i-solar-download-minimalistic-bold-duotone h-3.5 w-3.5"></span>
								Export CSV
							</button>
						</div>
					{/snippet}
				</CardHead>

				<!-- category triage: config / policy / access / export -->
				<div class="flex flex-wrap items-center gap-2 border-b border-paper-edge px-4 py-3">
					{#each auditCounts as c (c.category)}
						<button
							type="button"
							onclick={() => (auditCat = c.category)}
							aria-pressed={auditCat === c.category}
							class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium {auditCat ===
							c.category
								? 'border-ink bg-ink text-paper'
								: 'border-paper-edge text-ink-soft hover:bg-paper-mute'}"
						>
							{c.label}
							<span class="font-mono opacity-70">{c.count}</span>
						</button>
					{/each}
				</div>

				<!-- event stream, newest first -->
				<div>
					{#each auditRows as e (e.id)}
						{@const cat = categorize(e.action)}
						<div
							class="flex items-baseline gap-3 border-b border-paper-edge px-4 py-2.5 last:border-b-0"
						>
							<span class="w-16 shrink-0 font-mono text-xs text-ink-mute"
								>{agoLabel(e.created_at)}</span
							>
							<span class="w-16 shrink-0 truncate font-mono text-xs text-ink-soft"
								>{e.actor_id ? e.actor_id.slice(0, 8) : 'system'}</span
							>
							<span class="min-w-0 flex-1 text-sm text-ink">
								{actionLabel(e.action)}
								{#if e.target_type}<span class="text-ink-mute"> · {e.target_type}</span>{/if}
							</span>
							<span class="shrink-0 font-mono text-xs uppercase tracking-wider {catTone(cat)}"
								>{AUDIT_CATEGORY_LABELS[cat]}</span
							>
						</div>
					{/each}
					{#if auditRows.length === 0}
						<Empty
							icon="i-solar-history-bold-duotone"
							message={audit.length === 0 ? 'No audit events yet' : 'No events in this category'}
							hint={audit.length === 0 ? 'Privileged changes appear here as they happen.' : ''}
							pad="py-8"
						/>
					{/if}
				</div>

				<div
					class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-dashed border-paper-edge px-4 py-3 font-mono text-xs text-ink-mute"
				>
					<span>append-only · <b class="text-ink">no edit / delete</b></span>
					<span>streams to <b class="text-ink">configured SIEM sinks</b></span>
					<span>{audit.length} event{audit.length === 1 ? '' : 's'} in view</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
