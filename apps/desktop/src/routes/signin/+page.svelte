<script>
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import { session } from '@torii/core'

	let email = $state('')
	let password = $state('')
	let error = $state('')
	let loading = $state(false)

	const VALUE = [
		{
			icon: '→',
			title: 'Route across every provider',
			body: 'One endpoint. Step-down routing picks the best model for the budget.'
		},
		{
			icon: '◎',
			title: 'Spend with intent',
			body: 'Org, team and user budgets with hard caps. Blended cost tracked per call.'
		},
		{
			icon: '◈',
			title: 'Govern with confidence',
			body: 'Role-based access and a full request ledger — every call traceable.'
		}
	]

	async function handleSubmit(e) {
		e.preventDefault()
		if (loading) return
		loading = true
		error = ''
		const { error: err } = await session.signInWithPassword(email, password)
		loading = false
		if (err) {
			error = err.message
			return
		}
		goto(resolve('/'))
	}
</script>

<div class="sgn-root">
	<div class="sgn-wrap">
		<!-- header -->
		<header class="sgn-head">
			<div class="flex items-center justify-between gap-4 flex-wrap">
				<span class="text-lg font-semibold tracking-tight text-ink">Strategos</span>
				<span class="text-xs font-medium tracking-widest text-accent uppercase">
					AI gateway · routing &amp; governance
				</span>
			</div>
			<h1 class="mt-6 text-3xl font-semibold leading-tight text-ink">
				One endpoint for every model.
			</h1>
		</header>

		<div class="sgn-body">
			<!-- left: routing graphic + value props -->
			<section class="sgn-intro">
				<p class="text-sm text-ink-soft mb-5" style="max-width:460px">
					Strategos routes every request across Anthropic, Google, OpenAI and your local models —
					then keeps spend, access and answer quality under one roof.
				</p>

				<div class="rounded border border-paper-edge bg-paper-soft p-5">
					<svg
						class="w-full h-auto"
						viewBox="0 0 420 232"
						role="img"
						aria-label="Strategos routes requests from many model providers through one gateway to your apps."
						fill="none"
					>
						<!-- connectors base -->
						<path
							d="M160 38 C 232 38, 244 116, 272 116"
							stroke="var(--paper-edge)"
							stroke-width="1.5"
						/>
						<path
							d="M160 92 C 222 92, 244 116, 272 116"
							stroke="var(--paper-edge)"
							stroke-width="1.5"
						/>
						<path
							d="M160 146 C 222 146, 244 116, 272 116"
							stroke="var(--paper-edge)"
							stroke-width="1.5"
						/>
						<path
							d="M160 200 C 232 200, 244 116, 272 116"
							stroke="var(--paper-edge)"
							stroke-width="1.5"
						/>
						<!-- animated flow lines -->
						<path
							class="sgn-flow"
							d="M160 38 C 232 38, 244 116, 272 116"
							stroke="var(--accent)"
							stroke-width="1.5"
							stroke-linecap="round"
							opacity="0.55"
						/>
						<path
							class="sgn-flow"
							d="M160 92 C 222 92, 244 116, 272 116"
							stroke="var(--accent)"
							stroke-width="1.5"
							stroke-linecap="round"
							opacity="0.55"
						/>
						<path
							class="sgn-flow"
							d="M160 146 C 222 146, 244 116, 272 116"
							stroke="var(--accent)"
							stroke-width="1.5"
							stroke-linecap="round"
							opacity="0.55"
						/>
						<path
							class="sgn-flow"
							d="M160 200 C 232 200, 244 116, 272 116"
							stroke="var(--accent)"
							stroke-width="1.5"
							stroke-linecap="round"
							opacity="0.55"
						/>
						<!-- provider dots + labels -->
						<circle cx="16" cy="38" r="5" fill="var(--accent)" />
						<text x="30" y="42" font-family="monospace" font-size="12.5" fill="var(--ink-soft)"
							>anthropic</text
						>
						<circle cx="16" cy="92" r="5" fill="var(--success)" />
						<text x="30" y="96" font-family="monospace" font-size="12.5" fill="var(--ink-soft)"
							>google</text
						>
						<circle cx="16" cy="146" r="5" fill="var(--info)" />
						<text x="30" y="150" font-family="monospace" font-size="12.5" fill="var(--ink-soft)"
							>openai</text
						>
						<circle cx="16" cy="200" r="5" fill="var(--ink-faint)" />
						<text x="30" y="204" font-family="monospace" font-size="12.5" fill="var(--ink-soft)"
							>local</text
						>
						<!-- hub circle -->
						<circle cx="300" cy="116" r="29" fill="var(--accent-soft)" />
						<circle cx="300" cy="116" r="29" stroke="var(--paper-edge)" stroke-width="1" />
						<text
							x="300"
							y="120"
							text-anchor="middle"
							font-family="monospace"
							font-size="12"
							fill="var(--accent)"
							font-weight="600">SG</text
						>
						<text
							x="300"
							y="166"
							text-anchor="middle"
							font-family="monospace"
							font-size="10"
							letter-spacing="0.14em"
							fill="var(--ink-mute)">GATEWAY</text
						>
						<!-- output arrow -->
						<path d="M331 116 H 398" stroke="var(--ink-faint)" stroke-width="1.5" />
						<path
							d="M392 110 L 400 116 L 392 122"
							stroke="var(--ink-faint)"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<text
							x="382"
							y="103"
							text-anchor="end"
							font-family="monospace"
							font-size="11"
							fill="var(--ink-mute)">your apps</text
						>
					</svg>
				</div>

				<div class="flex flex-col gap-4 mt-6">
					{#each VALUE as v (v.title)}
						<div class="grid gap-3" style="grid-template-columns:36px 1fr">
							<span
								class="flex items-center justify-center w-9 h-9 rounded border border-paper-edge bg-paper-soft text-ink-mute text-base"
							>
								{v.icon}
							</span>
							<span>
								<span class="block text-sm font-semibold text-ink">{v.title}</span>
								<span class="block text-sm text-ink-mute mt-0.5 leading-relaxed">{v.body}</span>
							</span>
						</div>
					{/each}
				</div>
			</section>

			<!-- right: sign-in card -->
			<main class="sgn-main">
				<div class="w-full" style="max-width:400px">
					<div class="rounded border border-paper-edge bg-paper-soft p-6">
						<h2 class="text-xl font-semibold text-ink text-center">Sign in to your workspace</h2>
						<p class="text-sm text-ink-mute text-center mt-1.5 mb-5">Strategos Console · gateway</p>

						<form onsubmit={handleSubmit} class="flex flex-col gap-4">
							<div>
								<label
									class="block text-xs font-medium tracking-wide text-ink-soft mb-1.5"
									for="email"
								>
									Work email
								</label>
								<input
									id="email"
									type="email"
									autocomplete="email"
									required
									bind:value={email}
									placeholder="you@company.com"
									class="sgn-input"
								/>
							</div>
							<div>
								<label
									class="block text-xs font-medium tracking-wide text-ink-soft mb-1.5"
									for="password"
								>
									Password
								</label>
								<input
									id="password"
									type="password"
									autocomplete="current-password"
									required
									bind:value={password}
									class="sgn-input"
								/>
							</div>

							{#if error}
								<p class="text-sm text-danger bg-danger-soft rounded px-3 py-2">{error}</p>
							{/if}

							<button type="submit" disabled={loading} class="sgn-btn-primary">
								{loading ? 'Signing in…' : 'Sign in'}
							</button>
						</form>
					</div>

					<p class="text-center mt-4 text-xs text-ink-faint">
						Session pinned to your workspace · all traffic via the gateway
					</p>
				</div>
			</main>
		</div>
	</div>
</div>

<style>
	.sgn-root {
		position: fixed;
		inset: 0;
		background: var(--paper);
		overflow: auto;
	}
	.sgn-wrap {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2.5rem clamp(20px, 5vw, 48px);
	}
	.sgn-head {
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--paper-edge);
	}
	.sgn-body {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2.5rem;
		padding-top: 2.5rem;
		align-items: start;
	}
	.sgn-intro {
		display: none;
	}
	.sgn-main {
		display: flex;
		justify-content: center;
	}
	.sgn-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--paper-edge);
		background: var(--paper);
		color: var(--ink);
		font-size: 0.875rem;
		outline: none;
		transition: border-color 0.15s;
	}
	.sgn-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent-soft);
	}
	.sgn-btn-primary {
		width: 100%;
		padding: 0.625rem 1rem;
		border-radius: 0.375rem;
		background: var(--accent);
		color: var(--paper);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		border: none;
		transition: opacity 0.15s;
	}
	.sgn-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.sgn-btn-primary:hover:not(:disabled) {
		opacity: 0.9;
	}
	.sgn-flow {
		stroke-dasharray: 5 90;
		stroke-dashoffset: 0;
	}
	@media (prefers-reduced-motion: no-preference) {
		.sgn-flow {
			animation: sgn-flow 2.6s linear infinite;
		}
	}
	@keyframes sgn-flow {
		to {
			stroke-dashoffset: -95;
		}
	}
	@media (min-width: 900px) {
		.sgn-body {
			grid-template-columns: 1.05fr 0.95fr;
			gap: clamp(48px, 7vw, 96px);
		}
		.sgn-intro {
			display: block;
		}
		.sgn-main {
			justify-content: flex-end;
		}
	}
</style>
