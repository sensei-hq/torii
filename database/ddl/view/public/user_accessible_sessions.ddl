-- database/ddl/view/public/user_accessible_sessions.ddl
set search_path to public, extensions;

create or replace view user_accessible_sessions as
select
  s.tenant_id
, s.id
, s.user_id
, s.module_id
, s.previous_session_id
, s.status
, s.created_at
, s.completed_at
, s.duration_ms
from sessions s;

comment on view user_accessible_sessions is
'Role-aware session access view.
Access control is enforced at the API layer via caller context headers:
  - Platform admin (X-User-Role=platform_admin): all sessions across all tenants
  - Tenant admin  (X-User-Role=tenant_admin):   all sessions where tenant_id = X-Tenant-Id
  - User          (X-User-Role=user):            sessions where tenant_id = X-Tenant-Id AND user_id = X-User-Id
The view exposes all rows; filtering is applied by the repository query that reads it.
This keeps the view simple and avoids session-variable coupling (set_config / current_setting).';
