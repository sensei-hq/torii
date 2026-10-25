<script>
	import { onMount } from 'svelte'
	import { AppShell, PageHeader, Card, CardHead, Chip, Async, Empty } from '@torii/ui'
	import { api } from '$lib/api'
	import {
		admissibleLabel,
		ciFloorIsBinding,
		ciLabel,
		configuredMargin,
		marginLabel,
		orderedRows,
		rankLabel,
		shortSha,
		verdictTone,
		DEFAULT_MARGIN
	} from '$lib/rankings'

	/** @type {import('$lib/api').RankingsData | null} */
	let data = $state(null)
	let error = $state('')
	let loading = $state(true)
	let busy = $state('')
	let notice = $state('')
	/** @type {Record<string, string>} */
	let drafts = $state({})

	async function load() {
		try {
			data = await api.rankings()
			// Seed each edit form from what is CONFIGURED, not from effective_margin: the
			// effective number folds in the measurement's own CI, and prefilling it would
			// turn a display detail into a policy the operator never chose.
			drafts = Object.fromEntries(
				data.categories.map((c) => [
					c.category,
					String(configuredMargin(data.policies, c.category).margin)
				])
			)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
	onMount(load)

	/**
	 * Save one category's margin. The server bumps the policy revision and the tenant's
	 * routing snapshot; the ranks stay measurements, so nothing here edits an order.
	 * @param {string} category
	 */
	async function saveMargin(category) {
		if (busy) return
		const raw = Number(drafts[category])
		if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
			error = `${category}: margin must be between 0 and 1 (accuracy points)`
			return
		}
		busy = category
		error = ''
		notice = ''
		try {
			const res = await api.setRankingMargin(category, raw)
			notice = `${category}: margin ${res.margin} saved (policy revision ${res.revision})`
			await load()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}

	/** @param {import('$lib/api').RankingCategory} c */
	function configured(c) {
		return configuredMargin(data?.policies ?? [], c.category, DEFAULT_MARGIN)
	}
</script>

<AppShell app="admin" title="Rankings">
	<PageHeader
		eyebrow="Rankings"
		title="What the gateway knows about quality"
		sub="Measured rankings from the decision benchmark, per task category, as the routing chain sees them. A ranking is an order only when the evidence supports one — a tie is a set, and the gateway claims nothing from it. What you can tune here is how much accuracy a category may trade when its best model is unavailable."
	/>

	{#if loading}
		<Async loading />
	{:else if !data || data.categories.length === 0}
		<div class="px-4 sm:px-6 xl:px-12">
			<Card pad>
				<Empty
					icon="i-solar-medal-ribbons-star-bold-duotone"
					message={error || 'No measured rankings yet'}
					hint={error ? '' : 'Rank them by publishing a benchmark artifact, then re-import.'}
				/>
			</Card>
		</div>
	{:else}
		<div class="space-y-6 px-4 pb-12 sm:px-6 xl:px-12 xl:pb-16">
			{#if notice}
				<Card pad><p class="text-sm text-success">{notice}</p></Card>
			{/if}
			{#if error}
				<Card pad>
					<p class="text-sm text-danger">
						{error}{error.includes('403')
							? ' — needs the model.manage capability (owner/admin).'
							: ''}
					</p>
				</Card>
			{/if}

			{#each data.categories as c (c.category)}
				{@const margin = configured(c)}
				{@const binding = ciFloorIsBinding(margin.margin, c.effective_margin)}
				<Card flush>
					<CardHead title={c.category}>
						{#snippet right()}
							<span class="flex items-center gap-2">
								<Chip tone={verdictTone(c.verdict)}>{c.verdict}</Chip>
								<span class="font-mono text-xs text-ink-mute">
									{admissibleLabel(c)} within margin
								</span>
							</span>
						{/snippet}
					</CardHead>

					<!-- why, in the server's words: the same function the resolver reads -->
					<div
						class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-dashed border-paper-edge px-6 py-3 font-mono text-xs text-ink-mute"
					>
						<span class="text-ink-soft">{c.reason}</span>
						{#if c.proxy}
							<span>evidence proxy · <b class="text-warning">{c.proxy}</b></span>
						{/if}
					</div>

					<div class="overflow-auto">
						<table class="w-full text-xs">
							<thead
								class="font-mono text-xs uppercase tracking-wider text-ink-mute [&_th]:px-6 [&_th]:py-3 [&_th]:text-left [&_th]:font-medium"
							>
								<tr class="border-b border-paper-edge">
									<th>Rank</th>
									<th>Model</th>
									<th>Chain step</th>
									<th class="!text-right">Accuracy (95% CI)</th>
									<th>Margin</th>
									<th>Data rev</th>
								</tr>
							</thead>
							<tbody class="[&_td]:px-6 [&_td]:py-3">
								{#each orderedRows(c.rows) as r (r.chain_model_id ?? r.model_full_name)}
									<tr
										class="border-b border-paper-edge last:border-b-0 hover:bg-paper-mute/40"
										class:opacity-50={!r.measured}
									>
										<td class="font-mono text-ink-soft">{rankLabel(r.rank, c.verdict)}</td>
										<td>
											<span class="font-mono text-sm font-semibold text-ink"
												>{r.model_full_name}</span
											>
											<div class="mt-0.5 font-mono text-xs text-ink-mute">
												{r.provider ?? '—'} · {r.router_name ?? '—'}
											</div>
										</td>
										<td class="font-mono text-ink-soft">#{r.sequence_order}</td>
										<td class="text-right font-mono text-ink-soft">
											{ciLabel(r.accuracy, r.ci_half_width)}
										</td>
										<td>
											<Chip
												tone={r.within_margin === true
													? 'success'
													: r.within_margin === false
														? 'danger'
														: 'mute'}
											>
												{marginLabel(r.within_margin, c.verdict)}
											</Chip>
										</td>
										<td class="font-mono text-ink-mute">r{r.revision ?? '—'}</td>
									</tr>
								{/each}
								{#if c.rows.length === 0}
									<tr>
										<td colspan="6">
											<Empty
												icon="i-solar-cpu-bold-duotone"
												message="No chain step for this category"
												hint="Add a model to the decide chain on the Routing screen."
												pad="py-8"
											/>
										</td>
									</tr>
								{/if}
							</tbody>
						</table>
					</div>

					<!-- the margin: the only knob here. Ranks are measurements, not settings. -->
					<div
						class="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-paper-edge px-6 py-4"
					>
						<label class="flex items-end gap-2">
							<span class="flex flex-col gap-1">
								<span class="text-xs font-medium uppercase tracking-widest text-ink-mute"
									>Margin</span
								>
								<input
									type="number"
									min="0"
									max="1"
									step="0.005"
									bind:value={drafts[c.category]}
									class="w-24 rounded-md border border-paper-edge bg-paper px-2 py-1 font-mono text-sm text-ink"
								/>
							</span>
							<button
								onclick={() => saveMargin(c.category)}
								disabled={busy === c.category}
								class="rounded-md border border-paper-edge px-3 py-1 text-xs font-medium text-ink-soft hover:bg-paper-mute disabled:opacity-40"
								>{busy === c.category ? 'Saving…' : 'Save'}</button
							>
						</label>
						<span class="font-mono text-xs text-ink-mute">
							effective <b class="text-ink">{c.effective_margin}</b>
							{#if binding}
								<span class="text-warning">· set by the top model's CI, not by this number</span>
							{/if}
						</span>
						<span class="font-mono text-xs text-ink-mute">
							{margin.scope} policy
							{#if margin.revision != null}(rev {margin.revision}){/if}
						</span>
						<span class="ml-auto font-mono text-xs text-ink-faint">
							artifact {shortSha(c.artifact_sha)} · corpus {shortSha(c.corpus_sha)} · ranking r{c.ranking_revision ??
								'—'} · measured {c.measured}/{c.chained} chained
						</span>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</AppShell>
