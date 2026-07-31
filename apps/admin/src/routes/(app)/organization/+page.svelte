<script>
	import { onMount } from 'svelte'
	import { SvelteSet } from 'svelte/reactivity'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import { orgTreeState } from '$lib/org-tree-state.svelte'
	import BudgetTreeNode from '$lib/BudgetTreeNode.svelte'

	/** @type {import('$lib/api').Member[]} */
	let members = $state([])
	/** @type {import('$lib/api').Role[]} */
	let roles = $state([])
	/** @type {import('$lib/api').Capability[]} */
	let capabilities = $state([])
	/** the caller's own identity, for gating owner-only controls (e.g. transfer ownership) */
	/** @type {import('$lib/api').WhoAmI | null} */
	let me = $state(null)
	/** @type {import('$lib/api').ApiKey[]} */
	let keys = $state([])
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')

	// API-identity issuance — reveal-once. The raw secret is held only in memory, shown once,
	// then cleared. Own `keyName`/`keyBusy` so key ops never disable the member/role controls.
	let keyName = $state('')
	let issuing = $state(false)
	let keyBusy = $state('') // id of the key currently being revoked
	/** @type {import('$lib/api').IssuedKey | null} */
	let revealed = $state(null)
	let copied = $state(false)

	async function load() {
		try {
			// Budgets ride their own capability (budget.read) — a denial or an unseeded tree must
			// NOT blank the RBAC below, so it degrades to an empty tree in its own slot.
			const [o, k, b] = await Promise.all([
				api.org(),
				api.apikeys(),
				api.budgets().catch(() => ({ nodes: [], requests: [] }))
			])
			members = o.members
			roles = o.roles
			capabilities = o.capabilities
			keys = k.keys
			orgTreeState.load(b.nodes)
			me = await api.whoami()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	// org root (the parent-less node) drives the header "left this month" pill.
	const orgRoot = $derived(orgTreeState.nodes.find((n) => n.parent_id == null))
	/** @param {number | null | undefined} n */
	const money0 = (n) => (n == null ? '∞' : '$' + Math.round(n).toLocaleString())

	/** Issue a scoped API identity — the raw key is returned once, kept only in `revealed`. */
	async function issue() {
		if (issuing) return
		issuing = true
		error = ''
		copied = false
		try {
			revealed = await api.issueApiKey(keyName.trim() || undefined)
			keyName = ''
			await load() // refresh the masked list; the raw key stays only in `revealed`
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			issuing = false
		}
	}

	/** Revoke a key — it stops authenticating immediately. Irreversible (re-issue a new one).
	 * @param {string} id */
	async function revoke(id) {
		if (keyBusy) return
		keyBusy = id
		error = ''
		try {
			await api.revokeApiKey(id)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			keyBusy = ''
		}
	}

	async function copyKey() {
		if (!revealed) return
		try {
			await navigator.clipboard.writeText(revealed.key)
			copied = true
		} catch {
			copied = false
		}
	}

	/** @param {string} iso */
	const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
	/** @param {unknown} scope */
	const scopeLabel = (scope) => (Array.isArray(scope) ? scope.join(' · ') : 'inference')

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
			// You just demoted yourself to admin — admin can't load /organization (needs
			// role.manage), so go to the dashboard rather than bounce into a 403.
			window.location.assign('/')
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
		title="Hierarchy & budgets"
		sub="Model your org as it really is — the budget hierarchy (add levels, rename, cap each; caps cascade org → team → user), the people and roles that map onto it, and the API identities for your own apps. Access resolves server-side, never trusted from the token."
	>
		{#snippet actions()}
			{#if orgRoot}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-success"></span>
					{#if orgRoot.cap_amount != null}
						{money0(orgRoot.cap_amount - orgRoot.spent_amount)} left this {orgRoot.period ===
						'daily'
							? 'day'
							: orgRoot.period === 'weekly'
								? 'week'
								: 'month'}
					{:else}
						{money0(orgRoot.spent_amount)} spent · no org cap
					{/if}
				</span>
			{/if}
		{/snippet}
	</PageHeader>

	{#if loading}
		<Async loading />
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			<!-- Budget hierarchy — the editable org → dept → team → user tree (real /v1/budgets +
			     upsert/delete RPCs). The mock's SSO/SCIM directory card is intentionally omitted:
			     auth method (magic-link/OAuth/SSO) is out of scope; the hierarchy + budgets are the point. -->
			<Card flush>
				<CardHead title="Budget hierarchy" icon="i-solar-buildings-2-bold-duotone">
					{#snippet right()}
						{#if orgRoot}
							<button
								type="button"
								onclick={() => orgTreeState.addChild(orgRoot)}
								disabled={orgTreeState.busy === orgRoot.id}
								class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-mute disabled:opacity-40"
							>
								<span class="i-solar-add-circle-linear h-3.5 w-3.5 text-ink-mute"></span>
								Add department
							</button>
						{/if}
					{/snippet}
				</CardHead>
				{#if orgTreeState.error}
					<div class="flex items-center gap-2 border-b border-paper-edge px-6 py-2">
						<span class="text-xs text-danger" role="alert">{orgTreeState.error}</span>
						<button
							type="button"
							onclick={() => orgTreeState.clearError()}
							class="text-xs text-ink-mute hover:text-ink">dismiss</button
						>
					</div>
				{/if}
				<div class="px-4 py-3">
					{#each orgTreeState.tree as root (root.id)}
						<BudgetTreeNode node={root} />
					{/each}
					{#if orgTreeState.tree.length === 0}
						<Empty
							icon="i-solar-wallet-bold-duotone"
							message="No budget tree seeded for this tenant."
							pad="py-8"
						/>
					{/if}
				</div>
				<div
					class="flex items-start gap-2 border-t border-dashed border-paper-edge px-6 py-3 text-xs text-ink-mute"
				>
					<span class="i-solar-info-circle-linear mt-0.5 h-3.5 w-3.5 shrink-0"></span>
					<span>
						Each level shows <b>alloc</b> — the sum of its children's caps against its own;
						over-allocate and it turns red. The gear sets a node's <b>hard/soft</b> cap,
						<b>alert threshold</b>
						and
						<b>free-floor</b>; <b>D·W·M</b> set its enforcement window. Caps cascade — a call needs
						headroom at user, team, department <em>and</em> org.
					</span>
				</div>
			</Card>

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
								<div class="truncate text-sm text-ink">
									{m.display_name ?? m.email ?? 'Unnamed'}
								</div>
								<div class="font-mono text-xs text-ink-mute">{m.id.slice(0, 8)}</div>
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
										class="rounded-md border border-paper-edge bg-paper px-2 py-1 text-xs text-ink-soft disabled:opacity-40"
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

			<!-- Reveal-once banner: the raw secret, shown exactly once, then unrecoverable. -->
			{#if revealed}
				<Card pad class="border-accent bg-accent-soft">
					<div class="flex items-start gap-3">
						<span class="i-solar-key-bold-duotone mt-0.5 h-4 w-4 text-accent"></span>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-ink">
								Copy this key now — it will not be shown again.
							</p>
							<div class="mt-2 flex items-center gap-2">
								<code
									class="flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md border border-paper-edge bg-paper px-2.5 py-1.5 font-mono text-xs text-ink"
									>{revealed.key}</code
								>
								<button
									onclick={copyKey}
									class="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90"
									>{copied ? 'Copied' : 'Copy'}</button
								>
								<button
									onclick={() => (revealed = null)}
									class="rounded-md border border-paper-edge px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-mute"
									>Dismiss</button
								>
							</div>
						</div>
					</div>
				</Card>
			{/if}

			<!-- API identities — non-human principals for the org's own apps. Issue reveal-once, list masked. -->
			<Card flush>
				<CardHead>
					{#snippet left()}
						<span class="flex items-center gap-2">
							<span class="text-xs font-semibold uppercase tracking-wider text-ink-mute"
								>API identities</span
							>
							<span class="font-mono text-xs text-ink-mute"
								>{keys.filter((k) => k.status === 'active').length} active</span
							>
						</span>
					{/snippet}
					{#snippet right()}
						<div class="flex items-center gap-2">
							<input
								bind:value={keyName}
								aria-label="API key name"
								placeholder="key name (e.g. ingest-worker)"
								class="w-48 rounded-md border border-paper-edge bg-paper px-2.5 py-1 font-mono text-xs text-ink placeholder:text-ink-mute"
								onkeydown={(e) => e.key === 'Enter' && issue()}
							/>
							<button
								onclick={issue}
								disabled={issuing}
								class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-on-primary disabled:opacity-40"
								>{issuing ? 'Issuing…' : 'Issue key'}</button
							>
						</div>
					{/snippet}
				</CardHead>
				<div>
					{#each keys as k (k.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0"
							class:opacity-55={k.status === 'revoked'}
						>
							<Glyph
								icon={k.service_account_id
									? 'i-solar-server-bold-duotone'
									: 'i-solar-key-bold-duotone'}
								tone="soft"
							/>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-mono text-sm text-ink">{k.prefix}…</span>
									<Chip>{k.service_account_id ? 'service account' : 'API key'}</Chip>
									<Chip>{scopeLabel(k.scope)}</Chip>
								</div>
								<div class="mt-1 font-mono text-xs text-ink-mute">
									created {fmtDate(k.created_at)} · last used
									{k.last_used_at ? fmtDate(k.last_used_at) : '—'}
								</div>
							</div>
							<div class="flex flex-shrink-0 items-center gap-2">
								<Chip tone={k.status === 'active' ? 'success' : 'warning'}>{k.status}</Chip>
								{#if k.status === 'active'}
									<button
										onclick={() => revoke(k.id)}
										disabled={keyBusy === k.id}
										aria-label={`Revoke API key ${k.prefix}`}
										title="Revoke this key"
										class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-mute hover:border-danger hover:text-danger disabled:opacity-40"
										>{keyBusy === k.id ? 'Revoking…' : 'Revoke'}</button
									>
								{/if}
							</div>
						</div>
					{/each}
					{#if keys.length === 0}
						<Empty
							icon="i-solar-key-bold-duotone"
							message="No API identities yet"
							hint="Issue one above."
							pad="py-8"
						/>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-check-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						Keys are shown once at creation, then stored only as an argon2id hash. A key carries no
						budget — spend meters to the bound identity's node in the org tree, and every call is
						audited.
					</span>
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
							<div class="mt-1 font-mono text-xs text-ink-mute">
								{r.cap_count} capabilit{r.cap_count === 1 ? 'y' : 'ies'}
							</div>
							<button
								onclick={() => startDuplicate(r)}
								disabled={!!busy}
								class="mt-2 inline-flex items-center gap-1 text-xs text-ink-soft hover:text-accent disabled:opacity-40"
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
							<button onclick={() => (dupOpen = false)} class="text-xs text-ink-mute hover:text-ink"
								>Cancel</button
							>
						</div>
						<div class="flex flex-wrap gap-3">
							<label class="flex flex-col gap-1">
								<span class="text-xs text-ink-mute">Key (unique, lowercase)</span>
								<input
									bind:value={newKey}
									placeholder="support"
									class="w-48 rounded-md border border-paper-edge bg-paper px-2 py-1 font-mono text-xs text-ink"
								/>
							</label>
							<label class="flex flex-col gap-1">
								<span class="text-xs text-ink-mute">Display name</span>
								<input
									bind:value={newName}
									class="w-64 rounded-md border border-paper-edge bg-paper px-2 py-1 text-xs text-ink"
								/>
							</label>
						</div>

						<div class="mt-3">
							<div class="mb-1 text-xs text-ink-mute">
								Capabilities <span class="text-ink-faint"
									>({selectedCaps.size} selected — you can only grant capabilities you hold)</span
								>
							</div>
							<div class="space-y-2">
								{#each Object.entries(byDomain) as [domain, caps] (domain)}
									<div>
										<div class="text-xs font-semibold uppercase tracking-widest text-ink-mute">
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
							<span class="text-xs text-ink-mute"
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
									class="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-ink-mute"
									>Capability</th
								>
								{#each roles as r (r.id)}
									<th
										class="px-2 py-2 text-center text-xs font-medium text-ink-soft"
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
										class="px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink-mute"
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
					<span class="text-xs leading-relaxed text-ink-mute">
						System roles are seeded and undeletable (display name renamable). Grants resolve
						server-side by RLS + the gateway — a capability outside the closed catalog cannot be
						stored, and the JWT is never trusted for authorization.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
