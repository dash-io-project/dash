#!/bin/bash
# Enable password auth, publish the native port, and load the fixture.
# The official entrypoint then drops to the cassandra user and starts the node.

set -euo pipefail

conf="${CASSANDRA_CONF:-/etc/cassandra}/cassandra.yaml"
port="${CASSANDRA_NATIVE_PORT:-39042}"

if ! [[ "$port" =~ ^[0-9]+$ ]]; then
  echo "CASSANDRA_NATIVE_PORT is invalid" >&2
  exit 1
fi

sed -i \
  -e "s/^authenticator:.*/authenticator: PasswordAuthenticator/" \
  -e "s/^authorizer:.*/authorizer: CassandraAuthorizer/" \
  -e "s/^native_transport_port:.*/native_transport_port: ${port}/" \
  -e "s/^materialized_views_enabled:.*/materialized_views_enabled: true/" \
  "$conf"

export CASSANDRA_BROADCAST_RPC_ADDRESS="${CASSANDRA_BROADCAST_RPC_ADDRESS:-127.0.0.1}"
export CASSANDRA_RPC_ADDRESS="${CASSANDRA_RPC_ADDRESS:-0.0.0.0}"

child=0
shutdown() {
  if [ "$child" -ne 0 ]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap shutdown TERM INT

/usr/local/bin/docker-entrypoint.sh cassandra -f &
child=$!

ready=0
for _ in $(seq 1 90); do
  if cqlsh -u cassandra -p cassandra 127.0.0.1 "$port" -e "SELECT release_version FROM system.local" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$child" 2>/dev/null; then
    echo "Cassandra stopped before it accepted connections" >&2
    exit 1
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "Cassandra did not accept connections" >&2
  exit 1
fi

cqlsh -u cassandra -p cassandra 127.0.0.1 "$port" -f /opt/dash/init.cql
echo "Cassandra fixture is ready"

wait "$child"
