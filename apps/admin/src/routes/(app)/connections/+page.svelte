<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').Provider[]} */
	let providers = $state([])
	/** @type {import('$lib/api').ApiKey[]} */
	let keys = $state([])
	let error = $state('')
	let loading = $state(true)

	// reveal-once state — the raw secret is held only in memory, shown once, then cleared.
	let name = $state('')
	let issuing = $state(false)
	let busy = $state('') // id of the key currently being revoked
	/** @type {import('$lib/api').IssuedKey | null} */
	let revealed = $state(null)
	let copied = $state(false)

	// BYOK connect/rotate — the pasted secret lives only in `keyInput` (a password field),
	// is sent write-only to the vault, and is cleared the moment the call returns.
	let editing = $state('') // router name whose key input is open ('' = none)
	let keyInput = $state('')
	let connBusy = $state('') // router name currently mutating

	// OAuth (bearer / setup-token) connect — v1 Anthropic only. The pasted token lives only in
	// `tokenInput` (a password field), is sent write-only, and is cleared the moment it returns.
	let tokenEditing = $state('') // router name whose token input is open
	let tokenInput = $state('')

	/** 403 from the gateway means the caller lacks connection.manage — say so plainly. */
	function connError(e) {
		const msg = e instanceof Error ? e.message : String(e)
		return /\b403\b/.test(msg)
			? 'You need the connection.manage capability to change connections.'
			: msg
	}

	async function load() {
		try {
			const [c, k] = await Promise.all([api.connections(), api.apikeys()])
			providers = c.providers
			keys = k.keys
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	async function issue() {
		if (issuing) return
		issuing = true
		error = ''
		copied = false
		try {
			revealed = await api.issueApiKey(name.trim() || undefined)
			name = ''
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
		if (busy) return
		busy = id
		error = ''
		try {
			await api.revokeApiKey(id)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/** Seal a pasted key into the vault. Connect and rotate are the same server-side
	 * upsert — pick the endpoint by current state so the audit action is right.
	 * @param {import('$lib/api').Provider} p */
	async function saveKey(p) {
		const key = keyInput.trim()
		if (!key || connBusy) return
		connBusy = p.name
		error = ''
		try {
			await (p.connected ? api.rotateConnection(p.name, key) : api.connectConnection(p.name, key))
			keyInput = ''
			editing = ''
			await load() // reflect connected/last-set from the gateway; the key is never echoed
		} catch (e) {
			error = connError(e)
		} finally {
			connBusy = ''
		}
	}

	/** Revoke the tenant's BYOK key — the router goes back to unavailable (no fallback).
	 * @param {string} router */
	async function disconnect(router) {
		if (connBusy) return
		connBusy = router
		error = ''
		try {
			await api.revokeConnection(router)
			await load()
		} catch (e) {
			error = connError(e)
		} finally {
			connBusy = ''
		}
	}

	/** Seal a pasted OAuth bearer / setup-token into the vault (Anthropic v1). Coexists with an
	 * api_key credential for the same router; the token is sent write-only and never echoed.
	 * @param {import('$lib/api').Provider} p */
	async function saveToken(p) {
		const token = tokenInput.trim()
		if (!token || connBusy) return
		connBusy = p.name
		error = ''
		try {
			await api.oauthConnectConnection(p.name, token)
			tokenInput = ''
			tokenEditing = ''
			await load()
		} catch (e) {
			error = connError(e)
		} finally {
			connBusy = ''
		}
	}

	/** Revoke the tenant's OAuth credential for the router (independent of any api_key).
	 * @param {string} router */
	async function disconnectOauth(router) {
		if (connBusy) return
		connBusy = router
		error = ''
		try {
			await api.oauthRevokeConnection(router)
			await load()
		} catch (e) {
			error = connError(e)
		} finally {
			connBusy = ''
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

	/** @param {string} host */
	const providerIcon = (host) =>
		/ollama|localhost|127\.0\.0\.1/.test(host)
			? 'i-solar-database-bold-duotone'
			: 'i-solar-server-minimalistic-bold-duotone'
	/** @param {string} url */
	const hostOf = (url) => {
		try {
			return new URL(url).host
		} catch {
			return url
		}
	}
	/** @param {string} iso */
	const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
	/** @param {unknown} scope */
	const scopeLabel = (scope) => (Array.isArray(scope) ? scope.join(' · ') : 'inference')
</script>

<AppShell app="admin" title="Connections">
	<PageHeader
		eyebrow="Connections"
		title="Provider connections"
		sub="The gateway routes every call through the org's own credentials — members never see them. Below, issue scoped API identities for the org's own apps; each key meters against its identity's budget node and is shown exactly once."
	/>

	{#if loading}
		<Async loading />
	{:else}
		<div class="space-y-4 px-5 pb-6">
			{#if error}
				<Card pad><p class="text-sm text-accent">{error}</p></Card>
			{/if}

			<!-- Provider routers — bring-your-own-key. Remote providers use THIS org's own key
			 (sealed in the vault); keyless local routers need none. No cross-tenant fallback. -->
			<Card flush>
				<CardHead
					title="Routers & credentials"
					meta={`${providers.filter((p) => p.connected).length}/${providers.filter((p) => p.requires_key).length} connected`}
				/>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
					{#each providers as p, i (p.name)}
						<div
							data-router={p.name}
							class="flex flex-col gap-2.5 border-paper-edge p-4 {i % 3 !== 2
								? 'lg:border-r'
								: ''} {i >= 3 ? 'lg:border-t' : ''} {i % 2 !== 1
								? 'sm:border-r sm:lg:border-r'
								: ''} border-b"
						>
							<div class="flex items-center gap-3">
								<Glyph
									icon={providerIcon(p.api_base_url)}
									tone={p.connected ? 'accent' : p.requires_key ? 'mute' : 'soft'}
								/>
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm font-semibold text-ink">{p.name}</div>
									<div class="font-mono text-xs uppercase tracking-wider text-ink-mute">
										{p.is_active ? 'active' : 'inactive'}
									</div>
								</div>
								{#if !p.requires_key}
									<Chip tone="mute">local</Chip>
								{:else if p.connected}
									<Chip tone="success">connected</Chip>
								{:else}
									<Chip tone="warning">not set</Chip>
								{/if}
							</div>
							<div class="truncate font-mono text-xs text-ink-mute" title={p.api_base_url}>
								{hostOf(p.api_base_url)}{#if p.connected && p.connected_at}
									· set {fmtDate(p.connected_at)}{:else if !p.requires_key}
									· no key needed{/if}
							</div>

							{#if p.requires_key}
								{#if editing === p.name}
									<div class="flex items-center gap-2">
										<input
											type="password"
											bind:value={keyInput}
											aria-label={`API key for ${p.name}`}
											placeholder="paste provider key"
											autocomplete="off"
											class="min-w-0 flex-1 rounded-md border border-paper-edge bg-paper px-2.5 py-1 font-mono text-xs text-ink placeholder:text-ink-mute"
											onkeydown={(e) => e.key === 'Enter' && saveKey(p)}
										/>
										<button
											onclick={() => saveKey(p)}
											disabled={connBusy === p.name || !keyInput.trim()}
											class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-on-primary disabled:opacity-40"
											>{connBusy === p.name ? 'Saving…' : 'Save'}</button
										>
										<button
											onclick={() => {
												editing = ''
												keyInput = ''
											}}
											disabled={connBusy === p.name}
											class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-soft hover:bg-paper-mute disabled:opacity-40"
											>Cancel</button
										>
									</div>
								{:else if p.connected}
									<div class="flex items-center gap-2">
										<button
											onclick={() => {
												editing = p.name
												keyInput = ''
											}}
											class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-mute hover:border-accent hover:text-accent"
											>Rotate</button
										>
										<button
											onclick={() => disconnect(p.name)}
											disabled={connBusy === p.name}
											aria-label={`Revoke ${p.name} key`}
											title="Revoke this key — the router becomes unavailable to the org"
											class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-mute hover:border-danger hover:text-danger disabled:opacity-40"
											>{connBusy === p.name ? 'Revoking…' : 'Revoke'}</button
										>
									</div>
								{:else}
									<button
										onclick={() => {
											editing = p.name
											keyInput = ''
										}}
										class="self-start rounded-md bg-primary px-3 py-1 text-xs font-medium text-on-primary"
										>Connect</button
									>
								{/if}

								<!-- OAuth (bearer / setup-token) — v1 Anthropic only; shown too if already set. -->
								{#if p.name === 'anthropic' || p.oauth_connected}
									<div
										class="flex items-center gap-2 border-t border-dashed border-paper-edge pt-2"
									>
										<span class="text-[10px] font-semibold uppercase tracking-wider text-ink-mute"
											>OAuth</span
										>
										{#if p.oauth_connected}
											<Chip tone="success">token set</Chip>
											<button
												onclick={() => disconnectOauth(p.name)}
												disabled={connBusy === p.name}
												aria-label={`Revoke ${p.name} OAuth token`}
												class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-mute hover:border-danger hover:text-danger disabled:opacity-40"
												>{connBusy === p.name ? '…' : 'Revoke'}</button
											>
										{:else if tokenEditing === p.name}
											<input
												type="password"
												bind:value={tokenInput}
												aria-label={`OAuth token for ${p.name}`}
												placeholder="paste setup-token"
												autocomplete="off"
												class="min-w-0 flex-1 rounded-md border border-paper-edge bg-paper px-2.5 py-1 font-mono text-xs text-ink placeholder:text-ink-mute"
												onkeydown={(e) => e.key === 'Enter' && saveToken(p)}
											/>
											<button
												onclick={() => saveToken(p)}
												disabled={connBusy === p.name || !tokenInput.trim()}
												class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-on-primary disabled:opacity-40"
												>{connBusy === p.name ? 'Saving…' : 'Save'}</button
											>
											<button
												onclick={() => {
													tokenEditing = ''
													tokenInput = ''
												}}
												disabled={connBusy === p.name}
												class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-soft hover:bg-paper-mute disabled:opacity-40"
												>Cancel</button
											>
										{:else}
											<button
												onclick={() => {
													tokenEditing = p.name
													tokenInput = ''
												}}
												class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-mute hover:border-accent hover:text-accent"
												>Connect token</button
											>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					{/each}
					{#if providers.length === 0}
						<p class="p-4 text-sm text-ink-mute">No routers configured.</p>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-check-bold-duotone mt-0.5 h-3.5 w-3.5 text-success"></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						Remote providers authenticate with the org's own key, sealed in the vault and shown to
						no one; local models need no key. Keys are write-only here — rotate replaces, revoke
						removes.
					</span>
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

			<!-- API identities — issue reveal-once, list masked. -->
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
								bind:value={name}
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
										disabled={busy === k.id}
										aria-label={`Revoke API key ${k.prefix}`}
										title="Revoke this key"
										class="rounded-md border border-paper-edge px-2 py-1 text-xs text-ink-mute hover:border-danger hover:text-danger disabled:opacity-40"
										>{busy === k.id ? 'Revoking…' : 'Revoke'}</button
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
		</div>
	{/if}
</AppShell>
