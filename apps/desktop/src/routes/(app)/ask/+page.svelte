<script>
	import { ask } from '$lib/ask.svelte.js'
	import { ExecBadge } from '@torii/ui'
	import { session } from '@torii/core'

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
	<header class="flex items-center justify-between border-b border-paper-edge px-6 py-4">
		<div>
			<p class="text-xs uppercase tracking-wide text-ink-mute">Ask</p>
			<h1 class="text-lg font-medium text-ink">Ask your workspace</h1>
		</div>
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
					? 'inline-flex items-center gap-1 rounded-full bg-paper-soft px-2.5 py-1 font-medium text-primary-500'
					: 'inline-flex items-center gap-1 px-2.5 py-1 text-ink-mute'}
			>
				<span class="i-lucide:cpu h-3 w-3"></span>Local
			</button>
			<button
				type="button"
				data-plane="cloud"
				onclick={() => ask.setPlane('cloud')}
				class={ask.plane === 'cloud'
					? 'inline-flex items-center gap-1 rounded-full bg-paper-soft px-2.5 py-1 font-medium text-primary-500'
					: 'inline-flex items-center gap-1 px-2.5 py-1 text-ink-mute'}
			>
				<span class="i-lucide:cloud h-3 w-3"></span>Cloud
			</button>
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
							<ExecBadge
								plane={turn.exec?.plane ?? 'local'}
								region={turn.exec?.plane === 'cloud' ? 'eu-west-2' : ''}
							/>
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
				{onkeydown}
				placeholder="Ask anything… (Enter to send)"
				disabled={ask.loading}
				class="flex-1 rounded border border-paper-edge bg-paper-soft px-3 py-2 text-sm text-ink placeholder:text-ink-mute disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
			/>
			<button
				data-send
				onclick={submit}
				disabled={ask.loading || !draft.trim()}
				class="rounded bg-primary-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
			>
				Send
			</button>
		</div>
		{#if ask.plane === 'cloud' && !session.authenticated}
			<p class="mt-1.5 text-xs text-amber-600">Sign in to use the cloud plane.</p>
		{:else}
			<p class="mt-1.5 text-xs text-ink-mute">
				{ask.plane === 'cloud'
					? 'Cloud plane · routed through the gateway — provider keys stay server-side'
					: 'Local plane · answered on-device, no data leaves your machine'}
			</p>
		{/if}
	</div>
</section>
