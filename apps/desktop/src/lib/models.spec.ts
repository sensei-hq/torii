import { describe, it, expect } from 'vitest'
import {
	fmtSize,
	fmtGb,
	diskPct,
	diskTone,
	capabilityTone,
	pullPct,
	fitHint,
	sortInstalled
} from './models'
import type { LocalModel, AvailableModel, DeviceInfo } from './models'

const dev = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
	chip: 'Apple M3 Pro',
	ram_gb: 36,
	accel: 'Metal',
	disk_total_gb: 512,
	models_gb: 2.3,
	models_count: 2,
	...over
})

const lm = (over: Partial<LocalModel>): LocalModel => ({
	id: 'm',
	name: 'm',
	format: 'gguf',
	size_bytes: 1_000_000_000,
	source: 'managed',
	is_default: false,
	removable: true,
	capability: 'chat',
	...over
})

describe('formatting', () => {
	it('fmtSize picks GB / MB / dash', () => {
		expect(fmtSize(1_700_000_000)).toBe('1.6 GB')
		expect(fmtSize(670_000_000)).toBe('639 MB')
		expect(fmtSize(0)).toBe('—')
		expect(fmtSize(20 * 1024 ** 3)).toBe('20 GB')
	})
	it('fmtGb rounds sensibly', () => {
		expect(fmtGb(2.34)).toBe('2.3 GB')
		expect(fmtGb(512)).toBe('512 GB')
	})
})

describe('disk', () => {
	it('diskPct is the models share of total, clamped', () => {
		expect(diskPct(dev({ models_gb: 51.2, disk_total_gb: 512 }))).toBeCloseTo(10)
		expect(diskPct(dev({ disk_total_gb: 0 }))).toBe(0)
	})
	it('diskTone warns past 85% models share', () => {
		expect(diskTone(dev({ models_gb: 10, disk_total_gb: 512 }))).toBe('accent')
		expect(diskTone(dev({ models_gb: 500, disk_total_gb: 512 }))).toBe('warning')
	})
})

describe('tones + progress', () => {
	it('capabilityTone maps chat/embedding/unknown', () => {
		expect(capabilityTone('chat')).toBe('accent')
		expect(capabilityTone('embedding')).toBe('success')
		expect(capabilityTone('unknown')).toBe('mute')
	})
	it('pullPct handles unknown total + clamps', () => {
		expect(pullPct(50, 100)).toBe(50)
		expect(pullPct(10, null)).toBe(0)
		expect(pullPct(200, 100)).toBe(100)
	})
	it('fitHint reads need vs RAM', () => {
		const a: AvailableModel = {
			id: 'x',
			name: 'X',
			format: 'gguf',
			size_bytes: 1,
			ctx: 8192,
			quant: 'Q4',
			installed: false,
			fits: true,
			need_gb: 3
		}
		expect(fitHint(a, 36)).toBe('~3.0 GB / 36 GB RAM')
	})
})

describe('sortInstalled', () => {
	it('default first, then managed, then by name', () => {
		const out = sortInstalled([
			lm({ id: 'z-ollama', name: 'z', removable: false }),
			lm({ id: 'a-managed', name: 'a', removable: true }),
			lm({ id: 'def', name: 'd', is_default: true, removable: false })
		])
		expect(out.map((m) => m.id)).toEqual(['def', 'a-managed', 'z-ollama'])
	})
})
