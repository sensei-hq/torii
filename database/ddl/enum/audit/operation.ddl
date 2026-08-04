-- database/ddl/enum/audit/operation.ddl
set search_path to audit;
-- db-redesign.md §3 audit→history enum: the SCD-2 DML op on history.past_* twins (today only
-- history.past_feature_states.operation exists; future past_* twins reuse it). UPPERCASE to match
-- Postgres TG_OP. historize_feature_states() writes TG_OP (text) → casts tg_op::audit.operation
-- (text→enum has no assignment coercion). Literal comparisons (tg_op='DELETE') coerce.
create type operation as enum ('INSERT', 'UPDATE', 'DELETE');
