// Torii desktop — Workflows (v2 design preview) pure fixtures + helpers.
//
// DESIGN-ONLY. There is NO runtime and NO backend: the workflow engine (chained
// steps + ReAct agents) ships in v2. This module holds the browsable design
// fixtures and small pure helpers adapted from the mockups
// (docs/mockups/app/view-workflows*.jsx + content.js). No runes / no I/O, so it
// unit-tests in the node vitest env; workflows/+page.svelte consumes it.

/** The kinds of step a flow can be built from (the builder palette). */
export type StepKindId =
	'trigger' | 'retrieve' | 'draft' | 'tool' | 'classify' | 'notify' | 'branch' | 'output' | 'agent'

export interface StepKind {
	id: StepKindId
	label: string
	/** Solar icon class for the step. */
	icon: string
	/** One-line "use when …" describing when to reach for this step. */
	use: string
}

const STEP_META: Record<StepKindId, Omit<StepKind, 'id'>> = {
	trigger: {
		label: 'Trigger',
		icon: 'i-solar-bolt-bold-duotone',
		use: 'Start the flow — on a schedule, an event, or on demand.'
	},
	retrieve: {
		label: 'Retrieve',
		icon: 'i-solar-magnifer-bold-duotone',
		use: 'Ground the run in workspace documents before it acts.'
	},
	draft: {
		label: 'Draft',
		icon: 'i-solar-pen-new-square-bold-duotone',
		use: 'Write from a template — a notice, a memo, a digest.'
	},
	tool: {
		label: 'Tool / MCP',
		icon: 'i-solar-server-minimalistic-bold-duotone',
		use: 'Call an MCP tool — a warehouse query, a file export.'
	},
	classify: {
		label: 'Classify',
		icon: 'i-solar-shield-check-bold-duotone',
		use: 'Detect PII and set the classification.'
	},
	notify: {
		label: 'Notify',
		icon: 'i-solar-bell-bold-duotone',
		use: 'Email or hand a run off to a person.'
	},
	branch: {
		label: 'Branch',
		icon: 'i-solar-routing-2-bold-duotone',
		use: 'Split on a condition — hold a run for review.'
	},
	output: {
		label: 'Output',
		icon: 'i-solar-check-circle-bold-duotone',
		use: 'Save the result back to a collection.'
	},
	agent: {
		label: 'Agent',
		icon: 'i-solar-magic-stick-3-bold-duotone',
		use: 'Let a ReAct agent choose its own steps toward a goal.'
	}
}

/** Ordered list of step kinds — drives the (disabled) builder palette. */
export const STEP_KINDS: StepKind[] = (
	[
		'trigger',
		'retrieve',
		'draft',
		'tool',
		'classify',
		'notify',
		'branch',
		'output',
		'agent'
	] as StepKindId[]
).map((id) => ({ id, ...STEP_META[id] }))

/** Solar icon class for a step kind (neutral fallback for an unknown kind). */
export function stepIcon(kind: string): string {
	return STEP_META[kind as StepKindId]?.icon ?? 'i-solar-widget-2-bold-duotone'
}

/** Human label for a step kind (echoes the raw kind if unknown). */
export function stepLabel(kind: string): string {
	return STEP_META[kind as StepKindId]?.label ?? kind
}

/** A flow's design status — there are no live runs in the preview. */
export type FlowStatus = 'draft' | 'active' | 'preview'

/** Chip / Pill tone for a flow's design status. */
export function statusTone(status: FlowStatus): 'success' | 'mute' | 'accent' {
	return status === 'active' ? 'success' : status === 'preview' ? 'accent' : 'mute'
}

/** Short label for a flow's design status. */
export function statusLabel(status: FlowStatus): string {
	return status === 'active' ? 'Active' : status === 'preview' ? 'v2 preview' : 'Draft'
}

export interface FlowStep {
	kind: StepKindId
	label: string
}

export interface ExampleFlow {
	id: string
	name: string
	description: string
	status: FlowStatus
	/** One-line trigger · classification badge shown on the row. */
	badge: string
	steps: FlowStep[]
}

/**
 * Design fixtures adapted from the mockup's WORKFLOWS catalog. Every flow routes
 * through the gateway in v2, so the same budget / routing / governance apply to
 * each step — the copy leans on that.
 */
