<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'

	/** @type {import('$lib/api').McpServer[]} */
	let servers = $state([])
	/** @type {import('$lib/api').McpTool[]} */
	let tools = $state([])
	/** @type {{ id: string; key: string; name: string }[]} */
	let roles = $state([])
	/** @type {import('$lib/api').ToolGrant[]} */
	let grants = $state([])
	let loading = $state(true)
	let error = $state('')
	let busy = $state('')

	async function load() {
		try {
			const t = await api.tools()
			servers = t.servers
			tools = t.tools
			roles = t.roles
			grants = t.grants
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	// O(1) grant lookup keyed by role|server|tool.
	const grantSet = $derived(
		new Set(grants.map((g) => `${g.role_id}|${g.mcp_server_id}|${g.tool_name}`))
	)
	/** @param {string} roleId @param {string} serverId @param {string} tool */
	const isGranted = (roleId, serverId, tool) => grantSet.has(`${roleId}|${serverId}|${tool}`)

	// tools grouped by their server → the matrix row groups.
	const toolsByServer = $derived(
		servers.map((s) => ({ server: s, tools: tools.filter((t) => t.mcp_server_id === s.id) }))
	)
	const activeCount = $derived(servers.filter((s) => s.enabled).length)

	/** @param {import('$lib/api').McpServer} s */
	async function toggleServer(s) {
		if (busy) return
		busy = s.id
		error = ''
		try {
			await api.setMcpEnabled(s.id, !s.enabled)
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/** @param {string} roleId @param {string} serverId @param {string} tool */
	async function toggleGrant(roleId, serverId, tool) {
		const key = `${roleId}|${serverId}|${tool}`
		if (busy) return
		busy = key
		error = ''
		try {
			await api.setToolGrant(roleId, serverId, tool, !isGranted(roleId, serverId, tool))
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}
</script>

<AppShell app="admin" title="Tools & MCP">
	<PageHeader
		eyebrow="Gateway"
		title="Tools & MCP servers"
		sub="Register MCP servers and grant their tools per role. Default-deny — a role may call only the tools explicitly allowed here; the gateway enforces it at tool-call time."
	/>

	{#if loading}
		<Async loading />
	{:else}
		<div class="space-y-4 px-5 pb-6">
			{#if error}
				<Card pad
					><p class="text-sm text-danger" role="alert">
						{error}{error.includes('403') ? ' — needs the mcp.manage capability (owner/admin).' : ''}
					</p></Card
				>
			{/if}

			<!-- MCP servers -->
			<Card flush>
				<CardHead title="MCP servers" meta={`${activeCount} of ${servers.length} active`} />
				<div>
					{#each servers as s (s.id)}
						<div
							class="flex items-center gap-3 border-b border-paper-edge px-4 py-3 last:border-b-0"
							class:opacity-55={!s.enabled}
						>
							<span
								class="{s.transport === 'stdio'
									? 'i-solar-cpu-bold-duotone'
									: 'i-solar-server-minimalistic-bold-duotone'} h-5 w-5 flex-shrink-0 text-ink-mute"
							></span>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm text-ink">{s.label || s.name}</span>
									<Chip tone="mute">{s.transport}</Chip>
									<Chip tone={s.scope === 'platform' ? 'accent' : 'mute'}>{s.scope}</Chip>
								</div>
								<div class="font-mono text-xs text-ink-mute">{s.name}</div>
							</div>
							<button
								role="switch"
								aria-checked={s.enabled}
								aria-label={`Enable the ${s.name} MCP server`}
								disabled={busy === s.id}
								onclick={() => toggleServer(s)}
								class="relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 {s.enabled
									? 'bg-primary'
									: 'bg-paper-mute'}"
							>
								<span
									class="absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow-sm transition-all {s.enabled
										? 'left-[22px]'
										: 'left-0.5'}"
								></span>
							</button>
						</div>
					{/each}
					{#if servers.length === 0}
						<Empty
							icon="i-solar-widget-bold-duotone"
							message="No MCP servers registered"
							hint="Register one to expose its tools."
							pad="py-8"
						/>
					{/if}
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-info-circle-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						<b>stdio</b> servers run inside the desktop app (on-device, no egress). <b>http/sse</b>
						servers are shared and proxied by the gateway. (Register + refresh-tools are a fast-follow.)
					</span>
				</div>
			</Card>

			<!-- Tool allow-list matrix: tools (by server) × roles -->
			<Card flush>
				<CardHead title="Tool allow-list" meta={`${tools.length} tools × ${roles.length} roles`} />
				<div class="overflow-auto">
					<table class="w-full text-xs">
						<thead>
							<tr class="border-b border-paper-edge">
								<th
									class="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-ink-mute"
									>Tool</th
								>
								{#each roles as r (r.id)}
									<th
										class="px-2 py-2 text-center text-xs font-medium text-ink-soft"
										title={r.name}>{r.key}</th
									>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each toolsByServer as grp (grp.server.id)}
								<tr class="bg-paper-mute/50">
									<td
										colspan={roles.length + 1}
										class="px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink-mute"
										>{grp.server.label || grp.server.name}</td
									>
								</tr>
								{#each grp.tools as t (t.id)}
									<tr class="border-b border-paper-edge last:border-b-0">
										<td class="px-4 py-1.5 font-mono text-ink">{t.tool_name}</td>
										{#each roles as r (r.id)}
											{@const on = isGranted(r.id, grp.server.id, t.tool_name)}
											{@const key = `${r.id}|${grp.server.id}|${t.tool_name}`}
											<td class="px-2 py-1.5 text-center">
												<button
													onclick={() => toggleGrant(r.id, grp.server.id, t.tool_name)}
													disabled={busy === key}
													aria-label={`${on ? 'Revoke' : 'Grant'} ${t.tool_name} for ${r.key}`}
													title={on ? 'Allowed — click to revoke' : 'Blocked — click to allow'}
													class="grid h-6 w-6 place-items-center rounded-md border transition-colors disabled:opacity-40 {on
														? 'border-success/40 bg-success-soft'
														: 'border-paper-edge bg-paper-mute hover:border-ink-faint'}"
												>
													<span
														class="{on
															? 'i-solar-check-circle-bold-duotone text-success'
															: 'i-solar-lock-keyhole-minimalistic-linear text-ink-faint'} h-3.5 w-3.5"
													></span>
												</button>
											</td>
										{/each}
									</tr>
								{/each}
								{#if grp.tools.length === 0}
									<tr class="border-b border-paper-edge last:border-b-0">
										<td colspan={roles.length + 1} class="px-4 py-1.5 text-xs text-ink-faint"
											>No tools discovered yet.</td
										>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
				<div class="flex items-start gap-2 border-t border-dashed border-paper-edge px-4 py-3">
					<span class="i-solar-shield-keyhole-bold-duotone mt-0.5 h-3.5 w-3.5 text-ink-mute"></span>
					<span class="text-xs leading-relaxed text-ink-mute">
						Default-deny — a role may call only the tools granted here (the role default). Per-space
						tightening (a space can remove, never add) is a fast-follow. Allow-lists are saved now;
						the gateway enforces them at tool-call time once the Tools runtime ships.
					</span>
				</div>
			</Card>
		</div>
	{/if}
</AppShell>
