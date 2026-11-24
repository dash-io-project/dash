#!/usr/bin/env bash
# Exit 0 when the fixture revenue nodes are present.
set -euo pipefail

output=$(timeout 12 cypher-shell -a bolt://127.0.0.1:7687 -u neo4j -p dash -d neo4j --format plain "MATCH (n:revenue) RETURN count(n) AS c;" || true)
if ! printf '%s\n' "$output" | grep -Eq '(^|[^0-9])3([^0-9]|$)'; then
  printf 'neo4j fixture is not ready: %s\n' "$output" >&2
  exit 1
fi
