# @dash/adapter-cassandra

Apache Cassandra adapter for Dash. It implements `DataAdapter` from `@dash/core`.

The adapter sends prepared CQL. It binds each filter value. It quotes each identifier after validation. CQL has no `OFFSET`. The adapter reads `offset + limit` rows and returns the page. That span cannot pass 10,000 rows. `neq`, `like`, and `ilike` fail validation. A filter adds `ALLOW FILTERING` so a non-key column can match.

## Tests

Adapter tests use the local Cassandra cluster. CQL compilation tests stay in-process.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-cassandra test
```

The default URI is `cassandra://dash:dash@127.0.0.1:39042/dash?dc=datacenter1`. The fixture tables are `orders`, `revenue`, and `samples`. The fixture view is `orders_by_status`. `docker/cassandra/init.cql` creates them.
