## Torii monorepo build coordinator
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

.PHONY: install build test check lint fmt fmt-check clippy rust-lint hooks e2e clean clean-cache clean-all sweep help bump \
        gateway-build gateway-service gateway-restart gateway-stop gateway-logs gateway-status

# ── Help ──────────────────────────────────────────────────────────────────────

help: ## Show this help message
	@grep -E '^[a-zA-Z0-9_-]+:.*## .*$$' $(MAKEFILE_LIST) \
	  | sort \
	  | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── JS / Bun ──────────────────────────────────────────────────────────────────

install: ## Install everything: JS dependencies + the Rust API layer on PATH, then reclaim disk
	@# `bun install` is only linking — it costs no meaningful disk. The Rust API layer
	@# (services/gateway) is what actually fills the drive, so it is the half worth reclaiming,
	@# and it belongs in `install` rather than being a separate step you have to remember.
	bun install
	@# Same shape as dbd: install, then reclaim, preserving the INSTALL's exit status so a
	@# failed reclaim never reports as a failed install — and a failed install still gets its
	@# disk back. Safe to wipe target/ here precisely because the binary is now in ~/.cargo/bin.
	@ok=0; \
	 cargo install --path services/gateway --locked --force --debug || ok=$$?; \
	 $(RECLAIM); \
	 if [ $$ok -ne 0 ]; then \
	   echo "Install FAILED (exit $$ok) — disk was still reclaimed. Fix the build, re-run 'make install'."; \
	   exit $$ok; \
	 fi; \
	 echo "torii-gateway is on your PATH ($(GW_BIN))."

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

# ── Rust formatting + lint ────────────────────────────────────────────────────
#
# Every commit is rustfmt- and clippy-clean: the tracked .githooks/pre-commit runs fmt-check
# then clippy, and CI (coverage.yml) runs both too. `make hooks` once per clone enables the hook.
#
# clippy runs on rustup's `stable` — the toolchain CI's dtolnay/rust-toolchain@stable resolves —
# rather than whatever `cargo` is first on PATH: a Homebrew rustc can lag stable and miss a lint
# CI then fails on. Falls back to plain `cargo` where rustup is not installed.
RUST_STABLE := $(shell command -v rustup >/dev/null 2>&1 && echo "rustup run stable")

fmt: ## Format all Rust code (cargo fmt --all) — run before every commit
	cargo fmt --all

fmt-check: ## Check Rust formatting without modifying files
	cargo fmt --all --check

clippy: ## Lint every Rust crate (workspace, all targets) on stable, warnings are errors
	$(RUST_STABLE) cargo clippy --workspace --all-targets -- -D warnings

rust-lint: fmt-check clippy ## Rust gate: fmt-check + clippy (what the pre-commit hook and CI run)

hooks: ## Install the tracked git pre-commit hook (fmt-check + clippy -D warnings)
	git config core.hooksPath .githooks
	@echo "pre-commit hook enabled (.githooks/pre-commit)"

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
# The INSTALLED binary, not target/debug/. Two reasons, one of which bit us:
#   · `make clean` wipes target/, and the launchd service holds the running inode — so the
#     gateway keeps serving from a deleted file and only fails at the NEXT restart, long after
#     the clean that caused it. Installing outside target/ makes clean safe by construction.
#   · it is where `cargo install` puts it, so the service and the CLI run the same build.
GW_BIN    := $(HOME)/.cargo/bin/torii-gateway
GW_CWD    := $(CURDIR)/services/gateway
GW_LOG    := $(GW_CWD)/gateway.log
GW_DOMAIN := gui/$(shell id -u)
# Poll /health for up to ~15s (the gateway needs ~5s: DB + JWKS + adapters + config).
# $(call GW_WAIT,<prefix>) prints "<prefix>: health 200" once up, else a log hint.
GW_WAIT = for i in $$(seq 1 15); do \
	  if [ "$$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/health 2>/dev/null)" = "200" ]; then \
	    echo "$(1): health 200"; exit 0; fi; sleep 1; \
	done; echo "$(1): not healthy after 15s -- check: make gateway-logs"

gateway-build: ## Build torii-gateway and put it on PATH (debug profile — fast dev loop)
	@# `cargo install --debug` rather than `cargo build`: same debug profile and the same warm
	@# target/, but the artifact lands in ~/.cargo/bin instead of target/debug. That is what
	@# makes `make clean` safe — the service (GW_BIN) keeps running a binary clean cannot
	@# delete. --force because the version rarely changes between dev builds.
	cargo install --path services/gateway --locked --force --debug

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

# ── Version bump ──────────────────────────────────────────────────────────────
# VERSION is the single source of truth. `make bump v=patch|minor|major|<X.Y.Z>`
# updates VERSION + every JS package.json + every Rust crate Cargo.toml + the
# Tauri conf in lockstep, refreshes Cargo.lock, then commits + tags. Push and the
# develop→main merge (which trigger the Cloudflare + Fly deploys) stay manual.
#   make bump v=patch   0.1.0 → 0.1.1     make bump v=minor   0.1.0 → 0.2.0
#   make bump v=major   0.1.0 → 1.0.0     make bump v=0.5.0   explicit
BUMP_JSON  := package.json apps/admin/package.json apps/desktop/package.json \
              packages/core/package.json packages/ui/package.json \
              apps/desktop/src-tauri/tauri.conf.json
BUMP_CARGO := services/gateway/Cargo.toml apps/desktop/src-tauri/Cargo.toml

