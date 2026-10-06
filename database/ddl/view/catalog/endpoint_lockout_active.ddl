-- database/ddl/view/catalog/endpoint_lockout_active.ddl
set search_path to catalog, extensions;

-- G4: the endpoints that are locked RIGHT NOW — the only correct way to ask.
--
-- The naive form, `select … from endpoint_lockouts where locked_until > now()`, is wrong and
-- wrong in the dangerous direction: a TERMINAL lock (credits exhausted, dead credential) has a
-- NULL deadline, so the comparison is NULL, the row is dropped, and the endpoint reads as
-- healthy. The gateway would keep routing to an endpoint it cannot authenticate against.
--
-- A terminal lock is always active; a recoverable one is active until its deadline passes. The
-- expired row is deliberately LEFT in the base table — its escalation count is the memory that
-- makes a repeat offender wait longer next time.
create or replace view catalog.endpoint_lockout_active as
select
  l.tenant_id
, l.router_id
, l.model_id
, l.reason
, l.locked_until
, l.escalation
, l.first_locked_at
, (l.locked_until is null) as is_terminal
from catalog.endpoint_lockouts l
where l.locked_until is null          -- terminal: active until a human clears it
   or l.locked_until > now();         -- recoverable: active until its deadline

comment on view catalog.endpoint_lockout_active is
'G4: endpoints currently locked out. Includes TERMINAL locks (NULL deadline), which a bare
`locked_until > now()` silently drops — failing open on dead credentials. Query this, not the
base table. Expired recoverable rows stay in the base table to preserve escalation memory.';
