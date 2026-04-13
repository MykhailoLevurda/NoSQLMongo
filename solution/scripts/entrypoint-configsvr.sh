#!/bin/bash
# entrypoint-configsvr.sh
# Univerzální spouštěcí skript pro SEKUNDÁRNÍ uzly (config servery i shard servery).
# Konfigurace se předává přes proměnné prostředí:
#   MONGO_HOST    – hostname kontejneru (pro logování)
#   MONGO_PORT    – port (27019 pro configsvr, 27018 pro shardsvr)
#   MONGO_ROLE    – "configsvr" nebo "shardsvr"
#   REPLICA_SET   – název repliky

set -e

HOST="${MONGO_HOST:-unknown}"
PORT="${MONGO_PORT:-27018}"
ROLE="${MONGO_ROLE:-shardsvr}"
REPLSET="${REPLICA_SET:-shard1ReplSet}"
KEYFILE="/keyfile/mongo-keyfile"
DATA_DIR="/data/db"

echo "[$HOST] Spouštím MongoDB (role=$ROLE, replSet=$REPLSET, port=$PORT)..."

if [ "$ROLE" = "configsvr" ]; then
  exec mongod \
    --configsvr \
    --replSet "$REPLSET" \
    --keyFile "$KEYFILE" \
    --bind_ip_all \
    --port "$PORT" \
    --dbpath "$DATA_DIR"
else
  exec mongod \
    --shardsvr \
    --replSet "$REPLSET" \
    --keyFile "$KEYFILE" \
    --bind_ip_all \
    --port "$PORT" \
    --dbpath "$DATA_DIR"
fi
