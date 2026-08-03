-- C5 · hybrid retrieval + isolation test harness — run after `dbd apply`.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/retrieval.sql   (or: tests/run.sh)
-- Any failed assertion raises → non-zero exit. hybrid_search takes p_tenant_id/p_profile_id
-- explicitly (the service_role gateway path), so isolation is tested directly (no JWT context).
\set ON_ERROR_STOP on

\echo '== 1. dual-write: the generated tsv leg cannot go stale =='
begin;
do $$
declare
  t uuid := '11111111-1111-1111-1111-111111111111';
  d uuid := '1d1d1d1d-0000-0000-0000-000000000001';
  c uuid := 'c1c1c1c1-0000-0000-0000-000000000001';
  v vector(1024);
  hit boolean;
begin
  select ('[' || string_agg('0.03', ',') || ']')::vector(1024) into v from generate_series(1,1024);
  insert into documents(tenant_id, id, original_filename, content_type, classification, status)
    values (t, d, 'a.md', 'text/markdown', 'internal', 'completed');
  -- insert content ONLY; tsv is a GENERATED column → written in the SAME row automatically
  insert into document_embeddings(tenant_id, id, document_id, version_id, chunk_sequence, content, embedding)
    values (t, c, d, gen_random_uuid(), 0, 'the quick brown fox jumps over the lazy dog', v);

  select tsv @@ websearch_to_tsquery('english','fox') into hit from document_embeddings where id = c;
  if not hit then raise exception 'FAIL: generated tsv did not index content on insert'; end if;

  -- update content → tsv must recompute (no separate write)
  update document_embeddings set content = 'a completely different sentence about penguins' where id = c;
  select tsv @@ websearch_to_tsquery('english','fox') into hit from document_embeddings where id = c;
  if hit then raise exception 'FAIL: tsv still matches stale term after content update'; end if;
  select tsv @@ websearch_to_tsquery('english','penguins') into hit from document_embeddings where id = c;
  if not hit then raise exception 'FAIL: tsv did not recompute on content update'; end if;

  -- delete → gone from both legs (single row)
  delete from document_embeddings where id = c;
  if exists (select 1 from document_embeddings where id = c) then raise exception 'FAIL: chunk not deleted'; end if;
  raise notice 'dual-write generated tsv (insert/update/delete) holds ✓';
end $$;
rollback;
\echo 'RETRIEVAL dual-write TEST PASSED'

\echo '== 2. cross-tenant recall = 0 (adversarial identical embedding) =='
begin;
do $$
declare
  ta uuid := '11111111-1111-1111-1111-111111111111';
  tb uuid := '22222222-2222-2222-2222-222222222222';
  da uuid := 'd0c0a000-0000-0000-0000-0000000000a1';
  db uuid := 'd0c0b000-0000-0000-0000-0000000000b1';
  reader uuid := 'aaaa0000-0000-0000-0000-000000000001';
  v vector(1024);
  leaked int;
  own int;
begin
  select ('[' || string_agg('0.05', ',') || ']')::vector(1024) into v from generate_series(1,1024);
  -- tenant A and tenant B each hold an IDENTICAL chunk (same vector + same content)
  insert into documents(tenant_id, id, original_filename, content_type, classification, status) values
    (ta, da, 'a.md', 'text/markdown', 'internal', 'completed'),
    (tb, db, 'b.md', 'text/markdown', 'internal', 'completed');
  insert into document_embeddings(tenant_id, id, document_id, version_id, chunk_sequence, content, embedding) values
    (ta, gen_random_uuid(), da, gen_random_uuid(), 0, 'shared secret roadmap alpha', v),
    (tb, gen_random_uuid(), db, gen_random_uuid(), 0, 'shared secret roadmap alpha', v);

  -- query as tenant A with the EXACT vector B also holds
  select count(*) into leaked from hybrid_search(v, 'shared secret roadmap', ta, reader) where document_id = db;
  if leaked > 0 then raise exception 'FAIL: cross-tenant leak — tenant A retrieved tenant B chunk (% rows)', leaked; end if;

  select count(*) into own from hybrid_search(v, 'shared secret roadmap', ta, reader) where document_id = da;
  if own = 0 then raise exception 'FAIL: tenant A could not retrieve its OWN chunk (predicate too strict)'; end if;

  -- re-assert for the legacy dense-only similarity_search too
  select count(*) into leaked from similarity_search(v, 0.0, 50, null, null, reader, ta) where document_id = db;
  if leaked > 0 then raise exception 'FAIL: cross-tenant leak via similarity_search'; end if;
  raise notice 'cross-tenant recall = 0 (hybrid_search + similarity_search), own chunk retrievable ✓';
end $$;
rollback;
\echo 'RETRIEVAL cross-tenant TEST PASSED'

\echo '== 3. classification + space-membership predicate (mirrors knowledge.sql) =='
begin;
do $$
declare
  t uuid := '11111111-1111-1111-1111-111111111111';
  sp uuid := '5face000-0000-0000-0000-0000000000f1';
  owner_u uuid := '0000aaaa-0000-0000-0000-000000000001';   -- space owner, NOT a space_member
  member_u uuid := '0000bbbb-0000-0000-0000-000000000002';  -- space_member, NOT owner
  outsider uuid := '0000cccc-0000-0000-0000-000000000003';  -- tenant member, not in space
  uploader uuid := '0000dddd-0000-0000-0000-000000000004';  -- doc profile_id (not a reader)
  d_pub uuid := 'd0000001-0000-0000-0000-000000000001';
  d_conf uuid := 'd0000002-0000-0000-0000-000000000002';
  d_rest uuid := 'd0000003-0000-0000-0000-000000000003';
  v vector(1024);
