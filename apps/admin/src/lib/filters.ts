// Pure, client-side filter predicates for the Requests & Audit ledger. Kept out of
// the component so they're unit-testable (type-only imports → no $env at runtime).
import type { AuditEvent, RequestRow } from './api'

/**
 * Does an inference row match the search needle (already trimmed + lowercased) and
 * the plane filter? `plane` is 'all' | 'cloud' | 'local'; a null execution_location
 * only matches 'all'. Empty needle matches everything (subject to the plane).
 */
export function matchesRequest(r: RequestRow, needle: string, plane: string): boolean {
	if (plane !== 'all' && (r.execution_location ?? '') !== plane) return false
	if (!needle) return true
	return `${r.model} ${r.chain_id ?? ''} ${r.status} ${r.execution_location ?? ''}`
		.toLowerCase()
		.includes(needle)
}

/** Does an audit event match the search needle (already trimmed + lowercased)? */
export function matchesEvent(e: AuditEvent, needle: string): boolean {
	if (!needle) return true
	return `${e.action} ${e.target_type ?? ''} ${e.target_id ?? ''} ${e.actor_id ?? ''}`
		.toLowerCase()
		.includes(needle)
}
