pub mod chat;
pub mod documents; // C5: RAG document HTTP surface (/v1/documents/*)
pub mod health;
pub mod judge; // C6: synchronous quality-judge scoring (/v1/judge) — desktop Compare
pub mod ledger; // O1: capability-gated ledger reads (/v1/audit, /v1/requests)
pub mod retrieve; // C5: RAG hybrid retrieval (/v1/spaces/:id/retrieve)
pub mod rpc; // C1: gateway-mediated privileged writes (/rpc/*)
pub mod status;
pub mod whoami;
