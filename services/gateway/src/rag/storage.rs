//! C5 · object storage — document originals + derived artifacts (markdown/table_csv/image/ir_json).
//!
//! Objects live in a tenant/space-scoped Supabase Storage bucket, hash-addressed, and are served
//! via SHORT-LIVED signed URLs minted server-side ONLY AFTER the classification/read check (spec §5,
//! "object storage"). [`SupabaseStorage`] talks the Storage REST API as `service_role`;
//! [`InMemoryStore`] backs hermetic tests.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use uuid::Uuid;

use super::RagError;

/// Store + retrieve document bytes and mint signed URLs. All paths are tenant-scoped (the caller
/// builds them via [`object_path`]); the store never widens access on its own.
#[async_trait]
pub trait ObjectStore: Send + Sync {
    /// Upload bytes to `path` (server-side, `service_role`).
    async fn put(&self, path: &str, bytes: &[u8], content_type: &str) -> Result<(), RagError>;
    /// Fetch bytes from `path` (server-side, e.g. the ingest pipeline reading the original).
    async fn get(&self, path: &str) -> Result<Vec<u8>, RagError>;
    /// Mint a short-lived signed URL the client PUTs the original bytes to.
    async fn signed_upload(&self, path: &str) -> Result<String, RagError>;
    /// Mint a short-lived (`ttl_s`) signed URL for downloading an artifact — only after the caller
    /// has passed the classification/read check.
    async fn signed_download(&self, path: &str, ttl_s: u32) -> Result<String, RagError>;
}

/// Tenant/document/version/kind-scoped, sequence-addressed object path — the isolation boundary at
/// the storage layer (a signed URL for tenant A's path can never name tenant B's).
pub fn object_path(tenant: Uuid, doc: Uuid, ver: i32, kind: &str, n: usize) -> String {
    format!("{tenant}/{doc}/v{ver}/{kind}/{n}")
}

/// Supabase Storage over its REST API (`{base}/storage/v1/...`) as `service_role`. Bucket +
/// endpoint are operator config (no-hardcoded-ops).
pub struct SupabaseStorage {
    base: String,
    service_key: String,
    bucket: String,
    http: reqwest::Client,
}

impl SupabaseStorage {
    pub fn new(base: impl Into<String>, service_key: impl Into<String>, bucket: impl Into<String>) -> Self {
        Self { base: base.into(), service_key: service_key.into(), bucket: bucket.into(), http: reqwest::Client::new() }
    }

    /// Build from the environment: `PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
    /// (fallback `SERVICE_ROLE_KEY`) + `TORII_DOCS_BUCKET` (default `documents`).
    pub fn from_env() -> Self {
        let base = std::env::var("PUBLIC_SUPABASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:55321".to_string());
        let service_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
            .or_else(|_| std::env::var("SERVICE_ROLE_KEY"))
            .unwrap_or_default();
        let bucket = std::env::var("TORII_DOCS_BUCKET").unwrap_or_else(|_| "documents".to_string());
        Self::new(base, service_key, bucket)
    }

    fn object_url(&self, path: &str) -> String {
        format!("{}/storage/v1/object/{}/{}", self.base, self.bucket, path)
    }
}

