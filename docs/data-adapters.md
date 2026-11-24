# Data adapters

Each warehouse adapter is its own package under `packages/` and implements
`DataAdapter` from `@dash/core`. Postgres ships as `packages/postgres-adapter`
(`@dash/adapter-postgres`). MySQL ships as `packages/mysql-adapter`
(`@dash/adapter-mysql`). MariaDB ships as `packages/mariadb-adapter`
(`@dash/adapter-mariadb`). Snowflake ships as `packages/snowflake-adapter`
(`@dash/adapter-snowflake`). MongoDB ships as `packages/mongodb-adapter`
(`@dash/adapter-mongodb`). BigQuery ships as `packages/bigquery-adapter`
(`@dash/adapter-bigquery`). Databricks SQL ships as `packages/databricks-adapter`
(`@dash/adapter-databricks`). Amazon Redshift ships as `packages/redshift-adapter`
(`@dash/adapter-redshift`). Stripe ships as `packages/stripe-adapter`
(`@dash/adapter-stripe`). IBM Db2 ships as `packages/db2-adapter`
(`@dash/adapter-db2`). Amazon OpenSearch ships as `packages/opensearch-adapter`
(`@dash/adapter-opensearch`). Amazon DocumentDB ships as `packages/documentdb-adapter`
(`@dash/adapter-documentdb`). SAP HANA ships as `packages/hana-adapter`
(`@dash/adapter-hana`).

## Shipping

| Package | Directory | Kind | Status |
| --- | --- | --- | --- |
| `@dash/adapter-postgres` | `packages/postgres-adapter` | `postgres` | MVP |
| `@dash/adapter-mysql` | `packages/mysql-adapter` | `mysql` | MVP |
| `@dash/adapter-mariadb` | `packages/mariadb-adapter` | `mariadb` | MVP |
| `@dash/adapter-hana` | `packages/hana-adapter` | `hana` | MVP |
| `@dash/adapter-snowflake` | `packages/snowflake-adapter` | `snowflake` | MVP |
| `@dash/adapter-mongodb` | `packages/mongodb-adapter` | `mongodb` | MVP |
| `@dash/adapter-bigquery` | `packages/bigquery-adapter` | `bigquery` | MVP |
| `@dash/adapter-databricks` | `packages/databricks-adapter` | `databricks` | MVP |
| `@dash/adapter-redshift` | `packages/redshift-adapter` | `redshift` | MVP |
| `@dash/adapter-stripe` | `packages/stripe-adapter` | `stripe` | MVP |
| `@dash/adapter-db2` | `packages/db2-adapter` | `db2` | MVP |
| `@dash/adapter-opensearch` | `packages/opensearch-adapter` | `opensearch` | MVP |
| `@dash/adapter-documentdb` | `packages/documentdb-adapter` | `documentdb` | MVP |
| — | — | `clickhouse` | Planned |

The web app does not ship a built-in sample adapter. To get realistic data in
development, seed the configured sources from **Settings** (see the README).
The seed writers are in `packages/seed`: Postgres, MongoDB, and BigQuery. Put a
new writer in `packages/seed/src/writers` and add its kind to `SEEDABLE_KINDS`.

## Testing

Postgres, MySQL, MariaDB, MongoDB, BigQuery, Databricks SQL, Redshift, Stripe, OpenSearch, and DocumentDB adapter tests run against the local clusters in `docker-compose.test.yml`.

IBM Db2 adapter tests run in process. The community image `icr.io/db2_community/db2` does not fit this CI job. The image needs about 7 GB of disk and about 4 GB of memory. The container needs privileged mode. The first start takes several minutes.

SAP HANA has no service in that file. SAP HANA Express is too large for CI. `@dash/adapter-hana` tests use a fake driver.

```bash
pnpm test:services:start
pnpm test
pnpm test:services:stop
```

Postgres listens on `127.0.0.1:54329` (`dash` / `dash`, database `dash`).
MySQL listens on `127.0.0.1:33029` (`dash` / `dash`, database `dash`).
MariaDB listens on `127.0.0.1:33039` (`dash` / `dash`, database `dash`).
MongoDB listens on `127.0.0.1:27029` (`dash` / `dash`, database `dash`, auth
database `admin`). Databricks SQL listens on `http://127.0.0.1:14439` (token
`dash`, warehouse `dash`, catalog `dash`, schema `analytics`). The Redshift
stand-in listens on `127.0.0.1:54399`
(`redshift://dash:dash@127.0.0.1:54399/dash`). Stripe listens on
`http://127.0.0.1:12119`. OpenSearch listens on `http://127.0.0.1:9209`.
The DocumentDB stand-in listens on
`127.0.0.1:27099` (`mongodb://dash:dash@127.0.0.1:27099/dash?authSource=admin`, TLS).
Amazon DocumentDB has no local image. The stand-in speaks the MongoDB wire protocol.
The root README lists the
environment overrides. When an
engine can run locally, add it to that Compose file and point the package
tests at it.

## Adding an adapter

1. Create `packages/<name>-adapter` with a `package.json` that depends on `@dash/core`.
2. Implement `DataAdapter` (`testConnection`, `introspectSchema`, `query`, `close`).
3. Compile structured `AdapterQuery` values with bound parameters — never
   interpolate identifiers or literals from the client without validation.
4. Register the factory in `packages/web/src/server/adapters/registry.ts`.
5. When the engine can run locally, add it to `docker-compose.test.yml` and
   run the adapter tests against that cluster.
6. Check the new item off in the root README feature checklist.