bump: ## Bump VERSION + all package.json / Cargo.toml / tauri.conf in lockstep, commit + tag
	@if [ -z "$(v)" ]; then echo "Usage: make bump v=patch|minor|major|<version>"; exit 1; fi
	$(eval _v := $(shell \
	  cur=$$(cat VERSION); \
	  if [ "$(v)" = "patch" ]; then echo "$$cur" | awk -F. '{printf "%s.%s.%s", $$1, $$2, $$3+1}'; \
	  elif [ "$(v)" = "minor" ]; then echo "$$cur" | awk -F. '{printf "%s.%s.0", $$1, $$2+1}'; \
	  elif [ "$(v)" = "major" ]; then echo "$$cur" | awk -F. '{printf "%s.0.0", $$1+1}'; \
	  else echo "$(v)"; fi))
	@if git tag -l "v$(_v)" | grep -q .; then echo "Error: tag v$(_v) already exists (current $$(cat VERSION))."; exit 1; fi
	@cur=$$(cat VERSION); \
	  if [ "$$(printf '%s\n%s' "$$cur" "$(_v)" | sort -V | tail -1)" = "$$cur" ] && [ "$$cur" != "$(_v)" ]; then echo "Error: refusing to bump down ($$cur -> $(_v))"; exit 1; fi; \
	  if [ "$$cur" = "$(_v)" ]; then echo "Error: $(_v) is already the current version"; exit 1; fi
	@echo "Bumping $$(cat VERSION) -> $(_v)"
	@echo "$(_v)" > VERSION
	@for f in $(BUMP_JSON); do sed -i '' 's/"version": "[^"]*"/"version": "$(_v)"/' "$$f"; done
	@for f in $(BUMP_CARGO); do sed -i '' "s/^version = \"[^\"]*\"/version = \"$(_v)\"/" "$$f"; done
	@# Refresh Cargo.lock member versions via the deploy crate only — scoped to torii-gateway so a
	@# pre-existing compile error elsewhere in the workspace (e.g. the desktop app) can't block a bump.
	@cargo check -p torii-gateway --offline --quiet 2>/dev/null || cargo check -p torii-gateway --quiet
	@git add VERSION $(BUMP_JSON) $(BUMP_CARGO)
	-@git add Cargo.lock 2>/dev/null || true
	@git commit -m "chore: bump to v$(_v)"
	@git tag "v$(_v)"
	@echo "Committed + tagged v$(_v). To release: git push origin HEAD && git push origin v$(_v), then merge develop->main (triggers the CF + Fly deploys)."
	@# Reclaim AFTER the tag, never before: the bump's `cargo check` artifacts have done their
	@# job once the version is committed. A failure here must not imply the bump failed — the
	@# tag exists either way — so $$ok is reported separately from the release outcome.
	@ok=0; \
	 $(RECLAIM); \
	 if [ $$ok -ne 0 ]; then \
	   echo ""; \
	   echo "v$(_v) is committed and tagged — the bump itself succeeded."; \
	   echo "Only the disk reclaim failed; run 'make clean' when convenient."; \
	 fi

# ── Clean / Disk management ───────────────────────────────────────────────────

# Reclaim disk after a target that built Rust, reporting what it actually freed — the point
# of this is a number you can verify, not a reassuring message. Modelled on dbd's
# INSTALL_AND_RECLAIM: it preserves the CALLER's exit status in $$ok, so a reclaim failure
# never masks a failed build, and a failed build still gets its disk back.
#
# Only `bump` calls this. It is deliberately NOT on `install` (that is `bun install` — no Rust
# artifacts to reclaim, and cleaning would throw away a warm target/ for nothing) nor on
# `gateway-build`/`gateway-restart` (run repeatedly during development; cleaning after each
# would force a full recompile every time). `bump` is the release boundary, where the
# artifacts have served their purpose — the same place dbd reclaims.
define RECLAIM
	before=$$(du -sk target 2>/dev/null | awk '{print $$1}'); before=$${before:-0}; \
	echo "Reclaiming disk: removing Rust build artifacts..."; \
	if cargo clean; then \
	  freed=$$(( before / 1024 )); \
	  echo "target/ cleaned — $${freed} MB reclaimed; the next build recompiles against the current lockfile."; \
	else \
	  echo "WARNING: cargo clean failed — target/ is still on disk."; \
	  if [ $$ok -eq 0 ]; then ok=1; fi; \
	fi
endef

clean: ## Reclaim disk: remove Cargo target/, .svelte-kit, build dirs, Playwright artefacts
	@before=$$(du -sk target 2>/dev/null | awk '{print $$1}'); before=$${before:-0}; \
	 echo "Cleaning Cargo target/ (root workspace)..."; \
	 cargo clean; \
	 echo "Cleaning SvelteKit build artefacts..."; \
	 rm -rf apps/*/.svelte-kit apps/*/build build dist; \
	 echo "Pruning Playwright test artefacts..."; \
	 find . -type d \( -name test-results -o -name playwright-report \) -prune -exec rm -rf {} + ; \
	 echo "Clean complete — $$(( before / 1024 )) MB reclaimed from target/."

sweep: ## Prune STALE Rust artifacts (other toolchains, >14d untouched), keeping the build warm
	@if ! command -v cargo-sweep >/dev/null 2>&1; then \
	  echo "cargo-sweep not installed. Install it with:"; \
	  echo "  cargo install cargo-sweep"; \
	  echo "Or run 'make clean' to wipe target/ entirely (forces a full rebuild)."; \
	  exit 1; \
	fi
	@before=$$(du -sk target 2>/dev/null | awk '{print $$1}'); before=$${before:-0}; \
	 cargo sweep --installed; \
	 cargo sweep --time 14; \
	 after=$$(du -sk target 2>/dev/null | awk '{print $$1}'); after=$${after:-0}; \
	 echo "Swept — $$(( (before - after) / 1024 )) MB reclaimed, current working set kept warm."

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
