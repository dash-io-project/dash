# @dash/adapter-oracle

Oracle Database adapter for Dash. The adapter implements `DataAdapter` from `@dash/core`.

Structured queries compile to parameterized SQL (`:p0` binds). The compiler folds resource names and column names to uppercase, then double-quotes them, so `orders` matches an unquoted `ORDERS` table. The compiler does not concatenate client input into SQL. `like` uses `COLLATE BINARY` so the match stays case-sensitive. `ilike` compiles to `LOWER(column) LIKE LOWER(:p)` because Oracle has no `ILIKE`. `eq null` and `neq null` compile to `IS NULL` and `IS NOT NULL`. An empty string is rejected because Oracle stores it as null. An `in` list accepts at most 1,000 values.

The driver runs in Thin mode. The adapter parses connection strings in-process and rebuilds an Easy Connect string or a SID descriptor from the host, port, service name, and TLS flag. Oracle Cloud hosts require TLS and server-name verification, and a cloud host with no port uses 1522. `ssl_server_dn_match=yes` enables TLS. A `DATE` value is a `YYYY-MM-DD` string. `BLOB` values are returned as bytes, and `BFILE` values are read before the connection closes. Use an `oracle://` URL, a `jdbc:oracle:thin:` URL, an Easy Connect string, or a connect descriptor.

An unqualified table is resolved in the connected user's schema. `schema.table` selects another schema the user can read.

## Tests

Adapter tests connect to the local Oracle cluster. SQL compilation tests stay in-process. Each test checks the parameterized statement.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-oracle test
```

Default URL: `oracle://dash:Dash_test1@127.0.0.1:15219/FREEPDB1`. Fixture tables `ORDERS`, `REVENUE`, and `METRICS`, plus the `PAID_ORDERS` view, are created unquoted in the `DASH` schema by `docker/oracle/init`. Queries can still use `orders`.
