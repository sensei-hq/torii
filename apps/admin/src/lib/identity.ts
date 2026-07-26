// Pure identity helper, extracted from api.ts so it's unit-testable.

/**
 * The app role to DISPLAY, or null when the gateway returned the Supabase JWT `role`
 * claim — which is always "authenticated" for any signed-in user and is NOT the app
 * role (owner/admin/member live in profile_roles, and are multi-valued). Returning
 * null lets the shell show the email alone rather than a meaningless/fabricated role.
 */
export function meaningfulRole(role: string | null | undefined): string | null {
	return role && role !== 'authenticated' ? role : null
}
