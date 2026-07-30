<script>
	// Zen-Sumi "Alerts · needs attention" card (mock: view-overview.jsx ALERTS). Presentation only
	// — the app feeds `alerts` from its alerts-state singleton and wires `onopen`/`ondismiss`.
	// Each row: a status dot (warning amber / accent vermillion), an icon, the text, a dismiss.
	import Card from './Card.svelte'
	import CardHead from './CardHead.svelte'

	/** @typedef {{ id: string, severity: 'warning'|'accent', icon: string, text: string, route: string }} Alert */
	/** @type {{ alerts?: Alert[], onopen?: (route: string) => void, ondismiss?: (id: string) => void }} */
	let { alerts = [], onopen = () => {}, ondismiss = () => {} } = $props()

	/** @param {'warning'|'accent'} sev */
	const dot = (sev) => (sev === 'warning' ? 'bg-warning' : 'bg-accent')
</script>

<Card flush>
	<CardHead title="Alerts · needs attention" icon="i-solar-bell-bold-duotone">
		{#snippet right()}
			{#if alerts.length}
				<span
					class="rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning"
					>{alerts.length} open</span
				>
			{/if}
		{/snippet}
	</CardHead>

	<div>
		{#each alerts as a (a.id)}
			<div
				class="flex items-center gap-3 border-b border-paper-edge px-5 py-3 last:border-b-0"
				data-severity={a.severity}
			>
				<span class="h-2 w-2 shrink-0 rounded-full {dot(a.severity)}"></span>
				<span class="{a.icon} h-4 w-4 shrink-0 text-ink-soft"></span>
				<button
					type="button"
					onclick={() => onopen(a.route)}
					class="flex-1 truncate text-left text-sm text-ink transition-colors hover:text-accent"
					>{a.text}</button
				>
				<button
					type="button"
					onclick={() => ondismiss(a.id)}
					aria-label="Dismiss alert"
					class="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-faint hover:bg-paper-mute hover:text-ink"
				>
					<span class="i-solar-close-circle-bold-duotone h-3.5 w-3.5"></span>
				</button>
			</div>
		{/each}
		{#if !alerts.length}
			<div class="flex items-center gap-2 px-5 py-6 text-sm text-ink-mute">
				<span class="i-solar-check-circle-bold-duotone h-4 w-4 shrink-0 text-success"></span>
				Nothing needs attention — budget, policy and provider-health thresholds surface here.
			</div>
		{/if}
	</div>

	<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-5 py-3">
		<span class="i-solar-info-circle-bold-duotone mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-mute"></span>
		<span class="text-xs leading-relaxed text-ink-mute"
			>Thresholds on budget, policy blocks and provider health raise alerts here — no scrolling the
			ledger to find trouble.</span
		>
	</div>
</Card>
