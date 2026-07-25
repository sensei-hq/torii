<script>
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { PageHeader, Card, Glyph } from '@torii/ui'
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Tools"
		title="Playground"
		sub="A power-user surface for the gateway — pick a model, tune parameters, choose a retrieval mode, and inspect exactly how each answer was built."
	/>
	<div class="px-5 pb-6">
		<Card pad>
			<div class="flex items-center gap-4">
				<Glyph icon="i-solar-chat-square-code-bold-duotone" size={40} tone="accent" />
				<div class="flex-1">
					<p class="text-sm font-medium text-ink">Playground — coming soon</p>
					<p class="mt-1 text-[13px] text-ink-mute">
						Per-request model + parameter control, a retrieval-mode selector (hybrid / dense / sparse)
						with an inspector, and the full trace. For now, chat lives in
						<button
							class="text-accent hover:underline"
							onclick={() => goto(resolve('/ask'))}>Ask</button
						>.
					</p>
				</div>
			</div>
		</Card>
	</div>
</section>
