<script>
	// Torii desktop — W2 Library. The document workspace: upload → parse → redact → chunk → embed,
	// with an ingestion-status list and a per-document detail drawer (pipeline, assets, versions).
	// Presentation only — all state + I/O live in library.svelte.ts; pure derivations in library.ts.
	import { onMount } from 'svelte'
	import { library } from '$lib/library.svelte.js'
	import {
		statusBadge,
		pipelineSteps,
		classificationClass,
		docIcon,
		fmtWhen,
		docTitle,
		ingestingCount
	} from '$lib/library'
	import { PageHeader, Card, Chip, Empty } from '@torii/ui'

	onMount(() => library.load())

	// Classification → Chip tone. There are no clf-* classes in the app, so the normalized
	// class (classificationClass) keys a named-token tone instead.
	/** @type {Record<string, 'success' | 'mute' | 'warning' | 'danger'>} */
	const CLF_TONE = {
		public: 'success',
		internal: 'mute',
		confidential: 'warning',
		restricted: 'danger'
	}
	/** @param {string} c */
	const clfTone = (c) => CLF_TONE[classificationClass(c)] ?? 'mute'

	// IngBadge dot/label color from the derived tone (ok/run → accent, wait → mute, fail → warning).
	/** @param {'ok' | 'wait' | 'run' | 'fail'} tone */
	const ingColor = (tone) =>
		tone === 'fail' ? 'text-warning' : tone === 'wait' ? 'text-ink-mute' : 'text-accent'

	/** @param {Event & { currentTarget: HTMLInputElement }} e */
	function onUpload(e) {
		const input = e.currentTarget
		const file = input.files?.[0]
		input.value = '' // reset so re-selecting the same file fires change again
		if (file) library.upload(file)
	}
</script>

