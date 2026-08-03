<script>
	// Torii desktop — W3 retrieval inspector. Query → retrieve → inspect exactly what the gateway
	// pulled (dense + BM25 fused by RRF). Focused on retrieval-only; grounded generation is deferred.
	// Presentation only — state + I/O live in retrieval.svelte.ts; pure derivations in retrieval.ts.
	import { onMount } from 'svelte'
	import { retrieval } from '$lib/retrieval.svelte.js'
	import { densePct, fusedPct, fmtScore, stageSummary, configSummary } from '$lib/retrieval'
	import { PageHeader, Card, Empty } from '@torii/ui'

	onMount(() => retrieval.load())

	// bm25 has no exported pct helper (its absolute scale isn't normalizable), so show it relative to
	// the top bm25 hit among the returned chunks — the same treatment fusedPct uses. Local-only.
	/**
	 * @param {import('$lib/rag').RetrieveChunk} chunk
	 * @param {import('$lib/rag').RetrieveChunk[]} chunks
	 */
	function bm25Pct(chunk, chunks) {
		const max = chunks.reduce((m, c) => Math.max(m, c.scores.bm25 ?? 0), 0)
		const v = chunk.scores.bm25 ?? 0
		return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0
	}

	/** @param {KeyboardEvent} e */
	function onQueryKeydown(e) {
		if (e.key === 'Enter') {
			e.preventDefault()
			retrieval.run()
		}
	}
</script>

