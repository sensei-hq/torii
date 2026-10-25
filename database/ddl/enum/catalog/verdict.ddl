-- database/ddl/enum/catalog/verdict.ddl
set search_path to catalog, extensions;

-- A measured ranking's verdict (System One Phase 3). The four values are the
-- artifact's: only `winner` carries an order; `tie` is a set; `insufficient`
-- means too few shared cases (or fewer than two ranked models); `unranked`
-- means the category has no measured rows at all.
create type verdict as enum ('winner', 'tie', 'insufficient', 'unranked');
