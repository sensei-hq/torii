<script>
	// Zen-Sumi admin shell — Chrome top bar + grouped Rail sidebar, modelled on
	// docs/mockups/app/{admin,shell}.jsx. Uses Rokkit named tokens throughout.
	import { getContext } from 'svelte'
	import { page } from '$app/state'
	// Light/dark switcher — drives vibe.mode; the `themable` action in the root layout
	// writes data-mode to <html>/<body> and persists it (skin-system-rokkit skill).
	import { vibe } from '@rokkit/states'
	const toggleMode = () => {
		vibe.mode = vibe.mode === 'dark' ? 'light' : 'dark'
	}

	let {
		app = 'admin',
		title = 'admin portal',
		brand = 'Seiki',
		org: orgProp,
		user: userProp,
		onSignout: onSignoutProp,
		children
	} = $props()

	// Real identity + org + sign-out come from the (app) layout via the `adminShell`
	// context (see apps/admin/.../(app)/+layout.svelte). Props remain a fallback for
	// standalone use; the fallbacks are neutral labels — never fabricated data.
	const shell = getContext('adminShell')
	const user = $derived(shell?.user ?? userProp ?? { name: 'Account', initial: '·', role: '' })
	const org = $derived(shell?.org ?? orgProp ?? { mark: '·', name: 'Workspace', sub: 'organization' })
	const onSignout = $derived(shell?.onSignout ?? onSignoutProp)

	// Grouped nav — mirrors the mockup's Overview / Tenant / Gateway / Govern sections,
	// mapped to the routes that exist today (no dead links).
	const NAV = [
		{
			label: 'Overview',
			items: [
				{ href: '/', label: 'Overview', icon: 'i-solar-widget-5-bold-duotone' },
				{ href: '/requests', label: 'Requests & audit', icon: 'i-solar-clipboard-list-bold-duotone', live: true }
			]
		},
		{
			label: 'Tenant',
			items: [{ href: '/organization', label: 'Members & roles', icon: 'i-solar-buildings-3-bold-duotone' }]
		},
		{
			label: 'Gateway',
			items: [
				{ href: '/models', label: 'Models', icon: 'i-solar-cpu-bold-duotone' },
				{ href: '/routing', label: 'Routing', icon: 'i-solar-routing-2-bold-duotone' },
				{ href: '/connections', label: 'Connections', icon: 'i-solar-key-bold-duotone' },
				{ href: '/tools', label: 'Tools & MCP', icon: 'i-solar-plug-circle-bold-duotone' }
			]
		},
		{
			label: 'Govern',
			items: [
				{ href: '/governance', label: 'Governance', icon: 'i-solar-shield-keyhole-bold-duotone' },
				{ href: '/billing', label: 'Budgets & billing', icon: 'i-solar-wallet-2-bold-duotone' },
				{ href: '/settings', label: 'Settings', icon: 'i-solar-settings-bold-duotone' }
			]
		}
	]

	const path = $derived(page.url?.pathname ?? '/')
	/** @param {string} href */
	const isActive = (href) => (href === '/' ? path === '/' : path.startsWith(href))
</script>

