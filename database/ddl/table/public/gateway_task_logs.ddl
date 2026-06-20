set search_path to public, extensions;

create table if not exists gateway_task_logs (
  tenant_id         uuid        not null
, id                uuid        not null default uuid_generate_v4()
, gateway_task_id   uuid        not null
, sequence          integer     not null
, event_type        varchar(30) not null
    check (event_type in ('attempt', 'skip', 'fallback', 'quota_check', 'circuit_breaker'))
, router            varchar(100) not null
, model             varchar(100) not null
, api_model_id      varchar(200)
, capability        varchar(50) not null
, status            varchar(20) not null
    check (status in ('success', 'failed', 'skipped'))
, started_at        timestamptz not null default now()
, duration          interval    not null
, input_tokens      integer
, output_tokens     integer
, cost_incurred     decimal(10,6)
, error_category    varchar(100)
, error_message     text
, original_error    text
, http_status       integer
, retryable         boolean     not null default false
, fallback_triggered boolean    not null default false
, fallback_reason   varchar(100)
, modified_at       timestamptz not null default now()
, modified_by       varchar
, primary key (tenant_id, id)
, unique (tenant_id, gateway_task_id, sequence)
, foreign key (tenant_id, gateway_task_id)
    references gateway_tasks(tenant_id, task_id) on delete cascade
);

create index if not exists gateway_task_logs_idx1
  on gateway_task_logs(tenant_id, gateway_task_id);

comment on table gateway_task_logs is
'Per-attempt records within a gateway task.
- tenant_id: new column, partition key
- gateway_task_id: renamed from task_id; composite FK to gateway_tasks(tenant_id, task_id)
- One row per attempt/event (attempt, skip, fallback, quota_check, circuit_breaker)
- started_at is timestamptz; duration is an interval';
