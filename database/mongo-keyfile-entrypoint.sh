#!/bin/bash
set -euo pipefail

install -o mongodb -g mongodb -m 0400 /run/secrets/mongodb-keyfile /tmp/mongodb-keyfile
exec docker-entrypoint.sh mongod --replSet store-rs --bind_ip_all --keyFile /tmp/mongodb-keyfile
