-- database/ddl/enum/core/classification_level.ddl
set search_path to core;

-- db-redesign.md §3 shared enum: the fixed 4-level data-classification lattice
-- (low→high sensitivity). Backs documents.classification, spaces.classification, and
-- dataset_columns.sensitivity. A future governance.classifications LOOKUP carries the
-- editable label/policy metadata OVER this fixed enum (§3) — the enum stays the type.
--
-- Reads flow through json_agg/json_build_object (enum → text label, no cast). Bound-&str
-- writes need $N::core.classification_level. The documents RLS read-policy + the
-- guard_document_classification trigger compare via literals/`is distinct from`, which
-- coerce over the enum. See tests/enums.sql + policies/knowledge.sql.
create type classification_level as enum ('public', 'internal', 'confidential', 'restricted');
