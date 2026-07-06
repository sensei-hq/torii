import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
	// ── Global ignores ───────────────────────────────────────────────────────
	{
		ignores: [
			'**/node_modules/**',
			'**/.svelte-kit/**',
			'**/build/**',
			'**/dist/**',
			'**/target/**',
			'**/.wrangler/**',
			'**/.vercel/**',
			// Generated Paraglide i18n files
			'**/paraglide/**',
			// Rust source — linted by cargo clippy, not ESLint
			'apps/*/src-tauri/**',
			// Design mockups (static HTML/JSX, not part of the app)
			'docs/mockups/**'
		]
	},

	// ── Base rules ───────────────────────────────────────────────────────────
	js.configs.recommended,

	// TypeScript recommended — non-type-checked intentionally.
	// `recommendedTypeChecked` needs a per-package tsconfig project service;
	// skipping it keeps the flat config at the monorepo root without per-app
	// tsconfig wiring.
	...tseslint.configs.recommended,

	// Svelte recommended — registers the svelte parser + svelte-specific rules
	// for all *.svelte files automatically.
	...svelte.configs['flat/recommended'],

	// ── Language options ─────────────────────────────────────────────────────
	// Wire up the TS parser as the inner parser for <script lang="ts"> blocks
	// inside Svelte files (the outer parser remains svelte-eslint-parser).
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		}
	},

	// Globals: browser (SvelteKit client code) + Node (server routes, config files)
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},

	// ── Lenient rule overrides for a clean baseline pass ─────────────────────
	{
		rules: {
			// Empty catch blocks are intentional in e2e lifecycle code (pkill/unlink
			// that should not abort the setup if the target doesn't exist).
			'no-empty': ['error', { allowEmptyCatch: true }],

			// TypeScript's own compiler tracks undefined variables better than
			// ESLint's no-undef; @typescript-eslint/no-unused-vars is the right hook.
			'no-unused-vars': 'off',

			// Warn (not error) on unused vars; _-prefixed params/vars are intentional
			// placeholders (e.g. unused destructured args, lifecycle stubs).
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],

			// The e2e helpers (apps/desktop/e2e/helpers.ts) use `any` for the
			// Playwright/Tauri bridging API; and the supabase adapter uses `as unknown[]`
			// casts. Turning this off avoids suppressions scattered through the codebase.
			'@typescript-eslint/no-explicit-any': 'off',

			// No {@html ...} in the current Svelte files, but off to prevent churn
			// when e2e fixtures or future dynamic content use it.
			'svelte/no-at-html-tags': 'off'
		}
	},

	// ── Prettier ─────────────────────────────────────────────────────────────
	// Must be last — disables all ESLint rules that conflict with Prettier's
	// formatting opinions so both can coexist without fighting.
	prettier
)
