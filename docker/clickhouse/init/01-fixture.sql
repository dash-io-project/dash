-- Fixture warehouse for @dash/adapter-clickhouse.
-- Loaded once, when the cluster data directory is created.
-- The HTTP interface is what the adapter uses. MergeTree needs an ORDER BY.

CREATE TABLE IF NOT EXISTS dash.orders (
  id Int32,
  total Int32,
  status String,
  region Nullable(String),
  note Nullable(String)
) ENGINE = MergeTree
ORDER BY id;

INSERT INTO dash.orders (id, total, status, region, note) VALUES
  (1, 10, 'paid', 'Europe', 'first'),
  (2, 25, 'paid', 'Europe', NULL),
  (3, 5, 'open', 'Asia Pacific', 'third'),
  (4, 40, 'paid', 'North America', NULL);

CREATE TABLE IF NOT EXISTS dash.revenue (
  month String,
  amount Int32
) ENGINE = MergeTree
ORDER BY month;

INSERT INTO dash.revenue (month, amount) VALUES
  ('2026-01', 10),
  ('2026-02', 20),
  ('2026-03', 15);

CREATE VIEW IF NOT EXISTS dash.paid_orders AS
SELECT id, total, status, region
FROM dash.orders
WHERE status = 'paid';
