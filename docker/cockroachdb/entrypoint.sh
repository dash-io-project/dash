#!/bin/sh
# Start one secure CockroachDB node and load the adapter fixture.
# The node requires TLS. SQL clients use the CA certificate in /certs.

set -eu

CERTS=/certs
mkdir -p "$CERTS"
chmod 755 "$CERTS"

if [ ! -f "$CERTS/ca.crt" ]; then
  /cockroach/cockroach cert create-ca --certs-dir="$CERTS" --ca-key="$CERTS/ca.key" --allow-ca-key-reuse
  /cockroach/cockroach cert create-node localhost 127.0.0.1 ::1 cockroach --certs-dir="$CERTS" --ca-key="$CERTS/ca.key"
  /cockroach/cockroach cert create-client root --certs-dir="$CERTS" --ca-key="$CERTS/ca.key"
  chmod 644 "$CERTS/ca.crt" "$CERTS/node.crt"
  chmod 600 "$CERTS/ca.key" "$CERTS/node.key" "$CERTS/client.root.key"
fi

/cockroach/cockroach start-single-node \
  --certs-dir="$CERTS" \
  --listen-addr=0.0.0.0:26257 \
  --advertise-addr=localhost \
  --http-addr=127.0.0.1:8080 \
  --cache=128MiB \
  --max-sql-memory=128MiB \
  --store=type=mem,size=640MiB \
  &
pid=$!

stop_node() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
trap stop_node TERM INT

ready=0
i=0
while [ "$i" -lt 60 ]; do
  if /cockroach/cockroach sql --certs-dir="$CERTS" --host=localhost --execute "SELECT 1" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "cockroach exited during startup" >&2
    wait "$pid"
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "cockroach did not accept SQL in time" >&2
  stop_node
  exit 1
fi

/cockroach/cockroach sql --certs-dir="$CERTS" --host=localhost < /opt/dash/init.sql
/cockroach/cockroach sql \
  --url "postgresql://dash:dash@localhost:26257/dash?sslmode=verify-full&sslrootcert=/certs/ca.crt" \
  < /opt/dash/fixture.sql

wait "$pid"
