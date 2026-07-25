<script>
	import { AppShell, PageHeader, Card, Glyph } from '@torii/ui'

	// Workspace defaults — from docs/mockups/app/admin.jsx SettingsView. These are the
	// policy toggles that apply to every member unless a space overrides them. State is
	// local for now; persistence lands with the tenant-settings store (fast-follow).
	const ROWS = [
		{
			k: 'masking',
			ic: 'i-solar-shield-keyhole-bold-duotone',
			t: 'PII & tenant masking',
			d: 'Scan input and output on every call, across the workspace.'
		},
		{
			k: 'autoFallback',
			ic: 'i-solar-routing-2-bold-duotone',
			t: 'Automatic fallback',
			d: 'Step down on budget or provider error without asking.'
		},
		{
			k: 'alerts',
			ic: 'i-solar-bell-bold-duotone',
			t: 'Anomaly alerts',
			d: 'Notify owners on budget breach, outage, or policy hit.'
		},
		{
			k: 'telemetry',
			ic: 'i-solar-history-bold-duotone',
			t: 'Anonymous telemetry',
			d: 'Share aggregate routing metrics to improve defaults.'
		}
	]
	let state = $state({ masking: true, autoFallback: true, alerts: false, telemetry: false })
	/** @param {string} k */
	const flip = (k) => (state[k] = !state[k])
</script>

<AppShell app="admin" title="Settings">
	<PageHeader
		eyebrow="Settings"
		title="Workspace defaults"
		sub="Policies that apply to every member of the organization unless a space overrides them."
	/>

	<div class="space-y-4 px-5 pb-6">
		<Card flush>
			{#each ROWS as r, i (r.k)}
				<div
					class="flex items-center gap-4 px-5 py-4 {i > 0 ? 'border-t border-paper-edge' : ''}"
				>
					<Glyph icon={r.ic} size={34} tone={state[r.k] ? 'accent' : 'mute'} />
					<div class="min-w-0 flex-1">
						<div class="text-sm font-semibold text-ink">{r.t}</div>
						<div class="mt-0.5 text-[13px] text-ink-mute">{r.d}</div>
					</div>
					<button
						role="switch"
						aria-checked={state[r.k]}
						aria-label={r.t}
						onclick={() => flip(r.k)}
						class="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors {state[r.k]
							? 'bg-primary'
							: 'bg-paper-mute'}"
					>
						<span
							class="absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow-sm transition-all {state[
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
			gateway · healthy · these defaults are a preview — persistence lands with the tenant-settings
			store.
		</p>
	</div>
</AppShell>
