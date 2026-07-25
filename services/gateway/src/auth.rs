use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::state::SharedState;

/// JWT claims extracted from a Supabase-issued access token.
///
/// `aud` is kept as `Value` because Supabase may emit it as either a bare
/// string (`"authenticated"`) or a JSON array (`["authenticated"]`).
/// The `jsonwebtoken` validation layer handles the aud check; this field
/// is purely informational after the token passes.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    #[serde(default)]
    pub tenant_id: Option<Uuid>,
    /// RW2 / F2 §4.1 frozen contract: the role ids the user holds in the active
    /// tenant. Capabilities are resolved SERVER-SIDE from these (never trusted
    /// from the token) — see [`crate::capabilities`].
    #[serde(default)]
    pub role_ids: Vec<Uuid>,
    /// RW2: token-freshness counter (the downgrade-revocation gate). Compared to
    /// `core.profiles.claims_version`; a stale token is rejected.
    #[serde(default)]
    pub claims_version: i64,
    /// The Postgres `role` claim ("authenticated"); informational only.
    #[serde(default)]
    pub role: Option<String>,
    pub exp: usize,
    #[serde(default)]
    pub aud: Option<Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("missing Authorization header")]
    MissingHeader,
    #[error("Authorization header is not a valid Bearer token")]
    InvalidHeader,
    #[error("JWT validation failed: {0}")]
    InvalidToken(#[from] jsonwebtoken::errors::Error),
    #[error("no JWK matched the token kid")]
    NoMatchingKey,
    /// H2: an API-key credential (`sk_tor_…`) failed to authenticate — malformed,
    /// unknown/revoked prefix, or secret mismatch. Deliberately opaque (carries no
    /// secret and does not distinguish the cause) so the mapped 401 leaks nothing.
    #[error("API key authentication failed")]
    InvalidApiKey,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        tracing::warn!("auth: {}", self);
        StatusCode::UNAUTHORIZED.into_response()
    }
}

// ---------------------------------------------------------------------------
// JWKS fetch
// ---------------------------------------------------------------------------

/// Fetch the Supabase JWKS from `<supabase_url>/auth/v1/.well-known/jwks.json`.
///
/// Never panics — returns an empty [`JwkSet`] on any network or parse error
/// so the gateway can still serve `/health` even when Supabase is down at boot.
pub async fn fetch_jwks(supabase_url: &str) -> JwkSet {
    let url = format!(
        "{}/auth/v1/.well-known/jwks.json",
        supabase_url.trim_end_matches('/')
    );

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("JWKS: failed to build HTTP client: {e}");
            return JwkSet { keys: vec![] };
        }
    };

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<JwkSet>().await {
            Ok(jwks) => {
                tracing::info!("JWKS: loaded {} key(s) from {}", jwks.keys.len(), url);
                jwks
            }
            Err(e) => {
                tracing::warn!("JWKS: failed to parse JWKS from {url}: {e}");
                JwkSet { keys: vec![] }
            }
        },
        Ok(resp) => {
            tracing::warn!("JWKS: got HTTP {} from {}", resp.status(), url);
            JwkSet { keys: vec![] }
        }
        Err(e) => {
            tracing::warn!("JWKS: request to {url} failed: {e}");
            JwkSet { keys: vec![] }
        }
    }
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

/// Validate a raw JWT string against the provided JWKS.
///
/// 1. Decodes the header to get `kid` and `alg`.
/// 2. Finds the matching JWK by `kid` (falls back to the first key if no kid).
/// 3. Validates `exp` and `aud = "authenticated"`.
pub fn validate_token(token: &str, jwks: &JwkSet) -> Result<Claims, AuthError> {
    let header = decode_header(token)?;

    let jwk = match &header.kid {
        Some(kid) => jwks
            .keys
            .iter()
            .find(|k| k.common.key_id.as_deref() == Some(kid.as_str())),
        None => jwks.keys.first(),
    }
    .ok_or(AuthError::NoMatchingKey)?;

    let decoding_key = DecodingKey::from_jwk(jwk)?;

    let mut validation = Validation::new(header.alg);
    validation.validate_exp = true;
    validation.set_audience(&["authenticated"]);

    let token_data = decode::<Claims>(token, &decoding_key, &validation)?;
    Ok(token_data.claims)
}

