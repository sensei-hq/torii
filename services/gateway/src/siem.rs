//! O1 SIEM streaming (P6). A durable, at-least-once, **per-tenant-ordered** background
//! streamer that reads `audit_events` by the monotonic `(created_at, id)` cursor and
//! ships them to each enabled `siem` `notification_channel`. It resumes from the stored
//! cursor after a restart and only advances the cursor after the sink acknowledges — so
//! a sink outage means the same batch retries next tick (**at-least-once**, never lost).
//! Wire format: `{ "events": [ … ] }` JSON. A non-http `target` (e.g. `mock`) logs the
//! batch instead of sending (the operator configures an https sink for production).
//! (Per-tenant hash-chain tamper-evidence is a tracked follow-up.)

use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::state::SharedState;

const TICK: Duration = Duration::from_secs(5);
const BATCH: i64 = 100;

/// Spawn the background streamer. Ticks are no-ops when no `siem` channel exists.
pub fn spawn(state: SharedState) {
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        tracing::info!("siem: audit streamer started (tick {}s)", TICK.as_secs());
        loop {
            tokio::time::sleep(TICK).await;
            if let Err(e) = tick(&state, &client).await {
                tracing::warn!("siem: tick error: {e}");
            }
        }
    });
}

async fn tick(state: &SharedState, client: &reqwest::Client) -> Result<(), sqlx::Error> {
    let channels = sqlx::query(
        "select tenant_id, id, target from public.notification_channels \
          where kind = 'siem' and enabled = true",
    )
    .fetch_all(&state.pool)
    .await?;

    for c in channels {
        let tenant: Uuid = c.get("tenant_id");
        let channel: Uuid = c.get("id");
        let target: String = c.get("target");
        if let Err(e) = stream_channel(state, client, tenant, channel, &target).await {
            tracing::warn!("siem: channel {channel} error: {e}");
        }
    }
    Ok(())
}

async fn stream_channel(
    state: &SharedState,
    client: &reqwest::Client,
    tenant: Uuid,
    channel: Uuid,
    target: &str,
) -> Result<(), sqlx::Error> {
    // 1. Load the cursor (default: the epoch, min uuid).
    let cur = sqlx::query(
        "select last_created_at, last_id from public.siem_cursors \
          where tenant_id = $1 and channel_id = $2",
    )
    .bind(tenant)
    .bind(channel)
    .fetch_optional(&state.pool)
    .await?;
    let last_created: DateTime<Utc> = cur
        .as_ref()
        .map(|r| r.get("last_created_at"))
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp(0, 0).unwrap());
    let last_id: Uuid = cur
        .as_ref()
        .and_then(|r| r.get::<Option<Uuid>, _>("last_id"))
        .unwrap_or(Uuid::nil());

    // 2. Next batch strictly after the cursor, in monotonic order.
    let events = sqlx::query(
        "select id, actor_id, action, target_type, target_id, created_at \
           from public.audit_events \
          where tenant_id = $1 and (created_at, id) > ($2, $3) \
          order by created_at asc, id asc limit $4",
    )
    .bind(tenant)
    .bind(last_created)
    .bind(last_id)
    .bind(BATCH)
    .fetch_all(&state.pool)
    .await?;
    if events.is_empty() {
        return Ok(());
    }

    // 3. Serialize the batch.
    let batch: Vec<serde_json::Value> = events
        .iter()
        .map(|e| {
            serde_json::json!({
                "id": e.get::<Uuid, _>("id"),
                "tenant_id": tenant,
                "actor_id": e.get::<Option<Uuid>, _>("actor_id"),
                "action": e.get::<String, _>("action"),
                "target_type": e.get::<Option<String>, _>("target_type"),
                "target_id": e.get::<Option<Uuid>, _>("target_id"),
                "created_at": e.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();

    // 4. Ship. http(s) targets POST; anything else (e.g. `mock`) logs (dev/no-sink).
    let shipped = if target.starts_with("http://") || target.starts_with("https://") {
        match client
            .post(target)
            .json(&serde_json::json!({ "events": batch }))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => true,
            Ok(resp) => {
                tracing::warn!("siem: sink {target} returned {}", resp.status());
                false
            }
            Err(e) => {
                tracing::warn!("siem: sink {target} send error: {e}");
                false
            }
        }
    } else {
        tracing::info!(
            "siem[mock:{target}]: shipped {} audit event(s) for tenant {tenant}",
            batch.len()
        );
        true
    };

    // 5. Advance the cursor only on success (else retry next tick → at-least-once).
    if shipped {
        let last = events.last().unwrap();
        let lc: DateTime<Utc> = last.get("created_at");
        let li: Uuid = last.get("id");
        sqlx::query(
            "insert into public.siem_cursors (tenant_id, channel_id, last_created_at, last_id, updated_at) \
             values ($1, $2, $3, $4, now()) \
             on conflict (tenant_id, channel_id) do update set \
               last_created_at = excluded.last_created_at, last_id = excluded.last_id, updated_at = now()",
        )
        .bind(tenant)
        .bind(channel)
        .bind(lc)
        .bind(li)
        .execute(&state.pool)
        .await?;
    }
    Ok(())
}
