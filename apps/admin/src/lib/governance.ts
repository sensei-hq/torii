// Pure, client-side helpers for feature governance (C4 · RW6). Kept out of the component
// so they're unit-testable (type-only imports → no $env at runtime). The one job here is
// to UN-HARDCODE the set-feature scope: the gateway's `/rpc/governance/set-feature` accepts
// a workspace / space / role scope (see services/gateway · SetFeature), and the admin used
// to bake in `scope_type:'workspace'`. These helpers build the scope list the switcher
// offers and the exact RPC payload the write sends.
import type { FeatureState, Role } from './api'

/** The scope a feature-governance posture write targets (C4 §4.2 precedence: workspace → space → role). */
export type FeatureScopeType = 'workspace' | 'space' | 'role'

export interface FeatureScope {
	type: FeatureScopeType
	/** the scope's target id (role_id / space_id); null for the workspace default. */
	id: string | null
}

/** The workspace default — the pre-existing single scope (scope_id null). */
export const WORKSPACE_SCOPE: FeatureScope = { type: 'workspace', id: null }

/** A selectable scope in the switcher: a FeatureScope plus a stable key + display label. */
export interface ScopeOption extends FeatureScope {
	/** stable, unique key for `#each` + selection (`workspace` | `role:<uuid>`). */
	key: string
	label: string
}

/**
 * The scopes an admin can target when setting a feature posture. Always leads with the
 * workspace default (the pre-existing path, so nothing regresses), then one option per
 * role — using the REAL role_ids from `/v1/org`. Spaces are deliberately omitted: the
 * gateway exposes no spaces-list read to enumerate them, and this pass adds no backend
 * (the set-feature wrapper still accepts a `space` scope for when that read lands).
 */
export function scopeOptions(roles: Pick<Role, 'id' | 'key' | 'name'>[] = []): ScopeOption[] {
	const opts: ScopeOption[] = [
		{ key: 'workspace', type: 'workspace', id: null, label: 'Workspace default' }
	]
	for (const r of roles) {
		opts.push({ key: `role:${r.id}`, type: 'role', id: r.id, label: r.name })
	}
	return opts
}

/**
 * The exact `/rpc/governance/set-feature` request body. The scope defaults to the
 * workspace default so the pre-existing call site stays byte-identical, while a space or
 * role scope carries its `scope_type` + target `scope_id` through to the gateway.
 */
export function setFeaturePayload(
	feature_key: string,
	state: FeatureState,
	scope: FeatureScope = WORKSPACE_SCOPE
): {
	feature_key: string
	scope_type: FeatureScopeType
	scope_id: string | null
	state: FeatureState
} {
	return { feature_key, scope_type: scope.type, scope_id: scope.id, state }
}