export const EXAMPLE_FLOWS: ExampleFlow[] = [
	{
		id: 'wf-renewal',
		name: 'Renewal notice — draft & route',
		description:
			'When a document lands in Leasing Ops · Renewals, draft the renewal notice, hold any rent uplift over 5% for review, then save it as Confidential.',
		status: 'active',
		badge: 'Event · Confidential',
		steps: [
			{ kind: 'trigger', label: 'On new doc — Leasing Ops · Renewals' },
			{ kind: 'retrieve', label: 'Pull tenant record + schedule' },
			{ kind: 'draft', label: 'Draft renewal notice' },
			{ kind: 'branch', label: 'Rent uplift over 5%?' },
			{ kind: 'classify', label: 'Mark Confidential' },
			{ kind: 'output', label: 'Save to Renewals' }
		]
	},
	{
		id: 'wf-digest',
		name: 'Weekly tenant-ticket digest',
		description:
			'Every Monday at 08:00, gather the week’s tickets, write a five-bullet digest and email the Support leads.',
		status: 'active',
		badge: 'Schedule · Internal',
		steps: [
			{ kind: 'trigger', label: 'Every Mon · 08:00' },
			{ kind: 'retrieve', label: 'Gather the week’s tickets' },
			{ kind: 'draft', label: 'Write the digest' },
			{ kind: 'notify', label: 'Email Support leads' }
		]
	},
	{
		id: 'wf-reconcile',
		name: 'Reconciliation → board summary',
		description:
			'On the 1st of each month, query the finance warehouse, draft a board summary and flag any variance over £10k for the CFO.',
		status: 'active',
		badge: 'Schedule · Confidential',
		steps: [
			{ kind: 'trigger', label: '1st of month · 07:00' },
			{ kind: 'tool', label: 'Query the finance warehouse' },
			{ kind: 'draft', label: 'Draft board summary' },
			{ kind: 'branch', label: 'Variance over £10k?' },
			{ kind: 'output', label: 'Save to Q1 Reporting · Board' }
		]
	},
	{
		id: 'wf-classify',
		name: 'Auto-classify & route new uploads',
		description:
			'After any upload is parsed, detect PII, set a classification and route the document to the matching collection.',
		status: 'active',
		badge: 'Event · Company-wide',
		steps: [
			{ kind: 'trigger', label: 'On any upload — after parsing' },
			{ kind: 'retrieve', label: 'Read parsed content' },
			{ kind: 'classify', label: 'Detect PII → set classification' },
			{ kind: 'branch', label: 'Contains PII?' },
			{ kind: 'output', label: 'Route to matching collection' }
		]
	},
	{
		id: 'wf-overdue',
		name: 'Overdue renewals reminder',
		description:
			'Run on demand to find renewals past their 90-day notice window and nudge each unit’s owner.',
		status: 'draft',
		badge: 'Manual · Internal',
		steps: [
			{ kind: 'trigger', label: 'Run on demand' },
			{ kind: 'retrieve', label: 'Find overdue renewals' },
			{ kind: 'notify', label: 'Remind the owners' }
		]
	},
	{
		id: 'wf-agent',
		name: 'Portfolio insights agent',
		description:
			'A ReAct agent that surfaces the week’s portfolio risks — overdue renewals, budget overruns, repeat maintenance — and proposes next actions, within its guardrails.',
		status: 'preview',
		badge: 'Agent · v2',
		steps: [
			{ kind: 'trigger', label: 'Every Fri · 17:00' },
			{ kind: 'agent', label: 'Plan the approach' },
			{ kind: 'retrieve', label: 'Read renewals + maintenance logs' },
			{ kind: 'tool', label: 'Query warehouse for overruns' },
			{ kind: 'branch', label: 'Risks above threshold?' },
			{ kind: 'output', label: 'Draft a risk brief' }
		]
	}
]

/** Look a flow up by id (undefined if not found). */
export function flowById(id: string): ExampleFlow | undefined {
	return EXAMPLE_FLOWS.find((f) => f.id === id)
}

export interface AgentGuardrail {
	label: string
	value: string
}

export interface AgentPreview {
	name: string
	goal: string
	guardrails: AgentGuardrail[]
	/** Human tool names the agent may call, within the role allow-list. */
	tools: string[]
}

/** The v2 ReAct-agent builder preview — goal, guardrails and allowed tools. */
export const AGENT_PREVIEW: AgentPreview = {
	name: 'Portfolio insights agent',
	goal: 'Surface the portfolio risks worth a human’s attention this week — overdue renewals, budget overruns, repeated maintenance issues — and propose next actions.',
	guardrails: [
		{ label: 'Max steps', value: '8 per run' },
		{ label: 'Budget cap', value: '$0.50 per run' },
		{ label: 'Grounding', value: 'in-tenant only' }
	],
	tools: ['Finance warehouse', 'File export', 'Code interpreter']
}
