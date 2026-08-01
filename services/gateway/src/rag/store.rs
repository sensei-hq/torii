//! C5 · document persistence — the sqlx layer the crate `GatewayStore` does not cover
//! (documents / versions / assets / embeddings), written as `service_role` with tenant-scoped
//! composite keys. [`DocStore::commit_chunks`] writes the dense vector (via `pgvector`) + provenance
//! AND retires the prior version's chunks in ONE transaction, so retrieval never sees two versions;
//! the sparse `tsv` leg is a generated column, written automatically in the same row.

use pgvector::Vector;
use sqlx::PgPool;
use uuid::Uuid;

use super::chunk::Chunk;
use super::embed::validate_dims;
use super::RagError;

/// Metadata for a new document registration (before the original bytes are uploaded).
pub struct NewDocument {
    pub title: Option<String>,
    pub original_filename: String,
    pub content_type: String,
    pub scope: String,
    pub classification: String,
    pub space_id: Option<Uuid>,
    pub collection_id: Option<Uuid>,
    pub profile_id: Uuid,
}

/// One derived artifact row (markdown / table_csv / image / ir_json / original).
pub struct AssetRow {
    pub kind: String,
    pub storage_path: String,
    pub content_hash: Option<String>,
    pub label: Option<String>,
    pub sequence: Option<i32>,
    pub page_ref: Option<i32>,
    pub caption: Option<String>,
}

pub struct DocStore {
    pool: PgPool,
}

