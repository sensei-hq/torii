-- database/ddl/enum/content/message_role.ddl
set search_path to content;
-- db-redesign.md §3 content→chat enum: messages.role (Ask turn author). Only DB site is the
-- bound write in ask.rs insert_message → $3::content.message_role. The chat.rs request-payload
-- `role` fields are on the wire struct, NOT this column. No DB read.
create type message_role as enum ('user', 'assistant', 'system');
