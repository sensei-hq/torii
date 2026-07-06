import { getActions } from '@kavach/adapter-supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ModelSchema, type DataSource } from '../types'

// Real reads go through the kavach adapter's PostgREST actions (RLS enforced by Postgres).
export function createSupabaseDataSource(client: SupabaseClient): DataSource {
	const actions = getActions(client)
	return {
		async listModels() {
			const { data } = await actions.get('models', { columns: '*' })
			return ((data ?? []) as unknown[]).map((row) => ModelSchema.parse(row))
		}
	}
}
