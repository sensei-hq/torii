<script>
	// Torii desktop — Local models. On-device model management: this device + storage, installed
	// models (set-default / remove), and a download registry with live pull progress. Presentation
	// only — state + Tauri IPC live in models.svelte.ts; pure derivations in models.ts.
	import { onMount } from 'svelte'
	import { models } from '$lib/models.svelte.js'
	import { fmtSize, fmtGb, diskTone, capabilityTone, fitHint, sortInstalled } from '$lib/models'
	import { PageHeader, Card, CardHead, Meter, Chip, Empty } from '@torii/ui'

	onMount(() => models.load())
</script>

<section data-models class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Local"
		title="Local models"
		sub="Models on this device — offline, $0. Pulled into ~/.torii/models or read from your Ollama cache."
	>
		{#snippet actions()}
			<Chip tone="success">{models.installed.length} on device</Chip>
		{/snippet}
	</PageHeader>

	<div class="flex flex-1 flex-col gap-6 px-4 pb-10 sm:px-6 xl:px-12">
		{#if models.error}
			<div class="rounded border border-paper-edge bg-warning-soft px-3 py-2 text-sm text-warning">
				{models.error}
			</div>
		{/if}

		<!-- this device + storage -->
		{#if models.device}
			{@const d = models.device}
			<div data-device class="grid gap-4 sm:grid-cols-2">
				<Card pad>
					<CardHead>
						<span class="flex items-center gap-2">
							<span class="i-solar-cpu-bold-duotone h-4 w-4 text-ink-soft"></span>
							<span class="text-xs font-semibold uppercase tracking-widest text-ink-mute"
								>This device</span
							>
						</span>
						<span class="inline-flex items-center gap-1 text-xs text-accent">
							<span class="i-solar-bolt-circle-bold h-3.5 w-3.5"></span> runs on-device
						</span>
					</CardHead>
					<dl class="mt-2 grid grid-cols-3 gap-3 text-sm">
						<div>
							<dt class="text-xs text-ink-mute">Chip</dt>
							<dd class="text-ink">{d.chip}</dd>
						</div>
						<div>
							<dt class="text-xs text-ink-mute">Memory</dt>
							<dd class="text-ink">{fmtGb(d.ram_gb)}</dd>
						</div>
						<div>
							<dt class="text-xs text-ink-mute">Accelerator</dt>
							<dd class="text-ink">{d.accel}</dd>
						</div>
					</dl>
				</Card>
				<Card pad>
					<CardHead>
						<span class="flex items-center gap-2">
							<span class="i-solar-database-bold-duotone h-4 w-4 text-ink-soft"></span>
							<span class="text-xs font-semibold uppercase tracking-widest text-ink-mute"
								>Model storage</span
							>
						</span>
						<span class="font-mono text-xs text-ink-mute">{d.models_count} models</span>
					</CardHead>
					<div class="mt-3">
						<Meter
							label="Disk used by models"
							value={d.models_gb}
							max={d.disk_total_gb}
							display={fmtGb(d.models_gb) + ' / ' + fmtGb(d.disk_total_gb)}
							tone={diskTone(d)}
						/>
					</div>
				</Card>
			</div>
		{/if}

		<!-- installed -->
		<div data-installed>
			<div class="mb-2 flex items-center gap-2">
				<span class="i-solar-check-circle-bold-duotone h-4 w-4 text-accent"></span>
				<h2 class="text-xs font-semibold uppercase tracking-widest text-ink-mute">Installed</h2>
			</div>
			{#if models.loading && models.installed.length === 0}
				<p class="text-sm text-ink-mute">Loading models…</p>
			{:else if models.installed.length === 0}
				<Empty
					icon="i-solar-cpu-bold-duotone"
					message="No local models yet — download one below."
				/>
			{:else}
				<Card flush class="divide-y divide-paper-edge">
					{#each sortInstalled(models.installed) as m (m.id)}
						<div data-model-row class="flex items-center gap-3 px-4 py-3">
							<span class="i-solar-cpu-bold-duotone h-5 w-5 flex-shrink-0 text-ink-soft"></span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate text-sm font-medium text-ink">{m.name}</span>
									<Chip tone={capabilityTone(m.capability)}>{m.capability}</Chip>
									{#if m.is_default}<Chip tone="accent">default</Chip>{/if}
								</div>
								<div class="mt-0.5 font-mono text-xs text-ink-mute">
									{m.format} · {fmtSize(m.size_bytes)} · {m.source}
								</div>
							</div>
							{#if !m.is_default && m.capability === 'chat'}
								<button
									data-set-default
									type="button"
									onclick={() => models.setDefault(m.id)}
									class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-soft hover:bg-paper-mute hover:text-ink"
								>
									<span class="i-solar-pin-bold h-3.5 w-3.5"></span> Set default
								</button>
							{/if}
							{#if m.removable}
								<button
									data-remove
									type="button"
									onclick={() => models.remove(m.id)}
									aria-label="Remove {m.name}"
									title="Remove from device"
									class="inline-flex items-center rounded px-2 py-1 text-ink-mute hover:bg-danger-soft hover:text-danger"
								>
									<span class="i-solar-trash-bin-trash-bold-duotone h-4 w-4"></span>
								</button>
							{:else}
								<span class="font-mono text-xs text-ink-faint">read-only</span>
							{/if}
						</div>
					{/each}
				</Card>
			{/if}
		</div>

		<!-- available to download -->
		<div data-available>
			<div class="mb-2 flex items-center gap-2">
				<span class="i-solar-download-minimalistic-bold-duotone h-4 w-4 text-ink-soft"></span>
				<h2 class="text-xs font-semibold uppercase tracking-widest text-ink-mute">
					Available to download
				</h2>
				<span class="font-mono text-xs text-ink-faint">in-process runtime · GGUF / ONNX</span>
			</div>
			<Card flush class="divide-y divide-paper-edge">
				{#each models.available as m (m.id)}
					{@const pct = models.pulling[m.id]}
					<div class="flex items-center gap-3 px-4 py-3">
						<span class="i-solar-box-minimalistic-bold-duotone h-5 w-5 flex-shrink-0 text-ink-soft"
						></span>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-medium text-ink">{m.name}</span>
								{#if m.installed}<Chip tone="success">installed</Chip>{/if}
							</div>
							<div class="mt-0.5 font-mono text-xs text-ink-mute">
								{m.format} · {fmtSize(m.size_bytes)} · {m.ctx} ctx · {m.quant}
								{#if !m.fits && !m.installed}
									· <span class="text-warning">{fitHint(m, models.device?.ram_gb ?? 0)}</span>
								{/if}
							</div>
							{#if pct != null}
								<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-mute">
									<div
										class="h-full rounded-full bg-accent transition-all"
										style="width: {pct}%"
									></div>
								</div>
							{/if}
						</div>
						{#if m.installed}
							<span class="i-solar-check-circle-bold h-5 w-5 text-accent" aria-label="installed"
							></span>
						{:else if pct != null}
							<span class="font-mono text-xs text-accent">{pct}% · pulling</span>
						{:else if !m.fits}
							<span
								class="i-solar-lock-keyhole-bold h-4 w-4 text-ink-mute"
								title="Not enough memory for this model"
								aria-label="does not fit in memory"
							></span>
						{:else}
							<button
								data-pull
								type="button"
								onclick={() => models.pull(m.id)}
								class="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-on-primary hover:opacity-90"
							>
								<span class="i-solar-download-minimalistic-bold h-3.5 w-3.5"></span> Download
							</button>
						{/if}
					</div>
				{/each}
			</Card>
		</div>
	</div>
</section>