/// Try validating with HS256 + `SUPABASE_JWT_SECRET` (legacy / non-asymmetric projects).
/// Returns `None` if the env var is not set (skipped, not an error).
fn validate_hs256(token: &str) -> Option<Result<Claims, AuthError>> {
    let secret = std::env::var("SUPABASE_JWT_SECRET").ok()?;
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.set_audience(&["authenticated"]);
    Some(
        decode::<Claims>(token, &key, &validation)
            .map(|td| td.claims)
            .map_err(AuthError::from),
    )
}

// ---------------------------------------------------------------------------
// Axum middleware
// ---------------------------------------------------------------------------

/// Axum middleware applied to the `/v1` route group.
///
/// Flow:
/// 1. Extract `Authorization: Bearer <token>`.
/// 2. Validate against the cached JWKS (RS256 / ES256).
/// 3. On a `NoMatchingKey` error (key rotation): refetch JWKS once, retry.
/// 4. If `SUPABASE_JWT_SECRET` is set and JWKS still fails: try HS256 (legacy).
/// 5. On success: insert [`Claims`] into request extensions and call `next`.
/// 6. On any failure: 401 Unauthorized.
pub async fn require_auth(
    State(state): State<SharedState>,
    mut req: Request,
    next: Next,
) -> Response {
    let token = match extract_bearer(req.headers()) {
        Ok(t) => t,
        Err(e) => return e.into_response(),
    };

    // H2: API-key branch. Programmatic callers present `sk_tor_…` keys (legacy `sk_str_`
    // still accepted); everything else is a Supabase JWT and takes the unchanged path
    // below. The key only AUTHENTICATES — budget/capabilities come from the identity it
    // binds, never the key (see `authenticate_api_key`).
    if token.starts_with("sk_tor_") || token.starts_with("sk_str_") {
        return match authenticate_api_key(&state.pool, &token).await {
            Ok(claims) => {
                req.extensions_mut().insert(claims);
                next.run(req).await
            }
            Err(e) => e.into_response(),
        };
    }

    // Scope the read-lock so it drops before any await point.
    let initial_result = {
        let jwks = state.jwks.read().await;
        validate_token(&token, &*jwks)
    };

    let claims = match initial_result {
        Ok(c) => c,

        // kid miss — key may have rotated; refetch once then retry.
        Err(AuthError::NoMatchingKey) => {
            let supabase_url = std::env::var("PUBLIC_SUPABASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:55321".to_string());
            let new_jwks = fetch_jwks(&supabase_url).await;
            let retry = validate_token(&token, &new_jwks);
            // Only replace the cache when the refetch actually returned keys.
            // `fetch_jwks` yields an empty set on any network/parse error, and a
            // bad-`kid` token is unauthenticated — clobbering the good cached keys
            // with `[]` would 401 every legitimate JWT (cache poisoning) and let a
            // flood amplify upstream fetches. A non-empty set is a fresh, valid JWKS.
            if !new_jwks.keys.is_empty() {
                *state.jwks.write().await = new_jwks;
            }

            match retry {
                Ok(c) => c,
                Err(e) => {
                    // HS256 legacy fallback
                    if let Some(Ok(c)) = validate_hs256(&token) {
                        c
                    } else {
                        return e.into_response();
                    }
                }
            }
        }

        // Any other JWKS validation failure (bad sig, HS256 token vs RS/ES JWK,
        // wrong aud, expired, etc.) — try the HS256 legacy fallback before 401.
        // `validate_hs256` returns None when SUPABASE_JWT_SECRET is unset, so this
        // is a no-op (→ 401) in the normal asymmetric-only case.
        Err(e) => match validate_hs256(&token) {
            Some(Ok(c)) => c,
            _ => return e.into_response(),
        },
    };

    req.extensions_mut().insert(claims);
    next.run(req).await
}

// ---------------------------------------------------------------------------
// H2 · API-key authentication
// ---------------------------------------------------------------------------

/// Far-future `exp` stamped on API-key-derived [`Claims`] (year 2100). API keys carry
/// no JWT expiry — revocation is by `api_keys.status`, not by clock — so this simply
/// satisfies any downstream `exp` check without ever expiring a live key.
const API_KEY_EXP: usize = 4_102_444_800;

