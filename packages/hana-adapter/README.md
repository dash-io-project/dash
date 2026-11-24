# @dash/adapter-hana

SAP HANA adapter for Dash. It implements `DataAdapter` from `@dash/core`.

Structured queries compile to prepared SQL. Placeholders are `?`. Resource names and column names are quoted after validation. Client values stay in the bind list.

`like` is case-sensitive. `ilike` uses `LOWER` because SAP HANA has no `ILIKE`.

The connection test runs `SELECT 1 AS "ok" FROM DUMMY`. Schema introspection reads `SYS.TABLE_COLUMNS` and `SYS.VIEW_COLUMNS`. System schemas stay out of the result.

Encrypt defaults to on. The driver receives `encrypt` and `sslValidateCertificate` as the strings `true` and `false`. A connection URI can set only `schema`, `encrypt`, and `sslValidateCertificate`. Other query keys are rejected. The password is not part of the public summary.

Use a URI or separate fields.

```text
hana://user:password@host:30015/DB?schema=ANALYTICS&encrypt=true&sslValidateCertificate=true
```

The default port is `30015`. `database` is the tenant database. `schema` is the session schema for unqualified names. The adapter targets SAP HANA 2 and SAP HANA Cloud. Those releases accept parameter markers in `LIMIT` and `OFFSET`.

## Tests

SAP HANA Express is too large for CI. This package has no Docker cluster. Tests use a fake driver and check the prepared statement, the bind list, and connection cleanup.

```bash
pnpm --filter @dash/adapter-hana test
```

The package uses `@sap/hana-client`. Queries call `prepare`, then `exec`, and then `drop`. `disconnect` returns a pooled connection to the pool. `close` clears the pool.
