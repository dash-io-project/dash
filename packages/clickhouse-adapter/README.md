# @dash/adapter-clickhouse

ClickHouse adapter for Dash. Implements `DataAdapter` from `@dash/core`.

The adapter speaks the ClickHouse HTTP interface (`@clickhouse/client`), not the native TCP protocol. Structured queries compile to parameterized SQL (`{p0:Type}` placeholders). Resource and column names are backtick-quoted after an identifier check. Filter values stay in `query_params` and are substituted by the server. `LIKE` stays case-sensitive. `ILIKE` is the case-insensitive match. Null filters compile to `IS NULL` / `IS NOT NULL`.

Connection strings are parsed in-process. The client receives only the host, the port, the database, the user, the password, and a fixed set of settings. Unknown query parameters are rejected, so a URI cannot change ClickHouse settings. HTTPS is the default (`8443`). `ssl=false`, or an `http://` URI, uses plaintext HTTP (`8123`). Each query runs with `readonly=1` and stops after 60 seconds. The password is never placed on the public summary.

Every statement is qualified with the connected database, and a table in another database is rejected. Schema introspection is filtered to that same database. Qualification stays in the SQL because the HTTP client omits `database=default` and would otherwise follow the user's profile database. A page requests one extra row, including at the 10000-row cap, so a full page is truncated only when another row exists.

Use a `clickhouse://` string, an `https://` string, or an `http://` string. The path is the database.

## Tests

Adapter tests connect to the local ClickHouse cluster. SQL compilation tests stay in-process. Each test checks the parameterized statement.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-clickhouse test
```

Default URL: `clickhouse://dash:dash@127.0.0.1:18123/dash?ssl=false`. Fixture tables `orders` and `revenue`, plus the `paid_orders` view, are created by `docker/clickhouse/init`.
