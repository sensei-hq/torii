<script>
	import { PageHeader, Card, Glyph, Chip } from '@torii/ui'
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Tools"
		title="Workflows"
		sub="Chain steps into repeatable flows — and, later, ReAct agents that plan and act across your tools."
	/>
	<div class="px-5 pb-6">
		<Card pad>
			<div class="flex items-center gap-4">
				<Glyph icon="i-solar-refresh-bold-duotone" size={40} tone="mute" />
				<div class="flex-1">
					<div class="flex items-center gap-2">
						<p class="text-sm font-medium text-ink">Workflows &amp; agents</p>
						<Chip>v2 preview</Chip>
					</div>
					<p class="mt-1 text-[13px] text-ink-mute">
						Non-agent flows and ReAct agents (plan → act over MCP tools) are designed in v1 and ship
						in v2 — no runtime yet. The gateway's budget, routing and governance already apply to
						every step.
					</p>
				</div>
			</div>
		</Card>
	</div>
</section>
