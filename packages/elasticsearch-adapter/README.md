# @dash/adapter-elasticsearch

Elasticsearch adapter for Dash. Implements `DataAdapter` from `@dash/core`.

Structured queries compile to a `_search` body. The resource is one index or alias name. Field names are validated identifiers passed as Query DSL keys. Filter values are scalars — objects are rejected so a client cannot inject clauses. `like` and `ilike` become anchored wildcard patterns (`%` and `_` map to `*` and `?`); `\`, `*`, and `?` in the pattern stay literal. A string comparison matches the field and its `.keyword` subfield, so a keyword field and a text field with the default multi-field both match the original value. A text field with no `.keyword` subfield still does not match. Integers past 2^53 are returned as strings. Result columns take their type from the values in the page. A page is marked truncated only when another hit exists. At an `offset + limit` of 10,000 the search cannot read that extra hit, so a full page there stays truncated. Schema listing keeps the first 200 index and alias names and loads mappings only for those resources, including a hidden index behind an alias. Elasticsearch stores JSON null as a missing field, so `eq null` matches documents that omit the field and `neq` excludes them. `http` is accepted only for a loopback host. Redirects are not followed, and TLS verification cannot be disabled.

An Elastic Cloud ID (`name:base64`) selects `https://{esId}.{domain}`. An API key may be the encoded token or `id:api_key`. It is sent only to that node.

## Tests

Adapter tests connect to the local Elasticsearch cluster. Query compilation tests stay in-process and assert the search body before it is sent.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-elasticsearch test
```

Default URL: `http://dash:dash_test@127.0.0.1:9219`. Fixture indices `orders` and `revenue`, plus the `paid_orders` alias, are created by `docker/elasticsearch`.
