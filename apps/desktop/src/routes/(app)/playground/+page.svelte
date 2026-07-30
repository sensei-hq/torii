<script>
	// Single-shot prompt tester — system + user prompt through one gateway call, with cost +
	// latency meters, an on-demand quality-judge verdict (/v1/judge), and the exec-trace
	// inspector. Presentation only: state + the run/judge intents live in $lib/playground.svelte,
	// pure meter/verdict derivations in $lib/playground.
	import { PageHeader, Card, CardHead, ExecBadge, Meter } from '@torii/ui'
	import { session } from '@torii/core'
	import { playground } from '$lib/playground.svelte.js'
	import {
		COST_MAX_USD,
		LATENCY_MAX_MS,
		costTone,
		fmtCost,
		fmtLatency,
		judgeVerdict,
		latencyTone
	} from '$lib/playground'

	/** @param {KeyboardEvent} e */
	const onkeydown = (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') playground.run()
	}
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Tools"
		title="Playground"
		sub="Test a prompt through the gateway in one shot — set a system prompt, pick the plane, watch the cost + latency meters, and let the judge grade the answer."
	/>

	<div class="grid gap-4 px-5 pb-6 lg:grid-cols-2">
		<!-- compose -->
		<Card flush>
			<CardHead title="Prompt">
				{#snippet right()}
					<div
						class="inline-flex items-center gap-0.5 rounded-full border border-paper-edge p-0.5 text-[11px]"
					>
						{#each ['local', 'cloud'] as pl (pl)}
							<button
								onclick={() => (playground.plane = pl)}
								class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 {playground.plane ===
								pl
									? 'bg-paper-mute font-medium text-accent'
									: 'text-ink-mute'}"
							>
								<span
									class="{pl === 'local'
										? 'i-solar-cpu-bold-duotone'
										: 'i-solar-server-minimalistic-bold-duotone'} h-3 w-3"
								></span>{pl}
							</button>
						{/each}
					</div>
				{/snippet}
			</CardHead>
			<div class="space-y-3 p-4">
				<div>
					<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
						>System</span
					>
					<textarea
						bind:value={playground.system}
						aria-label="System prompt"
						rows="2"
						class="w-full resize-y rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
					></textarea>
				</div>
				<div>
					<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
						>Prompt</span
					>
					<textarea
						bind:value={playground.prompt}
						aria-label="Prompt"
						{onkeydown}
						rows="6"
						placeholder="Ask anything… (⌘/Ctrl+Enter to run)"
						class="w-full resize-y rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
					></textarea>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-[11px] text-ink-faint">
						{playground.plane === 'cloud'
							? 'Routed through the gateway — keys stay server-side'
							: 'On-device — no data leaves your machine'}
					</span>
					<button
						onclick={() => playground.run()}
						disabled={playground.loading ||
							!playground.prompt.trim() ||
							(playground.plane === 'cloud' && !session.authenticated)}
						class="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
					>
						<span class="i-solar-play-bold-duotone h-4 w-4"></span>{playground.loading
							? 'Running…'
							: 'Run'}
					</button>
				</div>
			</div>
		</Card>

		<!-- result -->
		<Card flush>
			<CardHead title="Result">
				{#snippet right()}
					<button
						type="button"
						data-judge-toggle
						onclick={() => playground.toggleJudge()}
						disabled={!playground.result}
						aria-pressed={playground.judgeOn}
						title="Grade this answer with the gateway quality judge"
						class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-40 {playground.judgeOn
							? 'border-accent bg-accent-soft text-accent'
							: 'border-paper-edge text-ink-mute'}"
					>
						<span class="i-solar-scale-bold-duotone h-3 w-3"></span>Judge {playground.judgeOn
							? 'on'
							: 'off'}
					</button>
				{/snippet}
			</CardHead>
			<div class="p-4">
				{#if playground.error}
					<p class="text-sm text-danger">{playground.error}</p>
				{:else if playground.loading}
					<p class="text-sm text-ink-mute italic">
						{playground.plane === 'cloud' ? 'Thinking via gateway…' : 'Thinking on-device…'}
					</p>
				{:else if playground.result}
					<div class="whitespace-pre-wrap text-sm text-ink">{playground.result.content}</div>
					<div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
						<span class="font-mono">{playground.result.model ?? '—'}</span>
						<span class="text-paper-edge">·</span>
						<ExecBadge
							plane={playground.result.plane}
							region={playground.result.plane === 'cloud' ? 'eu-west-2' : ''}
						/>
						<button
							class="ml-auto text-accent hover:underline"
							onclick={() => playground.toggleInspector()}
							>{playground.showInspector ? 'Hide' : 'Inspect'}</button
						>
					</div>

					<!-- cost + latency meters — the real cost_usd / round-trip duration of this answer -->
					<div data-meters class="mt-3 grid gap-3 sm:grid-cols-2">
						<Meter
							label="Cost / query"
							value={playground.result.cost_usd}
							max={COST_MAX_USD}
							display={fmtCost(playground.result.cost_usd)}
							tone={costTone(playground.result.cost_usd)}
							hint={playground.result.cost_usd === 0 ? 'local · free' : ''}
						/>
						<Meter
							label="Latency"
							value={playground.result.duration_ms}
							max={LATENCY_MAX_MS}
							display={fmtLatency(playground.result.duration_ms)}
							tone={latencyTone(playground.result.duration_ms)}
						/>
					</div>

					<!-- quality-judge verdict — a separate metered /v1/judge call on the answer -->
					{#if playground.judgeOn}
						<div data-judge class="mt-4 border-t border-dashed border-paper-edge pt-3">
							<div class="mb-2 flex items-center gap-2">
								<span class="i-solar-scale-bold-duotone h-3.5 w-3.5 text-accent"></span>
								<span class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute"
									>Quality judge</span
								>
							</div>
							{#if playground.judgeError}
								<p class="text-sm text-danger">{playground.judgeError}</p>
							{:else if playground.judging}
								<p class="text-sm text-ink-mute italic">
									Scoring the answer via the gateway judge…
								</p>
							{:else}
								{@const v = judgeVerdict(playground.judgeScore)}
								<div class="max-w-[260px]">
									<Meter
										label="Judge score"
										value={v.pct}
										max={100}
										display={v.display}
										tone={v.tone}
									/>
								</div>
								<p class="mt-2 text-sm text-ink-soft">{v.label}</p>
							{/if}
						</div>
					{/if}

					{#if playground.showInspector}
						<pre
							class="mt-3 overflow-auto rounded-md border border-paper-edge bg-paper-mute p-3 font-mono text-[11px] text-ink-soft">{JSON.stringify(
								{ request: playground.sent, response: playground.result },
								null,
								2
							)}</pre>
					{/if}
				{:else}
					<p class="text-sm text-ink-mute">
						Run a prompt to see the answer, its meters, and the trace here.
					</p>
				{/if}
			</div>
		</Card>
	</div>
</section>
