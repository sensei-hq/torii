# torii-gateway — the central Rust/Axum inference gateway.
# Cloud/HTTP-only (no local-engine/llama.cpp), so a plain multi-stage Rust build.
#
# Build from the REPO ROOT (the workspace):  docker build -f services/gateway/Dockerfile .
# (Fly.io: `fly deploy` uses this via fly.toml's [build].dockerfile.)

# ---- builder ---------------------------------------------------------------
FROM rust:1.83-slim-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config libssl-dev git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build

# Copy the workspace. Only torii-gateway is compiled (`-p`); the Tauri desktop member is
# dropped from the manifest below, so its sources aren't needed in the image.
COPY Cargo.toml Cargo.lock ./
COPY services ./services

# Prep the workspace manifest for a cloud-only gateway build:
#  1. Strip the dev-in-place [patch] (points sensei-* at the sibling repo ../gateway, absent
#     here) so the build resolves the git dependency at the pinned tag
#     (services/gateway/Cargo.toml, currently tag = "v0.4.8").
#  2. Drop the `apps/desktop/src-tauri` workspace member — the Tauri desktop app. Cargo parses
#     EVERY member even for `-p torii-gateway`, and that member's [lib] source isn't copied,
#     so keep it out of `members` entirely (the gateway doesn't depend on it).
RUN sed -i '/^\[patch\./,/^$/d' Cargo.toml && \
    sed -i -E 's#"apps/desktop/src-tauri",[[:space:]]*##' Cargo.toml

# Build only the gateway (not the Tauri desktop member).
RUN cargo build --release -p torii-gateway && \
    cp target/release/torii-gateway /torii-gateway

# ---- runtime ---------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libssl3 && rm -rf /var/lib/apt/lists/* && \
    useradd -r -u 10001 torii
COPY --from=builder /torii-gateway /usr/local/bin/torii-gateway
USER torii
# Bind 0.0.0.0 so the platform proxy can reach the container; PORT from the host (Fly 8080).
ENV HOST=0.0.0.0 PORT=8080 TORII_ENV=prod
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/torii-gateway"]
