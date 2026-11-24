-- Fixture keyspace for @dash/adapter-cassandra.
-- The script is safe to run again. Tables and rows use IF NOT EXISTS.

ALTER KEYSPACE system_auth WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE ROLE IF NOT EXISTS dash WITH PASSWORD = 'dash' AND LOGIN = true AND SUPERUSER = true;

CREATE KEYSPACE IF NOT EXISTS dash WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TABLE IF NOT EXISTS dash.orders (
  tenant text,
  id int,
  total int,
  status text,
  region text,
  note text,
  PRIMARY KEY (tenant, id)
) WITH CLUSTERING ORDER BY (id ASC);

INSERT INTO dash.orders (tenant, id, total, status, region, note)
VALUES ('dash', 1, 10, 'paid', 'Europe', 'first') IF NOT EXISTS;

INSERT INTO dash.orders (tenant, id, total, status, region)
VALUES ('dash', 2, 25, 'paid', 'Europe') IF NOT EXISTS;

INSERT INTO dash.orders (tenant, id, total, status, region, note)
VALUES ('dash', 3, 5, 'open', 'Asia Pacific', 'third') IF NOT EXISTS;

INSERT INTO dash.orders (tenant, id, total, status, region)
VALUES ('dash', 4, 40, 'paid', 'North America') IF NOT EXISTS;

CREATE TABLE IF NOT EXISTS dash.revenue (
  bucket text,
  month text,
  amount int,
  PRIMARY KEY (bucket, month)
) WITH CLUSTERING ORDER BY (month ASC);

INSERT INTO dash.revenue (bucket, month, amount) VALUES ('all', '2026-01', 10) IF NOT EXISTS;
INSERT INTO dash.revenue (bucket, month, amount) VALUES ('all', '2026-02', 20) IF NOT EXISTS;
INSERT INTO dash.revenue (bucket, month, amount) VALUES ('all', '2026-03', 15) IF NOT EXISTS;

CREATE TABLE IF NOT EXISTS dash.samples (
  id int PRIMARY KEY,
  active boolean,
  big bigint,
  seen timestamp,
  item uuid,
  payload blob,
  tags list<int>
);

INSERT INTO dash.samples (id, active, big, seen, item, payload, tags)
VALUES (
  1,
  true,
  9007199254740993,
  '2026-01-15T12:00:00.000Z',
  123e4567-e89b-12d3-a456-426614174000,
  0x6869,
  [1, 2, 3]
) IF NOT EXISTS;

CREATE MATERIALIZED VIEW IF NOT EXISTS dash.orders_by_status AS
  SELECT tenant, id, total, status, region
  FROM dash.orders
  WHERE tenant IS NOT NULL AND id IS NOT NULL AND status IS NOT NULL
  PRIMARY KEY ((tenant, status), id)
  WITH CLUSTERING ORDER BY (id ASC);
