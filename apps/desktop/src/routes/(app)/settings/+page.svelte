<script>
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { PageHeader, Card, CardHead } from '@torii/ui'
	import { session } from '@torii/core'
	import { settings } from '$lib/settings.svelte.js'
	import { THEME_OPTIONS, TIER_OPTIONS, CITE_OPTIONS } from '$lib/settings'

	const user = $derived(session.user ?? { name: 'Member', role: 'member', email: '' })

	// Load seam (runbook B4): hydrate prefs from localStorage. Client-local — there is no
	// server prefs endpoint yet (W2 spec §3.2 is a fast-follow), so this device is the source.
	onMount(() => settings.load())

	const prefs = $derived(settings.prefs)

	async function signout() {
		await session.signOut()
		goto(resolve('/signin'))
	}
</script>

{#snippet segmented(options, value, onpick)}
	<div class="inline-flex overflow-hidden rounded-md border border-paper-edge bg-paper">
		{#each options as o, i (o.value)}
			<button
				type="button"
				onclick={() => onpick(o.value)}
				aria-pressed={value === o.value}
				class="h-[30px] px-3 text-xs font-medium transition-colors {i
					? 'border-l border-paper-edge'
					: ''} {value === o.value
					? 'bg-ink text-on-primary'
					: 'text-ink-soft hover:bg-paper-mute'}"
			>
				{o.label}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet toggle(on, onpick, label, locked)}
	<button
		type="button"
		role="switch"
		aria-checked={on}
		aria-label={label}
		disabled={locked}
		onclick={() => onpick(!on)}
		class="relative h-5 w-[34px] shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-70 {on
			? 'border-accent bg-accent'
			: 'border-paper-edge bg-paper-mute'}"
	>
		<span
			class="absolute left-[1px] top-[1px] h-4 w-4 rounded-full bg-paper transition-transform {on
				? 'translate-x-[14px]'
				: ''}"
		></span>
	</button>
{/snippet}

{#snippet row(icon, title, desc, locked)}
	<span class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md bg-paper-mute">
		<span class="{icon} h-[17px] w-[17px] {locked ? 'text-ink-mute' : 'text-ink-soft'}"></span>
	</span>
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2">
			<span class="text-sm font-semibold text-ink">{title}</span>
			{#if locked}
				<span
					class="inline-flex items-center gap-1 rounded-sm border border-paper-edge px-1.5 py-0.5 text-[11px] text-ink-mute"
					title="Set by your administrator"
				>
					<span class="i-solar-lock-keyhole-minimalistic-bold-duotone h-3 w-3"></span> admin
				</span>
			{/if}
		</div>
		<div class="mt-0.5 text-xs text-ink-soft">{desc}</div>
	</div>
{/snippet}

<section class="flex h-full flex-col overflow-auto">
	<PageHeader
		eyebrow="You"
		title="Settings"
		sub="How Torii behaves for you on this device. Workspace-wide policies are set by an administrator — those show a lock and can't be changed here."
	/>

	<div class="space-y-4 px-5 pb-6">
		<Card flush>
			<CardHead title="Account" />
			<div class="flex items-center gap-4 px-5 py-4">
				<span
					class="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-lg font-semibold text-accent"
					>{(user.name ?? '?')[0].toUpperCase()}</span
				>
				<div class="min-w-0 flex-1">
					<div class="text-sm font-semibold text-ink">{user.name}</div>
					<div class="font-mono text-[11px] text-ink-mute">
						{user.email || '—'} · {user.role}
					</div>
				</div>
				<button
					onclick={signout}
					class="inline-flex items-center gap-2 rounded-md border border-paper-edge px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-mute"
				>
					<span class="i-solar-logout-3-bold-duotone h-4 w-4"></span> Sign out
				</button>
			</div>
		</Card>

		<Card flush>
			<CardHead title="Appearance" />
			<div class="flex items-center gap-4 border-t border-paper-edge px-5 py-4 first:border-t-0">
				{@render row('i-solar-moon-bold-duotone', 'Theme', 'Light or dark — applies across Torii.')}
				{@render segmented(THEME_OPTIONS, settings.theme, (v) => settings.setTheme(v))}
			</div>
		</Card>

		<Card flush>
			<CardHead title="Answering" meta="saved on this device" />
			<div class="flex items-center gap-4 px-5 py-4">
				{@render row(
					'i-solar-scale-bold-duotone',
					'Preferred tier',
					'How the gateway balances quality against cost for you.'
				)}
				{@render segmented(TIER_OPTIONS, prefs.tier, (v) => settings.setTier(v))}
			</div>
			<div class="flex items-center gap-4 border-t border-paper-edge px-5 py-4">
				{@render row(
					'i-solar-bookmark-bold-duotone',
					'Citation density',
					'How many sources to attach to an answer.'
				)}
				{@render segmented(CITE_OPTIONS, prefs.cites, (v) => settings.setCites(v))}
			</div>
			<div class="flex items-center gap-4 border-t border-paper-edge px-5 py-4">
				{@render row(
					'i-solar-history-bold-duotone',
					'Context retention',
					'Carry prior turns into the next question by default.'
				)}
				{@render toggle(
					prefs.retention,
					(v) => settings.setRetention(v),
					'Context retention',
					false
				)}
			</div>
			<div class="flex items-center gap-4 border-t border-paper-edge px-5 py-4">
				{@render row(
					'i-solar-magic-stick-3-bold-duotone',
					'Auto-tune prompts',
					'Rewrite prompts for the chosen model before sending.'
				)}
				{@render toggle(prefs.autotune, (v) => settings.setAutotune(v), 'Auto-tune prompts', false)}
			</div>
			<div class="flex items-center gap-4 border-t border-paper-edge px-5 py-4">
				{@render row(
					'i-solar-shield-check-bold-duotone',
					'PII & tenant masking',
					'Mask tenant names and PII on every call.',
					true
				)}
				{@render toggle(true, () => {}, 'PII and tenant masking (locked)', true)}
			</div>
		</Card>

		<Card flush>
			<CardHead title="Notifications & drafts" meta="saved on this device" />
			<div class="flex items-center gap-4 px-5 py-4">
				{@render row(
					'i-solar-bell-bold-duotone',
					'Weekly digest',
					'A Monday summary of activity in your spaces.'
				)}
				{@render toggle(prefs.digest, (v) => settings.setDigest(v), 'Weekly digest', false)}
			</div>
			<div class="flex items-center gap-4 border-t border-paper-edge px-5 py-4">
				{@render row(
					'i-solar-pen-new-square-bold-duotone',
					'Autosave drafts',
					'Keep generated docs as drafts in the active space.'
				)}
				{@render toggle(prefs.autosave, (v) => settings.setAutosave(v), 'Autosave drafts', false)}
			</div>
		</Card>

		<p class="px-1 font-mono text-[11px] text-ink-faint">
			Preferences are stored on this device · locked settings are governed by your administrator.
		</p>
	</div>
</section>
