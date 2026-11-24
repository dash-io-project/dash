CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE public.orders (
  id INT8 PRIMARY KEY,
  total INT8 NOT NULL,
  status STRING NOT NULL,
  region STRING,
  note STRING
);

INSERT INTO public.orders (id, total, status, region, note) VALUES
  (1, 10, 'paid', 'Europe', 'first'),
  (2, 25, 'paid', 'Europe', NULL),
  (3, 5, 'open', 'Asia Pacific', 'third'),
  (4, 40, 'paid', 'North America', NULL);

CREATE TABLE public.revenue (
  month STRING PRIMARY KEY,
  amount INT8 NOT NULL
);

INSERT INTO public.revenue (month, amount) VALUES
  ('2026-01', 10),
  ('2026-02', 20),
  ('2026-03', 15);

CREATE VIEW public.paid_orders AS
SELECT id, total, status, region
FROM public.orders
WHERE status = 'paid';

CREATE TABLE public.events (
  message STRING NOT NULL
);

INSERT INTO public.events (message) VALUES ('hello');

CREATE SEQUENCE public.order_seq;
CREATE INDEX orders_status ON public.orders (status);

CREATE TABLE public.types (
  id INT4 PRIMARY KEY,
  big INT8 NOT NULL,
  ratio DECIMAL(10, 2) NOT NULL,
  flag BOOL NOT NULL,
  day DATE NOT NULL,
  seen TIMESTAMPTZ NOT NULL,
  payload BYTES NOT NULL
);

INSERT INTO public.types (id, big, ratio, flag, day, seen, payload) VALUES
  (1, 9223372036854775807, 1.50, true, '2026-01-15', '2026-01-15T00:00:00Z', '\x0102');

CREATE TABLE analytics.targets (
  name STRING PRIMARY KEY,
  goal INT8 NOT NULL
);

INSERT INTO analytics.targets (name, goal) VALUES ('q1', 100);

CREATE TABLE other.public.extra (
  id INT8 PRIMARY KEY,
  label STRING NOT NULL
);

INSERT INTO other.public.extra (id, label) VALUES (1, 'outside');