#[async_trait]
impl ObjectStore for SupabaseStorage {
    async fn put(&self, path: &str, bytes: &[u8], content_type: &str) -> Result<(), RagError> {
        let resp = self
            .http
            .post(self.object_url(path))
            .bearer_auth(&self.service_key)
            .header("content-type", content_type)
            .header("x-upsert", "true")
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|e| RagError::Storage(format!("put {path}: {e}")))?;
        if !resp.status().is_success() {
            return Err(RagError::Storage(format!("put {path}: HTTP {}", resp.status())));
        }
        Ok(())
    }

    async fn get(&self, path: &str) -> Result<Vec<u8>, RagError> {
        let resp = self
            .http
            .get(self.object_url(path))
            .bearer_auth(&self.service_key)
            .send()
            .await
            .map_err(|e| RagError::Storage(format!("get {path}: {e}")))?;
        if !resp.status().is_success() {
            return Err(RagError::Storage(format!("get {path}: HTTP {}", resp.status())));
        }
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| RagError::Storage(format!("get {path} body: {e}")))
    }

    async fn signed_upload(&self, path: &str) -> Result<String, RagError> {
        // POST /storage/v1/object/upload/sign/{bucket}/{path} → { url, token }
        let endpoint = format!("{}/storage/v1/object/upload/sign/{}/{}", self.base, self.bucket, path);
        let resp = self
            .http
            .post(&endpoint)
            .bearer_auth(&self.service_key)
            .send()
            .await
            .map_err(|e| RagError::Storage(format!("sign upload {path}: {e}")))?;
        if !resp.status().is_success() {
            return Err(RagError::Storage(format!("sign upload {path}: HTTP {}", resp.status())));
        }
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| RagError::Storage(format!("sign upload {path} json: {e}")))?;
        let rel = body
            .get("url")
            .and_then(|u| u.as_str())
            .ok_or_else(|| RagError::Storage("sign upload: no url".into()))?;
        Ok(format!("{}/storage/v1{}", self.base, rel))
    }

    async fn signed_download(&self, path: &str, ttl_s: u32) -> Result<String, RagError> {
        // POST /storage/v1/object/sign/{bucket}/{path}  body { expiresIn } → { signedURL }
        let endpoint = format!("{}/storage/v1/object/sign/{}/{}", self.base, self.bucket, path);
        let resp = self
            .http
            .post(&endpoint)
            .bearer_auth(&self.service_key)
            .json(&serde_json::json!({ "expiresIn": ttl_s }))
            .send()
            .await
            .map_err(|e| RagError::Storage(format!("sign download {path}: {e}")))?;
        if !resp.status().is_success() {
            return Err(RagError::Storage(format!("sign download {path}: HTTP {}", resp.status())));
        }
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| RagError::Storage(format!("sign download {path} json: {e}")))?;
        let rel = body
            .get("signedURL")
            .or_else(|| body.get("signedUrl"))
            .and_then(|u| u.as_str())
            .ok_or_else(|| RagError::Storage("sign download: no signedURL".into()))?;
        Ok(format!("{}/storage/v1{}", self.base, rel))
    }
}

/// Hermetic in-memory store for tests. `signed_*` return a synthetic `mem://{path}?ttl=…` URL so the
/// scope/TTL contract is testable without a network.
#[derive(Default)]
pub struct InMemoryStore {
    map: Mutex<HashMap<String, Vec<u8>>>,
}

#[async_trait]
impl ObjectStore for InMemoryStore {
    async fn put(&self, path: &str, bytes: &[u8], _content_type: &str) -> Result<(), RagError> {
        self.map.lock().unwrap().insert(path.to_string(), bytes.to_vec());
        Ok(())
    }
    async fn get(&self, path: &str) -> Result<Vec<u8>, RagError> {
        self.map
            .lock()
            .unwrap()
            .get(path)
            .cloned()
            .ok_or_else(|| RagError::Storage(format!("not found: {path}")))
    }
    async fn signed_upload(&self, path: &str) -> Result<String, RagError> {
        Ok(format!("mem://{path}?upload=1"))
    }
    async fn signed_download(&self, path: &str, ttl_s: u32) -> Result<String, RagError> {
        Ok(format!("mem://{path}?ttl={ttl_s}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_path_is_tenant_doc_version_scoped() {
        let t = Uuid::from_u128(1);
        let d = Uuid::from_u128(2);
        let p = object_path(t, d, 3, "markdown", 0);
        assert_eq!(p, format!("{t}/{d}/v3/markdown/0"));
        assert!(p.starts_with(&t.to_string()), "path is tenant-scoped");
    }

    #[tokio::test]
    async fn in_memory_round_trip_and_signed_url_scope_ttl() {
        let s = InMemoryStore::default();
        let path = object_path(Uuid::from_u128(1), Uuid::from_u128(2), 1, "original", 0);
        s.put(&path, b"hello", "text/plain").await.unwrap();
        assert_eq!(s.get(&path).await.unwrap(), b"hello");
        assert!(s.get("nope").await.is_err());

        let dl = s.signed_download(&path, 120).await.unwrap();
        assert!(dl.contains(&path), "signed URL is path-scoped");
        assert!(dl.contains("ttl=120"), "signed URL carries the TTL");
    }
}
