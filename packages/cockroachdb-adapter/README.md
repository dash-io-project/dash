# @dash/adapter-cockroachdb

CockroachDB adapter for Dash. It implements `DataAdapter` from `@dash/core`.

A structured query compiles to parameterized SQL (`$1`, `$2`, …). The adapter quotes a resource name or a column name only after it validates the name. A client value is never concatenated into SQL.

CockroachDB speaks the PostgreSQL wire protocol. Its catalog is not the Postgres catalog. Introspection reads `crdb_sql_type`, skips system schemas, and skips hidden columns such as `rowid`. A name can be `table`, `schema.table`, or `database.schema.table`.

`INT` is `INT8`. A value that fits a safe integer becomes a number. A larger value stays a decimal string. `DECIMAL` stays a string. Date and time values stay text.

TLS is on by default. Set `ssl` to `false` for a node without TLS. Set `sslCa` to a PEM certificate for a private CA. A serverless cluster name is sent only as `--cluster`.

## Tests

Adapter tests connect to the local CockroachDB cluster. SQL compilation tests stay in-process.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-cockroachdb test
```

Default URL: `postgresql://dash:dash@127.0.0.1:26229/dash`. The CA file is `/tmp/dash-test-cockroach-certs/ca.crt`. Fixture tables live in the `dash` database.
