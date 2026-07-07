use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{
    decode, decode_header,
    jwk::JwkSet,
    Algorithm, DecodingKey, Validation,
};
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
    /// The `role` field — could be the Postgres role ("authenticated") or
    /// an app role set by the custom_access_token_hook. Use `tenant_id` +
    /// `role` together when authorising app-level actions.
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
                .unwrap_or_else(|_| "http://127.0.0.1:54321".to_string());
            let new_jwks = fetch_jwks(&supabase_url).await;
            let retry = validate_token(&token, &new_jwks);
            *state.jwks.write().await = new_jwks;

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

        // Any other validation error (expired, bad sig, wrong aud, etc.).
        Err(e) => return e.into_response(),
    };

    req.extensions_mut().insert(claims);
    next.run(req).await
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
