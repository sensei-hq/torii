-- C5: seed the 'embedding' fallback chain → Ollama mxbai-embed-large (1024-dim, matches
-- document_embeddings vector(1024)) so Gateway::execute(TextEmbed, chain='embedding') resolves.
-- No-hardcoded-ops: the gateway reads this from config at startup; TORII_EMBED_CHAIN selects it.
-- Idempotent (WHERE NOT EXISTS) — applied via dbd import `after:` and safe to run standalone.
set search_path to public, config, extensions;

-- 1. the embedding model (provider_id nullable — Ollama serves it; the model's maker is metadata).
insert into catalog.models
  (name, version, full_name, display_name, description, context_window, license_type, config, modified_by)
select 'mxbai-embed-large', '1', 'mxbai-embed-large', 'mxbai-embed-large (1024d)',
       'Mixedbread 1024-dim text embedding, served in-process/local via Ollama', 512, 'Apache-2.0',
       '{}'::jsonb, 'seed:c5'
where not exists (select 1 from catalog.models where full_name = 'mxbai-embed-large');

-- 2. capability link: this model does embedding.
insert into catalog.model_capabilities (model_id, capability_id, supported, modified_by)
select m.id, c.id, true, 'seed:c5'
from catalog.models m, catalog.capability_types c
where m.full_name = 'mxbai-embed-large' and c.name = 'embedding'
  and not exists (
    select 1 from catalog.model_capabilities mc where mc.model_id = m.id and mc.capability_id = c.id);

-- 3. endpoint: served by the ollama router at its OpenAI-compat /v1/embeddings.
insert into catalog.model_endpoints
  (model_id, router_id, capability_id, region, endpoint_url, router_model_id, priority,
   is_active, is_default, local_capable, supports_streaming, modified_by)
select m.id, r.id, c.id, 'local', 'http://localhost:11434/v1/embeddings', 'mxbai-embed-large', 10,
       true, true, false, false, 'seed:c5'
from catalog.models m, catalog.routers r, catalog.capability_types c
where m.full_name = 'mxbai-embed-large' and r.name = 'ollama' and c.name = 'embedding'
  and not exists (
    select 1 from catalog.model_endpoints e
    where e.model_id = m.id and e.router_id = r.id and e.capability_id = c.id);

-- 4. the platform-tenant 'embedding' chain.
insert into public.fallback_chains
  (tenant_id, name, capability_id, max_fallback_attempts, is_active, priority, description, modified_by)
select '00000000-0000-0000-0000-000000000000', 'embedding', c.id, 3, true, 1,
       'C5 embedding chain — Ollama mxbai-embed-large (1024d)', 'seed:c5'
from catalog.capability_types c
where c.name = 'embedding'
  and not exists (
    select 1 from public.fallback_chains
    where tenant_id = '00000000-0000-0000-0000-000000000000' and name = 'embedding');

-- 5. bind the model into the chain.
insert into public.fallback_chain_models
  (tenant_id, fallback_chain_id, router_id, model_id, sequence_order, is_active, plane, modified_by)
select '00000000-0000-0000-0000-000000000000', fc.id, r.id, m.id, 1, true, 'local', 'seed:c5'
from public.fallback_chains fc, catalog.routers r, catalog.models m
where fc.tenant_id = '00000000-0000-0000-0000-000000000000' and fc.name = 'embedding'
  and r.name = 'ollama' and m.full_name = 'mxbai-embed-large'
  and not exists (
    select 1 from public.fallback_chain_models fcm
    where fcm.fallback_chain_id = fc.id and fcm.model_id = m.id);
