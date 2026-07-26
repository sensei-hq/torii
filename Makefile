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

.PHONY: install build test check lint e2e clean clean-cache clean-all help \
        gateway-build gateway-service gateway-restart gateway-stop gateway-logs gateway-status

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
	bun run --filter @seiki/admin test:e2e
	# Desktop e2e compiles the full Tauri bundle via `bunx tauri build --debug`.
	# Expect 5-15 min on a cold cache; subsequent runs use incremental Rust builds.
	bun run --filter @torii/desktop test:e2e

# ── Gateway service (macOS launchd — resilient, auto-restarting dev service) ───
#
# The gateway loads its env from services/gateway/.env (dotenvy) — so the service is
# NOT tied to a shell. One-time setup: `cp services/gateway/.env.example services/
# gateway/.env` + fill it in, then `make gateway-service`. After a code change,
# `make gateway-restart` rebuilds + restarts; launchd's KeepAlive auto-restarts on crash.

GW_LABEL  := dev.torii.gateway
GW_PLIST  := $(HOME)/Library/LaunchAgents/$(GW_LABEL).plist
GW_BIN    := $(CURDIR)/target/debug/torii-gateway
GW_CWD    := $(CURDIR)/services/gateway
GW_LOG    := $(GW_CWD)/gateway.log
GW_DOMAIN := gui/$(shell id -u)
# Poll /health for up to ~15s (the gateway needs ~5s: DB + JWKS + adapters + config).
# $(call GW_WAIT,<prefix>) prints "<prefix>: health 200" once up, else a log hint.
GW_WAIT = for i in $$(seq 1 15); do \
	  if [ "$$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/health 2>/dev/null)" = "200" ]; then \
	    echo "$(1): health 200"; exit 0; fi; sleep 1; \
	done; echo "$(1): not healthy after 15s -- check: make gateway-logs"

gateway-build: ## Build the torii-gateway binary (debug)
	cargo build -p torii-gateway

gateway-service: gateway-build ## Install + start the gateway as a launchd service (auto-restart)
	@test -f "$(GW_CWD)/.env" || { echo "!! Missing $(GW_CWD)/.env — copy .env.example and fill it in first."; exit 1; }
	@mkdir -p "$(HOME)/Library/LaunchAgents"
	@printf '%s\n' \
	  '<?xml version="1.0" encoding="UTF-8"?>' \
	  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
	  '<plist version="1.0"><dict>' \
	  '  <key>Label</key><string>$(GW_LABEL)</string>' \
	  '  <key>ProgramArguments</key><array><string>$(GW_BIN)</string></array>' \
	  '  <key>WorkingDirectory</key><string>$(GW_CWD)</string>' \
	  '  <key>KeepAlive</key><true/>' \
	  '  <key>RunAtLoad</key><true/>' \
	  '  <key>ThrottleInterval</key><integer>5</integer>' \
	  '  <key>StandardOutPath</key><string>$(GW_LOG)</string>' \
	  '  <key>StandardErrorPath</key><string>$(GW_LOG)</string>' \
	  '  <key>ProcessType</key><string>Interactive</string>' \
	  '</dict></plist>' > "$(GW_PLIST)"
	-@launchctl bootout $(GW_DOMAIN)/$(GW_LABEL) 2>/dev/null || true
	@launchctl bootstrap $(GW_DOMAIN) "$(GW_PLIST)"
	@$(call GW_WAIT,gateway service up)

gateway-restart: gateway-build ## Rebuild + restart the gateway service (fresh binary takes effect)
	@launchctl kickstart -k $(GW_DOMAIN)/$(GW_LABEL) 2>/dev/null || { echo "!! service not installed — run 'make gateway-service' first"; exit 1; }
	@$(call GW_WAIT,restarted)

gateway-stop: ## Stop + unload the gateway service
	-@launchctl bootout $(GW_DOMAIN)/$(GW_LABEL) 2>/dev/null && echo "gateway service stopped" || echo "gateway service not running"

gateway-logs: ## Tail the gateway log
	@touch "$(GW_LOG)"; tail -n 40 -f "$(GW_LOG)"

gateway-status: ## Gateway service state + health
	-@launchctl print $(GW_DOMAIN)/$(GW_LABEL) 2>/dev/null | grep -E "state = |pid = " | head -2 || echo "service not installed"
	-@curl -s --max-time 3 -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:8787/health || echo "health: down"

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
