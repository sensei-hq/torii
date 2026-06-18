set search_path to public, extensions;

create table if not exists planned_task_interactions (
  tenant_id        uuid not null
, id               uuid not null default gen_random_uuid()
, planned_task_id  uuid not null
, tool_name        text not null
, status           text not null default 'pending'
    check (status in ('pending', 'responded', 'cancelled', 'timed_out'))
, request          jsonb not null
, response         jsonb
, created_at       bigint not null
, responded_at     bigint
, primary key (tenant_id, id)
, constraint pti_planned_task_fkey foreign key (tenant_id, planned_task_id)
    references planned_tasks(tenant_id, id) on delete cascade
) partition by list (tenant_id);

create index if not exists idx_pti_planned_task_id
  on planned_task_interactions(tenant_id, planned_task_id);

comment on table planned_task_interactions is
'HITL interaction requests within a planned task execution.
- tenant_id: new column, partition key
- Composite FK to planned_tasks prevents cross-tenant references
- Status lifecycle: pending → responded | cancelled | timed_out
- Timestamps are epoch milliseconds';
