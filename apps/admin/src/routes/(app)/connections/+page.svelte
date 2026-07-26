<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Glyph, Chip } from '@torii/ui'
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
	/** @type {import('$lib/api').IssuedKey | null} */
	let revealed = $state(null)
	let copied = $state(false)

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
		/ollama|localhost|127\.0\.0\.1/.test(host) ? 'i-solar-database-bold-duotone' : 'i-solar-server-minimalistic-bold-duotone'
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
		<p class="px-5 text-sm text-ink-mute">Loading…</p>
	{:else}
		<div class="space-y-4 px-5 pb-6">
			{#if error}
				<Card pad><p class="text-sm text-accent">{error}</p></Card>
			{/if}

			<!-- Provider routers — the platform's credentialed upstreams (read-only; vault-managed). -->
			<Card flush>
				<CardHead
					title="Routers & credentials"
					meta={`${providers.filter((p) => p.configured).length}/${providers.length} configured`}
				/>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
					{#each providers as p, i (p.name)}
						<div
							class="flex flex-col gap-2.5 border-paper-edge p-4 {i % 3 !== 2
								? 'lg:border-r'
								: ''} {i >= 3 ? 'lg:border-t' : ''} {i % 2 !== 1
								? 'sm:border-r sm:lg:border-r'
								: ''} border-b"
						>
							<div class="flex items-center gap-3">
								<Glyph
									icon={providerIcon(p.api_base_url)}
									tone={p.configured ? 'accent' : 'mute'}
								/>
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm font-semibold text-ink">{p.name}</div>
									<div class="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
										{p.is_active ? 'active' : 'inactive'}
									</div>
								</div>
								<Chip tone={p.configured ? 'success' : 'mute'}>
									{p.configured ? 'connected' : 'not set'}
								</Chip>
							</div>
							<div class="truncate font-mono text-[11px] text-ink-mute" title={p.api_base_url}>
								{hostOf(p.api_base_url)}
							</div>
						</div>
					{/each}
					{#if providers.length === 0}
						<p class="p-4 text-sm text-ink-mute">No routers configured.</p>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-check-bold-duotone mt-0.5 h-3.5 w-3.5 text-success"></span>
					<span class="text-[11px] leading-relaxed text-ink-mute">
						Credentials live in the org vault — the gateway proxies every call. Connect, rotate, and
						per-router custody are managed server-side.
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
							<span class="text-[11px] font-semibold uppercase tracking-wider text-ink-mute"
								>API identities</span
							>
							<span class="font-mono text-[11px] text-ink-mute"
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
								icon={k.service_account_id ? 'i-solar-server-bold-duotone' : 'i-solar-key-bold-duotone'}
								tone="soft"
							/>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-mono text-sm text-ink">{k.prefix}…</span>
									<Chip>{k.service_account_id ? 'service account' : 'API key'}</Chip>
									<Chip>{scopeLabel(k.scope)}</Chip>
								</div>
								<div class="mt-1 font-mono text-[11px] text-ink-mute">
									created {fmtDate(k.created_at)} · last used
									{k.last_used_at ? fmtDate(k.last_used_at) : '—'}
								</div>
							</div>
							<Chip tone={k.status === 'active' ? 'success' : 'warning'}>{k.status}</Chip>
						</div>
					{/each}
					{#if keys.length === 0}
						<p class="px-4 py-3 text-sm text-ink-mute">No API identities yet — issue one above.</p>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-check-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-[11px] leading-relaxed text-ink-mute">
						Keys are shown once at creation, then stored only as an argon2id hash. A key carries no
						budget — spend meters to the bound identity's node in the org tree, and every call is
						audited.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
