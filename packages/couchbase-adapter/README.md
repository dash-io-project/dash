# @dash/adapter-couchbase

Couchbase adapter for Dash. It implements `DataAdapter` from `@dash/core`.

Structured queries compile to parameterized SQL++ (`$1`, `$2`, …). The adapter validates resource names and column names, then quotes them. Client values are bound parameters. SQL++ has no `ILIKE`. `ilike` compiles to `LOWER(column) LIKE LOWER($n)`.

A collection name can be `collection`, `scope.collection`, or `bucket.scope.collection`. A short name uses the configured bucket and scope.

## Tests

Adapter tests connect to the local Couchbase cluster. SQL compilation tests stay in-process and assert the parameterized statement before it is sent.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-couchbase test
```

Default URL: `couchbase://dash:dashdash@127.0.0.1:11299/dash?scope=analytics&network=external`. Community Server requires a password of 6 characters or more, so the password is `dashdash`. The fixture collections are `analytics.orders` and `analytics.revenue`.
