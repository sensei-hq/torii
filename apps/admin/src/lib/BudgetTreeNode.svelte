<script>
	// One editable row of the budget-hierarchy tree, recursing into its children. Every edit
	// goes through orgTreeState → the gateway RPC → a re-read (no optimistic fabrication).
	import Self from './BudgetTreeNode.svelte'
	import { orgTreeState as s } from './org-tree-state.svelte'
	import { allocOf, nodePct, toneForPct, isOverAllocated, countDescendants } from './org-tree'

	/** @type {{ node: import('./org-tree').TreeNode }} */
	let { node } = $props()

	let polOpen = $state(false)

	const kids = $derived(node.children.length > 0)
	const pct = $derived(nodePct(node))
	const tone = $derived(toneForPct(pct))
	const alloc = $derived(allocOf(node))
	const over = $derived(isOverAllocated(node))
	const expanded = $derived(s.isExpanded(node.id))
	const barPct = $derived(Math.min(100, pct))

	const PERIODS = /** @type {const} */ ([
		['daily', 'D'],
		['weekly', 'W'],
		['monthly', 'M']
	])
	/** @type {Record<string, string>} */
	const SUFFIX = { daily: 'day', weekly: 'wk', monthly: 'mo' }
	/** @type {Record<string, string>} */
	const KIND_ICON = {
		org: 'i-solar-buildings-2-bold-duotone',
		dept: 'i-solar-users-group-two-rounded-bold-duotone',
		team: 'i-solar-users-group-rounded-bold-duotone',
		user: 'i-solar-user-bold-duotone',
		service: 'i-solar-cpu-bold-duotone'
	}
	/** @param {number | null} n */
	const money0 = (n) => (n == null ? '∞' : '$' + Math.round(n).toLocaleString())
	/** @param {'danger'|'warning'|'success'} t */
	const toneText = (t) =>
		t === 'danger' ? 'text-danger' : t === 'warning' ? 'text-warning' : 'text-success'
	/** @param {'danger'|'warning'|'success'} t */
	const toneBg = (t) =>
		t === 'danger' ? 'bg-danger' : t === 'warning' ? 'bg-warning' : 'bg-success'

	function confirmRemove() {
		const n = countDescendants(node)
		const extra = n > 0 ? ` and its ${n} descendant${n === 1 ? '' : 's'}` : ''
		if (confirm(`Remove ${node.name}${extra}? This can't be undone.`)) s.remove(node.id)
	}

	/** @param {number|null} v */
	const alertPct = (v) => (v == null ? '' : Math.round(v * 100))
</script>

