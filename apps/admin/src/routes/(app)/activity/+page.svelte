<script>
	import { onMount } from 'svelte'
	import { AppShell } from '@strategos/ui'
	import { api } from '$lib/api'

	let requests = $state([])
	let events = $state([])
	let error = $state('')
	let loading = $state(true)

	onMount(async () => {
		try {
			const [r, a] = await Promise.all([api.requests(50), api.audit(50)])
			requests = r.requests
			events = a.events
		} catch (e) {
			error = String(e)
		} finally {
			loading = false
		}
	})

	/** @param {string} s */
	const fmtTime = (s) => new Date(s).toLocaleString()
	/** @param {number} c */
	const fmtCost = (c) => '$' + Number(c).toFixed(6)
</script>

<AppShell app="admin" title="Requests & Audit">
	{#if loading}
		<p class="p-4 text-ink-mute">Loading…</p>
	{:else if error}
		<div class="m-4 rounded border border-paper-edge bg-paper-soft p-3 text-sm text-ink-soft">
			{error} — sign in to the admin (the gateway requires a session JWT).
		</div>
	{:else}
		<section class="p-4">
			<h2 class="mb-2 text-sm font-medium text-ink">Requests ({requests.length})</h2>
			<div class="overflow-auto rounded border border-paper-edge">
				<table class="w-full text-xs">
					<thead class="bg-paper-soft text-ink-mute">
						<tr>
							<th class="px-3 py-2 text-left">Time</th>
							<th class="px-3 py-2 text-left">Model</th>
							<th class="px-3 py-2 text-left">Chain</th>
							<th class="px-3 py-2 text-left">Plane</th>
							<th class="px-3 py-2 text-right">Tokens</th>
							<th class="px-3 py-2 text-right">Cost</th>
							<th class="px-3 py-2 text-left">Status</th>
						</tr>
					</thead>
					<tbody>
						{#each requests as r (r.id)}
							<tr class="border-t border-paper-edge">
								<td class="px-3 py-1.5 text-ink-mute">{fmtTime(r.recorded_at)}</td>
								<td class="px-3 py-1.5 text-ink">{r.model}</td>
								<td class="px-3 py-1.5 text-ink-soft">{r.chain_id ?? '—'}</td>
								<td class="px-3 py-1.5 text-ink-soft">{r.execution_location ?? '—'}</td>
								<td class="px-3 py-1.5 text-right text-ink-soft"
									>{r.input_tokens ?? 0}/{r.output_tokens ?? 0}</td
								>
								<td class="px-3 py-1.5 text-right text-ink-soft">{fmtCost(r.cost_usd)}</td>
								<td class="px-3 py-1.5 text-ink-soft">{r.status}</td>
							</tr>
						{/each}
						{#if requests.length === 0}
							<tr
								><td colspan="7" class="px-3 py-3 text-center text-ink-mute">No requests yet.</td
								></tr
							>
						{/if}
					</tbody>
				</table>
			</div>
		</section>

		<section class="p-4">
			<h2 class="mb-2 text-sm font-medium text-ink">Audit ({events.length})</h2>
			<div class="overflow-auto rounded border border-paper-edge">
				<table class="w-full text-xs">
					<thead class="bg-paper-soft text-ink-mute">
						<tr>
							<th class="px-3 py-2 text-left">Time</th>
							<th class="px-3 py-2 text-left">Action</th>
							<th class="px-3 py-2 text-left">Target</th>
							<th class="px-3 py-2 text-left">Actor</th>
						</tr>
					</thead>
					<tbody>
						{#each events as e (e.id)}
							<tr class="border-t border-paper-edge">
								<td class="px-3 py-1.5 text-ink-mute">{fmtTime(e.created_at)}</td>
								<td class="px-3 py-1.5 text-ink">{e.action}</td>
								<td class="px-3 py-1.5 text-ink-soft">{e.target_type ?? '—'}</td>
								<td class="px-3 py-1.5 text-ink-soft"
									>{e.actor_id ? e.actor_id.slice(0, 8) : 'system'}</td
								>
							</tr>
						{/each}
						{#if events.length === 0}
							<tr
								><td colspan="4" class="px-3 py-3 text-center text-ink-mute"
									>No audit events yet.</td
								></tr
							>
						{/if}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</AppShell>