/// H2: authenticate a raw `sk_tor_<env>_<prefix>.<secret>` API key into [`Claims`].
///
/// **Fail-closed by construction**: any malformed key, unknown/revoked prefix, secret
/// mismatch, or DB error resolves to `Err(AuthError::InvalidApiKey)` → 401. Nothing
/// here trusts the key for authority.
///
/// The key only *authenticates*; the identity, tenant, budget node, and capabilities
/// all come from the profile / service account the key is BOUND to (via `profile_id`
/// XOR `service_account_id`), never from the key itself (RW4 / DECISIONS §2 W2). The
/// resulting [`Claims`] mirror the JWT contract so every downstream consumer
/// (capability resolution, the C3 budget hot-path) works identically for both.
async fn authenticate_api_key(pool: &sqlx::PgPool, token: &str) -> Result<Claims, AuthError> {
    // a. Split into (prefix, secret). Malformed ⇒ fail closed.
    let (prefix, secret) = crate::apikeys::parse(token).ok_or(AuthError::InvalidApiKey)?;

    // b. Look the key up by its PUBLIC prefix — PARAMETERIZED (never interpolated),
    //    so a prefix crafted to look like SQL is just an inert bind value.
    let row: Option<(Uuid, String, Option<Uuid>, Option<Uuid>, Uuid, String)> = sqlx::query_as(
        "select id, hashed_secret, profile_id, service_account_id, tenant_id, status \
           from public.api_keys where prefix = $1",
    )
    .bind(prefix)
    .fetch_optional(pool)
    .await
    .map_err(|_| AuthError::InvalidApiKey)?;

    let (id, hashed_secret, profile_id, service_account_id, tenant, status) =
        row.ok_or(AuthError::InvalidApiKey)?;
    if status != "active" {
        // Revoked (or any non-active status) ⇒ deny. Revocation is status-driven.
        return Err(AuthError::InvalidApiKey);
    }

    // c. Constant-time argon2id verification of the presented secret.
    if !crate::apikeys::verify(secret, &hashed_secret) {
        return Err(AuthError::InvalidApiKey);
    }

    // d. Resolve the bound identity into Claims (roles/version from the identity).
    let claims = if let Some(pid) = profile_id {
        // Person-bound: capabilities come from the profile's tenant roles.
        let role_ids: Vec<Uuid> = sqlx::query_scalar(
            "select role_id from core.profile_roles where profile_id = $1 and tenant_id = $2",
        )
        .bind(pid)
        .bind(tenant)
        .fetch_all(pool)
        .await
        .map_err(|_| AuthError::InvalidApiKey)?;

        let claims_version: i64 = sqlx::query_scalar(
            "select coalesce(claims_version, 0) from core.profiles where id = $1",
        )
        .bind(pid)
        .fetch_optional(pool)
        .await
        .map_err(|_| AuthError::InvalidApiKey)?
        .unwrap_or(0);

        Claims {
            sub: pid.to_string(),
            tenant_id: Some(tenant),
            role_ids,
            claims_version,
            role: Some("apikey".to_string()),
            exp: API_KEY_EXP,
            aud: None,
        }
    } else if let Some(sa) = service_account_id {
        // Service-account-bound: capabilities come from the tenant's `service` role.
        let role_ids: Vec<Uuid> = sqlx::query_scalar(
            "select id from core.roles where tenant_id = $1 and key = 'service'",
        )
        .bind(tenant)
        .fetch_all(pool)
        .await
        .map_err(|_| AuthError::InvalidApiKey)?;

        Claims {
            sub: sa.to_string(),
            tenant_id: Some(tenant),
            role_ids,
            claims_version: 0,
            role: Some("service".to_string()),
            exp: API_KEY_EXP,
            aud: None,
        }
    } else {
        // The `api_keys_one_identity` CHECK makes this unreachable; fail closed anyway.
        return Err(AuthError::InvalidApiKey);
    };

    // f. Best-effort last-used stamp — never gate auth on it.
    let _ = sqlx::query("update public.api_keys set last_used_at = now() where id = $1")
        .bind(id)
        .execute(pool)
        .await;

    Ok(claims)
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

fn extract_bearer(headers: &HeaderMap) -> Result<String, AuthError> {
    let value = headers
        .get(AUTHORIZATION)
        .ok_or(AuthError::MissingHeader)?
        .to_str()
        .map_err(|_| AuthError::InvalidHeader)?;

    value
        .strip_prefix("Bearer ")
        .map(str::to_owned)
        .ok_or(AuthError::InvalidHeader)
}
