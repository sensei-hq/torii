<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').Member[]} */
	let members = $state([])
	/** @type {import('$lib/api').Role[]} */
	let roles = $state([])
	/** @type {import('$lib/api').Capability[]} */
	let capabilities = $state([])
	let error = $state('')
	let loading = $state(true)

	onMount(async () => {
		try {
			const o = await api.org()
			members = o.members
			roles = o.roles
			capabilities = o.capabilities
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	})

	// a Set of granted capabilities per role, for O(1) matrix cell lookups.
	const grantedByRole = $derived(new Map(roles.map((r) => [r.id, new Set(r.capabilities)])))

	// capabilities grouped by domain → the matrix's row groups.
	const byDomain = $derived(
		capabilities.reduce((/** @type {Record<string, import('$lib/api').Capability[]>} */ acc, c) => {
			;(acc[c.domain] ??= []).push(c)
			return acc
		}, {})
	)

	/** @param {string} roleId @param {string} capKey */
	const has = (roleId, capKey) => grantedByRole.get(roleId)?.has(capKey) ?? false
</script>

<AppShell app="admin" title="Organization">
	<PageHeader
		eyebrow="Organization"
		title="People & access"
		sub="Members and their roles, and the authoritative role × capability matrix. Effective access is the union of a member's roles — resolved server-side by the gateway, never trusted from the token."
	/>

	{#if loading}
		<p class="px-5 text-sm text-ink-mute">Loading…</p>
	{:else if error}
		<div class="px-5">
			<Card pad
				><p class="text-sm text-primary-500">
					{error}{error.includes('403') ? ' — needs the role.manage capability (owner/admin).' : ''}
				</p></Card
			>
		</div>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<!-- members + their role assignments -->
			<Card flush>
				<CardHead title="Members" meta={`${members.length}`} />
				<div>
					{#each members as m (m.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0"
						>
							<Glyph icon="i-lucide-user" tone="soft" />
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm text-ink">{m.display_name ?? 'Unnamed'}</div>
								<div class="font-mono text-[11px] text-ink-mute">{m.id.slice(0, 8)}</div>
							</div>
							<div class="flex flex-wrap justify-end gap-1.5">
								{#each m.roles as r (r)}
									<Chip tone={r === 'owner' || r === 'admin' ? 'accent' : 'mute'}>{r}</Chip>
								{/each}
							</div>
						</div>
					{/each}
					{#if members.length === 0}
						<p class="px-4 py-3 text-sm text-ink-mute">No members assigned to this tenant.</p>
					{/if}
				</div>
			</Card>

			<!-- roles overview -->
			<Card flush>
				<CardHead title="Roles" meta={`${roles.length}`} />
				<div class="flex flex-wrap gap-3 p-4">
					{#each roles as r (r.id)}
						<div class="rounded-lg border border-paper-edge bg-paper px-3 py-2">
							<div class="flex items-center gap-2">
								<span class="text-sm font-semibold text-ink">{r.name}</span>
								{#if r.is_system}<Chip>system</Chip>{/if}
							</div>
							<div class="mt-1 font-mono text-[11px] text-ink-mute">
								{r.cap_count} capabilit{r.cap_count === 1 ? 'y' : 'ies'}
							</div>
						</div>
					{/each}
				</div>
			</Card>

			<!-- the authoritative permission matrix: capabilities (rows, by domain) × roles (cols) -->
			<Card flush>
				<CardHead
					title="Permission matrix"
					meta={`${capabilities.length} capabilities × ${roles.length} roles`}
				/>
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead>
							<tr class="border-b border-paper-edge">
								<th
									class="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-mute"
									>Capability</th
								>
								{#each roles as r (r.id)}
									<th
										class="px-2 py-2 text-center text-[11px] font-medium text-ink-soft"
										title={r.name}
									>
										{r.key}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each Object.entries(byDomain) as [domain, caps] (domain)}
								<tr class="bg-paper-mute/50">
									<td
										colspan={roles.length + 1}
										class="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-mute"
										>{domain}</td
									>
								</tr>
								{#each caps as c (c.key)}
									<tr class="border-b border-paper-edge last:border-b-0">
										<td class="px-4 py-1.5 font-mono text-ink" title={c.description}>{c.key}</td>
										{#each roles as r (r.id)}
											<td class="px-2 py-1.5 text-center">
												{#if has(r.id, c.key)}
													<span class="i-lucide-check inline-block h-3.5 w-3.5 text-primary-500"
													></span>
												{:else}
													<span class="text-ink-faint">·</span>
												{/if}
											</td>
										{/each}
									</tr>
								{/each}
							{/each}
						</tbody>
					</table>
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-lucide-shield-check mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-[11px] leading-relaxed text-ink-mute">
						System roles are seeded and undeletable (display name renamable). Grants resolve
						server-side by RLS + the gateway — a capability outside the closed catalog cannot be
						stored, and the JWT is never trusted for authorization.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
