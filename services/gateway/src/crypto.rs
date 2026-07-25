//! F3 credential vault — DEK/KEK envelope crypto (DECISIONS §2 W4).
//!
//! AES-256-GCM via the vetted `aes-gcm` crate (RustCrypto) — never hand-rolled.
//! Envelope: a per-tenant **DEK** (in `core.tenant_keys.encrypted_dek`) is sealed
//! by the master **KEK**; provider credentials (`public.router_keys`) are sealed by
//! the tenant DEK. The gateway (`service_role`) is the ONLY place that decrypts;
//! keys never leave it and never touch a client/device.
//!
//! Ciphertext layout (both DEK and credential blobs): `[12B IV][16B tag][ciphertext]`.
//! `aes-gcm` expects `ciphertext || tag`, so we reassemble on decrypt.
//!
//! KEK source: `STRATEGOS_KEK` env var (base64 32 bytes) for local dev; production
//! resolves the KEK from a cloud KMS/HSM (deferred — see F3 spec). Fail-closed.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use zeroize::Zeroizing;

const IV_LEN: usize = 12;
const TAG_LEN: usize = 16;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("KEK not configured (STRATEGOS_KEK) or invalid: {0}")]
    Kek(String),
    #[error("ciphertext too short ({0} bytes; need > {1})")]
    TooShort(usize, usize),
    #[error("AEAD decryption failed (tampered ciphertext or wrong key)")]
    Decrypt,
}

/// The master key-encryption key. Dev: base64 32 bytes in `STRATEGOS_KEK`.
/// The key material is held in `Zeroizing` so it is wiped from memory on drop.
#[derive(Clone)]
pub struct Kek(Zeroizing<[u8; 32]>);

impl Kek {
    /// Load the KEK from the `TORII_KEK` env var (base64-encoded 32 bytes); the legacy
    /// `STRATEGOS_KEK` is accepted as a fallback. Production replaces this with a KMS-backed
    /// provider.
    pub fn from_env() -> Result<Self, CryptoError> {
        let raw = std::env::var("TORII_KEK")
            .or_else(|_| std::env::var("STRATEGOS_KEK"))
            .map_err(|_| CryptoError::Kek("env var unset".into()))?;
        // `Zeroizing` so the intermediate decoded copy of the KEK is wiped on drop.
        let bytes = Zeroizing::new(
            B64.decode(raw.trim())
                .map_err(|e| CryptoError::Kek(format!("base64: {e}")))?,
        );
        let arr: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| CryptoError::Kek(format!("expected 32 bytes, got {}", bytes.len())))?;
        Ok(Kek(Zeroizing::new(arr)))
    }

    #[cfg(test)]
    pub fn from_bytes(b: [u8; 32]) -> Self {
        Kek(Zeroizing::new(b))
    }

    fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
        decrypt_gcm(&self.0, blob, b"")
    }
}

/// Decrypt an `[IV][tag][ct]` blob with a 32-byte key and optional AAD.
fn decrypt_gcm(key: &[u8; 32], blob: &[u8], aad: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if blob.len() <= IV_LEN + TAG_LEN {
        return Err(CryptoError::TooShort(blob.len(), IV_LEN + TAG_LEN));
    }
    let (iv, rest) = blob.split_at(IV_LEN);
    let (tag, ct) = rest.split_at(TAG_LEN);
    // aes-gcm wants ciphertext with the tag appended.
    let mut ct_tag = Vec::with_capacity(ct.len() + TAG_LEN);
    ct_tag.extend_from_slice(ct);
    ct_tag.extend_from_slice(tag);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(iv), Payload { msg: &ct_tag, aad })
        .map_err(|_| CryptoError::Decrypt)
}

#[cfg(test)]
fn encrypt_gcm(key: &[u8; 32], iv: &[u8; IV_LEN], plaintext: &[u8]) -> Vec<u8> {
    // Test-only helper mirroring the DB layout [IV][tag][ct].
    use aes_gcm::aead::AeadInPlace;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut buf = plaintext.to_vec();
    let tag = cipher
        .encrypt_in_place_detached(Nonce::from_slice(iv), b"", &mut buf)
        .expect("encrypt");
    let mut out = Vec::new();
    out.extend_from_slice(iv);
    out.extend_from_slice(&tag);
    out.extend_from_slice(&buf);
    out
}