<div data-app-shell class="grid h-full grid-rows-[auto_1fr]">
	<!-- Chrome top bar -->
	<header
		class="flex h-[42px] flex-shrink-0 items-center gap-3 border-b border-paper-edge bg-paper px-4"
	>
		<div class="flex gap-[7px]">
			<span class="h-3 w-3 rounded-full" style="background:oklch(0.72 0.14 28)"></span>
			<span class="h-3 w-3 rounded-full" style="background:oklch(0.82 0.13 85)"></span>
			<span class="h-3 w-3 rounded-full" style="background:oklch(0.72 0.11 145)"></span>
		</div>
		<div class="flex-1 text-center text-xs tracking-wide text-ink-mute">
			{brand} · {title}
		</div>
		<div class="flex items-center gap-1.5">
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-paper-edge px-2.5 py-1 text-[11px] text-ink-mute"
			>
				<span class="i-solar-cpu-bold-duotone h-3 w-3"></span>Desktop app
			</span>
			<span class="mx-1 h-4 w-px bg-paper-edge"></span>
			<button class="rounded-md p-1.5 text-ink-mute hover:bg-paper-mute" title="Search" aria-label="Search"
				><span class="i-solar-magnifer-bold-duotone h-4 w-4"></span></button
			>
			<button class="rounded-md p-1.5 text-ink-mute hover:bg-paper-mute" title="Notifications" aria-label="Notifications"
				><span class="i-solar-bell-bold-duotone h-4 w-4"></span></button
			>
			<button
				onclick={toggleMode}
				class="rounded-md p-1.5 text-ink-mute hover:bg-paper-mute"
				title="Toggle light / dark"
				aria-label="Toggle light or dark theme"
			>
				<span class="{vibe.mode === 'dark' ? 'i-solar-sun-2-bold-duotone' : 'i-solar-moon-bold-duotone'} block h-4 w-4"></span>
			</button>
			<span class="mx-1 h-4 w-px bg-paper-edge"></span>
			<span class="flex items-center gap-2" title={user.role}>
				<span
					class="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent-soft text-[9px] font-semibold text-accent"
					>{user.initial}</span
				>
				<span class="whitespace-nowrap text-[11px] text-ink-soft"
				>{user.name}{user.role ? ` · ${user.role}` : ''}</span
			>
			</span>
			{#if onSignout}
				<button
					class="rounded-md p-1.5 text-ink-mute hover:bg-paper-mute"
					title="Sign out" aria-label="Sign out"
					onclick={onSignout}><span class="i-solar-logout-3-bold-duotone h-4 w-4"></span></button
				>
			{/if}
		</div>
	</header>

	<div class="grid min-h-0 grid-cols-[15rem_1fr]">
		<!-- Rail sidebar -->
		<nav
			aria-label="Primary"
			class="flex flex-col overflow-y-auto border-r border-paper-edge bg-paper-soft px-3 py-4"
		>
			<!-- brand -->
			<div class="flex items-center gap-2.5 px-1.5">
				<img src="/logo.svg" alt="" class="h-[22px] w-[22px]" />
				<span class="font-heading text-[17px] tracking-tight text-ink">{brand}</span>
			</div>

			<!-- org header -->
			<div
				class="mt-4 flex items-center gap-2.5 rounded-lg border border-paper-edge bg-paper px-2.5 py-2"
			>
				<span
					class="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-paper-mute text-sm font-semibold text-ink"
					>{org.mark}</span
				>
				<div class="min-w-0">
					<div class="truncate text-sm font-semibold text-ink">{org.name}</div>
					<div class="font-mono text-[11px] text-ink-mute">{org.sub}</div>
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
							<a
								href={it.href}
								class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors {active
									? 'bg-paper-mute font-medium text-ink'
									: 'text-ink-soft hover:bg-paper-mute/60 hover:text-ink'}"
								aria-current={active ? 'page' : undefined}
							>
								<span
									class="{it.icon} h-[18px] w-[18px] flex-shrink-0 {active
										? 'text-accent'
										: 'text-ink-mute'}"
								></span>
								<span class="flex-1 truncate">{it.label}</span>
								{#if it.live}
									<span class="h-1.5 w-1.5 rounded-full bg-success"></span>
								{:else if it.end}
									<span class="font-mono text-[11px] text-ink-mute">{it.end}</span>
								{/if}
							</a>
						{/each}
					</div>
				</div>
			{/each}
			<span class="flex-1"></span>
			<div class="px-2 font-mono text-[10px] text-ink-faint">gateway · healthy · {app}</div>
		</nav>

		<!-- main content -->
		<main class="min-h-0 overflow-auto">{@render children?.()}</main>
	</div>
</div>
