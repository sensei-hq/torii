//! C5 · document HTTP surface (`/v1/documents…`, DECISIONS §2 W5, spec §4.1).
//!
//! Register → (client PUTs bytes to a signed URL) → ingest → poll status → read metadata / assets.
//! The RAG CORE (parse/chunk/embed/redact/store/retrieve) is frozen; this layer only wires HTTP.
//!
//! SECURITY — the read predicate. The gateway runs as `service_role` (RLS bypassed), so every
//! read (`get`/`list`/`assets`) MUST filter in-query with the SAME predicate as
//! `policies/knowledge.sql` `documents_read` (which mirrors `hybrid_search`): a doc is readable by
//! (tenant, actor) iff its classification is public/internal, OR the actor owns it, OR it is a
//! confidential doc in a space the actor is a member of, OR a restricted doc in a space the actor
//! owns. `get_document` returns **404** (not 403) when the predicate excludes the doc — never leak
//! existence. Every value is a bound parameter; only the static predicate SQL fragment is
//! interpolated (it carries no caller input).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::Claims,
    rag::store::{DocStore, NewDocument},
    routes::rpc::{audit, authorize},
    state::SharedState,
};

/// The document READ predicate — a byte-for-byte replica of `policies/knowledge.sql`
/// `documents_read` (itself mirroring `hybrid_search`). Bound params: `$1` = tenant, `$2` = actor
/// (the caller's `profile_id`). Applied against the `public.documents` alias `d`. Interpolating
/// this CONSTANT is safe (it contains no caller-supplied data — every value is a `$` parameter);
/// callers append their own filters using `$3+`.
const DOC_READ_PREDICATE: &str = "\
    d.tenant_id = $1 \
    and ( \
      d.classification in ('public', 'internal') \
      or d.profile_id = $2 \
      or (d.classification = 'confidential' and d.space_id is not null and exists ( \
            select 1 from public.space_members sm \
            where sm.tenant_id = d.tenant_id \
              and sm.space_id  = d.space_id \
              and sm.profile_id = $2)) \
      or (d.classification = 'restricted' and d.space_id is not null and exists ( \
            select 1 from public.spaces s \
            where s.tenant_id = d.tenant_id \
              and s.id        = d.space_id \
              and s.owner_id  = $2)) \
    )";

/// Signed-download TTL for asset URLs (seconds). Operator-overridable via `TORII_SIGNED_URL_TTL_S`;
/// the const is only the fallback (no-hardcoded-ops).
fn signed_url_ttl_s() -> u32 {
    std::env::var("TORII_SIGNED_URL_TTL_S")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300)
}

/// Whether (tenant, actor) may READ document `doc` — the read predicate as an existence check. Used
/// to gate mutations on existing docs (ingest/delete) so a caller can't act on a doc they can't see
/// (no cross-classification over-reach, no existence leak — the caller gets a 404).
async fn can_access_doc(pool: &sqlx::PgPool, tenant: Uuid, actor: Uuid, doc: Uuid) -> bool {
    let sql =
        format!("select exists(select 1 from public.documents d where d.id = $3 and {DOC_READ_PREDICATE})");
    sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(actor)
        .bind(doc)
        .fetch_one(pool)
        .await
        .unwrap_or(false)
}

/// Whether (tenant, actor) owns or is a member of `space` — the create-target space gate (a doc.write
/// holder must not be able to inject a document into a space they don't belong to).
async fn can_write_space(pool: &sqlx::PgPool, tenant: Uuid, actor: Uuid, space: Uuid) -> bool {
    sqlx::query_scalar(
        "select exists( \
           select 1 from public.spaces s \
           where s.tenant_id = $1 and s.id = $2 \
             and ( s.owner_id = $3 \
                or exists(select 1 from public.space_members m \
                          where m.tenant_id = $1 and m.space_id = $2 and m.profile_id = $3)))",
    )
    .bind(tenant)
    .bind(space)
    .bind(actor)
    .fetch_one(pool)
    .await
    .unwrap_or(false)
}

