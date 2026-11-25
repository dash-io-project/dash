#!/usr/bin/env bash
# Start Elasticsearch, load the fixture, and keep the server in the foreground.
# The image's own entrypoint only sets the bootstrap password when the command
# is `elasticsearch`, so this script does that setup and then backgrounds the server.

set -euo pipefail

cd /usr/share/elasticsearch

password="${ELASTIC_PASSWORD:-dash_test}"

if [[ ! -f config/elasticsearch.keystore ]]; then
  bin/elasticsearch-keystore create
fi
if ! bin/elasticsearch-keystore list | grep -q '^bootstrap.password$'; then
  printf '%s' "$password" | bin/elasticsearch-keystore add -x 'bootstrap.password'
fi

server_pid=""
cleanup() {
  if [[ -n "${server_pid}" ]]; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi
}
trap cleanup TERM INT

bin/elasticsearch \
  -E discovery.type=single-node \
  -E network.host=0.0.0.0 \
  -E http.port=9200 \
  -E xpack.security.enabled=true \
  -E xpack.security.enrollment.enabled=false \
  -E xpack.security.http.ssl.enabled=false \
  -E xpack.security.transport.ssl.enabled=false \
  -E cluster.routing.allocation.disk.threshold_enabled=false \
  -E ingest.geoip.downloader.enabled=false \
  &
server_pid=$!

ready=0
for _ in $(seq 1 90); do
  if curl -sf -u "elastic:${password}" http://127.0.0.1:9200 >/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    wait "${server_pid}"
    exit 1
  fi
  sleep 2
done

if [[ "${ready}" -ne 1 ]]; then
  echo "Elasticsearch did not accept connections" >&2
  cleanup
  exit 1
fi

bash /opt/dash/load-fixture.sh
wait "${server_pid}"
