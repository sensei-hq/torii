pub mod chat;
pub mod health;
pub mod ledger;   // O1: capability-gated ledger reads (/v1/audit, /v1/requests)
pub mod rpc;      // C1: gateway-mediated privileged writes (/rpc/*)
pub mod status;
pub mod whoami;
