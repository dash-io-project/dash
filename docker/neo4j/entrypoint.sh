#!/usr/bin/env bash
# Start Neo4j, load the fixture, then wait. Compose signals this process.
set -euo pipefail

pid=""
cleanup() {
  if [[ -n "${pid}" ]]; then
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

/startup/docker-entrypoint.sh neo4j &
pid=$!

ready=0
for _ in $(seq 1 90); do
  if timeout 8 cypher-shell -a bolt://127.0.0.1:7687 -u neo4j -p dash -d neo4j "RETURN 1;" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "${pid}" 2>/dev/null; then
    echo "Neo4j exited during startup" >&2
    exit 1
  fi
  sleep 2
done

if [[ "${ready}" -ne 1 ]]; then
  echo "Neo4j did not accept connections" >&2
  exit 1
fi

timeout 60 cypher-shell -a bolt://127.0.0.1:7687 -u neo4j -p dash -d neo4j --file /opt/dash/fixture.cypher

wait "${pid}"
