#!/bin/bash
# Start a TLS MongoDB stand-in for Amazon DocumentDB adapter tests.
# Amazon DocumentDB has no local image. This process speaks the MongoDB wire protocol.

set -euo pipefail

user=${MONGO_INITDB_ROOT_USERNAME:-dash}
password=${MONGO_INITDB_ROOT_PASSWORD:-dash}
database=${MONGO_INITDB_DATABASE:-dash}
if [[ ! "$user" =~ ^[A-Za-z0-9_-]+$ ]] || [[ ! "$password" =~ ^[A-Za-z0-9_-]+$ ]] || [[ ! "$database" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "The DocumentDB test credentials are invalid." >&2
  exit 1
fi

mkdir -p /certs /opt/dash/runtime /data/db

if [[ ! -f /certs/ca.pem || ! -f /certs/server.pem ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout /certs/ca.key -out /certs/ca.pem -days 3650 \
    -subj "/CN=Dash DocumentDB Test CA" \
    -addext "basicConstraints=critical,CA:TRUE"
  cat > /certs/san.cnf <<'EOF'
[server]
basicConstraints=CA:FALSE
subjectAltName=DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
keyUsage=digitalSignature,keyEncipherment
EOF
  openssl req -newkey rsa:2048 -nodes \
    -keyout /certs/server.key -out /certs/server.csr \
    -subj "/CN=localhost"
  openssl x509 -req -in /certs/server.csr \
    -CA /certs/ca.pem -CAkey /certs/ca.key -CAcreateserial \
    -out /certs/server.crt -days 3650 \
    -extfile /certs/san.cnf -extensions server
  cat /certs/server.crt /certs/server.key > /certs/server.pem
  chmod 600 /certs/ca.key /certs/server.key /certs/server.pem
  chmod 644 /certs/ca.pem
fi

cp /certs/ca.pem /opt/dash/runtime/ca.pem
chmod 644 /opt/dash/runtime/ca.pem

mongod_common=(
  mongod
  --bind_ip_all
  --port 27017
  --dbpath /data/db
  --tlsMode requireTLS
  --tlsCertificateKeyFile /certs/server.pem
  --tlsCAFile /certs/ca.pem
  --tlsAllowConnectionsWithoutCertificates
  --wiredTigerCacheSizeGB 0.25
)

if [[ ! -f /data/db/.dash-init-complete ]]; then
  "${mongod_common[@]}" &
  init_pid=$!
  ready=0
  for _ in $(seq 1 60); do
    if mongosh --quiet "mongodb://127.0.0.1:27017/admin?tls=true" --tlsCAFile /certs/ca.pem --eval 'quit(db.runCommand({ ping: 1 }).ok === 1 ? 0 : 1)'; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "The DocumentDB stand-in did not open." >&2
    exit 1
  fi
  mongosh --quiet "mongodb://127.0.0.1:27017/admin?tls=true" --tlsCAFile /certs/ca.pem --eval \
    "db.createUser({ user: '${user}', pwd: '${password}', roles: [{ role: 'root', db: 'admin' }] })"
  mongosh --quiet "mongodb://127.0.0.1:27017/${database}?tls=true" --tlsCAFile /certs/ca.pem /opt/dash/init/01-fixture.js
  touch /data/db/.dash-init-complete
  mongosh --quiet "mongodb://127.0.0.1:27017/admin?tls=true" --tlsCAFile /certs/ca.pem --eval 'db.shutdownServer()' || true
  wait "$init_pid" || true
fi

exec "${mongod_common[@]}" --auth