impl DocStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Register a document (`status='uploaded'`) + its version-1 row. Returns
    /// `(document_id, version_no, original_storage_path)` — the path the client PUTs the bytes to.
    pub async fn register_document(
        &self,
        tenant: Uuid,
        meta: &NewDocument,
    ) -> Result<(Uuid, i32, String), RagError> {
        let doc_id = Uuid::new_v4();
        sqlx::query(
            "insert into documents \
               (tenant_id, id, title, original_filename, content_type, scope, classification, \
                space_id, collection_id, profile_id, status) \
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'uploaded')",
        )
        .bind(tenant)
        .bind(doc_id)
        .bind(&meta.title)
        .bind(&meta.original_filename)
        .bind(&meta.content_type)
        .bind(&meta.scope)
        .bind(&meta.classification)
        .bind(meta.space_id)
        .bind(meta.collection_id)
        .bind(meta.profile_id)
        .execute(&self.pool)
        .await?;

        let storage_path = super::storage::object_path(tenant, doc_id, 1, "original", 0);
        sqlx::query(
            "insert into document_versions \
               (tenant_id, document_id, version_no, storage_path, content_type, created_by) \
             values ($1,$2,1,$3,$4,$5)",
        )
        .bind(tenant)
        .bind(doc_id)
        .bind(&storage_path)
        .bind(&meta.content_type)
        .bind(meta.profile_id.to_string())
        .execute(&self.pool)
        .await?;

        Ok((doc_id, 1, storage_path))
    }

    /// The latest version row for a document: `(version_id, version_no, storage_path)`.
    pub async fn current_version(&self, tenant: Uuid, doc: Uuid) -> Result<(Uuid, i32, String), RagError> {
        let row: (Uuid, i32, Option<String>) = sqlx::query_as(
            "select id, version_no, storage_path from document_versions \
             where tenant_id=$1 and document_id=$2 order by version_no desc limit 1",
        )
        .bind(tenant)
        .bind(doc)
        .fetch_one(&self.pool)
        .await?;
        Ok((row.0, row.1, row.2.unwrap_or_default()))
    }

    /// Record the content hash + parser provenance on a version (set once the bytes are parsed).
    pub async fn set_version_provenance(
        &self,
        tenant: Uuid,
        version_id: Uuid,
        content_hash: &str,
        parser: &str,
    ) -> Result<(), RagError> {
        sqlx::query(
            "update document_versions set content_hash=$3, parser=$4 where tenant_id=$1 and id=$2",
        )
        .bind(tenant)
        .bind(version_id)
        .bind(content_hash)
        .bind(parser)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Tenant-partitioned content-hash dedup: an existing document with this exact hash, if any.
    pub async fn find_by_hash(&self, tenant: Uuid, content_hash: &str) -> Result<Option<Uuid>, RagError> {
        let r: Option<(Uuid,)> = sqlx::query_as(
            "select document_id from document_versions where tenant_id=$1 and content_hash=$2 limit 1",
        )
        .bind(tenant)
        .bind(content_hash)
        .fetch_optional(&self.pool)
        .await?;
        Ok(r.map(|x| x.0))
    }

    /// Persist one derived artifact.
    pub async fn insert_asset(
        &self,
        tenant: Uuid,
        doc: Uuid,
        version_id: Uuid,
        a: &AssetRow,
    ) -> Result<(), RagError> {
        sqlx::query(
            "insert into document_assets \
               (tenant_id, document_id, version_id, kind, storage_path, content_hash, label, sequence, page_ref, caption) \
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(tenant)
        .bind(doc)
        .bind(version_id)
        .bind(&a.kind)
        .bind(&a.storage_path)
        .bind(&a.content_hash)
        .bind(&a.label)
        .bind(a.sequence)
        .bind(a.page_ref)
        .bind(&a.caption)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Insert all chunks (redacted content + 1024-dim embedding + provenance + redaction_count) AND
    /// retire the prior version's chunks (`superseded_at`) in ONE transaction. Fail-closed on any
    /// non-1024-dim vector BEFORE binding. The generated `tsv` column populates automatically.
    pub async fn commit_chunks(
        &self,
        tenant: Uuid,
        doc: Uuid,
        version_id: Uuid,
        chunks: &[Chunk],
        embeddings: &[Vec<f32>],
        redaction_counts: &[i32],
    ) -> Result<(), RagError> {
        validate_dims(embeddings)?;
        if chunks.len() != embeddings.len() {
            return Err(RagError::Embed(format!(
                "chunk/embedding count mismatch: {} vs {}",
                chunks.len(),
                embeddings.len()
            )));
        }
        let mut tx = self.pool.begin().await?;
        for (i, c) in chunks.iter().enumerate() {
            let emb = Vector::from(embeddings[i].clone());
            let rc = redaction_counts.get(i).copied().unwrap_or(0);
            sqlx::query(
                "insert into document_embeddings \
                   (tenant_id, document_id, version_id, chunk_sequence, content, embedding, \
                    token_count, start_position, end_position, section_path, page_ref, element_type, \
                    redaction_count, contextual_prefix) \
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            )
            .bind(tenant)
            .bind(doc)
            .bind(version_id)
            .bind(c.seq)
            .bind(&c.text)
            .bind(emb)
            .bind(c.token_count)
            .bind(c.start_position)
            .bind(c.end_position)
            .bind(&c.section_path)
            .bind(c.page_ref)
            .bind(c.element_type)
            .bind(rc)
            .bind(&c.contextual_prefix)
            .execute(&mut *tx)
            .await?;
        }
        // Atomically retire any prior version's chunks so retrieval never returns stale content.
        sqlx::query(
            "update document_embeddings set superseded_at = now() \
             where tenant_id=$1 and document_id=$2 and version_id is distinct from $3 \
               and superseded_at is null",
        )
        .bind(tenant)
        .bind(doc)
        .bind(version_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn set_status(
        &self,
        tenant: Uuid,
        doc: Uuid,
        status: &str,
        reason: Option<&str>,
    ) -> Result<(), RagError> {
        sqlx::query(
            "update documents set status=$3, status_reason=$4, modified_at=now() \
             where tenant_id=$1 and id=$2",
        )
        .bind(tenant)
        .bind(doc)
        .bind(status)
        .bind(reason)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Mark the document ready: terminal `completed` status + current version + chunk count + model.
    pub async fn finalize(
        &self,
        tenant: Uuid,
        doc: Uuid,
        current_version: Uuid,
        chunk_count: i32,
        embedding_model: &str,
    ) -> Result<(), RagError> {
        sqlx::query(
            "update documents set status='completed', current_version_id=$3, chunk_count=$4, \
                    embedding_model=$5, completed_at=now(), status_reason=null \
             where tenant_id=$1 and id=$2",
        )
        .bind(tenant)
        .bind(doc)
        .bind(current_version)
        .bind(chunk_count)
        .bind(embedding_model)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Hard-delete a document (FK cascade retires its chunks/versions/assets). v1 delete; a
    /// reversible soft-delete (a `deleted_at` column) is a later refinement.
    pub async fn delete_document(&self, tenant: Uuid, doc: Uuid) -> Result<u64, RagError> {
        let r = sqlx::query("delete from documents where tenant_id=$1 and id=$2")
            .bind(tenant)
            .bind(doc)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected())
    }
}
