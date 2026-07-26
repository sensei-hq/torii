<script>
	// Ask one question across 2–4 models side by side (docs/mockups/app/view-compare.jsx).
	// Real data only: each column runs the prompt for real — local models on-device via
	// Tauri (gateway.infer), the cloud column through the C1 gateway (cloudInfer) — and
	// shows the actual answer, cost and latency. Ranked by a real cost+speed heuristic.
	// The LLM quality-judge (grounding/quality scores) is a fast-follow — it needs the C6
	// judge surfaced to the desktop, so it is intentionally not faked here.
	import { onMount } from 'svelte'
	import { PageHeader, Card, Chip, ExecBadge, Meter, Async, Empty } from '@torii/ui'
	import { session } from '@torii/core'
	import { cloudInfer } from '$lib/cloud'
	import { gateway } from '$lib/gateway.js'

	// A synthetic column for the gateway/cloud plane — always available so there are ≥2
	// options even with a single (or no) local model installed.
	const CLOUD = { id: '__cloud__', name: 'Gateway (cloud)', local: false }

	let prompt = $state('')
	/** @type {(import('$lib/gateway').ModelInfo)[]} */
	let available = $state([])
	/** @type {string[]} 2–4 selected model ids */
	let selected = $state([])
	let loadingModels = $state(true)
	let running = $state(false)
	let pickOpen = $state(false)
	/** @type {Record<string, { status: 'ok' | 'err', content?: string, error?: string, plane?: 'local' | 'cloud', cost_usd?: number, duration_ms?: number }>} */
	let results = $state({})

	onMount(async () => {
		/** @type {(import('$lib/gateway').ModelInfo)[]} */
		let local = []
		try {
			local = await gateway.listModels()
		} catch {
			/* not running inside Tauri (or no local models) — the cloud column still works */
		}
		available = [...local, CLOUD]
		selected = available.slice(0, 2).map((m) => m.id)
		loadingModels = false
	})

	const cols = $derived(
		selected.map((id) => available.find((m) => m.id === id)).filter((m) => m != null)
	)
	const addable = $derived(available.filter((m) => !selected.includes(m.id)))
	const canRun = $derived(cols.length >= 2 && !!prompt.trim() && !running)

	/** @param {string} id */
	const remove = (id) => {
		if (selected.length > 2) selected = selected.filter((x) => x !== id)
	}
	/** @param {string} id */
	const add = (id) => {
		if (selected.length < 4 && !selected.includes(id)) selected = [...selected, id]
		pickOpen = false
	}

	/** @param {import('$lib/gateway').ModelInfo} m @param {import('$lib/gateway').ChatMessage[]} messages */
	async function runOne(m, messages) {
		const t0 = performance.now()
		try {
			const r =
				m.id === CLOUD.id
					? await cloudInfer(messages)
					: await gateway.infer(messages, { model: m.id })
			return {
				status: /** @type {const} */ ('ok'),
				content: r.content,
				plane: r.plane,
				cost_usd: r.cost_usd,
				// gateway.infer returns real duration; cloudInfer doesn't — measure the round-trip.
				duration_ms: r.duration_ms || Math.round(performance.now() - t0)
			}
		} catch (e) {
			return {
				status: /** @type {const} */ ('err'),
				error: e instanceof Error ? e.message : String(e)
			}
		}
	}

	async function run() {
		const p = prompt.trim()
		if (!p || running || cols.length < 2) return
		running = true
		results = {}
		/** @type {import('$lib/gateway').ChatMessage[]} */
		const messages = [{ role: 'user', content: p }]
		// Fire every column in parallel; paint each as it lands (no waiting on the slowest).
		await Promise.all(
			cols.map(async (m) => {
				const r = await runOne(m, messages)
				results = { ...results, [m.id]: r }
			})
		)
		running = false
	}

	// Rank on REAL signals only: successful first, then cheaper, then faster. This is an
	// honest cost/speed heuristic — NOT the LLM quality judge (that's a fast-follow).
	const ranked = $derived(
		cols
			.map((m) => ({ m, r: results[m.id] }))
			.filter((x) => x.r?.status === 'ok')
			.sort(
				(a, b) =>
					(a.r?.cost_usd ?? 0) - (b.r?.cost_usd ?? 0) ||
					(a.r?.duration_ms ?? 0) - (b.r?.duration_ms ?? 0)
			)
	)
	const winner = $derived(ranked[0]?.m.id ?? null)
	const hasResults = $derived(Object.keys(results).length > 0)

	/** @param {number | undefined} c */
	const money = (c) => (!c ? 'free' : '$' + Number(c).toFixed(4))
	/** @param {KeyboardEvent} e */
	const onkeydown = (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run()
	}
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Tools"
		title="Compare"
		sub="Ask once, see how different models answer side by side. Each column runs for real — local models on-device, the cloud column through the gateway — with its true cost and latency."
	/>

	<div class="space-y-4 px-5 pb-6">
		<!-- prompt -->
		<Card flush>
			<div class="space-y-3 p-4">
				<textarea
					bind:value={prompt}
					{onkeydown}
					aria-label="Prompt"
					rows="3"
					placeholder="Ask once — compare how each model answers… (⌘/Ctrl+Enter to run)"
					class="w-full resize-y rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
				></textarea>
				<div class="flex items-center justify-between">
					<span class="text-[11px] text-ink-faint">
						{cols.length} model{cols.length === 1 ? '' : 's'} selected · runs in parallel
					</span>
					<button
						onclick={run}
						disabled={!canRun}
						class="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
					>
						<span class="i-solar-play-bold-duotone h-4 w-4"></span>{running
							? 'Running…'
							: 'Compare'}
					</button>
				</div>
			</div>
		</Card>

		{#if loadingModels}
			<Async loading />
		{:else}
			<!-- columns: one per selected model + an "add" tile up to 4 -->
			<div
				class="grid items-stretch gap-4"
				style="grid-template-columns: repeat({cols.length}, minmax(0, 1fr)){cols.length < 4 &&
				addable.length
					? ' auto'
					: ''}"
			>
				{#each cols as m (m.id)}
					{@const r = results[m.id]}
					{@const won = hasResults && m.id === winner}
					<div
						class="flex flex-col overflow-hidden rounded-lg border bg-paper {won
							? 'border-accent'
							: 'border-paper-edge'}"
					>
						<!-- header -->
						<div class="flex items-center gap-2 border-b border-paper-edge px-3 py-2.5">
							<span
								class="{m.local
									? 'i-solar-cpu-bold-duotone'
									: 'i-solar-server-minimalistic-bold-duotone'} h-4 w-4 flex-shrink-0 text-ink-mute"
							></span>
							<span class="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-ink"
								>{m.name}</span
							>
							<Chip tone={m.local ? 'mute' : 'accent'}>{m.local ? 'local' : 'cloud'}</Chip>
							{#if cols.length > 2}
								<button
									onclick={() => remove(m.id)}
									title="Remove"
									aria-label={`Remove ${m.name}`}
									class="text-ink-mute hover:text-ink"
									><span class="i-solar-close-circle-bold-duotone h-4 w-4"></span></button
								>
							{/if}
						</div>

						{#if won}
							<div
								class="flex items-center gap-1.5 border-b border-paper-edge bg-accent-soft px-3 py-1.5"
							>
								<span class="i-solar-star-bold-duotone h-3.5 w-3.5 text-accent"></span>
								<span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent"
									>Best value</span
								>
							</div>
						{/if}

						<!-- body -->
						<div class="flex-1 p-3">
							{#if running && !r}
								<p class="text-sm text-ink-mute italic">Thinking…</p>
							{:else if r?.status === 'err'}
								<p class="text-sm text-danger">{r.error}</p>
							{:else if r?.status === 'ok'}
								<div class="mb-2"><ExecBadge plane={r.plane} region={r.plane === 'cloud' ? 'eu-west-2' : ''} /></div>
								<div class="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{r.content}</div>
							{:else}
								<p class="text-sm text-ink-faint">Run to compare.</p>
							{/if}
						</div>

						<!-- metrics (real) -->
						{#if r?.status === 'ok'}
							<div class="grid gap-2.5 border-t border-paper-edge p-3">
								<Meter
									label="Cost"
									value={(r.cost_usd ?? 0) * 100000}
									max={100}
									display={money(r.cost_usd)}
									tone={r.cost_usd ? 'accent' : 'ink'}
								/>
								<Meter
									label="Latency"
									value={r.duration_ms ?? 0}
									max={5000}
									display={((r.duration_ms ?? 0) / 1000).toFixed(1) + 's'}
									tone={(r.duration_ms ?? 0) > 2600 ? 'danger' : 'ink'}
								/>
							</div>
						{/if}
					</div>
				{/each}

				<!-- add a model -->
				{#if cols.length < 4 && addable.length}
					<div class="relative">
						<button
							onclick={() => (pickOpen = !pickOpen)}
							class="flex h-full min-h-[120px] w-[150px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-paper-edge text-sm text-ink-mute hover:border-ink-mute hover:bg-paper-mute"
						>
							<span class="i-solar-add-circle-bold-duotone h-6 w-6"></span>
							<span>Add a model</span>
						</button>
						{#if pickOpen}
							<div
								class="absolute left-1/2 top-[calc(100%+6px)] z-30 w-56 -translate-x-1/2 rounded-lg border border-paper-edge bg-paper p-1 shadow-lg"
							>
								{#each addable as m (m.id)}
									<button
										onclick={() => add(m.id)}
										class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-paper-mute"
									>
										<span
											class="{m.local
												? 'i-solar-cpu-bold-duotone'
												: 'i-solar-server-minimalistic-bold-duotone'} h-3.5 w-3.5 flex-shrink-0 text-ink-mute"
										></span>
										<span class="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{m.name}</span>
										<Chip tone={m.local ? 'mute' : 'accent'}>{m.local ? 'local' : 'cloud'}</Chip>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			{#if cols.length < 2}
				<Empty
					icon="i-solar-layers-minimalistic-bold-duotone"
					message="Pick at least two models to compare"
					hint="Install a local model, or the cloud column alone isn't a comparison."
					pad="py-8"
				/>
			{/if}

			<!-- ranking (real cost+speed heuristic) -->
			{#if ranked.length > 1}
				<Card flush>
					<div class="flex items-center gap-2 border-b border-paper-edge px-4 py-3">
						<span class="i-solar-ranking-bold-duotone h-4 w-4 text-accent"></span>
						<span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-mute"
							>Cost &amp; speed ranking</span
						>
					</div>
					<div class="px-4 py-1">
						{#each ranked as { m, r }, i (m.id)}
							<div
								class="flex items-center gap-3 py-2 {i > 0 ? 'border-t border-paper-edge' : ''}"
							>
								<span
									class="w-5 font-heading text-lg {i === 0 ? 'text-accent' : 'text-ink-mute'}">{i + 1}</span
								>
								<span class="flex-1 truncate font-mono text-[13px] font-semibold text-ink">{m.name}</span>
								<span class="font-mono text-[11px] text-ink-mute"
									>{money(r?.cost_usd)} · {((r?.duration_ms ?? 0) / 1000).toFixed(1)}s</span
								>
							</div>
						{/each}
					</div>
					<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
						<span class="i-solar-info-circle-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
						<span class="text-[11px] leading-relaxed text-ink-mute">
							Ranked on real cost then latency. A quality/grounding judge (scoring the answers
							themselves) is a fast-follow — this is a cost-and-speed heuristic, not a verdict on
							which answer is best.
						</span>
					</div>
				</Card>
			{/if}
		{/if}
	</div>
</section>
