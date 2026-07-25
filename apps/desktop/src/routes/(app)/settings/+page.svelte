<script>
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { PageHeader, Card, CardHead } from '@torii/ui'
	import { session } from '@torii/core'

	const user = $derived(session.user ?? { name: 'Member', role: 'member', email: '' })

	async function signout() {
		await session.signOut()
		goto(resolve('/signin'))
	}
</script>

<section class="flex h-full flex-col overflow-auto">
	<PageHeader eyebrow="You" title="Settings" sub="Your identity and preferences on this device." />

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
			<div class="flex items-center gap-4 px-5 py-4">
				<span class="i-solar-pallete-2-bold-duotone h-5 w-5 text-ink-mute"></span>
				<div class="flex-1 text-sm text-ink">
					Theme
					<span class="text-ink-mute">— toggle light / dark from the title bar (top right).</span>
				</div>
			</div>
		</Card>

		<p class="px-1 font-mono text-[11px] text-ink-faint">
			gateway · healthy · policies for the whole workspace are managed by your administrator.
		</p>
	</div>
</section>
