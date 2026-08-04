-- database/ddl/enum/metering/signal_class.ddl
set search_path to metering;
-- db-redesign.md §3 metering enum: quality_signals.signal_class (how a signal originated).
-- 1:1 with the live CHECK {explicit,implicit,system}. §3 eventually narrows to {implicit,system}
-- (explicit user feedback splits into a NEW metering.feedback table, §7-#4, not built) — that
-- narrowing is DEFERRED to the feedback-split slice; all 5 current writers use literal 'implicit'.
-- Best-effort writes, all literals → coerce; no reads. Sibling signal_subject deferred to §7-#6.
create type signal_class as enum ('explicit', 'implicit', 'system');
