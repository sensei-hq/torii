import { describe, it, expect } from 'vitest'
import {
	STEP_KINDS,
	EXAMPLE_FLOWS,
	AGENT_PREVIEW,
	stepIcon,
	stepLabel,
	statusTone,
	statusLabel,
	flowById,
	type StepKindId
} from './workflows'

const KIND_IDS: StepKindId[] = [
	'trigger',
	'retrieve',
	'draft',
	'tool',
	'classify',
	'notify',
	'branch',
	'output',
	'agent'
]

describe('STEP_KINDS', () => {
	it('covers every step kind, in order', () => {
		expect(STEP_KINDS.map((k) => k.id)).toEqual(KIND_IDS)
	})

	it('each kind has a label, a solar icon and a one-line use', () => {
		for (const k of STEP_KINDS) {
			expect(k.label.length).toBeGreaterThan(0)
			expect(k.icon).toMatch(/^i-solar-/)
			expect(k.use.length).toBeGreaterThan(0)
		}
	})
})

describe('stepIcon / stepLabel', () => {
	it('resolve a known kind', () => {
		expect(stepIcon('branch')).toBe('i-solar-routing-2-bold-duotone')
		expect(stepLabel('tool')).toBe('Tool / MCP')
	})
	it('fall back safely for an unknown kind', () => {
		expect(stepIcon('bogus')).toBe('i-solar-widget-2-bold-duotone')
		expect(stepLabel('bogus')).toBe('bogus')
	})
	it('every STEP_KINDS icon matches stepIcon', () => {
		for (const k of STEP_KINDS) expect(stepIcon(k.id)).toBe(k.icon)
	})
})

describe('statusTone / statusLabel', () => {
	it('map each status to a tone', () => {
		expect(statusTone('active')).toBe('success')
		expect(statusTone('preview')).toBe('accent')
		expect(statusTone('draft')).toBe('mute')
	})
	it('map each status to a label', () => {
		expect(statusLabel('active')).toBe('Active')
		expect(statusLabel('preview')).toBe('v2 preview')
		expect(statusLabel('draft')).toBe('Draft')
	})
})

describe('EXAMPLE_FLOWS', () => {
	it('has flows with unique ids', () => {
		const ids = EXAMPLE_FLOWS.map((f) => f.id)
		expect(ids.length).toBeGreaterThan(0)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it('each flow is well-formed and starts on a trigger', () => {
		for (const f of EXAMPLE_FLOWS) {
			expect(f.name.length).toBeGreaterThan(0)
			expect(f.description.length).toBeGreaterThan(0)
			expect(f.badge.length).toBeGreaterThan(0)
			expect(['draft', 'active', 'preview']).toContain(f.status)
			expect(f.steps.length).toBeGreaterThan(1)
			expect(f.steps[0].kind).toBe('trigger')
			for (const s of f.steps) {
				expect(KIND_IDS).toContain(s.kind)
				expect(s.label.length).toBeGreaterThan(0)
			}
		}
	})

	it('has exactly one agent (v2 preview) flow', () => {
		const preview = EXAMPLE_FLOWS.filter((f) => f.status === 'preview')
		expect(preview).toHaveLength(1)
		expect(preview[0].steps.some((s) => s.kind === 'agent')).toBe(true)
	})
})

describe('flowById', () => {
	it('finds a known flow and returns undefined otherwise', () => {
		expect(flowById('wf-renewal')?.name).toBe('Renewal notice — draft & route')
		expect(flowById('nope')).toBeUndefined()
	})
})

describe('AGENT_PREVIEW', () => {
	it('has a goal, guardrails and tools', () => {
		expect(AGENT_PREVIEW.goal.length).toBeGreaterThan(0)
		expect(AGENT_PREVIEW.guardrails.length).toBeGreaterThan(0)
		expect(AGENT_PREVIEW.tools.length).toBeGreaterThan(0)
		for (const g of AGENT_PREVIEW.guardrails) {
			expect(g.label.length).toBeGreaterThan(0)
			expect(g.value.length).toBeGreaterThan(0)
		}
	})
})
