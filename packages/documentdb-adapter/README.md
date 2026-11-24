# @dash/adapter-documentdb

Amazon DocumentDB adapter for Dash. It implements `DataAdapter` from `@dash/core`.

A structured query compiles to a `find` command. Each field name is a validated document key. A resource is the collection name. `database.collection` also selects that collection when both parts are identifiers and the database is the connected one, unless a collection with the full dotted name exists. Filter values are BSON scalars. The adapter rejects an object so a client cannot inject an operator such as `$gt` or `$where`. `like` and `ilike` become anchored, escaped patterns. The find filter uses only operators that DocumentDB supports: `$and`, `$or`, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$exists`, `$regex`, and `$options`. The adapter does not send `$where`, `$expr`, `$jsonSchema`, `$text`, collation, or an aggregation.

TLS is required. The client trusts the Amazon RDS global CA bundle. Set `caBundle` to replace that bundle with PEM certificates. The bundle cannot contain a private key. The adapter does not read `tlsCAFile` or any other certificate path from the connection string. `retryWrites` is false. `mongodb+srv` is rejected. A parameter that disables TLS verification is rejected.

A user and a password in discrete fields are driver auth options. They are not part of the connection URI. A connection string with a user and no `authSource` authenticates against `admin`.

Schema introspection lists up to 200 collections and samples up to 50 documents in each. DocumentDB has no declared column list, so nullability reflects that sample. A field name that fails the structured-query identifier rules is omitted.

## Tests

Adapter tests connect to the local stand-in. Amazon DocumentDB has no local image. The stand-in speaks the MongoDB wire protocol with TLS. Query compilation tests stay in-process and assert the find command before it is sent.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-documentdb test
```

Default endpoint: `mongodb://dash:dash@127.0.0.1:27099/dash?authSource=admin`. The test CA is `docker/documentdb/runtime/ca.pem` after the cluster starts. Pass it as `caBundle`. Fixture collections `orders` and `revenue`, plus the `paid_orders` view, come from `docker/documentdb/init`.
