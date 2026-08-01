//! H2 API-key identity — generation + argon2id hash/verify of
//! `sk_tor_<env>_<prefix>.<secret>`.
//!
//! Keys are **identity-bound** (a person's `profile_id` or a `service_account_id`);
//! the budget node comes from the identity, never the key (DECISIONS §1.2 / §2 W2).
//! Only the `prefix` (lookup) + an argon2id PHC `hashed_secret` are persisted — the
//! raw secret is shown to the operator exactly once at issuance and never logged.
//! Issuance is a privileged `/rpc` write; verification on the auth path lives in
//! [`crate::auth::require_auth`] (the `sk_tor_`/`sk_str_` branch → `authenticate_api_key`).

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

/// A freshly minted key. `full` is returned to the operator once; only `prefix` +
/// `hashed_secret` are persisted.
pub struct NewApiKey {
    pub prefix: String,
    pub hashed_secret: String,
    pub full: String,
}

/// Mint `sk_tor_<env>_<prefix>.<secret>` — 48-bit lookup prefix + 256-bit secret,
/// with the secret argon2id-hashed for storage.
pub fn mint() -> Result<NewApiKey, argon2::password_hash::Error> {
    let mut pbytes = [0u8; 6];
    OsRng.fill_bytes(&mut pbytes);
    let prefix = URL_SAFE_NO_PAD.encode(pbytes);

    let mut sbytes = [0u8; 32];
    OsRng.fill_bytes(&mut sbytes);
    let secret = URL_SAFE_NO_PAD.encode(sbytes);

    // TORII_ENV (torii = the gateway/engine brand).
    let env = std::env::var("TORII_ENV").unwrap_or_else(|_| "dev".to_string());
    let full = format!("sk_tor_{env}_{prefix}.{secret}");

    let salt = SaltString::generate(&mut OsRng);
    let hashed_secret = Argon2::default()
        .hash_password(secret.as_bytes(), &salt)?
        .to_string();

    Ok(NewApiKey {
        prefix,
        hashed_secret,
        full,
    })
}

/// Constant-time verify a presented secret against a stored argon2id PHC hash.
pub fn verify(secret: &str, hashed: &str) -> bool {
    match PasswordHash::new(hashed) {
        Ok(parsed) => Argon2::default()
            .verify_password(secret.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Split `sk_tor_<env>_<prefix>.<secret>` → `(prefix, secret)`. Also accepts the legacy
/// `sk_str_` prefix (pre-rebrand keys). `None` if malformed.
pub fn parse(key: &str) -> Option<(&str, &str)> {
    let rest = key
        .strip_prefix("sk_tor_")
        .or_else(|| key.strip_prefix("sk_str_"))?;
    let (env_prefix, secret) = rest.split_once('.')?;
    let (_env, prefix) = env_prefix.split_once('_')?;
    (!prefix.is_empty() && !secret.is_empty()).then_some((prefix, secret))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_parses_and_verifies_roundtrip() {
        let k = mint().unwrap();
        assert!(k.full.starts_with("sk_tor_"));
        let (prefix, secret) = parse(&k.full).expect("parse minted key");
        assert_eq!(prefix, k.prefix);
        assert!(verify(secret, &k.hashed_secret));
        assert!(!verify("wrong-secret", &k.hashed_secret));
    }

    #[test]
    fn parse_accepts_legacy_str_prefix() {
        // pre-rebrand keys (sk_str_) must still authenticate.
        let (prefix, secret) = parse("sk_str_dev_abc123.thesecret").expect("parse legacy key");
        assert_eq!(prefix, "abc123");
        assert_eq!(secret, "thesecret");
    }

    #[test]
    fn parse_rejects_malformed() {
        assert!(parse("nope").is_none());
        assert!(parse("sk_tor_dev_prefixonly").is_none()); // no secret
        assert!(parse("sk_tor_dev_.secret").is_none()); // empty prefix
    }
}
