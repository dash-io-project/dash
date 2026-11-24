-- Fixture data for @dash/adapter-mariadb.
-- The server loads this file once, when it creates the data directory.

USE dash;

CREATE TABLE orders (
  id INT NOT NULL PRIMARY KEY,
  total INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  region VARCHAR(64) NULL,
  note TEXT NULL
);

INSERT INTO orders (id, total, status, region, note) VALUES
  (1, 10, 'paid', 'Europe', 'first'),
  (2, 25, 'paid', 'Europe', NULL),
  (3, 5, 'open', 'Asia Pacific', 'third'),
  (4, 40, 'paid', 'North America', NULL),
  (5, 15, 'Paid', 'Europe', NULL);

CREATE TABLE revenue (
  month VARCHAR(16) NOT NULL PRIMARY KEY,
  amount INT NOT NULL
);

INSERT INTO revenue (month, amount) VALUES
  ('2026-01', 10),
  ('2026-02', 20),
  ('2026-03', 15);

CREATE TABLE metrics (
  id INT NOT NULL PRIMARY KEY,
  billed_on DATE NOT NULL,
  amount BIGINT NOT NULL
);

INSERT INTO metrics (id, billed_on, amount) VALUES
  (1, '2026-01-15', 9007199254740993),
  (2, '2026-01-16', 42);

CREATE VIEW paid_orders AS
SELECT id, total, status, region
FROM orders
WHERE status COLLATE utf8mb4_bin = 'paid';
