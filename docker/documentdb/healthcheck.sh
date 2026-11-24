#!/bin/bash
# Require the fixture view so a healthy container is ready for queries.

set -euo pipefail

mongosh --quiet \
  "mongodb://dash:dash@127.0.0.1:27017/dash?authSource=admin&tls=true" \
  --tlsCAFile /certs/ca.pem \
  --eval '(async () => { const revenue = await db.revenue.countDocuments(); const paid = await db.paid_orders.countDocuments(); if (revenue !== 3 || paid !== 3) quit(1); quit(0); })()'
