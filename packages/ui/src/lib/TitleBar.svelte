<script>
	import { ThemeSwitcherToggle } from '@rokkit/app'
	import EnvChip from './EnvChip.svelte'
	import BrandMark from './BrandMark.svelte'

	let { user, brand = 'Torii', title = 'workspace', onsearch, onsignout } = $props()

	const initial = $derived(user?.name ? user.name[0].toUpperCase() : '?')
</script>

<div
	data-title-bar
	class="flex h-[42px] flex-shrink-0 items-center gap-3 border-b border-paper-edge bg-paper px-4"
>
	<BrandMark size={20} />
	<span class="font-heading text-sm text-ink">{brand}</span>
	<EnvChip />

	<div class="flex-1 text-center text-xs tracking-wide text-ink-mute">{brand} · {title}</div>

	<button
		type="button"
		onclick={() => onsearch?.()}
		class="inline-flex items-center gap-1.5 rounded-md border border-paper-edge px-2 py-1 text-[11px] text-ink-mute hover:bg-paper-mute"
		aria-label="Search"
	>
		<span class="i-solar-magnifer-bold-duotone h-3.5 w-3.5" aria-hidden="true"></span>
		<span class="hidden sm:inline">Search</span>
		<kbd class="hidden text-ink-faint sm:inline">⌘K</kbd>
	</button>

	<ThemeSwitcherToggle size="sm" />

	<span class="mx-1 h-4 w-px bg-paper-edge"></span>

	<span class="flex items-center gap-2" title={user?.role}>
		<span
			class="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent-soft text-[9px] font-semibold text-accent"
			aria-hidden="true">{initial}</span
		>
		<span class="hidden whitespace-nowrap text-[11px] text-ink-soft sm:inline"
			>{user?.name} · {user?.role}</span
		>
	</span>
	<button
		type="button"
		onclick={() => onsignout?.()}
		class="rounded-md p-1.5 text-ink-mute hover:bg-paper-mute"
		aria-label="Sign out"
	>
		<span class="i-solar-logout-3-bold-duotone h-4 w-4" aria-hidden="true"></span>
	</button>
</div>
