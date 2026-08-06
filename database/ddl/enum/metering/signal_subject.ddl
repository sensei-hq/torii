-- database/ddl/enum/metering/signal_subject.ddl
set search_path to metering;
-- §D Ledger Normalize (§7-#6): the typed subject discriminant for quality_signals + feedback. Replaces
-- the fragile "inference_call_id OR message_id OR source LIKE 'c5.%'" polymorphism with an enum + a
-- CHECK (exactly one target per subject_type). 'event' = a C5 event-level signal (a retrieval op /
-- ingest-redaction batch keyed to a document/space event) — no call/message/conversation; its target
-- lives in value_json. (RATIFIED 2026-08-06: keep 'event' rather than force C5 to rekey to the embed call.)
create type signal_subject as enum ('call', 'message', 'conversation', 'event');
