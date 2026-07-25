<script>
	import { PageHeader, Card, Glyph } from '@torii/ui'
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="Workspace"
		title="Library"
		sub="Your documents — uploaded, parsed, chunked and embedded so the gateway can ground answers in them."
	/>
	<div class="px-5 pb-6">
		<Card pad>
			<div class="flex items-center gap-4">
				<Glyph icon="i-solar-folder-with-files-bold-duotone" size={40} tone="accent" />
				<div>
					<p class="text-sm font-medium text-ink">Document workspace — coming soon</p>
					<p class="mt-1 text-[13px] text-ink-mute">
						Collections, versions & lineage, an extracted-asset browser (markdown / tables / images),
						ingestion status, and a preview pane. Secrets and PII are redacted at rest before
						embedding.
					</p>
				</div>
			</div>
		</Card>
	</div>
</section>
