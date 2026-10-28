import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CREDS } from './helpers'

// Direct DB access for specs whose screens read a ledger.
//
// The Runs screens are read-only views over accounting rows, so their spec needs rows with a
// known shape (see fixtures/runs.seed.sql for why they are seeded rather than driven through the
// orchestrator). The local Supabase database is already a prerequisite of every authed spec, so
// this adds no new service — only the psql client, which the local DB tooling assumes anyway.
//
// Override DATABASE_URL to point the fixtures at another seed, matching TORII_E2E_EMAIL.
const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * Apply one fixture file. `email` is bound as a psql variable so a fixture can resolve the
 * signed-in tenant from the seed instead of hard-coding a uuid — the same override that moves
 * `helpers.ts` moves the fixture with it.
 */
export function applyFixture(file: string): void {
	execFileSync(
		'psql',
		[
			DATABASE_URL,
			'-X',
			'-q',
			'-v',
			'ON_ERROR_STOP=1',
			'-v',
			`email=${CREDS.email}`,
			'-f',
			join(FIXTURES, file)
		],
		{ stdio: 'inherit' }
	)
}