#[derive(Deserialize)]
pub struct CreateDocument {
    #[serde(default)]
    pub title: Option<String>,
    pub original_filename: String,
    pub content_type: String,
    #[serde(default)]
    pub space_id: Option<Uuid>,
    #[serde(default)]
    pub collection_id: Option<Uuid>,
    #[serde(default)]
    pub classification: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

/// `POST /v1/documents` — capability `doc.write`. Registers a document (+ its version-1 row) owned
/// by the caller and returns a short-lived signed upload URL for the original bytes. Classification
/// defaults to `internal`, scope to `user` (mirrors the DDL defaults).
pub async fn create_document(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<CreateDocument>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    // No cross-space injection: registering INTO a space requires membership/ownership of it.
    if let Some(space) = body.space_id {
        if !can_write_space(&state.pool, tenant, actor, space).await {
            return (StatusCode::FORBIDDEN, "not a member of the target space").into_response();
        }
    }
    let meta = NewDocument {
        title: body.title,
        original_filename: body.original_filename,
        content_type: body.content_type,
        scope: body.scope.unwrap_or_else(|| "user".into()),
        classification: body.classification.unwrap_or_else(|| "internal".into()),
        space_id: body.space_id,
        collection_id: body.collection_id,
        profile_id: actor,
    };
    let store = DocStore::new(state.pool.clone());
    let (doc_id, version_no, storage_path) = match store.register_document(tenant, &meta).await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("create_document: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };
    // Best-effort signed upload URL: a storage outage must not leave a registered doc unreturnable
    // (the client can re-request a URL). null upload_url on failure.
    let upload_url = match state.object_store.signed_upload(&storage_path).await {
        Ok(u) => Some(u),
        Err(e) => {
            tracing::warn!("create_document: signed upload for {doc_id}: {e}");
            None
        }
    };
    audit(&state, tenant, actor, "document.created", "document", Some(doc_id)).await;
    (
        StatusCode::OK,
        Json(json!({ "document_id": doc_id, "version_no": version_no, "upload_url": upload_url })),
    )
        .into_response()
}

/// `POST /v1/documents/{id}/ingest` — capability `doc.write`. Kicks the ingestion pipeline
/// (parse → redact-at-rest → chunk → embed → index) on a spawned task and returns immediately;
/// the client polls `GET /v1/documents/{id}` for status. Idempotent (re-runnable).
pub async fn ingest_document(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if !can_access_doc(&state.pool, tenant, actor, id).await {
        return (StatusCode::NOT_FOUND, "document not found").into_response();
    }
    spawn_ingest(&state, tenant, actor, id);
    audit(&state, tenant, actor, "document.ingest.queued", "document", Some(id)).await;
    (
        StatusCode::OK,
        Json(json!({ "document_id": id, "status": "queued" })),
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct ReingestQuery {
    /// Optional stage to resume from (accepted for API stability; v1 always re-runs the full
    /// pipeline — a resumable partial re-run is a tracked follow-up).
    #[serde(default)]
    pub from: Option<String>,
}

/// `POST /v1/documents/{id}/reingest?from=` — capability `doc.write`. v1 re-runs the FULL
/// pipeline (`from` is accepted but ignored); `commit_chunks` atomically retires the prior
/// version's chunks so retrieval never straddles two versions.
pub async fn reingest_document(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
    Query(_q): Query<ReingestQuery>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.write").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if !can_access_doc(&state.pool, tenant, actor, id).await {
        return (StatusCode::NOT_FOUND, "document not found").into_response();
    }
    spawn_ingest(&state, tenant, actor, id);
    audit(&state, tenant, actor, "document.reingest.queued", "document", Some(id)).await;
    (
        StatusCode::OK,
        Json(json!({ "document_id": id, "status": "queued" })),
    )
        .into_response()
}

/// Spawn the ingest task (marking `queued` first, best-effort + tenant-scoped, so a poll before the
/// pipeline starts shows `queued`). Errors inside the task land `status='failed'` + a
/// `status_reason` (see `Ingestor::run`); we only log the join-side.
fn spawn_ingest(state: &SharedState, tenant: Uuid, actor: Uuid, doc: Uuid) {
    let ingestor = state.ingestor.clone();
    tokio::spawn(async move {
        if let Err(e) = ingestor.store.set_status(tenant, doc, "queued", None).await {
            tracing::warn!("c5 ingest: set queued for {doc}: {e}");
        }
        if let Err(e) = ingestor.run(tenant, doc, actor).await {
            tracing::warn!("c5 ingest {doc}: {e}");
        }
    });
}

/// `GET /v1/documents/{id}` — capability `doc.read`, then the read predicate. Returns metadata +
/// status + status_reason + classification + chunk_count + versions. **404** when the predicate
/// excludes the doc (does not distinguish "no such doc" from "not allowed" — no existence leak).
pub async fn get_document(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.read").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let sql = format!(
        "select json_build_object( \
            'document_id', d.id, \
            'title', d.title, \
            'original_filename', d.original_filename, \
            'content_type', d.content_type, \
            'scope', d.scope, \
            'classification', d.classification, \
            'status', d.lifecycle::text, 'stage', d.stage, \
            'status_reason', d.status_reason, \
            'chunk_count', d.chunk_count, \
            'embedding_model', d.embedding_model, \
            'space_id', d.space_id, \
            'collection_id', d.collection_id, \
            'created_at', d.uploaded_at, \
            'completed_at', d.completed_at, \
            'versions', coalesce(( \
               select json_agg(json_build_object( \
                   'version_id', v.id, 'version_no', v.version_no, \
                   'content_type', v.content_type, 'created_at', v.created_at, \
                   'superseded_at', v.superseded_at) order by v.version_no) \
               from public.document_versions v \
               where v.tenant_id = d.tenant_id and v.document_id = d.id), '[]'::json) \
         ) \
         from public.documents d \
         where d.id = $3 and {DOC_READ_PREDICATE}"
    );
    let row: Result<Option<Value>, _> = sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(actor)
        .bind(id)
        .fetch_optional(&state.pool)
        .await;
    match row {
        Ok(Some(doc)) => (StatusCode::OK, Json(doc)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "document not found").into_response(),
        Err(e) => {
            tracing::error!("get_document: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub space_id: Option<Uuid>,
    #[serde(default)]
    pub collection: Option<Uuid>,
    #[serde(default)]
    pub status: Option<String>,
}

/// `GET /v1/documents?space_id=&collection=&status=` — capability `doc.read`, then the read
/// predicate applied to every row (so the list only ever contains docs the caller may read).
pub async fn list_documents(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Query(q): Query<ListQuery>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.read").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let sql = format!(
        "select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from ( \
           select d.id as document_id, d.title, d.original_filename, d.content_type, \
                  d.classification, d.lifecycle::text as status, d.stage, d.status_reason, d.chunk_count, \
                  d.space_id, d.collection_id, d.uploaded_at as created_at, d.completed_at \
             from public.documents d \
            where {DOC_READ_PREDICATE} \
              and ($3::uuid is null or d.space_id = $3) \
              and ($4::uuid is null or d.collection_id = $4) \
              and ($5::text is null or d.lifecycle::text = $5 or d.stage = $5) \
            order by d.uploaded_at desc \
            limit 500) t"
    );
    let rows: Result<Value, _> = sqlx::query_scalar(&sql)
        .bind(tenant)
        .bind(actor)
        .bind(q.space_id)
        .bind(q.collection)
        .bind(q.status)
        .fetch_one(&state.pool)
        .await;
    match rows {
        Ok(documents) => (StatusCode::OK, Json(json!({ "documents": documents }))).into_response(),
        Err(e) => {
            tracing::error!("list_documents: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

/// `GET /v1/documents/{id}/assets` — capability `doc.read`, then the read predicate on the PARENT
/// doc (404 if excluded — no existence leak). Only THEN are `document_assets` listed, each with a
/// freshly-minted short-lived signed download URL. A URL that fails to mint is returned as `null`
/// (best-effort) rather than failing the whole list.
pub async fn get_assets(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.read").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    // Read predicate on the parent doc FIRST (404 if excluded — assets inherit the doc's access).
    let readable_sql = format!(
        "select exists(select 1 from public.documents d where d.id = $3 and {DOC_READ_PREDICATE})"
    );
    let readable: bool = match sqlx::query_scalar(&readable_sql)
        .bind(tenant)
        .bind(actor)
        .bind(id)
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("get_assets predicate: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
        }
    };
    if !readable {
        return (StatusCode::NOT_FOUND, "document not found").into_response();
    }

    let assets: Vec<(Uuid, String, Option<String>, Option<String>, Option<i32>, Option<i32>, Option<String>)> =
        match sqlx::query_as(
            "select id, kind::text, storage_path, label, sequence, page_ref, caption \
               from public.document_assets \
              where tenant_id = $1 and document_id = $2 \
              order by kind, sequence",
        )
        .bind(tenant)
        .bind(id)
        .fetch_all(&state.pool)
        .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("get_assets list: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response();
            }
        };

    let ttl = signed_url_ttl_s();
    let mut out: Vec<Value> = Vec::with_capacity(assets.len());
    for (aid, kind, storage_path, label, sequence, page_ref, caption) in assets {
        let download_url = match &storage_path {
            Some(p) => match state.object_store.signed_download(p, ttl).await {
                Ok(u) => Some(u),
                Err(e) => {
                    tracing::warn!("get_assets: sign download for asset {aid}: {e}");
                    None
                }
            },
            None => None,
        };
        out.push(json!({
            "id": aid,
            "kind": kind,
            "label": label,
            "sequence": sequence,
            "page_ref": page_ref,
            "caption": caption,
            "download_url": download_url,
        }));
    }
    (StatusCode::OK, Json(json!({ "assets": out }))).into_response()
}

/// `DELETE /v1/documents/{id}` — capability `doc.delete`. Hard-deletes the document (FK cascade
/// retires its versions/assets/chunks). Tenant-scoped (404 if not in the caller's tenant — no
/// cross-tenant delete). Audited.
pub async fn delete_document(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.delete").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    // Can't delete a doc you can't see (narrows doc.delete from tenant-wide to accessible docs).
    if !can_access_doc(&state.pool, tenant, actor, id).await {
        return (StatusCode::NOT_FOUND, "document not found").into_response();
    }
    let store = DocStore::new(state.pool.clone());
    match store.delete_document(tenant, id).await {
        Ok(0) => (StatusCode::NOT_FOUND, "document not found in tenant").into_response(),
        Ok(_) => {
            audit(&state, tenant, actor, "document.deleted", "document", Some(id)).await;
            (StatusCode::OK, Json(json!({ "deleted": true }))).into_response()
        }
        Err(e) => {
            tracing::error!("delete_document: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "delete failed").into_response()
        }
    }
}
