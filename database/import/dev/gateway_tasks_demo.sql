-- Demo gateway task data for development/demo environment
-- Inserts ~25 tasks with logs across the last 7 days
-- Tenant: 00000000-0000-0000-0000-000000000001 (platform tenant)

DO $$
DECLARE
  tid uuid := '00000000-0000-0000-0000-000000000001';
  now_ms bigint := extract(epoch from now()) * 1000;
  t_id uuid;

  -- helpers
  tasks jsonb := '[
    {"cap":"chat",      "chain":"chat",      "router":"openai",      "model":"gpt-4o",                   "status":"success", "attempts":1, "dur":1240,  "in":823,  "out":412,  "cost":0.008215, "offset_ms":60000},
    {"cap":"chat",      "chain":"chat",      "router":"anthropic",   "model":"claude-3-5-sonnet-20241022","status":"success", "attempts":1, "dur":1890,  "in":1104, "out":687,  "cost":0.013005, "offset_ms":180000},
    {"cap":"chat",      "chain":"fast",      "router":"openai",      "model":"gpt-4o-mini",              "status":"success", "attempts":1, "dur":620,   "in":244,  "out":183,  "cost":0.000214, "offset_ms":300000},
    {"cap":"chat",      "chain":"chat",      "router":"openrouter",  "model":"meta-llama/llama-3.3-70b", "status":"failed",  "attempts":3, "dur":5100,  "in":512,  "out":0,    "cost":0.000000, "offset_ms":420000},
    {"cap":"embedding", "chain":"",          "router":"openai",      "model":"text-embedding-3-large",   "status":"success", "attempts":1, "dur":340,   "in":2048, "out":0,    "cost":0.000266, "offset_ms":600000},
    {"cap":"chat",      "chain":"demo",      "router":"anthropic",   "model":"claude-3-haiku-20240307",  "status":"success", "attempts":1, "dur":980,   "in":389,  "out":291,  "cost":0.000485, "offset_ms":900000},
    {"cap":"vision",    "chain":"",          "router":"openai",      "model":"gpt-4-vision-preview",     "status":"success", "attempts":1, "dur":2340,  "in":650,  "out":398,  "cost":0.014390, "offset_ms":1200000},
    {"cap":"chat",      "chain":"cheap",     "router":"openrouter",  "model":"mistral/mistral-small-3.1","status":"success", "attempts":1, "dur":1120,  "in":445,  "out":312,  "cost":0.000379, "offset_ms":1800000},
    {"cap":"embedding", "chain":"",          "router":"openai",      "model":"text-embedding-3-small",   "status":"success", "attempts":1, "dur":290,   "in":4096, "out":0,    "cost":0.000082, "offset_ms":3600000},
    {"cap":"chat",      "chain":"chat",      "router":"openai",      "model":"gpt-4o",                   "status":"success", "attempts":2, "dur":3870,  "in":1240, "out":823,  "cost":0.018570, "offset_ms":7200000},
    {"cap":"chat",      "chain":"generate",  "router":"anthropic",   "model":"claude-3-5-sonnet-20241022","status":"success","attempts":1, "dur":4210,  "in":2103, "out":1847, "cost":0.051585, "offset_ms":14400000},
    {"cap":"chat",      "chain":"fast",      "router":"openai",      "model":"gpt-4o-mini",              "status":"failed",  "attempts":2, "dur":2100,  "in":178,  "out":0,    "cost":0.000000, "offset_ms":21600000},
    {"cap":"vision",    "chain":"",          "router":"openai",      "model":"gpt-4o",                   "status":"success", "attempts":1, "dur":1890,  "in":890,  "out":542,  "cost":0.016640, "offset_ms":28800000},
    {"cap":"embedding", "chain":"",          "router":"openai",      "model":"text-embedding-3-large",   "status":"success", "attempts":1, "dur":410,   "in":8192, "out":0,    "cost":0.001065, "offset_ms":43200000},
    {"cap":"chat",      "chain":"chat",      "router":"openai",      "model":"gpt-4o",                   "status":"success", "attempts":1, "dur":1560,  "in":712,  "out":489,  "cost":0.009505, "offset_ms":57600000},
    {"cap":"chat",      "chain":"chat",      "router":"anthropic",   "model":"claude-3-5-sonnet-20241022","status":"success","attempts":1, "dur":2230,  "in":934,  "out":723,  "cost":0.018390, "offset_ms":72000000},
    {"cap":"chat",      "chain":"cheap",     "router":"openrouter",  "model":"google/gemma-3-27b-it",    "status":"success", "attempts":1, "dur":1340,  "in":367,  "out":288,  "cost":0.000328, "offset_ms":86400000},
    {"cap":"chat",      "chain":"demo",      "router":"openai",      "model":"gpt-4o-mini",              "status":"success", "attempts":1, "dur":780,   "in":523,  "out":394,  "cost":0.000553, "offset_ms":172800000},
    {"cap":"embedding", "chain":"",          "router":"openai",      "model":"text-embedding-ada-002",   "status":"success", "attempts":1, "dur":320,   "in":1024, "out":0,    "cost":0.000102, "offset_ms":259200000},
    {"cap":"chat",      "chain":"generate",  "router":"anthropic",   "model":"claude-3-5-haiku-20241022","status":"success", "attempts":1, "dur":3120,  "in":1893, "out":1245, "cost":0.008900, "offset_ms":345600000},
    {"cap":"vision",    "chain":"",          "router":"openai",      "model":"gpt-4o",                   "status":"failed",  "attempts":1, "dur":9000,  "in":0,    "out":0,    "cost":0.000000, "offset_ms":432000000},
    {"cap":"chat",      "chain":"fast",      "router":"openai",      "model":"gpt-4o-mini",              "status":"success", "attempts":1, "dur":540,   "in":189,  "out":142,  "cost":0.000165, "offset_ms":518400000},
    {"cap":"chat",      "chain":"chat",      "router":"openai",      "model":"gpt-4o",                   "status":"success", "attempts":1, "dur":1740,  "in":945,  "out":634,  "cost":0.011345, "offset_ms":604800000},
    {"cap":"embedding", "chain":"",          "router":"openai",      "model":"text-embedding-3-large",   "status":"success", "attempts":1, "dur":380,   "in":3072, "out":0,    "cost":0.000399, "offset_ms":691200000},
    {"cap":"chat",      "chain":"chat",      "router":"anthropic",   "model":"claude-3-5-sonnet-20241022","status":"success","attempts":1, "dur":1980,  "in":1056, "out":812,  "cost":0.019560, "offset_ms":777600000}
  ]';

  task_rec jsonb;
  started bigint;
  completed bigint;
  task_uuid uuid;  -- the task_id column (FK target for logs)

