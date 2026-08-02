<script>
	import { onMount } from 'svelte'
	import { ask } from '$lib/ask.svelte.js'
	import {
		LATENCY_MAX_MS,
		citationLabel,
		fmtLatency,
		groundedReason,
		latencyTone,
		routingReason
	} from '$lib/ask'
	import { ExecBadge, Meter } from '@torii/ui'
	import { session } from '@torii/core'

	let draft = $state('')

	// Load seam: the models the member may pin (cloud + on-device). Degrades internally, so a
	// failure just leaves the picker with "Auto" — fire-and-forget, never blocks the screen.
	onMount(() => {
		ask.load()
	})

	function submit() {
		const t = draft.trim()
		if (!t || ask.loading) return
		draft = ''
		ask.send(t)
	}

	/** @param {KeyboardEvent} e */
	function onkeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			submit()
		}
	}
</script>

<section data-ask class="flex h-full flex-col">
	<!-- header -->
	<header class="flex items-center justify-between border-b border-paper-edge px-6 py-4">
		<div>
			<p class="text-xs uppercase tracking-wide text-ink-mute">Ask</p>
			<h1 class="text-lg font-medium text-ink">Ask your workspace</h1>
		</div>
		<div class="flex items-center gap-3">
			<!-- grounding control: ask within a space → retrieval-augmented, cited answer (via the
			     gateway). "No grounding" falls back to plain plane routing. Only shown if the member
			     has spaces to ground in. -->
			{#if ask.spaces.length}
				<label class="flex items-center gap-1.5 text-xs text-ink-mute">
					<span class="i-solar-folder-with-files-bold-duotone h-3.5 w-3.5 text-accent"></span>
					<select
						data-space-picker
						aria-label="Ground in space"
						value={ask.spaceId}
						onchange={(e) => ask.setSpace(e.currentTarget.value)}
						class="rounded border border-paper-edge bg-paper-soft px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
					>
						<option value="">No grounding</option>
						{#each ask.spaces as s (s.id)}
							<option value={s.id}>{s.name} · {s.document_count}</option>
						{/each}
					</select>
				</label>
			{/if}

			<!-- pinned-model control: pin the answering model (opts.model) or let the plane
			     auto-route. Options are scoped to the current plane so a pin is always runnable. -->
			<label class="flex items-center gap-1.5 text-xs text-ink-mute">
				<span class="i-solar-pin-bold-duotone h-3.5 w-3.5 text-accent"></span>
				<select
					data-pin-model
					aria-label="Pinned model"
					bind:value={ask.model}
					class="rounded border border-paper-edge bg-paper-soft px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
				>
					<option value="">Auto · gateway chooses</option>
					{#each ask.pinnable as m (m.id)}
						<option value={m.id}>{m.name}</option>
					{/each}
				</select>
			</label>

			<!-- D3 split-plane selector: choose where this Ask runs -->
			<div
				data-plane-toggle
				class="inline-flex items-center gap-0.5 rounded-full border border-paper-edge p-0.5 text-xs"
			>
				<button
					type="button"
					data-plane="local"
					onclick={() => ask.setPlane('local')}
					class={ask.plane === 'local'
						? 'inline-flex items-center gap-1 rounded-full bg-paper-soft px-2.5 py-1 font-medium text-accent'
						: 'inline-flex items-center gap-1 px-2.5 py-1 text-ink-mute'}
				>
					<span class="i-solar-cpu-bold-duotone h-3 w-3"></span>Local
				</button>
				<button
					type="button"
					data-plane="cloud"
					onclick={() => ask.setPlane('cloud')}
					class={ask.plane === 'cloud'
						? 'inline-flex items-center gap-1 rounded-full bg-paper-soft px-2.5 py-1 font-medium text-accent'
						: 'inline-flex items-center gap-1 px-2.5 py-1 text-ink-mute'}
				>
					<span class="i-solar-server-minimalistic-bold-duotone h-3 w-3"></span>Cloud
				</button>
			</div>
		</div>
	</header>

	<!-- conversation -->
	<div class="flex-1 overflow-auto px-6 py-4 space-y-4">
		{#each ask.turns as turn, i (i)}
			{#if turn.role === 'user'}
				<div class="flex justify-end">
					<div class="max-w-[70%]">
						<p class="text-xs font-medium text-ink-mute mb-1 text-right">You</p>
						<div
							class="rounded-lg bg-paper-soft px-4 py-2.5 text-sm text-ink border border-paper-edge"
						>
							{turn.content}
						</div>
					</div>
				</div>
			{:else}
				<div class="flex justify-start">
					<div class="max-w-[80%]">
						<div
							class="rounded-lg bg-paper-mute px-4 py-2.5 text-sm text-ink border border-paper-edge whitespace-pre-wrap"
						>
							{turn.content}
						</div>
						<div class="mt-1.5 flex items-center gap-2 text-xs text-ink-mute">
							<span class="font-medium">{turn.exec?.model ?? 'gemma2:2b'}</span>
							<span class="text-paper-edge">·</span>
							<!-- region omitted: it must come from the gateway (M3) — no fabricated constant.
							     The badge shows the honest plane ("via gateway") until the response carries it. -->
							<ExecBadge plane={turn.exec?.plane ?? 'local'} />
							{#if turn.exec != null && turn.exec.cost_usd === 0}
								<span class="text-paper-edge">·</span>
								<span>$0</span>
							{/if}
						</div>

						{#if turn.exec != null}
							<!-- reason line: for a grounded turn, which space + how many sources; otherwise
							     which plane/model answered and why (client-side legibility) -->
							{#if turn.grounded}
								<p data-routing-reason class="mt-2 text-xs leading-relaxed text-ink-soft">
									{groundedReason(turn.spaceName ?? 'this space', turn.citations?.length ?? 0)}
								</p>
							{:else}
								<p data-routing-reason class="mt-2 text-xs leading-relaxed text-ink-soft">
									{routingReason({
										plane: turn.exec.plane,
										pinned: turn.pinned ?? false,
										model: turn.exec.model
									})}
								</p>
							{/if}

							<!-- grounded answer sources: the cited excerpts the answer was grounded on -->
							{#if turn.grounded && turn.citations && turn.citations.length}
								<div data-sources class="mt-2 space-y-1.5">
									<p class="text-xs font-medium uppercase tracking-wider text-ink-mute">Sources</p>
									{#each turn.citations as c (c.chunk_id)}
										<div
											data-citation
											class="rounded border border-paper-edge bg-paper-soft px-2.5 py-1.5"
										>
											<div class="flex items-center gap-2 text-xs">
												<span class="font-mono text-accent">{citationLabel(c)}</span>
												{#if c.page_ref != null}
													<span class="text-ink-mute">p.{c.page_ref}</span>
												{/if}
												<span class="flex-1"></span>
												<span class="font-mono text-ink-mute">{c.score.toFixed(2)}</span>
											</div>
											<p class="mt-0.5 line-clamp-2 text-xs text-ink-soft">{c.snippet}</p>
										</div>
									{/each}
								</div>
							{/if}

							<!-- latency meter: the real round-trip duration of this answer -->
							<div data-latency class="mt-2 max-w-[220px]">
								<Meter
									label="Latency"
									value={turn.exec.duration_ms}
									max={LATENCY_MAX_MS}
									display={fmtLatency(turn.exec.duration_ms)}
									tone={latencyTone(turn.exec.duration_ms)}
								/>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		{/each}

		{#if ask.loading}
			<div class="flex justify-start">
				<p class="text-sm text-ink-mute italic">
					{ask.plane === 'cloud' ? 'Thinking via gateway…' : 'Thinking on-device…'}
				</p>
			</div>
		{/if}

		{#if ask.error}
			<div class="rounded bg-paper-soft border border-paper-edge px-3 py-2 text-sm text-ink-soft">
				{ask.error}
			</div>
		{/if}
	</div>

	<!-- composer -->
	<div class="border-t border-paper-edge px-6 py-4">
		<div class="flex items-center gap-2">
			<input
				bind:value={draft}
				aria-label="Ask a question"
				{onkeydown}
				placeholder="Ask anything… (Enter to send)"
				disabled={ask.loading}
				class="flex-1 rounded border border-paper-edge bg-paper-soft px-3 py-2 text-sm text-ink placeholder:text-ink-mute disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
			/>
			<button
				data-send
				onclick={submit}
				disabled={ask.loading || !draft.trim()}
				class="rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
			>
				Send
			</button>
		</div>
		{#if (ask.plane === 'cloud' || ask.grounded) && !session.authenticated}
			<p class="mt-1.5 text-xs text-warning">
				Sign in to {ask.grounded ? 'ground answers in a space' : 'use the cloud plane'}.
			</p>
		{:else}
			<p class="mt-1.5 text-xs text-ink-mute">
				{#if ask.grounded}
					Grounded · answered from {ask.spaceName}'s documents through the gateway, with citations
				{:else if ask.plane === 'cloud'}
					Cloud plane · routed through the gateway — provider keys stay server-side
				{:else}
					Local plane · answered on-device, no data leaves your machine
				{/if}
			</p>
		{/if}
	</div>
</section>
