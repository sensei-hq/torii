<script>
	// Seiki admin sign-in — modelled on docs/mockups/app/view-signin.jsx (Zen-Sumi):
	// brand header + eyebrow, a routing diagram + value props on the left, the sign-in
	// card on the right. Auth is the REAL Supabase email/password (api.signIn); OAuth /
	// magic-link / SAML are shown as honest fast-follow (disabled) until wired.
	import { goto } from '$app/navigation'
	import { api } from '$lib/api'

	let email = $state('')
	let password = $state('')
	let error = $state('')
	let loading = $state(false)

	async function submit() {
		if (loading) return
		loading = true
		error = ''
		try {
			await api.signIn(email, password)
			goto('/')
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	const PROVIDERS = [
		{ key: 'anthropic', label: 'anthropic', y: 38, hue: 'oklch(0.70 0.13 45)' },
		{ key: 'google', label: 'google', y: 92, hue: 'oklch(0.62 0.16 254)' },
		{ key: 'openai', label: 'openai', y: 146, hue: 'oklch(0.62 0.08 160)' },
		{ key: 'local', label: 'local', y: 200, hue: 'oklch(0.58 0.01 50)' }
	]
	const PATH = {
		38: 'M160 38 C 232 38, 244 116, 272 116',
		92: 'M160 92 C 222 92, 244 116, 272 116',
		146: 'M160 146 C 222 146, 244 116, 272 116',
		200: 'M160 200 C 232 200, 244 116, 272 116'
	}
	const VALUE = [
		{
			ic: 'i-solar-routing-2-bold-duotone',
			t: 'Route across every provider',
			s: 'One endpoint. Step-down routing and a free-tier floor pick the cheapest model that still answers well.'
		},
		{
			ic: 'i-solar-wallet-2-bold-duotone',
			t: 'Spend with intent',
			s: 'Org, team and user budgets with hard caps — every call reserved and committed against a ledger.'
		},
		{
			ic: 'i-solar-shield-check-bold-duotone',
			t: 'Govern with confidence',
			s: 'Role-based access and a full request ledger — every call traceable, every key accounted for.'
		}
	]
</script>

<div class="min-h-screen overflow-auto bg-paper">
	<div class="mx-auto max-w-[1100px] px-[clamp(20px,5vw,48px)] py-12">
		<!-- header · spans both columns -->
		<header class="flex flex-wrap items-center justify-between gap-4 border-b border-paper-edge pb-3">
			<span class="flex items-center gap-3">
				<img src="/logo.svg" alt="" class="h-8 w-8" />
				<span class="font-heading text-[28px] tracking-tight text-ink">Seiki</span>
				<span
					class="rounded-full border border-paper-edge px-2 py-0.5 font-mono text-[11px] text-ink-mute"
					>v1.0</span
				>
			</span>
			<div class="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
				Admin portal · define · manage · control · inspect
			</div>
		</header>

		<div class="grid items-start gap-12 pt-12 md:grid-cols-[1.05fr_0.95fr] md:gap-[clamp(48px,7vw,96px)]">
			<!-- left · routing diagram + value props (hidden on small screens) -->
			<section class="hidden min-w-0 md:block">
				<p class="mb-6 max-w-[460px] text-sm leading-relaxed text-ink-soft">
					Seiki routes every request across Anthropic, Google, OpenAI and your local models — then
					keeps spend, access and answer quality under one roof.
				</p>
				<div class="rounded-lg border border-paper-edge bg-paper-soft p-5">
					<svg viewBox="0 0 420 232" class="block h-auto w-full" fill="none" aria-label="Seiki routes requests from many providers through one gateway to your apps">
						{#each PROVIDERS as p (p.key)}
							<path d={PATH[p.y]} stroke="var(--paper-edge)" stroke-width="1.5" />
						{/each}
						{#each PROVIDERS as p (p.key)}
							<path
								class="flow"
								d={PATH[p.y]}
								stroke="var(--accent)"
								stroke-width="1.5"
								stroke-linecap="round"
								opacity="0.55"
							/>
						{/each}
						{#each PROVIDERS as p (p.key)}
							<circle cx="16" cy={p.y} r="5" fill={p.hue} />
							<text x="30" y={p.y + 4} font-family="var(--font-mono)" font-size="12.5" fill="var(--ink-soft)"
								>{p.label}</text
							>
							<circle cx="160" cy={p.y} r="2.5" fill="var(--ink-faint)" />
						{/each}
						<circle cx="300" cy="116" r="29" fill="var(--accent-soft)" />
						<circle cx="300" cy="116" r="29" stroke="var(--paper-edge)" stroke-width="1" />
						<circle cx="300" cy="116" r="9" stroke="var(--ink)" stroke-width="1.5" />
						<circle cx="300" cy="116" r="3" fill="var(--accent)" />
						<text x="300" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="10" letter-spacing="0.14em" fill="var(--ink-mute)">GATEWAY</text>
						<path d="M331 116 H 398" stroke="var(--ink-faint)" stroke-width="1.5" />
						<path d="M392 110 L 400 116 L 392 122" stroke="var(--ink-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
						<text x="382" y="103" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-mute)">your apps</text>
					</svg>
				</div>

				<div class="mt-6 flex flex-col gap-4">
					{#each VALUE as v (v.t)}
						<div class="grid grid-cols-[36px_1fr] items-start gap-3">
							<span class="grid h-9 w-9 place-items-center rounded-md border border-paper-edge bg-paper-soft">
								<span class="{v.ic} h-[18px] w-[18px] text-accent"></span>
							</span>
							<span>
								<span class="block text-sm font-semibold text-ink">{v.t}</span>
								<span class="mt-0.5 block text-sm leading-snug text-ink-mute">{v.s}</span>
							</span>
						</div>
					{/each}
				</div>
			</section>

			<!-- right · sign in -->
			<main class="flex min-w-0 justify-center md:justify-end">
				<div class="w-full max-w-[400px]">
					<div class="rounded-lg border border-paper-edge bg-paper-soft p-6">
						<h1 class="mb-5 text-center font-heading text-xl text-ink">Sign in to the admin portal</h1>

						<form
							onsubmit={(e) => {
								e.preventDefault()
								submit()
							}}
							class="space-y-3"
						>
							<div>
								<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
									>Work email</span
								>
								<input
									bind:value={email}
									type="email"
									placeholder="you@company.com"
									autocomplete="username"
									class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
								/>
							</div>
							<div>
								<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
									>Password</span
								>
								<input
									bind:value={password}
									type="password"
									placeholder="••••••••"
									autocomplete="current-password"
									class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
								/>
							</div>
							{#if error}
								<p class="text-xs text-danger">{error}</p>
							{/if}
							<button
								type="submit"
								disabled={loading || !email || !password}
								class="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-on-primary disabled:opacity-40"
							>
								{loading ? 'Signing in…' : 'Sign in'}
							</button>
						</form>

						<div class="my-4 flex items-center gap-3">
							<span class="h-px flex-1 bg-paper-edge"></span>
							<span class="font-mono text-[10px] uppercase tracking-wider text-ink-mute">or</span>
							<span class="h-px flex-1 bg-paper-edge"></span>
						</div>

						<div class="flex flex-col gap-2">
							<button
								disabled
								title="Fast-follow — not yet enabled"
								class="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-paper-edge text-sm text-ink-soft opacity-60"
							>
								<span class="i-solar-global-bold-duotone h-4 w-4"></span> Continue with Google
							</button>
							<button
								disabled
								title="Fast-follow — not yet enabled"
								class="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-paper-edge text-sm text-ink-soft opacity-60"
							>
								<span class="i-lucide-github h-4 w-4"></span> Continue with GitHub
							</button>
						</div>
					</div>

					<p class="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-faint">
						<span class="i-solar-shield-check-bold-duotone h-3 w-3"></span>
						Email + OAuth · SAML SSO fast-follow · session pinned to your tenant region
					</p>
				</div>
			</main>
		</div>
	</div>
</div>

<style>
	.flow {
		stroke-dasharray: 5 90;
		stroke-dashoffset: 0;
	}
	@media (prefers-reduced-motion: no-preference) {
		.flow {
			animation: flow 2.6s linear infinite;
		}
	}
	@keyframes flow {
		to {
			stroke-dashoffset: -95;
		}
	}
</style>
