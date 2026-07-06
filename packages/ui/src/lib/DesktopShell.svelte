<script>
	import { onMount } from 'svelte'
	import { commands } from '@rokkit/states'
	import { shortcuts } from '@rokkit/actions'
	import { CommandPalette } from '@rokkit/ui'
	import TitleBar from './TitleBar.svelte'
	import NavRail from './NavRail.svelte'
	import DeviceFooter from './DeviceFooter.svelte'
	import { registerShellCommands } from './commands.js'

	let {
		user,
		items = [],
		active,
		version = 0,
		localModels = 0,
		onnavigate,
		onsignout,
		children
	} = $props()

	let paletteOpen = $state(false)

	onMount(() => {
		const unregisterPalette = commands.register({
			id: 'palette.open',
			label: 'Open command palette',
			shortcut: 'mod+k',
			global: true,
			group: 'general',
			run: () => {
				paletteOpen = true
			}
		})
		const unregisterNav = registerShellCommands({ goto: onnavigate, items })
		return () => {
			unregisterPalette()
			unregisterNav()
		}
	})
</script>

<div data-desktop-shell class="grid h-full grid-rows-[auto_1fr]" use:shortcuts={commands}>
	<TitleBar {user} onsearch={() => (paletteOpen = true)} {onsignout} />
	<div class="grid grid-cols-[13rem_1fr] overflow-hidden">
		<NavRail {items} {active} appName="Strategos" {version} {onnavigate}>
			{#snippet footer()}
				<DeviceFooter {localModels} configVersion={version} />
			{/snippet}
		</NavRail>
		<section class="overflow-auto">
			{@render children?.()}
		</section>
	</div>
</div>

<CommandPalette bind:open={paletteOpen} />
