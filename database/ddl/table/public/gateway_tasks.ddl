set search_path to public, extensions;

create table if not exists gateway_tasks (
  tenant_id          uuid        not null
, id                 uuid        not null default uuid_generate_v4()
, task_id            uuid        not null default gen_random_uuid()
, status             varchar(20) not null default 'running'
    check (status in ('running', 'success', 'failed'))
, capability         varchar(50) not null
, chain_id           varchar(100)
, router_requested   varchar(100)
, model_requested    varchar(100)
, budget_limit       decimal(10,6)
, total_attempts     integer     not null default 0
, successful_attempt integer
, candidate_models   text[]      not null default '{}'
, started_at         bigint      not null
, completed_at       bigint
, duration_ms        bigint
, estimated_cost     decimal(10,6)
, actual_cost        decimal(10,6)
, input_tokens       integer
, output_tokens      integer
, total_tokens       integer
, currency           varchar(3)  not null default 'USD'
, final_router       varchar(100)
, final_model        varchar(100)
, response_preview   text
, error_category     varchar(100)
, error_message      text
, user_id            varchar(100)
, tags               text
, modified_at        timestamptz not null default now()
, modified_by        varchar
, primary key (tenant_id, id)
) partition by list (tenant_id);

-- Required for composite FK targets from gateway_task_logs and planned_tasks
create unique index if not exists gateway_tasks_tenant_task_ukey
  on gateway_tasks(tenant_id, task_id);

create index if not exists gateway_tasks_idx1 on gateway_tasks(status);
create index if not exists gateway_tasks_idx2 on gateway_tasks(started_at);
create index if not exists gateway_tasks_idx3 on gateway_tasks(capability);

comment on table gateway_tasks is
'Gateway request lifecycle tracking.
- tenant_id: partition key (renamed+retyped from organization_id varchar(100))
- (tenant_id, task_id) unique index required for composite FK from child tables
- One row per gateway request with input, execution summary, cost, and result
- Timestamps are epoch milliseconds (matching Convex convention)';
