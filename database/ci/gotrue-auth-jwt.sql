-- The one auth.* function torii's schema needs that the bare supabase/postgres image lacks.
--
-- The image's init scripts create auth.uid(), auth.role() and auth.email(); auth.jwt() comes from
-- GoTrue's own migrations (20220531120530_add_auth_jwt_function), which only run when the auth
-- service boots. A full Supabase stack (`supabase start`) has it; a lone Postgres service — CI's —
-- does not, and `dbd deploy` then fails on the first function or policy that reads the JWT.
-- The body is GoTrue's, verbatim. Idempotent.
create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;