begin
  select ('[' || string_agg('0.07', ',') || ']')::vector(1024) into v from generate_series(1,1024);
  insert into core.tenants(id, name, slug, modified_by) values (t, 'TestT', 'testt-c5', 'test')
    on conflict (id) do nothing;
  insert into spaces(tenant_id, id, name, owner_id, modified_by) values (t, sp, 'S', owner_u, 'test');
  insert into space_members(tenant_id, space_id, profile_id) values (t, sp, member_u);
  insert into documents(tenant_id, id, original_filename, content_type, classification, status, space_id, profile_id) values
    (t, d_pub,  'p.md', 'text/markdown', 'public',       'completed', sp, uploader),
    (t, d_conf, 'c.md', 'text/markdown', 'confidential', 'completed', sp, uploader),
    (t, d_rest, 'r.md', 'text/markdown', 'restricted',   'completed', sp, uploader);
  insert into document_embeddings(tenant_id, id, document_id, version_id, chunk_sequence, content, embedding) values
    (t, gen_random_uuid(), d_pub,  gen_random_uuid(), 0, 'quarterly plan overview', v),
    (t, gen_random_uuid(), d_conf, gen_random_uuid(), 0, 'quarterly plan overview', v),
    (t, gen_random_uuid(), d_rest, gen_random_uuid(), 0, 'quarterly plan overview', v);

  -- helper: does reader R see doc D via hybrid_search?
  -- outsider (tenant member, not in space): PUBLIC only
  if not exists (select 1 from hybrid_search(v,'quarterly plan',t,outsider) where document_id=d_pub)
    then raise exception 'FAIL: outsider cannot see public doc'; end if;
  if exists (select 1 from hybrid_search(v,'quarterly plan',t,outsider) where document_id=d_conf)
    then raise exception 'FAIL: outsider saw a CONFIDENTIAL doc (not a space member)'; end if;
  if exists (select 1 from hybrid_search(v,'quarterly plan',t,outsider) where document_id=d_rest)
    then raise exception 'FAIL: outsider saw a RESTRICTED doc'; end if;

  -- member (space_member, not owner): PUBLIC + CONFIDENTIAL, NOT restricted
  if not exists (select 1 from hybrid_search(v,'quarterly plan',t,member_u) where document_id=d_conf)
    then raise exception 'FAIL: space member cannot see confidential doc'; end if;
  if exists (select 1 from hybrid_search(v,'quarterly plan',t,member_u) where document_id=d_rest)
    then raise exception 'FAIL: space member saw a RESTRICTED doc (not the space/doc owner)'; end if;

  -- space owner (owner_id, not a space_member): PUBLIC + RESTRICTED, NOT confidential
  if not exists (select 1 from hybrid_search(v,'quarterly plan',t,owner_u) where document_id=d_rest)
    then raise exception 'FAIL: space owner cannot see restricted doc'; end if;
  if exists (select 1 from hybrid_search(v,'quarterly plan',t,owner_u) where document_id=d_conf)
    then raise exception 'FAIL: space owner saw a CONFIDENTIAL doc without space membership'; end if;

  -- doc owner (profile_id) always sees own doc regardless of classification
  if not exists (select 1 from hybrid_search(v,'quarterly plan',t,uploader) where document_id=d_rest)
    then raise exception 'FAIL: doc owner (profile_id) cannot see own restricted doc'; end if;
  raise notice 'classification + space-membership predicate enforced (public/confidential/restricted/owner) ✓';
end $$;
rollback;
\echo 'RETRIEVAL classification TEST PASSED'

\echo '== 4. superseded chunks excluded + both legs scored =='
begin;
do $$
declare
  t uuid := '11111111-1111-1111-1111-111111111111';
  d uuid := 'd0000004-0000-0000-0000-000000000004';
  reader uuid := '0000eeee-0000-0000-0000-000000000005';
  live_chunk uuid := 'c0000001-0000-0000-0000-000000000001';
  old_chunk uuid := 'c0000002-0000-0000-0000-000000000002';
  v vector(1024);
  r record;
  saw_old boolean := false;
begin
  select ('[' || string_agg('0.09', ',') || ']')::vector(1024) into v from generate_series(1,1024);
  insert into documents(tenant_id, id, original_filename, content_type, classification, status)
    values (t, d, 'v.md', 'text/markdown', 'internal', 'completed');
  insert into document_embeddings(tenant_id, id, document_id, version_id, chunk_sequence, content, embedding, superseded_at) values
    (t, live_chunk, d, gen_random_uuid(), 0, 'migration guide for the widget service', v, null),
    (t, old_chunk,  d, gen_random_uuid(), 1, 'migration guide for the widget service', v, now());  -- retired prior version

  for r in select chunk_id, dense_sim, bm25_score, rrf_score from hybrid_search(v, 'migration guide widget', t, reader) loop
    if r.chunk_id = old_chunk then saw_old := true; end if;
    if r.chunk_id = live_chunk then
      if r.dense_sim is null then raise exception 'FAIL: dense_sim missing on a matched chunk'; end if;
      if r.bm25_score is null then raise exception 'FAIL: bm25_score missing (lexical leg not scored)'; end if;
      if r.rrf_score is null or r.rrf_score <= 0 then raise exception 'FAIL: rrf_score not fused'; end if;
    end if;
  end loop;
  if saw_old then raise exception 'FAIL: hybrid_search returned a SUPERSEDED chunk'; end if;
  if not exists (select 1 from hybrid_search(v, 'migration guide widget', t, reader) where chunk_id = live_chunk)
    then raise exception 'FAIL: live chunk not returned'; end if;
  raise notice 'superseded excluded + dense/bm25/rrf scores present ✓';
end $$;
rollback;
\echo 'RETRIEVAL superseded+scores TEST PASSED'

\echo '✅ C5 RETRIEVAL SUITE PASSED'
