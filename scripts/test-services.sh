#!/usr/bin/env bash
# Start or stop the Docker Compose clusters used by adapter tests.
# Usage: scripts/test-services.sh start|stop

set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required to manage adapter test clusters" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "error: docker compose v2 is required (the \`docker compose\` plugin)" >&2
  exit 1
fi

compose=(docker compose -p dash-test -f docker-compose.test.yml)

action=${1:-}
case "$action" in
  start)
    if [[ "$(uname -s)" == "Linux" ]]; then
      map_count=$(cat /proc/sys/vm/max_map_count 2>/dev/null || echo 0)
      if [[ "${map_count}" -lt 262144 ]]; then
        echo "warning: vm.max_map_count is ${map_count}. Elasticsearch needs 262144 or more." >&2
      fi
    fi
    "${compose[@]}" up -d --wait --remove-orphans
    pnpm --filter @dash/adapter-dynamodb exec node --experimental-strip-types src/seed-cluster.ts
    echo "PostgreSQL test cluster is ready at postgres://dash:dash@127.0.0.1:${DASH_TEST_POSTGRES_PORT:-54329}/dash"
    echo "MySQL test cluster is ready at mysql://dash:dash@127.0.0.1:${DASH_TEST_MYSQL_PORT:-33029}/dash"
    echo "MariaDB test cluster is ready at mariadb://dash:dash@127.0.0.1:${DASH_TEST_MARIADB_PORT:-33039}/dash"
    echo "Redshift test cluster is ready at redshift://dash:dash@127.0.0.1:${DASH_TEST_REDSHIFT_PORT:-54399}/dash"
    echo "MongoDB test cluster is ready at mongodb://dash:dash@127.0.0.1:${DASH_TEST_MONGODB_PORT:-27029}/dash?authSource=admin"
    echo "BigQuery test cluster is ready at http://127.0.0.1:${DASH_TEST_BIGQUERY_PORT:-9059} (project dash, dataset analytics)"
    echo "Databricks SQL test cluster is ready at http://127.0.0.1:${DASH_TEST_DATABRICKS_PORT:-14439} (warehouse ${DASH_TEST_DATABRICKS_WAREHOUSE:-dash}, catalog ${DASH_TEST_DATABRICKS_CATALOG:-dash}, schema ${DASH_TEST_DATABRICKS_SCHEMA:-analytics})"
    echo "ClickHouse test cluster is ready at clickhouse://dash:dash@127.0.0.1:${DASH_TEST_CLICKHOUSE_PORT:-18123}/dash?ssl=false"
    echo "Stripe test cluster is ready at http://127.0.0.1:${DASH_TEST_STRIPE_PORT:-12119}"
    echo "OpenSearch test cluster is ready at http://127.0.0.1:${DASH_TEST_OPENSEARCH_PORT:-9209}"
    echo "DocumentDB test cluster is ready at mongodb://dash:dash@127.0.0.1:${DASH_TEST_DOCUMENTDB_PORT:-27099}/dash?authSource=admin (TLS, CA at docker/documentdb/runtime/ca.pem)"
    echo "CockroachDB test cluster is ready at postgresql://dash:dash@127.0.0.1:${DASH_TEST_COCKROACHDB_PORT:-26229}/dash (CA /tmp/dash-test-cockroach-certs/ca.crt)"
    echo "Couchbase test cluster is ready at couchbase://dash:dashdash@127.0.0.1:${DASH_TEST_COUCHBASE_PORT:-11299}/dash?scope=analytics&network=external"
    echo "Neo4j test cluster is ready at bolt://neo4j:dash@127.0.0.1:${DASH_TEST_NEO4J_PORT:-17687} (database neo4j)"
    echo "Cassandra test cluster is ready at cassandra://dash:dash@127.0.0.1:${DASH_TEST_CASSANDRA_PORT:-39042}/dash?dc=datacenter1"
    echo "Oracle test cluster is ready at oracle://dash:Dash_test1@127.0.0.1:${DASH_TEST_ORACLE_PORT:-15219}/FREEPDB1"
    echo "DynamoDB test cluster is ready at http://127.0.0.1:${DASH_TEST_DYNAMODB_PORT:-8009}"
    echo "Elasticsearch test cluster is ready at http://dash:dash_test@127.0.0.1:${DASH_TEST_ELASTICSEARCH_PORT:-9219}"
    ;;
  stop)
    "${compose[@]}" down --volumes --remove-orphans
    echo "Adapter test clusters stopped."
    ;;
  *)
    echo "usage: scripts/test-services.sh start|stop" >&2
    exit 1
    ;;
esac
