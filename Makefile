## Strategos monorepo build coordinator
##
## Stack:
##   apps/admin    — SvelteKit + Cloudflare Workers (admin panel)
##   apps/desktop  — SvelteKit + Tauri (desktop console)
##   packages/ui   — Shared Svelte component library
##   packages/core — Shared TypeScript data layer
##   target/       — Single Cargo workspace (root-level, shared by all Rust crates)
##
## Bun workspaces: packages/* apps/*
## Cargo workspace: Cargo.toml at monorepo root → target/ at monorepo root

.PHONY: install build test check lint e2e clean clean-cache clean-all help

# ── Help ──────────────────────────────────────────────────────────────────────

help: ## Show this help message
	@grep -E '^[a-zA-Z0-9_-]+:.*## .*$$' $(MAKEFILE_LIST) \
	  | sort \
	  | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── JS / Bun ──────────────────────────────────────────────────────────────────

install: ## Install all JS dependencies via bun
	bun install

build: ## Build all JS workspaces (apps only) then the Cargo workspace
	bun run build
	cargo build

test: ## Run unit tests: bun vitest (packages/ui, packages/core) + Cargo workspace
	bun run test
	cargo test --workspace

check: ## Type-check all workspaces (svelte-check + tsc)
	bun run check

lint: ## Prettier format-check + ESLint across all workspaces
	bun run lint

# ── E2E ───────────────────────────────────────────────────────────────────────

e2e: ## Run Playwright e2e for admin and desktop (desktop e2e builds the Tauri app — slow)
	bun run --filter @strategos/admin test:e2e
	# Desktop e2e compiles the full Tauri bundle via `bunx tauri build --debug`.
	# Expect 5-15 min on a cold cache; subsequent runs use incremental Rust builds.
	bun run --filter @strategos/desktop test:e2e

# ── Clean / Disk management ───────────────────────────────────────────────────

clean: ## Reclaim disk: remove Cargo target/, .svelte-kit, build dirs, Playwright artefacts
	@echo "Cleaning Cargo target/ (root workspace)..."
	cargo clean
	@echo "Cleaning SvelteKit build artefacts..."
	rm -rf apps/*/.svelte-kit apps/*/build build dist
	@echo "Pruning Playwright test artefacts..."
	find . -type d \( -name test-results -o -name playwright-report \) -prune -exec rm -rf {} +
	@echo "Clean complete."

clean-cache: ## Prune stale rustc incremental caches (keep 5 newest per crate, macOS stat)
	@echo "Pruning stale rustc incremental caches (keeping 5 newest per crate)..."
	@inc="target/debug/incremental"; \
	if [ ! -d "$$inc" ]; then \
	  echo "  $$inc: not present, nothing to prune"; \
	else \
	  keep=5; \
	  find "$$inc" -mindepth 1 -maxdepth 1 -type d -print0 \
	    | xargs -0 -I{} stat -f "%m %N" "{}" 2>/dev/null \
	    | sort -rn \
	    | tail -n +$$((keep + 1)) \
	    | awk '{print $$2}' \
	    | xargs -I{} rm -rf "{}" 2>/dev/null; \
	  echo "  $$inc: kept last $$keep, rest pruned"; \
	fi
	@echo "Cache prune complete."

clean-all: ## Deep clean: clean + remove all node_modules (requires 'make install' afterward)
	$(MAKE) clean
	@echo "Removing node_modules..."
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	@echo "Done. Run 'make install' to restore dependencies."
