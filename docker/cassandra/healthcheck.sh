#!/bin/bash
# The node is queryable when the fixture row and the view row both exist.

set -euo pipefail

port="${CASSANDRA_NATIVE_PORT:-39042}"

has_row() {
  local query="$1"
  local output
  output="$(cqlsh --no-color -u dash -p dash 127.0.0.1 "$port" -e "$query")"
  case "$output" in
    *"(1 rows)"*) return 0 ;;
    *) return 1 ;;
  esac
}

has_row "SELECT id FROM dash.orders WHERE tenant = 'dash' AND id = 1"
has_row "SELECT id FROM dash.orders_by_status WHERE tenant = 'dash' AND status = 'paid' AND id = 1"