/// Decrypt a tenant DEK (sealed by the KEK) → the 32-byte data key.
/// Returned in `Zeroizing` so the key is wiped from memory when the caller drops it.
pub fn unseal_dek(kek: &Kek, encrypted_dek: &[u8]) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    // Wrap the intermediate decrypted Vec so it is wiped on drop too.
    let dek = Zeroizing::new(kek.decrypt(encrypted_dek)?);
    let arr: [u8; 32] = dek
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::Decrypt)?;
    Ok(Zeroizing::new(arr))
}

/// Decrypt a provider credential (sealed by the tenant DEK) → UTF-8 secret.
/// Returned in `Zeroizing` so the plaintext secret is wiped when the caller drops it.
pub fn unseal_credential(
    dek: &[u8; 32],
    encrypted: &[u8],
) -> Result<Zeroizing<String>, CryptoError> {
    let pt = decrypt_gcm(dek, encrypted, b"")?;
    let secret = String::from_utf8(pt).map_err(|_| CryptoError::Decrypt)?;
    Ok(Zeroizing::new(secret))
}

/// Seal a plaintext secret under the tenant DEK → `[IV][tag][ct]` (the DB layout),
/// using a fresh random 96-bit nonce. Used when a provider credential is stored
/// (the `/rpc/connections/*` write path lands in P5 once dev KEK/seed align).
#[allow(dead_code)]
pub fn seal_credential(dek: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use aes_gcm::aead::AeadInPlace;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(dek));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut buf = plaintext.to_vec();
    let tag = cipher
        .encrypt_in_place_detached(&nonce, b"", &mut buf)
        .map_err(|_| CryptoError::Decrypt)?;
    let mut out = Vec::with_capacity(IV_LEN + TAG_LEN + buf.len());
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&tag);
    out.extend_from_slice(&buf);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_round_trips_dek_then_credential() {
        let kek = Kek::from_bytes([7u8; 32]);
        let dek = [42u8; 32];

        // Seal the DEK with the KEK, then unseal.
        let sealed_dek = encrypt_gcm(&kek.0, &[1u8; IV_LEN], &dek);
        assert_eq!(*unseal_dek(&kek, &sealed_dek).unwrap(), dek);

        // Seal a provider key with the DEK, then unseal.
        let sealed_key = encrypt_gcm(&dek, &[2u8; IV_LEN], b"sk-ant-secret-123");
        assert_eq!(
            *unseal_credential(&dek, &sealed_key).unwrap(),
            "sk-ant-secret-123"
        );
    }

    #[test]
    fn seal_then_unseal_round_trips_with_random_nonce() {
        let dek = [11u8; 32];
        let sealed = seal_credential(&dek, b"sk-ant-live-xyz").unwrap();
        // fresh nonce each call → distinct ciphertext, but both decrypt.
        let sealed2 = seal_credential(&dek, b"sk-ant-live-xyz").unwrap();
        assert_ne!(sealed, sealed2);
        assert_eq!(
            *unseal_credential(&dek, &sealed).unwrap(),
            "sk-ant-live-xyz"
        );
        assert_eq!(
            *unseal_credential(&dek, &sealed2).unwrap(),
            "sk-ant-live-xyz"
        );
    }

    #[test]
    fn tampered_ciphertext_fails_closed() {
        let dek = [9u8; 32];
        let mut sealed = encrypt_gcm(&dek, &[3u8; IV_LEN], b"secret");
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01; // flip a bit
        assert!(matches!(
            unseal_credential(&dek, &sealed),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn short_blob_rejected() {
        assert!(matches!(
            unseal_credential(&[0u8; 32], b"tiny"),
            Err(CryptoError::TooShort(..))
        ));
    }
}
