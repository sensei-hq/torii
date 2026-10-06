-- database/ddl/enum/catalog/tos_verdict.ddl
set search_path to catalog;
-- G1 catalog enum: catalog.models.free_tos — ToS verdict for proxy/relay use of a free tier.
-- Mirrors the gateway's `TosVerdict`. Surfaced on the Models screen as a badge: routing a
-- tenant's traffic through a free tier whose terms forbid it is a legal exposure, so the
-- verdict travels WITH the allowance rather than living in a separate policy doc.
create type tos_verdict as enum ('ok', 'caution', 'ambiguous');
