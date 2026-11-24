# @dash/adapter-db2

IBM Db2 adapter for Dash. It implements `DataAdapter` from `@dash/core`.

The adapter uses the `ibm_db` driver. Each query is a prepared statement. Filter values, the limit, and the offset are bound parameters. The adapter quotes a resource name or a column name only after it validates the identifier.

Db2 has no `ILIKE`. A case-insensitive filter compiles to `UPPER(column) LIKE UPPER(?)`.

A database name has 1 to 8 characters. The adapter sends it in uppercase. A quoted identifier keeps its case. Use the name that schema introspection returns. An unquoted Db2 name is usually uppercase.

Set `schema` when a query uses only the table name. The adapter then qualifies that name as `schema.table`. An explicit `schema.table` name keeps its own schema.

## Connection

Use separate fields, or a `db2://` URI.

```text
db2://db2inst1:password@db.example:50000/DASH?schema=ANALYTICS&ssl=true
```

The URI accepts `schema` and `ssl`. Any other query parameter is rejected. `ssl=true` sets `Security=SSL` on the CLI connection. A field value replaces the same part of the URI.

## Tests

The tests run in process. They do not start a Db2 container.

The community image `icr.io/db2_community/db2` does not fit this CI job. The image needs about 7 GB of disk and about 4 GB of memory. The container needs privileged mode. The first start takes several minutes.

```bash
pnpm --filter @dash/adapter-db2 test
```
