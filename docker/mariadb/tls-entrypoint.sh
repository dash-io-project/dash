#!/bin/bash
# Create a self-signed server certificate.
# Then start the MariaDB image entrypoint.

set -euo pipefail

cert_dir=/etc/mysql/ssl
mkdir -p "$cert_dir"
if [[ ! -f "$cert_dir/server.crt" || ! -f "$cert_dir/server.key" ]]; then
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$cert_dir/server.key" \
    -out "$cert_dir/server.crt" \
    -days 3650 \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  chmod 644 "$cert_dir/server.crt"
  chmod 640 "$cert_dir/server.key"
  if id mysql >/dev/null 2>&1; then
    chown mysql:mysql "$cert_dir/server.key" "$cert_dir/server.crt"
  fi
fi

exec docker-entrypoint.sh "$@"
