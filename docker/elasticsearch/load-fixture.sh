#!/usr/bin/env bash
# Idempotent fixture for @dash/adapter-elasticsearch.
# Indices use keyword and integer mappings so term and range filters match
# the values Dash sends. paid_orders is an alias over a hidden index.

set -euo pipefail

password="${ELASTIC_PASSWORD:-dash_test}"
if [[ "${password}" == *[$'\n\r\t']* ]]; then
  echo "ELASTIC_PASSWORD contains a control character" >&2
  exit 1
fi
json_password="${password//\\/\\\\}"
json_password="${json_password//\"/\\\"}"
auth=(-u "elastic:${password}" -H "Content-Type: application/json")

curl -sf "${auth[@]}" -X PUT "http://127.0.0.1:9200/_security/role/dash_read" -d '{
  "cluster": ["monitor"],
  "indices": [
    {
      "names": ["orders", "revenue", "paid_orders"],
      "privileges": ["read", "view_index_metadata"]
    },
    {
      "names": ["paid_orders_data"],
      "privileges": ["read", "view_index_metadata"],
      "allow_restricted_indices": true
    }
  ]
}' >/dev/null

curl -sf "${auth[@]}" -X PUT "http://127.0.0.1:9200/_security/user/dash" -d "{
  \"password\": \"${json_password}\",
  \"roles\": [\"dash_read\"]
}" >/dev/null

put_index() {
  local name="$1"
  local body="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -u "elastic:${password}" "http://127.0.0.1:9200/${name}")"
  if [[ "${code}" == "200" ]]; then
    return
  fi
  curl -sf "${auth[@]}" -X PUT "http://127.0.0.1:9200/${name}" -d "${body}" >/dev/null
}

put_index orders '{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id": { "type": "integer" },
      "total": { "type": "integer" },
      "status": { "type": "keyword" },
      "region": { "type": "keyword" },
      "note": { "type": "keyword" }
    }
  }
}'

put_index revenue '{
  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "month": { "type": "keyword" },
      "amount": { "type": "integer" }
    }
  }
}'

put_index paid_orders_data '{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "index.hidden": true
  },
  "mappings": {
    "properties": {
      "id": { "type": "integer" },
      "total": { "type": "integer" },
      "status": { "type": "keyword" },
      "region": { "type": "keyword" }
    }
  }
}'

bulk="$(curl -sf -u "elastic:${password}" -H "Content-Type: application/x-ndjson" \
  -X POST "http://127.0.0.1:9200/_bulk?refresh=true" --data-binary @- <<'EOF'
{"index":{"_index":"orders","_id":"1"}}
{"id":1,"total":10,"status":"paid","region":"Europe","note":"first"}
{"index":{"_index":"orders","_id":"2"}}
{"id":2,"total":25,"status":"paid","region":"Europe"}
{"index":{"_index":"orders","_id":"3"}}
{"id":3,"total":5,"status":"open","region":"Asia Pacific","note":"third"}
{"index":{"_index":"orders","_id":"4"}}
{"id":4,"total":40,"status":"paid","region":"North America"}
{"index":{"_index":"orders","_id":"5"}}
{"id":5,"total":25,"status":"hold","region":"Other"}
{"index":{"_index":"revenue","_id":"1"}}
{"month":"2026-01","amount":10}
{"index":{"_index":"revenue","_id":"2"}}
{"month":"2026-02","amount":20}
{"index":{"_index":"revenue","_id":"3"}}
{"month":"2026-03","amount":15}
{"index":{"_index":"paid_orders_data","_id":"1"}}
{"id":1,"total":10,"status":"paid","region":"Europe"}
{"index":{"_index":"paid_orders_data","_id":"2"}}
{"id":2,"total":25,"status":"paid","region":"Europe"}
{"index":{"_index":"paid_orders_data","_id":"4"}}
{"id":4,"total":40,"status":"paid","region":"North America"}
EOF
)"
if [[ "${bulk}" == *'"errors":true'* ]]; then
  echo "${bulk}" >&2
  exit 1
fi

curl -sf "${auth[@]}" -X POST "http://127.0.0.1:9200/_aliases" -d '{
  "actions": [
    { "add": { "index": "paid_orders_data", "alias": "paid_orders" } }
  ]
}' >/dev/null
