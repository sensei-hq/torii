-- database/ddl/view/audit/audit_events_for_tenant.ddl
set search_path to audit, core, extensions;

-- §D §B shield view: the stable read contract for the audit feed (/v1/audit), decoupling it from
-- the public→audit table move. Joins core.profiles for the actor display name. Gateway-internal
-- read model (read via the pool, tenant-filtered + `audit.read`-gated in ledger.rs::get_audit) —
-- NOT granted to authenticated (same convention as effective_chain_models), so no PostgREST bypass.
create or replace view audit_events_for_tenant as
select
  e.tenant_id
, e.id
, e.actor_id
, p.display_name as actor          -- design contract: actor(display)
, e.action
, e.target_type
, e.target_id
, e.ip_address   as ip
, e.created_at
from audit.audit_events e
left join core.profiles p on p.id = e.actor_id;

comment on view audit_events_for_tenant is
'AuditEvent read shield (§D §B): audit.audit_events × core.profiles → id/actor(display)/action/
target/ip/created_at. Backs /v1/audit; gateway filters tenant_id + gates on audit.read. Append-only
source — no U/D. Isolates the audit feed from the audit_events schema move.';
