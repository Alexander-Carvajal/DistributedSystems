#!/bin/sh
set -eu

: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
: "${REDIS_ROLE:?REDIS_ROLE is required}"

mkdir -p /data
if [ ! -f /data/redis.conf ]; then
  cat > /data/redis.conf <<EOF
bind 0.0.0.0
protected-mode no
port 6379
dir /data
save ""
appendonly no
requirepass ${REDIS_PASSWORD}
masterauth ${REDIS_PASSWORD}
EOF
  if [ "${REDIS_ROLE}" = "replica" ]; then
    echo 'replicaof 172.32.0.10 6379' >> /data/redis.conf
  fi
fi

if [ "${REDIS_ROLE}" = "replica" ] && grep -q '^replicaof redis-primary 6379$' /data/redis.conf; then
  sed -i 's/^replicaof redis-primary 6379$/replicaof 172.32.0.10 6379/' /data/redis.conf
fi

exec redis-server /data/redis.conf
