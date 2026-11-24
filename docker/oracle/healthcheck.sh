#!/usr/bin/env bash
# Exit 0 when the fixture view answers inside FREEPDB1.

set -euo pipefail

sqlplus -L -s dash/Dash_test1@//127.0.0.1:1521/FREEPDB1 <<'EOF'
WHENEVER SQLERROR EXIT SQL.SQLCODE
SET HEADING OFF
SET FEEDBACK OFF
SET PAGESIZE 0
SELECT 1 FROM paid_orders WHERE ROWNUM = 1;
EXIT
EOF
