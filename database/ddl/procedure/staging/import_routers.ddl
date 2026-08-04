set search_path to staging;

create or replace procedure import_routers()
language plpgsql
as
$$
begin
  insert into catalog.routers(
     name, display_name, description, router_type
   , website_url, documentation_url, api_base_url, api_key_env_var
   , authentication_type, default_headers, supported_auth_methods
   , regions, rate_limits, pricing_info_url, status_page_url
   , is_active, is_enterprise, requires_approval, sequence
   , modified_at, modified_by)
  select trim(stg.name), stg.display_name, stg.description
       , coalesce(stg.router_type, 'direct')::catalog.router_type
       , stg.website_url, stg.documentation_url, stg.api_base_url, stg.api_key_env_var
       , coalesce(stg.authentication_type, 'api_key')::catalog.auth_type
       , stg.default_headers, stg.supported_auth_methods
       , stg.regions, stg.rate_limits, stg.pricing_info_url, stg.status_page_url
       , coalesce(stg.is_active, true)
       , coalesce(stg.is_enterprise, false)
       , coalesce(stg.requires_approval, false)
       , coalesce(stg.sequence, 0)
       , coalesce(stg.modified_at, now())
       , coalesce(stg.modified_by, current_user)
    from staging.routers stg
   where not exists (select 1
                       from catalog.routers r
                      where r.name        = trim(stg.name)
                        and r.modified_at > stg.modified_at)
      on conflict(name)
      do update
            set display_name           = excluded.display_name
              , description            = excluded.description
              , router_type            = excluded.router_type
              , website_url            = excluded.website_url
              , documentation_url      = excluded.documentation_url
              , api_base_url           = excluded.api_base_url
              , api_key_env_var        = excluded.api_key_env_var
              , authentication_type    = excluded.authentication_type
              , default_headers        = excluded.default_headers
              , supported_auth_methods = excluded.supported_auth_methods
              , regions                = excluded.regions
              , rate_limits            = excluded.rate_limits
              , pricing_info_url       = excluded.pricing_info_url
              , status_page_url        = excluded.status_page_url
              , is_active              = excluded.is_active
              , is_enterprise          = excluded.is_enterprise
              , requires_approval      = excluded.requires_approval
              , sequence               = excluded.sequence
              , modified_by            = excluded.modified_by
              , modified_at            = excluded.modified_at;
end;
$$;
