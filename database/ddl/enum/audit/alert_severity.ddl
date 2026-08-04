-- database/ddl/enum/audit/alert_severity.ddl
set search_path to audit;
-- db-redesign.md §3 audit enum: alert_rules.severity + alert_events.severity (two columns).
-- Zero Rust surface today (alerts backend is RW8/Pass-2). FORWARD-WARNING: when RW8 writes
-- severity from Rust, bound &str params MUST cast $N::audit.alert_severity (literals coerce).
create type alert_severity as enum ('info', 'warning', 'critical');
