-- database/ddl/function/public/forbid_mutation.ddl
set search_path to public, extensions;

-- O1 (P6): append-only audit ledger. A BEFORE UPDATE/DELETE trigger raises, so
-- `audit_events` is immutable even to `service_role` / the gateway superuser role —
-- not just to `authenticated` (which RLS already denies via the absence of an
-- UPDATE/DELETE policy). This gives tamper-EVIDENCE: the only way to alter the
-- ledger is to DROP this trigger or ALTER the table, both of which are themselves
-- privileged DDL acts an operator can audit out-of-band.
--
-- (v1: DSR "erase" is field-level redaction-in-place — a controlled future path
-- that will run through a SECURITY DEFINER function gated by a session flag, not a
-- raw UPDATE; until that lands, the ledger is strictly append-only.)
create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only ledger: % on % is forbidden', TG_OP, TG_TABLE_NAME
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.forbid_mutation();

comment on function public.forbid_mutation() is
'O1: append-only guard — raises on UPDATE/DELETE so a ledger table is immutable
even to service_role/superuser (tamper-evidence). Attached to audit_events.';
