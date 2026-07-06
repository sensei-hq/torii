import { commands } from '@rokkit/states'

/**
 * Register per-item "Go to {item}" navigation commands in the global registry.
 * Returns the unregister cleanup callback (call it in onMount return or $effect cleanup).
 */
export function registerShellCommands({
	goto,
	items
}: {
	goto?: (item: string) => void
	items: string[]
}): () => void {
	return commands.registerMany(
		items.map((item) => ({
			id: `nav.${item.toLowerCase()}`,
			label: `Go to ${item}`,
			group: 'navigation',
			keywords: [item.toLowerCase()],
			run: () => goto?.(item)
		}))
	)
}
