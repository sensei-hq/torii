<script>
	// Single-shot prompt tester — system + user prompt through one gateway call, with the
	// exec trace inspector. Reuses the committed cloudInfer (/v1/chat) for the cloud plane;
	// the local plane runs on-device (Tauri).
	import { PageHeader, Card, CardHead, Chip, ExecBadge } from '@torii/ui'
	import { session } from '@torii/core'
	import { cloudInfer } from '$lib/cloud'
	import { gateway } from '$lib/gateway.js'

	let system = $state('You are a concise assistant.')
	let prompt = $state('')
	let plane = $state('cloud')
	let loading = $state(false)
	let error = $state('')
	/** @type {import('$lib/gateway').InferResult | null} */
	let result = $state(null)
	/** @type {import('$lib/gateway').ChatMessage[]} */
	let sent = $state([])
	let showInspector = $state(false)

	async function run() {
		const p = prompt.trim()
		if (!p || loading) return
		loading = true
		error = ''
		result = null
		/** @type {import('$lib/gateway').ChatMessage[]} */
		const messages = []
		if (system.trim()) messages.push({ role: 'system', content: system.trim() })
		messages.push({ role: 'user', content: p })
		sent = messages
		try {
			result = plane === 'cloud' ? await cloudInfer(messages) : await gateway.infer(messages)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	/** @param {number} c */
	const cost = (c) => (c === 0 ? '$0' : '$' + Number(c).toFixed(4))
	/** @param {KeyboardEvent} e */
	const onkeydown = (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run()
	}
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Tools"
		title="Playground"
		sub="Test a prompt through the gateway in one shot — set a system prompt, pick the plane, and inspect exactly how the answer was produced."
	/>

	<div class="grid gap-4 px-5 pb-6 lg:grid-cols-2">
		<!-- compose -->
		<Card flush>
			<CardHead title="Prompt">
				{#snippet right()}
					<div
						class="inline-flex items-center gap-0.5 rounded-full border border-paper-edge p-0.5 text-[11px]"
					>
						{#each ['local', 'cloud'] as p (p)}
							<button
								onclick={() => (plane = p)}
								class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 {plane === p
									? 'bg-paper-mute font-medium text-accent'
									: 'text-ink-mute'}"
							>
								<span
									class="{p === 'local'
										? 'i-solar-cpu-bold-duotone'
										: 'i-solar-server-minimalistic-bold-duotone'} h-3 w-3"
								></span>{p}
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
						bind:value={system}
						rows="2"
						class="w-full resize-y rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
					></textarea>
				</div>
				<div>
					<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
						>Prompt</span
					>
					<textarea
						bind:value={prompt}
						{onkeydown}
						rows="6"
						placeholder="Ask anything… (⌘/Ctrl+Enter to run)"
						class="w-full resize-y rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none"
					></textarea>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-[11px] text-ink-faint">
						{plane === 'cloud'
							? 'Routed through the gateway — keys stay server-side'
							: 'On-device — no data leaves your machine'}
					</span>
					<button
						onclick={run}
						disabled={loading || !prompt.trim() || (plane === 'cloud' && !session.authenticated)}
						class="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
					>
						<span class="i-solar-play-bold-duotone h-4 w-4"></span>{loading ? 'Running…' : 'Run'}
					</button>
				</div>
			</div>
		</Card>

		<!-- result -->
		<Card flush>
			<CardHead title="Result" meta={result ? (result.model ?? '') : ''} />
			<div class="p-4">
				{#if error}
					<p class="text-sm text-danger">{error}</p>
				{:else if loading}
					<p class="text-sm text-ink-mute italic">
						{plane === 'cloud' ? 'Thinking via gateway…' : 'Thinking on-device…'}
					</p>
				{:else if result}
					<div class="whitespace-pre-wrap text-sm text-ink">{result.content}</div>
					<div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
						<span class="font-mono">{result.model ?? '—'}</span>
						<span class="text-paper-edge">·</span>
						<ExecBadge plane={result.plane} region={result.plane === 'cloud' ? 'eu-west-2' : ''} />
						<span class="text-paper-edge">·</span>
						<span class="font-mono">{cost(result.cost_usd)}</span>
						{#if result.duration_ms}
							<span class="text-paper-edge">·</span>
							<span class="font-mono">{result.duration_ms}ms</span>
						{/if}
						<button
							class="ml-auto text-accent hover:underline"
							onclick={() => (showInspector = !showInspector)}
							>{showInspector ? 'Hide' : 'Inspect'}</button
						>
					</div>
					{#if showInspector}
						<pre
							class="mt-3 overflow-auto rounded-md border border-paper-edge bg-paper-mute p-3 font-mono text-[11px] text-ink-soft">{JSON.stringify(
								{ request: sent, response: result },
								null,
								2
							)}</pre>
					{/if}
				{:else}
					<p class="text-sm text-ink-mute">Run a prompt to see the answer + its exec trace here.</p>
				{/if}
			</div>
		</Card>
	</div>
</section>
