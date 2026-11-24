#!/bin/sh
set -eu
/cockroach/cockroach sql \
  --url "postgresql://dash:dash@127.0.0.1:26257/dash?sslmode=verify-full&sslrootcert=/certs/ca.crt" \
  --execute "SELECT 1 FROM public.paid_orders LIMIT 1"
