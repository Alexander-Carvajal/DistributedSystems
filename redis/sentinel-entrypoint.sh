#!/bin/sh
set -eu

: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"

mkdir -p /data
if [ ! -f /data/sentinel.conf ]; then
cat > /data/sentinel.conf <<EOF
port 26379
bind 0.0.0.0
protected-mode no
dir /data
requirepass ${REDIS_PASSWORD}
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
sentinel monitor store-cache 172.32.0.10 6379 2
sentinel auth-pass store-cache ${REDIS_PASSWORD}
sentinel down-after-milliseconds store-cache 5000
sentinel failover-timeout store-cache 60000
sentinel parallel-syncs store-cache 1
EOF
elif ! grep -q '^sentinel resolve-hostnames yes$' /data/sentinel.conf; then
  sed -i '1i sentinel resolve-hostnames yes\nsentinel announce-hostnames yes' /data/sentinel.conf
fi

if grep -q '^sentinel monitor store-cache redis-primary 6379 2$' /data/sentinel.conf; then
  sed -i 's/^sentinel monitor store-cache redis-primary 6379 2$/sentinel monitor store-cache 172.32.0.10 6379 2/' /data/sentinel.conf
fi

exec redis-sentinel /data/sentinel.conf
