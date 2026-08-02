<script>
	// Torii desktop — Workflows (v2 DESIGN PREVIEW). Rich, browsable, EDITING DISABLED:
	// the workflow engine (chained steps + ReAct agents) ships in v2 — there is no runtime
	// and no backend here. Fixtures + pure helpers live in $lib/workflows (unit-tested);
	// the only local state is which flow the read-only builder previews (browsing, not editing).
	// Faithful to docs/mockups/app/view-workflows*.jsx.
	import { PageHeader, Card, Chip } from '@torii/ui'
	import {
		STEP_KINDS,
		EXAMPLE_FLOWS,
		AGENT_PREVIEW,
		stepIcon,
		stepLabel,
		statusTone,
		statusLabel
	} from '$lib/workflows'

	let selectedId = $state(EXAMPLE_FLOWS[0].id)
	const selected = $derived(EXAMPLE_FLOWS.find((f) => f.id === selectedId) ?? EXAMPLE_FLOWS[0])

	/** Node border accent by step kind (mirrors the mockup's canvas nodes). */
	/** @param {string} kind */
	const nodeBorder = (kind) =>
		kind === 'trigger'
			? 'border-dashed border-paper-edge bg-paper-soft'
			: kind === 'branch'
				? 'border-warning'
				: kind === 'output'
					? 'border-success'
					: kind === 'agent'
						? 'border-accent'
						: 'border-paper-edge'

	/** Icon tint by step kind. */
	/** @param {string} kind */
	const iconTone = (kind) =>
		kind === 'trigger' || kind === 'agent'
			? 'text-accent'
			: kind === 'branch'
				? 'text-warning'
				: kind === 'output'
					? 'text-success'
					: 'text-ink-soft'
</script>

