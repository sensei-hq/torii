import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Foundation guard for the Zen-Sumi grid (see docs/design/fidelity-audit.md).
// The type scale is set in packages/ui/type-scale.js to the mockup's zs.css scale
// (text-xs=11 / sm=13 / base=15 / lg=17 / xl=22 / 2xl=28 / 3xl=40 / 4xl=56 — measured
// live vs the mock 2026-07-30). Components must use those named stops — never an
// arbitrary `text-[Npx]`, which is the "random inconsistent numbers" the grid work
// removed. This test fails the build if a raw px text size creeps back in, across both
// the deployed admin app and the shared UI kit.
//
// Scope note: only TEXT sizes are guarded here. Off-grid spacing (`py-1.5`…) and
// arbitrary dimensions (`w-[18px]`…) are handled in the per-screen catalog pass and
// are intentionally NOT asserted yet.

const here = dirname(fileURLToPath(import.meta.url))
const ROOTS = [
	resolve(here, '..'), // apps/admin/src
	resolve(here, '../../../../packages/ui/src') // packages/ui/src (shared kit)
]
const SKIP = new Set(['node_modules', '.svelte-kit', 'dist', 'build', '.turbo'])
const EXT = /\.(svelte|ts|js)$/
const OFF_GRID_TEXT = /text-\[\d+px\]/g

function walk(dir: string, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full, acc)
		else if (EXT.test(name)) acc.push(full)
	}
	return acc
}

describe('Zen-Sumi grid consistency', () => {
	it('uses named type-scale stops, never an arbitrary text-[Npx]', () => {
		const offenders: string[] = []
		for (const root of ROOTS) {
			for (const file of walk(root)) {
				const src = readFileSync(file, 'utf8')
				const hits = src.match(OFF_GRID_TEXT)
				if (hits)
					offenders.push(
						`${relative(resolve(here, '../../../..'), file)}: ${[...new Set(hits)].join(', ')}`
					)
			}
		}
		expect(
			offenders,
			`off-grid text sizes found — snap to a presetRokkit stop:\n${offenders.join('\n')}`
		).toEqual([])
	})
})