<section data-retrieval class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Playground"
		title="Chat with your documents"
		sub="Run a query and inspect exactly what the gateway retrieves — dense + BM25 fused by RRF."
	/>

	<div class="flex flex-1 flex-col gap-4 px-4 pb-8 sm:px-6 xl:px-12">
		<!-- controls -->
		<Card pad>
			<div class="flex flex-col gap-3">
				<div class="flex flex-wrap items-end gap-3">
					<label class="flex flex-col gap-1 text-xs text-ink-mute">
						<span>Space</span>
						{#if retrieval.spaces.length === 0}
							<span class="py-1.5 text-xs text-ink-faint"
								>Upload documents to a space first (Library).</span
							>
						{:else}
							<select
								data-space-select
								aria-label="Space"
								value={retrieval.spaceId}
								onchange={(e) => retrieval.setSpace(e.currentTarget.value)}
								class="rounded border border-paper-edge bg-paper px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
							>
								{#each retrieval.spaces as s (s.id)}
									<option value={s.id}>{s.id.slice(0, 8)}… · {s.count} docs</option>
								{/each}
							</select>
						{/if}
					</label>

					<label class="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-ink-mute">
						<span>Query</span>
						<input
							data-query
							bind:value={retrieval.query}
							onkeydown={onQueryKeydown}
							placeholder="Ask across this space… (Enter to run)"
							aria-label="Query"
							class="rounded border border-paper-edge bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-mute focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
						/>
					</label>

					<label class="flex w-40 flex-col gap-1 text-xs text-ink-mute">
						<span class="flex items-center justify-between"
							>top-k <span class="font-mono text-ink-soft">{retrieval.topK}</span></span
						>
						<input
							type="range"
							min="1"
							max="50"
							step="1"
							value={retrieval.topK}
							oninput={(e) => retrieval.setTopK(+e.currentTarget.value)}
							aria-label="Top K results"
							style="accent-color: var(--accent)"
							class="w-full cursor-pointer"
						/>
					</label>

					<button
						data-retrieve-run
						type="button"
						onclick={() => retrieval.run()}
						disabled={retrieval.loading || !retrieval.query.trim() || !retrieval.spaceId}
						class="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
					>
						{#if retrieval.loading}
							<span class="i-solar-refresh-bold-duotone h-4 w-4 animate-spin"></span> Retrieving…
						{:else}
							<span class="i-solar-magnifer-zoom-in-bold-duotone h-4 w-4"></span> Run
						{/if}
					</button>
				</div>

				{#if configSummary(retrieval.config)}
					<p class="font-mono text-xs text-ink-faint">{configSummary(retrieval.config)}</p>
				{/if}
			</div>
		</Card>

		{#if retrieval.error}
			<div class="rounded border border-paper-edge bg-warning-soft px-3 py-2 text-sm text-warning">
				{retrieval.error}
			</div>
		{/if}

		{#if retrieval.loading}
			<p class="text-sm text-ink-mute">Retrieving…</p>
		{/if}

		{#if retrieval.result}
			{@const result = retrieval.result}
			{@const chunks = result.chunks}
			<!-- grounding pill -->
			<div class="flex items-center gap-2">
				<span
					data-grounding
					class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium {result.grounding_ready
						? 'bg-success-soft text-success'
						: 'bg-warning-soft text-warning'}"
				>
					<span
						class="{result.grounding_ready
							? 'i-solar-check-circle-bold'
							: 'i-solar-danger-circle-bold'} h-3.5 w-3.5"
					></span>
					{result.grounding_ready ? 'grounding ready' : 'no matches'}
				</span>
				{#if result.redactions > 0}
					<span class="inline-flex items-center gap-1 text-xs text-ink-mute">
						<span class="i-solar-shield-keyhole-bold-duotone h-3.5 w-3.5"></span>
						{result.redactions} redacted
					</span>
				{/if}
			</div>

			<!-- retrieved chunks -->
			{#if chunks.length === 0}
				<Empty
					icon="i-solar-magnifer-zoom-in-bold-duotone"
					message="No chunks matched this query."
				/>
			{:else}
				<div class="flex flex-col gap-3">
					{#each chunks as chunk (chunk.chunk_id)}
						<div
							data-chunk
							class="rounded-lg border border-paper-edge bg-paper-soft p-4 {chunk.dropped
								? 'opacity-55'
								: ''}"
						>
							<div class="mb-1.5 flex items-center gap-2">
								<span class="i-solar-document-text-bold-duotone h-4 w-4 flex-shrink-0 text-ink-soft"
								></span>
								<span class="min-w-0 flex-1 truncate text-sm font-medium text-ink"
									>{chunk.section_path ?? chunk.document_id.slice(0, 8)}</span
								>
								{#if chunk.page_ref != null}
									<span class="flex-shrink-0 font-mono text-xs text-ink-mute"
										>p.{chunk.page_ref}</span
									>
								{/if}
								{#if chunk.dropped}
									<span
										class="flex-shrink-0 rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning"
										>dropped by rerank</span
									>
								{/if}
							</div>
							<p class="line-clamp-3 text-sm leading-relaxed text-ink-soft">{chunk.text}</p>

							<div data-score class="mt-3 flex flex-col gap-1">
								{@render scoreBar('dense', densePct(chunk), fmtScore(chunk.scores.dense))}
								{@render scoreBar('bm25', bm25Pct(chunk, chunks), fmtScore(chunk.scores.bm25))}
								{@render scoreBar('fused', fusedPct(chunk, chunks), fmtScore(chunk.scores.fused))}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- pipeline stages -->
			<div data-stage class="rounded-lg border border-paper-edge bg-paper-soft p-4">
				<div class="mb-2 flex items-center gap-2">
					<span class="i-solar-routing-2-bold-duotone h-4 w-4 text-ink-soft"></span>
					<span class="text-xs font-medium uppercase tracking-widest text-ink-mute"
						>Pipeline stages</span
					>
				</div>
				<p class="mb-2 font-mono text-xs text-ink-soft">{stageSummary(result.stages)}</p>
				<ul class="flex flex-wrap gap-x-4 gap-y-1">
					{#each result.stages as stage (stage.name)}
						<li class="font-mono text-xs text-ink-mute">
							<span class="text-ink-soft">{stage.name}</span>
							{stage.k_in}<span class="text-ink-faint">→</span>{stage.k_out} · {stage.ms}ms
						</li>
					{/each}
				</ul>
				<p class="mt-3 border-t border-paper-edge pt-2 font-mono text-xs text-ink-faint">
					top {chunks.length} · {result.config_used.mode} · no rerank
				</p>
			</div>
		{/if}
	</div>

	<!-- deferred: generation + advanced modes -->
</section>

{#snippet scoreBar(label, pct, val)}
	<div class="flex items-center gap-2">
		<span class="w-12 flex-shrink-0 font-mono text-xs text-ink-mute">{label}</span>
		<span class="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-mute">
			<span class="block h-full bg-accent" style="width: {pct}%"></span>
		</span>
		<span class="w-14 flex-shrink-0 text-right font-mono text-xs text-ink-soft">{val}</span>
	</div>
{/snippet}
