<script>
	import { ThemeSwitcherToggle } from '@rokkit/app'
	import EnvChip from './EnvChip.svelte'

	let { user, onsearch, onsignout } = $props()

	const initials = $derived(
		user?.name
			? user.name
					.split(' ')
					.map((w) => w[0])
					.join('')
					.toUpperCase()
					.slice(0, 2)
			: '??'
	)
</script>

<div data-title-bar class="flex items-center gap-2 border-b border-paper-edge px-3 py-1.5">
	<!-- Brand mark -->
	<span class="text-sm font-semibold text-primary-500">Strategos</span>

	<EnvChip />

	<span class="flex-1"></span>

	<!-- Search / ⌘K hint -->
	<button
		type="button"
		onclick={() => onsearch?.()}
		class="inline-flex items-center gap-1.5 rounded border border-paper-edge px-2 py-0.5 text-xs text-ink-mute"
		aria-label="Search"
	>
		<span class="i-lucide:search h-3 w-3" aria-hidden="true"></span>
		<span class="hidden sm:inline">Search…</span>
		<kbd class="hidden text-ink-mute sm:inline">⌘K</kbd>
	</button>

	<!-- Theme toggle -->
	<ThemeSwitcherToggle size="sm" />

	<!-- User menu -->
	<div class="flex items-center gap-1.5">
		<span
			class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-paper-soft text-xs text-ink-soft"
			aria-hidden="true"
		>
			{initials}
		</span>
		<span class="hidden text-xs text-ink-soft sm:inline">
			<span>{user?.name}</span>
			<span class="text-ink-mute"> · {user?.role}</span>
		</span>
		<button
			type="button"
			onclick={() => onsignout?.()}
			class="ml-1 inline-flex items-center text-ink-mute"
			aria-label="Sign out"
		>
			<span class="i-lucide:log-out h-3.5 w-3.5" aria-hidden="true"></span>
		</button>
	</div>
</div>
