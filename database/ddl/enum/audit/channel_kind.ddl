-- database/ddl/enum/audit/channel_kind.ddl
set search_path to audit;
-- db-redesign.md §3 audit enum: notification_channels.kind. Only DB touch is siem.rs tick()
-- `where kind = 'siem'` (literal comparison → coerces, no cast; kind not projected). FORWARD-
-- WARNING: a future bound-&str write of kind needs $N::audit.channel_kind.
create type channel_kind as enum ('email', 'slack', 'webhook', 'siem');
