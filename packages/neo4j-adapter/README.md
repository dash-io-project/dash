# Neo4j adapter

`@dash/adapter-neo4j` implements `DataAdapter` for Neo4j.

A query reads one node label or one relationship type. The adapter sends Cypher with bound parameters. The query text does not contain a label, a relationship type, a property name, or a literal from the request.

`bolt+ssc://` and `neo4j+ssc://` are rejected. Those schemes do not check the server certificate.

The local cluster is the `neo4j` service in `docker-compose.test.yml`. It listens at `bolt://neo4j:dash@127.0.0.1:17687`. The database name is `neo4j`. The user name is `neo4j`.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-neo4j test
```