BEGIN
  -- Insert each demo task
  FOR task_rec IN SELECT * FROM jsonb_array_elements(tasks)
  LOOP
    t_id := gen_random_uuid();
    task_uuid := gen_random_uuid();
    started := now_ms - (task_rec->>'offset_ms')::bigint;
    completed := started + (task_rec->>'dur')::bigint;

    INSERT INTO public.gateway_tasks (
      tenant_id, id, task_id, status, capability,
      chain_id, router_requested,
      total_attempts, successful_attempt,
      candidate_models,
      started_at, completed_at, duration_ms,
      estimated_cost, actual_cost,
      input_tokens, output_tokens, total_tokens,
      final_router, final_model, currency
    ) VALUES (
      tid,
      t_id,
      task_uuid,
      task_rec->>'status',
      task_rec->>'cap',
      NULLIF(task_rec->>'chain', ''),
      task_rec->>'router',
      (task_rec->>'attempts')::int,
      CASE WHEN task_rec->>'status' = 'success' THEN 1 ELSE NULL END,
      ARRAY[(task_rec->>'router') || '/' || (task_rec->>'model')],
      started, completed,
      (task_rec->>'dur')::bigint,
      (task_rec->>'cost')::numeric,
      CASE WHEN task_rec->>'status' = 'success' THEN (task_rec->>'cost')::numeric ELSE NULL END,
      NULLIF((task_rec->>'in')::int, 0),
      NULLIF((task_rec->>'out')::int, 0),
      NULLIF((task_rec->>'in')::int + (task_rec->>'out')::int, 0),
      CASE WHEN task_rec->>'status' = 'success' THEN task_rec->>'router' ELSE NULL END,
      CASE WHEN task_rec->>'status' = 'success' THEN task_rec->>'model' ELSE NULL END,
      'USD'
    );

    -- Insert the primary attempt log
    INSERT INTO public.gateway_task_logs (
      tenant_id, gateway_task_id, sequence,
      event_type, router, model, capability,
      status, started_at, duration_ms,
      input_tokens, output_tokens, cost_incurred,
      retryable, fallback_triggered
    ) VALUES (
      tid, task_uuid, 1,
      'attempt',
      task_rec->>'router',
      task_rec->>'model',
      task_rec->>'cap',
      CASE WHEN (task_rec->>'attempts')::int = 1 THEN task_rec->>'status'
           WHEN task_rec->>'status' = 'failed' THEN 'failed'
           ELSE 'failed' END,
      started,
      CASE WHEN (task_rec->>'attempts')::int = 1 THEN (task_rec->>'dur')::bigint
           ELSE (task_rec->>'dur')::bigint / 2 END,
      NULLIF((task_rec->>'in')::int, 0),
      CASE WHEN (task_rec->>'attempts')::int = 1 THEN NULLIF((task_rec->>'out')::int, 0) ELSE NULL END,
      CASE WHEN (task_rec->>'attempts')::int = 1 THEN NULLIF((task_rec->>'cost')::numeric, 0) ELSE NULL END,
      true,
      (task_rec->>'attempts')::int > 1
    );

    -- If multi-attempt, add a successful second attempt
    IF (task_rec->>'attempts')::int > 1 AND task_rec->>'status' = 'success' THEN
      INSERT INTO public.gateway_task_logs (
        tenant_id, gateway_task_id, sequence,
        event_type, router, model, capability,
        status, started_at, duration_ms,
        input_tokens, output_tokens, cost_incurred,
        retryable, fallback_triggered
      ) VALUES (
        tid, task_uuid, 2,
        'attempt',
        task_rec->>'router',
        task_rec->>'model',
        task_rec->>'cap',
        'success',
        started + (task_rec->>'dur')::bigint / 2,
        (task_rec->>'dur')::bigint / 2,
        NULLIF((task_rec->>'in')::int, 0),
        NULLIF((task_rec->>'out')::int, 0),
        NULLIF((task_rec->>'cost')::numeric, 0),
        false,
        false
      );
    END IF;

  END LOOP;

  RAISE NOTICE 'Inserted % demo gateway tasks', jsonb_array_length(tasks);
END;
$$;
