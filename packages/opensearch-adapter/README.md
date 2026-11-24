# @dash/adapter-opensearch

Amazon OpenSearch adapter for Dash. Implements `DataAdapter` from `@dash/core`.

A resource is one index name. The name is lowercase. It uses letters, digits, `_`, and `-`. It does not start with `_`. Field names are validated identifiers. Filter values are JSON scalars. An object is rejected, so a client cannot inject a query clause. `like` and `ilike` become escaped wildcard patterns. A `text` field that has a `keyword` subfield is filtered and sorted on that subfield. `eq` stays case sensitive.

Basic auth sends the user and password on the `Authorization` header. They are not put in the node URL. Set `region` to sign each request with AWS SigV4. `service` is `es` or `aoss`. Omit the access keys to use the default AWS credential chain. Do not set basic auth and SigV4 together. `http` is allowed only for a loopback host. Certificate checks stay on.

The connection test calls `HEAD /` for a domain. For OpenSearch Serverless (`aoss`) it calls `POST /_search` with `size` 0. Schema introspection lists up to 200 indices and their scalar fields. Object and nested fields are omitted. A query reads at most 10,000 rows from the start of the index.

## Tests

Adapter tests connect to the local OpenSearch cluster. Query compilation tests stay in process. Auth header tests use a local HTTP server.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-opensearch test
```

Default node: `http://127.0.0.1:9209`. The cluster image is `opensearchproject/opensearch`. The security plugin is off. Tests create the `dash_orders` index and then delete it.
