<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, Glyph } from '@torii/ui'
	import { api } from '$lib/api'

	// Workspace-default policy toggles (docs/mockups/app/admin.jsx SettingsView). Each
	// persists to public.tenant_settings via /rpc/settings/set; an absent row = `def`.
	const ROWS = [
		{
			k: 'masking',
			ic: 'i-solar-shield-keyhole-bold-duotone',
			t: 'PII & tenant masking',
			d: 'Scan input and output on every call, across the workspace.',
			def: true
		},
		{
			k: 'autoFallback',
			ic: 'i-solar-routing-2-bold-duotone',
			t: 'Automatic fallback',
			d: 'Step down on budget or provider error without asking.',
			def: true
		},
		{
			k: 'alerts',
			ic: 'i-solar-bell-bold-duotone',
			t: 'Anomaly alerts',
			d: 'Notify owners on budget breach, outage, or policy hit.',
			def: false
		},
		{
			k: 'telemetry',
			ic: 'i-solar-history-bold-duotone',
			t: 'Anonymous telemetry',
			d: 'Share aggregate routing metrics to improve defaults.',
			def: false
		}
	]

	/** @type {Record<string, boolean>} */
	let values = $state(Object.fromEntries(ROWS.map((r) => [r.k, r.def])))
	let loading = $state(true)
	let error = $state('')
	let busy = $state('')

	onMount(async () => {
		try {
			const s = await api.settings()
			const next = Object.fromEntries(ROWS.map((r) => [r.k, r.def]))
			for (const row of s.settings) if (row.setting_key in next) next[row.setting_key] = row.enabled
			values = next
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	/** @param {string} k */
	async function flip(k) {
		if (busy) return
		const nextVal = !values[k]
		busy = k
		error = ''
		try {
			await api.setSetting(k, nextVal)
			values[k] = nextVal
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}
</script>

<AppShell app="admin" title="Settings">
	<PageHeader
		eyebrow="Settings"
		title="Workspace defaults"
		sub="Policies that apply to every member of the organization unless a space overrides them."
	/>

	<div class="space-y-4 px-5 pb-6">
		{#if error}
			<Card pad
				><p class="text-sm text-danger">
					{error}{error.includes('403') ? ' — needs the tenant.manage capability (owner/admin).' : ''}
				</p></Card
			>
		{/if}
		<Card flush>
			{#each ROWS as r, i (r.k)}
				<div class="flex items-center gap-4 px-5 py-4 {i > 0 ? 'border-t border-paper-edge' : ''}">
					<Glyph icon={r.ic} size={34} tone={values[r.k] ? 'accent' : 'mute'} />
					<div class="min-w-0 flex-1">
						<div class="text-sm font-semibold text-ink">{r.t}</div>
						<div class="mt-0.5 text-[13px] text-ink-mute">{r.d}</div>
					</div>
					<button
						role="switch"
						aria-checked={values[r.k]}
						aria-label={r.t}
						disabled={loading || busy === r.k}
						onclick={() => flip(r.k)}
						class="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 {values[
							r.k
						]
							? 'bg-primary'
							: 'bg-paper-mute'}"
					>
						<span
							class="absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow-sm transition-all {values[
								r.k
							]
								? 'left-[22px]'
								: 'left-0.5'}"
						></span>
					</button>
				</div>
			{/each}
		</Card>

		<p class="px-1 font-mono text-[11px] text-ink-faint">
			gateway · healthy · changes persist to the tenant workspace and are audited.
		</p>
	</div>
</AppShell>
