<script>
	// Torii desktop console shell — TitleBar + grouped Rail, modelled on
	// docs/mockups/app/{app,shell}.jsx. Owns the console nav (Workspace / Tools / You),
	// the command palette, and shortcuts. Uses Rokkit named tokens + Solar icons.
	import { onMount } from 'svelte'
	import { page } from '$app/state'
	import { commands } from '@rokkit/states'
	import { shortcuts } from '@rokkit/actions'
	import { CommandPalette } from '@rokkit/ui'
	import TitleBar from './TitleBar.svelte'
	import DeviceFooter from './DeviceFooter.svelte'
	import { registerShellCommands } from './commands.js'

	let {
		user,
		brand = 'Torii',
		workspace = { mark: 'L', name: 'Leasing Ops', sub: 'teams workspace' },
		version = 0,
		localModels = 0,
		onnavigate,
		onsignout,
		children
	} = $props()

	const NAV = [
		{
			label: 'Workspace',
			items: [
				{ href: '/', label: 'Home', icon: 'i-solar-home-smile-bold-duotone' },
				{ href: '/ask', label: 'Ask', icon: 'i-solar-chat-round-line-bold-duotone' },
				{ href: '/library', label: 'Library', icon: 'i-solar-folder-with-files-bold-duotone' }
			]
		},
		{
			label: 'Tools',
			items: [
				{ href: '/playground', label: 'Playground', icon: 'i-solar-chat-square-code-bold-duotone' },
				{ href: '/workflows', label: 'Workflows', icon: 'i-solar-refresh-bold-duotone' },
				{ href: '/models', label: 'Local models', icon: 'i-solar-cpu-bold-duotone' }
			]
		},
		{
			label: 'You',
			items: [
				{ href: '/activity', label: 'Activity', icon: 'i-solar-history-bold-duotone' },
				{ href: '/settings', label: 'Settings', icon: 'i-solar-settings-bold-duotone' }
			]
		}
	]
	const flat = NAV.flatMap((g) => g.items)
	let paletteOpen = $state(false)
	const path = $derived(page.url?.pathname ?? '/')
	/** @param {string} href */
	const isActive = (href) => (href === '/' ? path === '/' : path.startsWith(href))

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
		const unregisterNav = registerShellCommands({
			goto: (label) => {
				const it = flat.find((i) => i.label === label)
				if (it) onnavigate?.(it.href)
			},
			items: flat.map((i) => i.label)
		})
		return () => {
			unregisterPalette()
			unregisterNav()
		}
	})
</script>

<div data-desktop-shell class="grid h-full grid-rows-[auto_1fr]" use:shortcuts={commands}>
	<TitleBar {user} {brand} title={workspace.name} onsearch={() => (paletteOpen = true)} {onsignout} />
	<div class="grid min-h-0 grid-cols-[15rem_1fr] overflow-hidden">
		<nav
			aria-label="Primary"
			class="flex flex-col overflow-y-auto border-r border-paper-edge bg-paper-soft px-3 py-4"
		>
			<!-- brand -->
			<div class="flex items-center gap-2.5 px-1.5">
				<img src="/logo.svg" alt="" class="h-[22px] w-[22px]" />
				<span class="font-heading text-[17px] tracking-tight text-ink">{brand}</span>
			</div>

			<!-- active workspace -->
			<div
				class="mt-4 flex items-center gap-2.5 rounded-lg border border-paper-edge bg-paper px-2.5 py-2"
			>
				<span
					class="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-accent-soft text-sm font-semibold text-accent"
					>{workspace.mark}</span
				>
				<div class="min-w-0">
					<div class="truncate text-sm font-semibold text-ink">{workspace.name}</div>
					<div class="font-mono text-[11px] text-ink-mute">{workspace.sub}</div>
				</div>
			</div>

			<!-- nav groups -->
			{#each NAV as group (group.label)}
				<div class="mt-5">
					<div
						class="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint"
					>
						{group.label}
					</div>
					<div class="flex flex-col gap-0.5">
						{#each group.items as it (it.href)}
							{@const active = isActive(it.href)}
							<button
								type="button"
								onclick={() => onnavigate?.(it.href)}
								aria-current={active ? 'page' : undefined}
								class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors {active
									? 'bg-paper-mute font-medium text-ink'
									: 'text-ink-soft hover:bg-paper-mute/60 hover:text-ink'}"
							>
								<span
									class="{it.icon} h-[18px] w-[18px] flex-shrink-0 {active
										? 'text-accent'
										: 'text-ink-mute'}"
								></span>
								<span class="flex-1 truncate">{it.label}</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
			<span class="flex-1"></span>
			<DeviceFooter {localModels} configVersion={version} />
		</nav>
		<section class="min-h-0 overflow-auto">{@render children?.()}</section>
	</div>
</div>

<CommandPalette bind:open={paletteOpen} />
