<script>
	import { onMount } from 'svelte'
	import { SvelteSet } from 'svelte/reactivity'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').Member[]} */
	let members = $state([])
	/** @type {import('$lib/api').Role[]} */
	let roles = $state([])
	/** @type {import('$lib/api').Capability[]} */
	let capabilities = $state([])
	/** the caller's own identity, for gating owner-only controls (e.g. transfer ownership) */
	/** @type {import('$lib/api').WhoAmI | null} */
	let me = $state(null)
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')

	async function load() {
		try {
			const o = await api.org()
			members = o.members
			roles = o.roles
			capabilities = o.capabilities
			me = await api.whoami()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	/**
	 * Assign a role to a member via the committed /rpc/rbac/assign-role. NOTE: this bumps the
	 * target's claims_version — if you assign to yourself you'll be signed out (re-auth).
	 * @param {string} profileId @param {string} roleId
	 */
	async function assign(profileId, roleId) {
		if (!roleId || busy) return
		busy = profileId
		error = ''
		try {
			await api.assignRole(profileId, roleId)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/**
	 * Remove a role from a member via /rpc/rbac/unassign-role. Server-guarded (subset +
	 * last-owner). NOTE: bumps the target's claims_version — removing your own role
	 * signs you out.
	 * @param {string} profileId @param {string} roleId
	 */
	async function unassign(profileId, roleId) {
		if (!roleId || busy) return
		busy = profileId
		error = ''
		try {
			await api.unassignRole(profileId, roleId)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/**
	 * Transfer ownership to another member (owner-only). Bumps both users' claims_version;
	 * since this demotes YOU, refresh the session and reload so the shell reflects the new caps.
	 * @param {string} profileId
	 */
	async function transferOwnership(profileId) {
		if (!profileId || busy) return
		if (
			!confirm(
				'Transfer ownership? You will become an admin and can no longer manage roles, API keys, or org settings.'
			)
		)
			return
		busy = profileId
		error = ''
		try {
			await api.transferOwnership(profileId)
			await api.refreshSession()
			window.location.assign('/organization')
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/** role key → id, for mapping a member's role chips (which carry keys) to unassign. */
	const roleIdByKey = $derived(new Map(roles.map((r) => [r.key, r.id])))

	// api.whoami().role is the raw Postgres JWT role claim ("authenticated"/"apikey"/"service")
	// and NOT the app role — owner/admin/member live in profile_roles and are only exposed via
	// each member's `roles` keys (same data the chips render from). So the caller's own role is
	// looked up the same way as anyone else's: find their row in `members` by profile id.
	const myRoles = $derived(members.find((m) => m.id === me?.sub)?.roles ?? [])
	const isOwner = $derived(myRoles.includes('owner'))

	/** roles a member does NOT already hold (candidates to assign) */
	/** @param {import('$lib/api').Member} m */
	const assignable = (m) => roles.filter((r) => !m.roles.includes(r.key))

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

	// ── custom roles: "duplicate a default to customize" (create-only) ──────────────
	// Defaults stay read-only; this mints a tenant-only role prefilled from a source role's caps.
	// The gateway enforces no-shadowing (409) + anti-escalation subset (403) — the UI shows the full
	// catalog and surfaces the server's reason inline rather than second-guessing the caller's caps.
	let dupOpen = $state(false)
	let sourceName = $state('')
	let newKey = $state('')
	let newName = $state('')
	/** selected capability keys for the new role (SvelteSet → reactive on in-place mutation) */
	const selectedCaps = new SvelteSet()

	/** Open the create panel, prefilled from an existing role. @param {import('$lib/api').Role} role */
	function startDuplicate(role) {
		dupOpen = true
		sourceName = role.name
		newKey = ''
		newName = `${role.name} (custom)`
		selectedCaps.clear()
		for (const c of role.capabilities) selectedCaps.add(c)
		error = ''
	}

	/** Toggle a capability in the selection. @param {string} key */
	function toggleCap(key) {
		if (selectedCaps.has(key)) selectedCaps.delete(key)
		else selectedCaps.add(key)
	}

	/** Create the tenant-custom role via /rpc/rbac/create-role. */
	async function submitRole() {
		const key = newKey.trim()
		const name = newName.trim()
		if (!key || !name || busy) return
		busy = 'create-role'
		error = ''
		try {
			await api.createRole(key, name, [...selectedCaps])
			dupOpen = false
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}
</script>

<AppShell app="admin" title="Organization">
	<PageHeader
		eyebrow="Organization"
		title="People & access"
		sub="Members and their roles, and the authoritative role × capability matrix. Effective access is the union of a member's roles — resolved server-side by the gateway, never trusted from the token."
	/>

	{#if loading}
		<Async loading />
	{:else}
		<div class="space-y-4 px-5 pb-6">
			<!-- action/load errors show inline here, without hiding the member list -->
			{#if error}
				<Card pad
					><p class="text-sm text-accent" role="alert">
						{error}{error.includes('403')
							? ' — needs the role.manage capability (owner/admin).'
							: ''}
					</p></Card
				>
			{/if}
			<!-- members + their role assignments -->
			<Card flush>
				<CardHead title="Members" meta={`${members.length}`} />
				<div>
					{#each members as m (m.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0"
						>
							<Glyph icon="i-solar-user-bold-duotone" tone="soft" />
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm text-ink">{m.display_name ?? 'Unnamed'}</div>
								<div class="font-mono text-[11px] text-ink-mute">{m.id.slice(0, 8)}</div>
							</div>
							<div class="flex flex-wrap items-center justify-end gap-1.5">
								{#each m.roles as r (r)}
									{@const rid = roleIdByKey.get(r)}
									<span class="inline-flex items-center gap-0.5">
										<Chip tone={r === 'owner' || r === 'admin' ? 'accent' : 'mute'}>{r}</Chip>
										{#if rid}
											<button
												onclick={() => unassign(m.id, rid)}
												disabled={busy === m.id}
												aria-label={`Remove the ${r} role from ${m.display_name ?? m.id}`}
												title={`Remove ${r}`}
												class="grid h-4 w-4 place-items-center rounded-full text-ink-faint hover:bg-paper-mute hover:text-danger disabled:opacity-40"
											>
												<span class="i-solar-close-circle-bold-duotone h-3.5 w-3.5"></span>
											</button>
										{/if}
									</span>
								{/each}
								{#if assignable(m).length > 0}
									<!-- assign a role the member doesn't hold (value resets after each pick) -->
									<select
										disabled={busy === m.id}
										value=""
										onchange={(e) => {
											assign(m.id, e.currentTarget.value)
											e.currentTarget.value = ''
										}}
										aria-label={`Add a role to ${m.display_name ?? m.id}`}
										class="rounded-md border border-paper-edge bg-paper px-2 py-1 text-[11px] text-ink-soft disabled:opacity-40"
									>
										<option value="" disabled>+ role</option>
										{#each assignable(m) as r (r.id)}
											<option value={r.id}>{r.name}</option>
										{/each}
									</select>
								{/if}
								{#if isOwner && m.id !== me?.sub && !m.roles.includes('owner')}
									<button
										type="button"
										onclick={() => transferOwnership(m.id)}
										disabled={busy === m.id}
										class="rounded-md border border-paper-edge px-2 py-1 text-xs font-medium text-ink-mute hover:text-ink disabled:opacity-40"
									>
										Make owner
									</button>
								{/if}
							</div>
						</div>
					{/each}
					{#if members.length === 0}
						<Empty
							icon="i-solar-users-group-rounded-bold-duotone"
							message="No members assigned to this tenant"
							pad="py-8"
						/>
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
								{#if r.is_system}<Chip>system</Chip>{:else}<Chip tone="accent">custom</Chip>{/if}
							</div>
							<div class="mt-1 font-mono text-[11px] text-ink-mute">
								{r.cap_count} capabilit{r.cap_count === 1 ? 'y' : 'ies'}
							</div>
							<button
								onclick={() => startDuplicate(r)}
								disabled={!!busy}
								class="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-soft hover:text-accent disabled:opacity-40"
							>
								<span class="i-solar-copy-bold-duotone h-3.5 w-3.5"></span>
								Duplicate to customize
							</button>
						</div>
					{/each}
				</div>

				{#if dupOpen}
					<!-- inline create panel (prefilled from the source role); defaults themselves stay read-only -->
					<div class="border-t border-paper-edge bg-paper-mute/40 p-4">
						<div class="mb-3 flex items-center justify-between">
							<h3 class="text-sm font-semibold text-ink">
								New custom role <span class="font-normal text-ink-mute">from {sourceName}</span>
							</h3>
							<button
								onclick={() => (dupOpen = false)}
								class="text-[11px] text-ink-mute hover:text-ink">Cancel</button
							>
						</div>
						<div class="flex flex-wrap gap-3">
							<label class="flex flex-col gap-1">
								<span class="text-[11px] text-ink-mute">Key (unique, lowercase)</span>
								<input
									bind:value={newKey}
									placeholder="support"
									class="w-48 rounded-md border border-paper-edge bg-paper px-2 py-1 font-mono text-xs text-ink"
								/>
							</label>
							<label class="flex flex-col gap-1">
								<span class="text-[11px] text-ink-mute">Display name</span>
								<input
									bind:value={newName}
									class="w-64 rounded-md border border-paper-edge bg-paper px-2 py-1 text-xs text-ink"
								/>
							</label>
						</div>

						<div class="mt-3">
							<div class="mb-1 text-[11px] text-ink-mute">
								Capabilities <span class="text-ink-faint"
									>({selectedCaps.size} selected — you can only grant capabilities you hold)</span
								>
							</div>
							<div class="space-y-2">
								{#each Object.entries(byDomain) as [domain, caps] (domain)}
									<div>
										<div class="text-[10px] font-semibold uppercase tracking-widest text-ink-mute">
											{domain}
										</div>
										<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
											{#each caps as c (c.key)}
												<label
													class="inline-flex items-center gap-1.5 text-xs text-ink"
													title={c.description}
												>
													<input
														type="checkbox"
														checked={selectedCaps.has(c.key)}
														onchange={() => toggleCap(c.key)}
													/>
													<span class="font-mono">{c.key}</span>
												</label>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						</div>

						<div class="mt-4 flex items-center gap-3">
							<button
								onclick={submitRole}
								disabled={!newKey.trim() || !newName.trim() || !!busy}
								class="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-40"
							>
								{busy === 'create-role' ? 'Creating…' : 'Create role'}
							</button>
							<span class="text-[11px] text-ink-mute"
								>Creates a tenant-only role — the source default is unchanged.</span
							>
						</div>
					</div>
				{/if}
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
													<span
														class="i-solar-check-circle-bold-duotone inline-block h-3.5 w-3.5 text-accent"
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
					<span class="i-solar-shield-check-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
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
