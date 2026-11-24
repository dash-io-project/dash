# @dash/adapter-mariadb

MariaDB adapter for Dash. It implements `DataAdapter` from `@dash/core`.

The adapter compiles a structured query to SQL with `?` placeholders. It checks each resource name and each column name, then quotes the name with backticks. It does not put client text in the SQL. `like` uses `COLLATE utf8mb4_bin`, so the match stays case-sensitive. `ilike` uses `LOWER(column) LIKE LOWER(?)` because MariaDB has no `ILIKE`. The adapter reads a connection URI in this process. Only the host, the port, the user, the password, the database, and SSL reach the driver.

## Tests

Adapter tests connect to the local MariaDB cluster. SQL compilation tests stay in this process. They check the statement before the driver sends it.

```bash
pnpm test:services:start
pnpm --filter @dash/adapter-mariadb test
```

Default URL: `mariadb://dash:dash@127.0.0.1:33039/dash`. The script `docker/mariadb/init` creates the tables `orders`, `revenue`, and `metrics`, and the view `paid_orders`.
