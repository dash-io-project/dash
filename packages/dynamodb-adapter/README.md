# @dash/adapter-dynamodb

Amazon DynamoDB adapter for Dash. Implements `DataAdapter` from `@dash/core`.

Structured queries compile to DynamoDB `Query` or `Scan`. Attribute names are sent as expression attribute names, and filter values are sent as expression attribute values. A resource is a table name. Equality on the partition key uses `Query`, including one sort-key condition when the table has a sort key. Every other read is a `Scan`. `like` patterns that are an exact value, a prefix, or a single contained substring are pushed into the request. Other patterns, including `ilike` when case matters, are applied to the items DynamoDB returns. A read stops after 10,000 evaluated items. When no filter remains and the order is already the DynamoDB order, the request sets `Limit` to the page size plus one so a small page does not read a full 1 MB. Selected columns are projected in that same case. Pages request one extra match so an exact page is not marked truncated. Rows are sorted before projection, so an `ORDER BY` column does not have to be in the select list.

Requests are signed with AWS Signature Version 4 and sent to `https://dynamodb.{region}.amazonaws.com` (`amazonaws.com.cn` in China). `http` is accepted only for a loopback endpoint such as DynamoDB Local. Redirects are not followed. The secret access key and session token are omitted from connection summaries.

Schema introspection lists up to 200 tables and samples up to 50 items in each. Key attributes come from the table description. Other attributes and nullability come from that sample.

## Tests

Adapter tests connect to the local DynamoDB cluster. Query compilation tests stay in-process and assert the request before it is sent.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-dynamodb test
```

Default endpoint: `http://127.0.0.1:8009` with region `us-east-1`, access key `dash`, and secret `dashsecret`. `pnpm test:services:start` loads fixture tables `orders` and `revenue`. The adapter tests load the same fixture when it is missing.
