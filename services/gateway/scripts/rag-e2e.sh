#!/usr/bin/env bash
# C5 RAG live e2e: register → upload → ingest → poll → hybrid-retrieve → assets, against a running
# gateway + local Supabase (55322) + Ollama (mxbai-embed-large via the 'embedding' chain).
# Prereqs: gateway on $GW; a doc.*-capable JWT in $TOK; the 'documents' storage bucket; the embedding
# chain seeded (database/import/embedding_chain.sql). Usage: GW=… TOK=… bash scripts/rag-e2e.sh
set -euo pipefail
GW="${GW:-http://127.0.0.1:8799}"
DBURL="${DBURL:-postgresql://postgres:postgres@127.0.0.1:55322/postgres}"
TOK="${TOK:?set TOK to a Supabase JWT for a doc.* owner}"
AUTH=(-H "authorization: Bearer $TOK")
J() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

# owner + tenant from the JWT.
OWNER=$(python3 -c "import base64,json;p='$TOK'.split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p))['sub'])")
TENANT=$(python3 -c "import base64,json;p='$TOK'.split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p))['tenant_id'])")
SID=$(python3 -c "import uuid;print(uuid.uuid4())")

echo "== 1. create space $SID (owner=$OWNER) =="
psql "$DBURL" -q -c "insert into public.spaces (tenant_id, id, name, classification, owner_id, modified_by)
  values ('$TENANT','$SID','C5 E2E','internal','$OWNER','e2e') on conflict do nothing;"

echo "== 2. register document =="
REG=$(curl -s "$GW/v1/documents" "${AUTH[@]}" -H 'content-type: application/json' \
  -d "{\"original_filename\":\"e2e.md\",\"content_type\":\"text/markdown\",\"classification\":\"internal\",\"space_id\":\"$SID\"}")
echo "  $REG"
DID=$(echo "$REG" | J "['document_id']"); UP=$(echo "$REG" | J "['upload_url']")

echo "== 3. upload original (contains a live secret + PII) =="
printf '# Widget Migration Runbook\n\nThe widget migration runs nightly at 02:00 UTC; rollback uses the previous snapshot.\nDeploy key api_key = sk-LIVEKEY1234567890ABCDEFG must be rotated after use.\nContact ops@example.com for the on-call schedule.\n' > /tmp/e2e-doc.md
curl -s -X PUT "$UP" -H 'content-type: text/markdown' --data-binary @/tmp/e2e-doc.md >/dev/null
echo "  uploaded $(wc -c < /tmp/e2e-doc.md) bytes"

echo "== 4. ingest =="
curl -s -X POST "$GW/v1/documents/$DID/ingest" "${AUTH[@]}" | J ""

echo "== 5. poll status =="
ST=""
for i in $(seq 1 40); do
  ST=$(curl -s "$GW/v1/documents/$DID" "${AUTH[@]}" | J "['status']")
  echo "  [$i] $ST"
  [ "$ST" = "completed" ] && break
  if [ "$ST" = "failed" ]; then
    echo "  status_reason:"; curl -s "$GW/v1/documents/$DID" "${AUTH[@]}" | J "['status_reason']"; exit 1
  fi
  sleep 1
done
[ "$ST" = "completed" ] || { echo "did not complete"; exit 1; }

echo "== 6. hybrid retrieve (inspect) =="
RES=$(curl -s "$GW/v1/spaces/$SID/retrieve" "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"query":"widget migration rollback schedule","inspect":true}')
echo "$RES" | python3 -c "
import sys,json
d=json.load(sys.stdin); ch=d.get('chunks',[])
assert ch, 'FAIL: no chunks retrieved'
c=ch[0]; s=c['scores']
print('  chunks:', len(ch), '| top fused:', round(s['fused'],5), '| dense:', s['dense'], '| bm25:', s['bm25'])
print('  stages:', [ (x['name'], x['k_out']) for x in d['stages'] ])
print('  text:', c['text'][:110].replace(chr(10),' '))
blob=json.dumps(d)
assert 'sk-LIVEKEY1234567890ABCDEFG' not in blob, 'FAIL: RAW SECRET leaked in retrieve response'
assert 'ops@example.com' not in blob, 'FAIL: RAW email leaked'
assert '[REDACTED:' in c['text'], 'FAIL: no redaction placeholder in chunk'
assert 'widget migration' in c['text'].lower(), 'FAIL: expected content missing'
print('  ✓ retrieved, scored (dense+bm25+fused), redacted, no raw secret')
"

echo "== 7. assets (signed download URLs) =="
curl -s "$GW/v1/documents/$DID/assets" "${AUTH[@]}" | python3 -c "
import sys,json; d=json.load(sys.stdin); a=d.get('assets',[])
print('  assets:', sorted(set(x['kind'] for x in a)), '| signed:', all(x.get('download_url') for x in a))
assert any(x['kind']=='markdown' for x in a), 'FAIL: no markdown asset'
"

echo "== 8. cleanup =="
curl -s -X DELETE "$GW/v1/documents/$DID" "${AUTH[@]}" | J ""
psql "$DBURL" -q -c "delete from public.spaces where tenant_id='$TENANT' and id='$SID'; delete from public.quality_signals where tenant_id='$TENANT';"
echo "✅ C5 RAG LIVE E2E PASSED"