<div>
	<div
		class="flex items-center gap-2.5 rounded-md py-2 pr-2"
		class:bg-paper={node.kind === 'user'}
		class:border={node.kind === 'user'}
		class:border-paper-edge={node.kind === 'user'}
		style="margin-left:{node.depth * 20}px; padding-left:10px"
	>
		<!-- caret -->
		<button
			type="button"
			onclick={() => kids && s.toggle(node.id)}
			aria-label={kids ? (expanded ? 'Collapse' : 'Expand') : undefined}
			class="grid h-[18px] w-[18px] shrink-0 place-items-center text-ink-mute {kids
				? ''
				: 'invisible'}"
		>
			<span
				class="i-solar-alt-arrow-down-linear h-3 w-3 transition-transform {expanded
					? ''
					: '-rotate-90'}"
			></span>
		</button>

		<!-- kind glyph -->
		<span
			class="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border border-paper-edge bg-paper-soft"
		>
			<span class="{KIND_ICON[node.kind] ?? KIND_ICON.user} h-3.5 w-3.5 text-ink-soft"></span>
		</span>

		<!-- name + kind / alloc -->
		<div class="min-w-[150px] shrink-0">
			<input
				value={node.name}
				onchange={(e) => s.rename(node.id, e.currentTarget.value)}
				spellcheck="false"
				aria-label="Node name"
				class="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink hover:border-paper-edge focus:border-ink focus:outline-none {node.kind ===
				'user'
					? 'font-mono'
					: ''}"
			/>
			<div class="flex items-baseline gap-2 pl-1">
				<span class="font-mono text-xs uppercase tracking-wider text-ink-mute">{node.kind}</span>
				{#if kids}
					<span class="font-mono text-xs {over ? 'text-danger' : 'text-ink-faint'}"
						>alloc {money0(alloc)}/{money0(node.cap_amount)}{over ? ' · over' : ''}</span
					>
				{/if}
			</div>
		</div>

		<!-- utilization meter (status-toned: green/amber/red) -->
		<div class="min-w-[50px] flex-1">
			<div class="h-1.5 overflow-hidden rounded-full bg-paper-mute">
				<div class="h-full rounded-full {toneBg(tone)}" style="width:{barPct}%"></div>
			</div>
		</div>

		<!-- spent / cap (editable) -->
		<div
			class="flex items-baseline justify-end gap-1 font-mono text-xs text-ink-mute"
			style="min-width:132px"
		>
			<span class="text-ink">{money0(node.spent_amount)}</span>/
			<input
				type="number"
				value={node.cap_amount == null ? '' : Math.round(node.cap_amount)}
				onchange={(e) =>
					s.setCap(node.id, e.currentTarget.value === '' ? null : +e.currentTarget.value)}
				aria-label="Cap amount"
				placeholder="∞"
				class="w-14 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-right text-xs font-medium text-ink hover:border-paper-edge focus:border-ink focus:outline-none"
			/>
			<span class="text-ink-faint">/{SUFFIX[node.period] ?? 'mo'}</span>
		</div>

		<!-- pct -->
		<span class="min-w-[32px] shrink-0 text-right font-mono text-sm font-semibold {toneText(tone)}"
			>{pct}%</span
		>

		<!-- period tabs -->
		<div class="inline-flex shrink-0 overflow-hidden rounded-md border border-paper-edge">
			{#each PERIODS as [p, lab] (p)}
				<button
					type="button"
					onclick={() => s.setPeriod(node.id, p)}
					aria-pressed={node.period === p}
					class="px-1.5 py-0.5 text-xs font-medium {node.period === p
						? 'bg-ink text-on-primary'
						: 'text-ink-mute hover:bg-paper-mute'}">{lab}</button
				>
			{/each}
		</div>

		<!-- actions -->
		<div class="flex shrink-0 items-center gap-0.5">
			<button
				type="button"
				onclick={() => (polOpen = !polOpen)}
				title="Budget policy"
				aria-label="Budget policy"
				class="grid h-6 w-6 place-items-center rounded-sm hover:bg-paper-mute"
			>
				<span
					class="i-solar-settings-bold-duotone h-3.5 w-3.5 {polOpen
						? 'text-accent'
						: 'text-ink-faint'}"
				></span>
			</button>
			{#if node.kind !== 'user'}
				<button
					type="button"
					onclick={() => s.addChild(node)}
					disabled={s.busy === node.id}
					title="Add a level under this"
					aria-label="Add a level under this"
					class="grid h-6 w-6 place-items-center rounded-sm hover:bg-paper-mute disabled:opacity-40"
				>
					<span class="i-solar-add-circle-linear h-3.5 w-3.5 text-ink-mute"></span>
				</button>
			{/if}
			{#if node.depth > 0}
				<button
					type="button"
					onclick={confirmRemove}
					disabled={s.busy === node.id}
					title="Remove"
					aria-label="Remove this node"
					class="grid h-6 w-6 place-items-center rounded-sm hover:bg-paper-mute disabled:opacity-40"
				>
					<span class="i-solar-trash-bin-minimalistic-linear h-3.5 w-3.5 text-ink-faint"></span>
				</button>
			{/if}
		</div>
	</div>

	<!-- policy popover: hard/soft · alert % · free floor -->
	{#if polOpen}
		<div
			class="mb-1.5 mt-1 flex flex-wrap items-center gap-6 rounded-md border border-paper-edge bg-paper-soft px-3 py-2"
			style="margin-left:{node.depth * 20 + 44}px"
		>
			<span class="flex items-center gap-2">
				<span class="text-xs font-medium uppercase tracking-widest text-ink-mute">Cap</span>
				<span class="inline-flex overflow-hidden rounded-md border border-paper-edge">
					{#each ['hard', 'soft'] as tp (tp)}
						<button
							type="button"
							onclick={() => s.setEnforcement(node.id, tp)}
							aria-pressed={node.enforcement === tp}
							class="px-2.5 py-1 text-xs font-medium capitalize {node.enforcement === tp
								? tp === 'hard'
									? 'bg-ink text-on-primary'
									: 'bg-warning text-on-primary'
								: 'text-ink-soft hover:bg-paper-mute'}">{tp}</button
						>
					{/each}
				</span>
			</span>

			<span class="flex items-center gap-2">
				<span class="text-xs font-medium uppercase tracking-widest text-ink-mute">Alert at</span>
				<input
					type="number"
					min="0"
					max="100"
					value={alertPct(node.alert_threshold)}
					onchange={(e) =>
						s.setAlert(node.id, e.currentTarget.value === '' ? null : +e.currentTarget.value / 100)}
					aria-label="Alert threshold percent"
					class="w-14 rounded-sm border border-paper-edge bg-paper px-1.5 py-1 text-right font-mono text-xs text-ink"
				/>
				<span class="font-mono text-xs text-ink-mute">%</span>
			</span>

			<span class="flex items-center gap-2">
				<span class="text-xs font-medium uppercase tracking-widest text-ink-mute">Free floor</span>
				<button
					type="button"
					role="switch"
					aria-checked={node.free_floor_enabled}
					aria-label="Free floor"
					onclick={() => s.setFloor(node.id, !node.free_floor_enabled)}
					class="relative h-5 w-9 shrink-0 rounded-full transition-colors {node.free_floor_enabled
						? 'bg-success'
						: 'bg-paper-mute'}"
				>
					<span
						class="absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-all {node.free_floor_enabled
							? 'left-[18px]'
							: 'left-0.5'}"
					></span>
				</button>
			</span>

			<span class="font-mono text-xs text-ink-faint">
				{node.enforcement === 'hard' ? 'blocks at 100% → free floor' : 'warns, keeps serving'} · {SUFFIX[
					node.period
				] ?? 'mo'}
			</span>
		</div>
	{/if}

	<!-- children -->
	{#if kids && expanded}
		<div class="mt-0.5">
			{#each node.children as child (child.id)}
				<Self node={child} />
			{/each}
		</div>
	{/if}
</div>
