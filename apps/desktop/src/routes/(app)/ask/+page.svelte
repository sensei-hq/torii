<script>
	import { ask } from '$lib/ask.svelte.js'
	import { ExecBadge } from '@strategos/ui'

	let draft = $state('')

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
	<header class="border-b border-paper-edge px-6 py-4">
		<p class="text-xs uppercase tracking-wide text-ink-mute">Ask</p>
		<h1 class="text-lg font-medium text-ink">Ask your workspace</h1>
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
							<ExecBadge plane={turn.exec?.plane ?? 'local'} />
							{#if turn.exec != null && turn.exec.cost_usd === 0}
								<span class="text-paper-edge">·</span>
								<span>$0</span>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		{/each}

		{#if ask.loading}
			<div class="flex justify-start">
				<p class="text-sm text-ink-mute italic">Thinking on-device…</p>
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
				{onkeydown}
				placeholder="Ask anything… (Enter to send)"
				disabled={ask.loading}
				class="flex-1 rounded border border-paper-edge bg-paper-soft px-3 py-2 text-sm text-ink placeholder:text-ink-mute disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
			/>
			<button
				onclick={submit}
				disabled={ask.loading || !draft.trim()}
				class="rounded bg-primary-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
			>
				Send
			</button>
		</div>
		<p class="mt-1.5 text-xs text-ink-mute">Answered on-device · no data leaves your machine</p>
	</div>
</section>