<section data-workflows class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Tools"
		title="Workflows"
		sub="Chain steps — retrieve, draft, tool calls, branches — into repeatable flows, and, in v2, ReAct agents that plan and act across your MCP tools."
	>
		{#snippet actions()}
			<Chip tone="accent" class="gap-1.5">
				<span class="i-solar-magic-stick-3-bold-duotone h-3.5 w-3.5"></span> v2 preview
			</Chip>
		{/snippet}
	</PageHeader>

	<div class="flex flex-1 flex-col gap-6 px-4 pb-10 sm:px-6 xl:px-12">
		<!-- ships-in-v2 banner -->
		<div
			data-preview-note
			class="flex items-start gap-3 rounded-lg border border-paper-edge bg-accent-soft px-4 py-3"
		>
			<span class="i-solar-info-circle-bold-duotone mt-0.5 h-5 w-5 flex-shrink-0 text-accent"
			></span>
			<div class="min-w-0">
				<p class="text-sm font-medium text-ink">Designed in v1, ships in v2 — no runtime yet.</p>
				<p class="mt-0.5 text-[13px] text-ink-soft">
					Browse the flows and the builder below. When the engine lands, the gateway’s budget,
					routing and governance already apply to every step — an automated run is audited exactly
					like a person’s call. Editing is disabled throughout this preview.
				</p>
			</div>
		</div>

		<!-- flows index -->
		<section aria-label="Example flows">
			<div class="mb-2 flex items-center justify-between">
				<h2 class="text-xs font-medium uppercase tracking-widest text-ink-mute">Flows</h2>
				<span class="font-mono text-xs text-ink-faint">{EXAMPLE_FLOWS.length} designed</span>
			</div>

			<Card flush class="divide-y divide-paper-edge">
				{#each EXAMPLE_FLOWS as flow (flow.id)}
					<div
						data-flow-row
						class="flex items-start gap-3 px-4 py-3.5 {selectedId === flow.id
							? 'bg-paper-mute'
							: ''}"
					>
						<button
							type="button"
							onclick={() => (selectedId = flow.id)}
							aria-pressed={selectedId === flow.id}
							aria-label={`Preview ${flow.name} in the builder`}
							class="min-w-0 flex-1 rounded text-left transition-colors"
						>
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-semibold text-ink">{flow.name}</span>
								<Chip tone={statusTone(flow.status)}>{statusLabel(flow.status)}</Chip>
								<span class="font-mono text-[11px] text-ink-mute">{flow.badge}</span>
							</div>
							<p class="mt-1 max-w-2xl text-[13px] text-ink-soft">{flow.description}</p>

							<!-- horizontal step chip trail -->
							<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
								{#each flow.steps as step, i (i)}
									{#if i > 0}<span class="text-xs text-ink-faint" aria-hidden="true">→</span>{/if}
									<span
										class="inline-flex items-center gap-1 rounded-md border border-paper-edge bg-paper-mute px-1.5 py-0.5"
									>
										<span class="{stepIcon(step.kind)} h-3.5 w-3.5 {iconTone(step.kind)}"></span>
										<span class="text-[11px] text-ink-soft">{step.label}</span>
									</span>
								{/each}
							</div>
						</button>

						<button
							type="button"
							disabled
							aria-disabled="true"
							title="The builder ships in v2"
							aria-label={`Open ${flow.name} in the builder — ships in v2`}
							class="mt-0.5 inline-flex flex-shrink-0 cursor-not-allowed items-center gap-1.5 rounded border border-paper-edge bg-paper-soft px-3 py-1.5 text-xs font-medium text-ink-mute opacity-60"
						>
							<span class="i-solar-pen-new-square-bold-duotone h-3.5 w-3.5"></span>
							Open in builder
						</button>
					</div>
				{/each}
			</Card>
		</section>

		<!-- builder preview -->
		<section aria-label="Builder preview">
			<div class="mb-2 flex flex-wrap items-center gap-2">
				<h2 class="text-xs font-medium uppercase tracking-widest text-ink-mute">Builder</h2>
				<Chip tone="accent">v2 · preview</Chip>
				<span class="font-mono text-[11px] text-ink-faint">read-only</span>
				<span class="ml-auto text-[13px] text-ink-soft">
					Previewing <span class="font-medium text-ink">{selected.name}</span>
				</span>
			</div>

			<Card pad>
				<!-- disabled List / Canvas toggle -->
				<div class="mb-4 flex items-center gap-3">
					<div
						class="inline-flex items-center gap-0.5 rounded-md border border-paper-edge bg-paper-mute p-0.5"
						role="group"
						aria-label="Builder view — disabled in preview"
					>
						<button
							type="button"
							disabled
							aria-disabled="true"
							aria-pressed="true"
							class="inline-flex cursor-not-allowed items-center gap-1.5 rounded bg-paper px-2.5 py-1 text-xs font-medium text-ink shadow-sm"
						>
							<span class="i-solar-routing-2-bold-duotone h-3.5 w-3.5"></span> Canvas
						</button>
						<button
							type="button"
							disabled
							aria-disabled="true"
							aria-pressed="false"
							class="inline-flex cursor-not-allowed items-center gap-1.5 rounded px-2.5 py-1 text-xs text-ink-mute opacity-60"
						>
							<span class="i-solar-checklist-minimalistic-bold-duotone h-3.5 w-3.5"></span> List
						</button>
					</div>
					<span class="text-[11px] text-ink-faint"
						>Switching views arrives with the builder in v2.</span
					>
				</div>

				<!-- read-only DAG / step canvas -->
				<div
					data-builder
					class="overflow-x-auto rounded-lg border border-paper-edge bg-paper-mute p-4"
				>
					<div class="flex min-w-max items-stretch">
						{#each selected.steps as step, i (i)}
							{#if i > 0}
								<div class="flex items-center px-1.5" aria-hidden="true">
									<span class="h-px w-5 bg-paper-edge"></span>
									<span class="i-solar-alt-arrow-right-linear h-3.5 w-3.5 text-ink-faint"></span>
								</div>
							{/if}
							<div
								class="flex w-48 flex-col rounded-lg border bg-paper px-3 py-2.5 shadow-sm {nodeBorder(
									step.kind
								)}"
							>
								<div class="mb-1.5 flex items-center gap-1.5">
									<span
										class="grid h-6 w-6 place-items-center rounded border border-paper-edge bg-paper-mute"
									>
										<span class="{stepIcon(step.kind)} h-3.5 w-3.5 {iconTone(step.kind)}"></span>
									</span>
									<span class="font-mono text-[10px] uppercase tracking-wider text-ink-faint"
										>{stepLabel(step.kind)}</span
									>
								</div>
								<span class="text-[13px] font-medium leading-snug text-ink">{step.label}</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- disabled step-kind palette -->
				<div class="mt-5">
					<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
						Step palette
					</div>
					<div class="flex flex-wrap gap-2">
						{#each STEP_KINDS as kind (kind.id)}
							<button
								type="button"
								disabled
								aria-disabled="true"
								title={kind.use}
								aria-label={`${kind.label} — ${kind.use} (disabled in preview)`}
								class="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-paper-edge bg-paper-mute px-2 py-1 text-xs text-ink-mute opacity-70"
							>
								<span class="{kind.icon} h-3.5 w-3.5 {iconTone(kind.id)}"></span>
								{kind.label}
							</button>
						{/each}
					</div>
					<p class="mt-2 text-[11px] text-ink-faint">
						Drag-to-build lands in v2 — the palette is disabled in this preview.
					</p>
				</div>
			</Card>
		</section>

		<!-- agent builder (v2 · preview) -->
		<section aria-label="Agent builder preview">
			<Card pad>
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<span class="i-solar-magic-stick-3-bold-duotone h-5 w-5 text-accent"></span>
					<span class="text-sm font-semibold text-ink">Agent builder</span>
					<Chip tone="accent">v2 · preview</Chip>
				</div>
				<p class="mb-4 max-w-2xl text-[13px] text-ink-soft">
					A ReAct agent decides its own steps to reach a goal — within the tools, budget and
					guardrails you set. Shipping in v2; editing is disabled in this preview.
				</p>

				<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium uppercase tracking-widest text-ink-mute"
							>Goal</span
						>
						<textarea
							value={AGENT_PREVIEW.goal}
							disabled
							readonly
							rows="4"
							aria-label="Agent goal — read-only preview"
							class="w-full cursor-not-allowed resize-none rounded border border-paper-edge bg-paper-mute px-3 py-2 text-[13px] text-ink-soft opacity-80"
						></textarea>
					</label>

					<div class="flex flex-col gap-5">
						<div>
							<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
								Guardrails
							</div>
							<div class="flex flex-col gap-2">
								{#each AGENT_PREVIEW.guardrails as g (g.label)}
									<div
										class="flex items-center justify-between border-b border-paper-edge pb-2 last:border-0 last:pb-0"
									>
										<span class="text-[13px] text-ink-soft">{g.label}</span>
										<span class="font-mono text-xs text-ink">{g.value}</span>
									</div>
								{/each}
							</div>
						</div>

						<div>
							<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
								Tools it may call
							</div>
							<div class="flex flex-wrap gap-2">
								{#each AGENT_PREVIEW.tools as tool (tool)}
									<span
										class="inline-flex items-center gap-1 rounded-md border border-paper-edge bg-paper-mute px-2 py-0.5 text-xs text-ink-mute"
									>
										<span class="i-solar-server-minimalistic-bold-duotone h-3.5 w-3.5 text-ink-soft"
										></span>{tool}
									</span>
								{/each}
							</div>
						</div>
					</div>
				</div>
			</Card>
		</section>
	</div>
</section>
