set search_path to public, extensions;

create table if not exists planned_tasks (
  tenant_id         uuid    not null
, id                uuid    not null default gen_random_uuid()
, plan_id           uuid    not null
, task_name         text    not null
, type              text    not null
    check (type in ('planning', 'action', 'react_loop', 'consolidator'))
, description       text    not null
, goal              text    not null
, tool_name         text
, tool_args         jsonb
, dependencies      jsonb   not null default '[]'
, parallel_group    text
, status            text    not null default 'pending'
    check (status in ('pending', 'queued', 'running', 'completed', 'failed', 'skipped', 'cancelled'))
, input             jsonb
, output            jsonb
, error_message     text
, model             text
, router            text
, chain             text
, cost              numeric
, input_tokens      integer
, output_tokens     integer
, started_at        bigint
, completed_at      bigint
, duration_ms       bigint
, gateway_task_id   uuid
, primary key (tenant_id, id)
, constraint planned_tasks_ukey unique (tenant_id, plan_id, task_name)
, constraint planned_tasks_plan_fkey foreign key (tenant_id, plan_id)
    references plans(tenant_id, id) on delete cascade
, constraint planned_tasks_gateway_fkey foreign key (tenant_id, gateway_task_id)
    references gateway_tasks(tenant_id, task_id) on delete set null
) partition by list (tenant_id);

create index if not exists idx_planned_tasks_plan_id on planned_tasks(tenant_id, plan_id);
create index if not exists idx_planned_tasks_status  on planned_tasks(status);

comment on table planned_tasks is
'Individual tasks within a plan — forms a DAG via the dependencies array.
- tenant_id: new column, partition key
- Composite FKs to plans and gateway_tasks prevent cross-tenant references
- gateway_tasks FK now targets (tenant_id, task_id) unique index on gateway_tasks
- Timestamps are epoch milliseconds';