<section data-library class="relative flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Library"
		title="Library"
		sub="Documents — uploaded, parsed, redacted, chunked and embedded so the gateway can ground answers in them."
	>
		{#snippet actions()}
			<label
				data-upload
				class="inline-flex cursor-pointer items-center gap-1.5 rounded bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 {library.uploading
					? 'opacity-60'
					: ''}"
			>
				{#if library.uploading}
					<span class="i-solar-refresh-bold-duotone h-4 w-4 animate-spin"></span>
					Uploading…
				{:else}
					<span class="i-solar-upload-minimalistic-bold-duotone h-4 w-4"></span>
					Upload
				{/if}
				<input
					type="file"
					class="sr-only"
					accept=".md,.txt,.pdf,.docx,.pptx,.xlsx,.html,image/*"
					aria-label="Upload a document"
					disabled={library.uploading}
					onchange={onUpload}
				/>
			</label>
		{/snippet}
	</PageHeader>

	<div class="flex flex-1 flex-col gap-4 px-4 pb-8 sm:px-6 xl:px-12">
		<!-- upload → normalize hint -->
		<div
			class="flex items-center gap-2 rounded border border-dashed border-paper-edge bg-paper-mute px-4 py-2.5 text-xs text-ink-mute"
		>
			<span class="i-solar-upload-minimalistic-bold-duotone h-4 w-4 flex-shrink-0"></span>
			<span
				>pdf · docx · xlsx · pptx · html <span class="text-ink-faint">→</span> normalized to markdown
				· tables · images</span
			>
		</div>

		{#if library.uploadError}
			<div
				data-upload-error
				class="rounded border border-paper-edge bg-warning-soft px-3 py-2 text-sm text-warning"
			>
				{library.uploadError}
			</div>
		{/if}

		{#if ingestingCount(library.docs) > 0}
			<p data-ingesting-note class="flex items-center gap-1.5 text-xs text-accent">
				<span class="i-solar-refresh-bold-duotone h-3.5 w-3.5 animate-spin"></span>
				{ingestingCount(library.docs)} document{ingestingCount(library.docs) === 1 ? '' : 's'} ingesting…
			</p>
		{/if}

		{#if library.error}
			<div class="rounded border border-paper-edge bg-paper-soft px-3 py-2 text-sm text-ink-soft">
				{library.error}
			</div>
		{/if}

		{#if library.loading && library.docs.length === 0}
			<p class="text-sm text-ink-mute">Loading documents…</p>
		{:else if library.docs.length === 0}
			<Empty
				icon="i-solar-folder-with-files-bold-duotone"
				message="Nothing here yet — upload a document to get started."
			/>
		{:else}
			<Card flush class="divide-y divide-paper-edge">
				{#each library.docs as d (d.document_id)}
					{@const badge = statusBadge(d.status)}
					<button
						data-doc-row
						type="button"
						onclick={() => library.select(d.document_id)}
						aria-current={library.selectedId === d.document_id ? 'true' : undefined}
						class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-mute/50 {library.selectedId ===
						d.document_id
							? 'bg-paper-mute'
							: ''}"
					>
						<span class="{docIcon(d.content_type)} h-5 w-5 flex-shrink-0 text-ink-soft"></span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium text-ink">{docTitle(d)}</span>
							<span class="block truncate font-mono text-xs text-ink-mute"
								>{d.original_filename}</span
							>
						</span>
						<span
							data-ingest-status
							class="inline-flex flex-shrink-0 items-center gap-1.5 text-xs {ingColor(badge.tone)}"
						>
							<span
								class="h-1.5 w-1.5 rounded-full bg-current {badge.spinning ? 'animate-pulse' : ''}"
							></span>
							{badge.label}
						</span>
						<Chip tone={clfTone(d.classification)} class="flex-shrink-0">{d.classification}</Chip>
						<span
							class="hidden w-16 flex-shrink-0 text-right font-mono text-xs text-ink-mute sm:block"
							>{d.chunk_count ?? '—'} chunks</span
						>
						<span class="hidden flex-shrink-0 font-mono text-xs text-ink-faint lg:block"
							>{fmtWhen(d.created_at)}</span
						>
					</button>
				{/each}
			</Card>
		{/if}
	</div>

	<!-- detail drawer — keyed on the selection so Back/close work while the detail is still loading -->
	{#if library.selectedId}
		<div data-doc-detail class="absolute inset-0 z-20 flex">
			<button
				type="button"
				class="flex-1 bg-ink/20"
				aria-label="Close document detail"
				onclick={() => library.closeDetail()}
			></button>
			<aside
				class="flex w-[440px] max-w-full flex-col overflow-auto border-l border-paper-edge bg-paper shadow-xl"
			>
				<div class="flex items-center border-b border-paper-edge px-5 py-3">
					<button
						type="button"
						onclick={() => library.closeDetail()}
						class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-mute hover:bg-paper-mute hover:text-ink"
					>
						<span class="i-solar-arrow-left-linear h-4 w-4"></span> Back
					</button>
				</div>

				{#if library.detailLoading || !library.detail}
					<p class="px-5 py-6 text-sm text-ink-mute">Loading…</p>
				{:else}
					{@const detail = library.detail}
					{@const steps = pipelineSteps(detail.status)}
					<div class="flex flex-col gap-5 px-5 py-4">
						<!-- title + classification + meta -->
						<div>
							<div class="flex items-start gap-2">
								<span
									class="{docIcon(detail.content_type)} mt-0.5 h-5 w-5 flex-shrink-0 text-ink-soft"
								></span>
								<h2 class="min-w-0 flex-1 text-base font-medium text-ink">{docTitle(detail)}</h2>
								<Chip tone={clfTone(detail.classification)}>{detail.classification}</Chip>
							</div>
							<p class="mt-1 font-mono text-xs text-ink-mute">
								v{detail.versions.length} · {detail.chunk_count ?? '—'} chunks · {detail.embedding_model ??
									'no embedding model'}
							</p>
						</div>

						<!-- ingestion pipeline stepper -->
						<div>
							<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
								Ingestion pipeline
							</div>
							<div class="flex flex-wrap items-center gap-x-1.5 gap-y-2">
								{#each steps as step, i (step.name)}
									<span class="inline-flex items-center gap-1.5">
										<span
											class="grid h-5 w-5 place-items-center rounded-full border {step.state ===
											'done'
												? 'border-accent bg-accent-soft'
												: step.state === 'failed'
													? 'border-warning bg-warning-soft'
													: step.state === 'current'
														? 'border-accent'
														: 'border-paper-edge'}"
										>
											{#if step.state === 'done'}
												<span class="i-solar-check-read-linear h-3 w-3 text-accent"></span>
											{:else if step.state === 'failed'}
												<span class="i-solar-danger-triangle-bold h-3 w-3 text-warning"></span>
											{:else if step.state === 'current'}
												<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"></span>
											{:else}
												<span class="h-1.5 w-1.5 rounded-full bg-ink-faint"></span>
											{/if}
										</span>
										<span
											class="text-xs capitalize {step.state === 'pending'
												? 'text-ink-faint'
												: step.state === 'failed'
													? 'text-warning'
													: 'text-ink-soft'}">{step.name}</span
										>
									</span>
									{#if i < steps.length - 1}<span class="h-px w-3 bg-paper-edge"></span>{/if}
								{/each}
							</div>

							{#if detail.status === 'failed'}
								<div
									class="mt-3 rounded border border-paper-edge bg-warning-soft px-3 py-2 text-xs text-warning"
								>
									{detail.status_reason ?? 'Ingestion failed.'}
								</div>
								<button
									type="button"
									onclick={() => library.reingest(detail.document_id)}
									class="mt-2 inline-flex items-center gap-1.5 rounded border border-paper-edge bg-paper-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-mute"
								>
									<span class="i-solar-refresh-bold-duotone h-3.5 w-3.5"></span> Re-process
								</button>
							{/if}
						</div>

						<!-- extracted assets -->
						<div>
							<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
								Extracted assets
							</div>
							{#if library.assets.length === 0}
								<p class="text-xs text-ink-faint">No extracted assets.</p>
							{:else}
								<ul class="flex flex-col gap-1.5">
									{#each library.assets as a (a.id)}
										<li class="flex items-center gap-2 text-xs">
											<span class="rounded bg-paper-mute px-1.5 py-0.5 font-mono text-ink-mute"
												>{a.kind}</span
											>
											<span class="min-w-0 flex-1 truncate text-ink-soft">{a.label ?? a.kind}</span>
											{#if a.download_url}
												<!-- eslint-disable svelte/no-navigation-without-resolve -- external server-minted signed storage URL, not an app route -->
												<a
													href={a.download_url}
													target="_blank"
													rel="noreferrer"
													class="text-accent hover:underline">download</a
												>
												<!-- eslint-enable svelte/no-navigation-without-resolve -->
											{:else}
												<span class="text-ink-faint">—</span>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</div>

						<!-- versions -->
						<div>
							<div class="mb-2 text-xs font-medium uppercase tracking-widest text-ink-mute">
								Versions
							</div>
							<ul class="flex flex-col gap-1.5">
								{#each detail.versions as v (v.version_id)}
									<li class="flex items-center gap-2 font-mono text-xs text-ink-mute">
										<span class="text-ink-soft">v{v.version_no}</span>
										<span>· {fmtWhen(v.created_at)} ·</span>
										<span class={v.superseded_at ? 'text-ink-faint' : 'text-accent'}
											>{v.superseded_at ? 'superseded' : 'current'}</span
										>
									</li>
								{/each}
							</ul>
						</div>

						<!-- delete -->
						<div class="border-t border-paper-edge pt-4">
							<button
								type="button"
								onclick={() => library.remove(detail.document_id)}
								class="inline-flex items-center gap-1.5 rounded border border-paper-edge px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
							>
								<span class="i-solar-trash-bin-trash-bold-duotone h-3.5 w-3.5"></span> Delete document
							</button>
						</div>
					</div>
				{/if}
			</aside>
		</div>
	{/if}

	<!-- deferred (no backend): collections/tags filter, bulk-select bar, storage meter,
	     Chunks/Comments/Lineage tabs, the §3c "ask the data" card, markdown/table/image preview -->
</section>
