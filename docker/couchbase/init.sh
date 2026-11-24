#!/bin/bash
# Start Couchbase and load the Dash fixture.
# Community Server requires a password of 6 characters or more.
# The fixture password is dashdash.

set -euo pipefail

export PATH="/opt/couchbase/bin:/opt/couchbase/bin/tools:${PATH}"

CB_USER="${COUCHBASE_ADMINISTRATOR_USERNAME:-dash}"
CB_PASS="${DASH_COUCHBASE_PASSWORD:-dashdash}"
ALT_HOST="${DASH_COUCHBASE_ALT_HOST:-127.0.0.1}"
ALT_KV="${DASH_COUCHBASE_ALT_KV:-11299}"
ALT_MGMT="${DASH_COUCHBASE_ALT_MGMT:-18099}"
ALT_QUERY="${DASH_COUCHBASE_ALT_QUERY:-18093}"
READY="/tmp/dash-couchbase-ready"

case "$ALT_HOST" in
  ""|*[!A-Za-z0-9.-]*|*..*)
    echo "Couchbase alternate host is invalid" >&2
    exit 1
    ;;
esac
for port in "$ALT_KV" "$ALT_MGMT" "$ALT_QUERY"; do
  case "$port" in
    ""|*[!0-9]*)
      echo "Couchbase alternate port is invalid" >&2
      exit 1
      ;;
  esac
done

/entrypoint.sh couchbase-server &
server_pid=$!

stop_server() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap stop_server TERM INT

echo "Wait for the Couchbase REST port"
ready=0
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8091/pools" || true)
  if [ "$code" = "200" ] || [ "$code" = "401" ]; then
    ready=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Couchbase server exited before the REST port opened" >&2
    exit 1
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "Couchbase REST port did not open" >&2
  exit 1
fi

echo "Initialize the cluster"
initialized=0
for _ in $(seq 1 30); do
  if curl -sf -u "${CB_USER}:${CB_PASS}" "http://127.0.0.1:8091/pools/default" >/dev/null; then
    initialized=1
    break
  fi
  if couchbase-cli cluster-init \
    --cluster "http://127.0.0.1:8091" \
    --cluster-username "$CB_USER" \
    --cluster-password "$CB_PASS" \
    --services data,index,query \
    --cluster-ramsize 256 \
    --cluster-index-ramsize 256; then
    initialized=1
    break
  fi
  sleep 3
done
if [ "$initialized" -ne 1 ]; then
  echo "Couchbase cluster-init failed" >&2
  exit 1
fi

echo "Publish alternate addresses for the host ports"
curl -sf -u "${CB_USER}:${CB_PASS}" \
  -X PUT "http://127.0.0.1:8091/node/controller/setupAlternateAddresses/external" \
  -d "hostname=${ALT_HOST}" \
  -d "kv=${ALT_KV}" \
  -d "mgmt=${ALT_MGMT}" \
  -d "n1ql=${ALT_QUERY}" >/dev/null

if ! curl -sf -u "${CB_USER}:${CB_PASS}" "http://127.0.0.1:8091/pools/default/buckets/dash" >/dev/null; then
  echo "Create the dash bucket"
  couchbase-cli bucket-create \
    -c "127.0.0.1:8091" \
    -u "$CB_USER" \
    -p "$CB_PASS" \
    --bucket dash \
    --bucket-type couchbase \
    --bucket-ramsize 128 \
    --bucket-replica 0 \
    --wait
fi

couchbase-cli collection-manage \
  -c "127.0.0.1:8091" \
  -u "$CB_USER" \
  -p "$CB_PASS" \
  --bucket dash \
  --create-scope analytics || true

couchbase-cli collection-manage \
  -c "127.0.0.1:8091" \
  -u "$CB_USER" \
  -p "$CB_PASS" \
  --bucket dash \
  --create-collection analytics.orders || true

couchbase-cli collection-manage \
  -c "127.0.0.1:8091" \
  -u "$CB_USER" \
  -p "$CB_PASS" \
  --bucket dash \
  --create-collection analytics.revenue || true

couchbase-cli collection-manage \
  -c "127.0.0.1:8091" \
  -u "$CB_USER" \
  -p "$CB_PASS" \
  --bucket dash \
  --drop-collection _default._default || true

n1ql() {
  local statement=$1
  local body
  body=$(curl -sS -u "${CB_USER}:${CB_PASS}" \
    "http://127.0.0.1:8093/query/service" \
    --data-urlencode "statement=${statement}") || return 1
  printf '%s\n' "$body"
  compact=$(printf '%s' "$body" | tr -d '[:space:]')
  case "$compact" in
    *'"status":"success"'*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "Wait for the query service"
query_ready=0
for _ in $(seq 1 40); do
  if n1ql "SELECT 1 AS ok" >/dev/null; then
    query_ready=1
    break
  fi
  sleep 3
done
if [ "$query_ready" -ne 1 ]; then
  echo "Couchbase query service did not start" >&2
  exit 1
fi

echo "Create primary indexes"
for _ in $(seq 1 20); do
  if n1ql 'CREATE PRIMARY INDEX IF NOT EXISTS ON dash.analytics.orders' >/dev/null \
    && n1ql 'CREATE PRIMARY INDEX IF NOT EXISTS ON dash.analytics.revenue' >/dev/null; then
    break
  fi
  sleep 3
done

echo "Load fixture documents"
loaded_docs=0
for _ in $(seq 1 20); do
  if n1ql 'UPSERT INTO dash.analytics.orders (KEY, VALUE) VALUES ("1", {"id": 1, "total": 10, "status": "paid", "region": "Europe", "note": "first"}), ("2", {"id": 2, "total": 25, "status": "paid", "region": "Europe", "note": null}), ("3", {"id": 3, "total": 5, "status": "open", "region": "Asia Pacific", "note": "third"}), ("4", {"id": 4, "total": 40, "status": "paid", "region": "North America", "note": null})' >/dev/null \
    && n1ql 'UPSERT INTO dash.analytics.revenue (KEY, VALUE) VALUES ("2026-01", {"month": "2026-01", "amount": 10}), ("2026-02", {"month": "2026-02", "amount": 20}), ("2026-03", {"month": "2026-03", "amount": 15})' >/dev/null; then
    loaded_docs=1
    break
  fi
  sleep 3
done
if [ "$loaded_docs" -ne 1 ]; then
  echo "Couchbase fixture documents were not loaded" >&2
  exit 1
fi

echo "Wait until the fixture is queryable"
loaded=0
for _ in $(seq 1 30); do
  body=$(n1ql "SELECT RAW COUNT(*) FROM dash.analytics.revenue" || true)
  compact=$(printf '%s' "$body" | tr -d '[:space:]')
  case "$compact" in
    *'"results":[3]'*)
      loaded=1
      break
      ;;
  esac
  sleep 2
done
if [ "$loaded" -ne 1 ]; then
  echo "Couchbase fixture did not become queryable" >&2
  exit 1
fi

touch "$READY"
echo "Couchbase fixture is ready"
wait "$server_pid"
