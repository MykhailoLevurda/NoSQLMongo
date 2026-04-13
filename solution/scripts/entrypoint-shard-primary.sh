#!/bin/bash
# entrypoint-shard-primary.sh
# Spouštěcí skript pro PRIMÁRNÍ uzel každého shardu (shard1-1, shard2-1, shard3-1).
# Inicializuje repliku a vytváří admin uživatele.
# Parametry přes proměnné prostředí:
#   SHARD_REPLSET  – název replikační sady (např. shard1ReplSet)
#   SHARD_HOST     – hostname tohoto uzlu (např. shard1-1)
#   SHARD_PEERS    – čárkou oddělené hosty repliky (shard1-1:27018,shard1-2:27018,shard1-3:27018)
#   MONGO_ADMIN_USER / MONGO_ADMIN_PASS – přihlašovací údaje admin uživatele

set -e

REPLSET="${SHARD_REPLSET:-shard1ReplSet}"
HOST="${SHARD_HOST:-shard1-1}"
PEERS="${SHARD_PEERS:-shard1-1:27018,shard1-2:27018,shard1-3:27018}"
ADMIN_USER="${MONGO_ADMIN_USER:-admin}"
ADMIN_PASS="${MONGO_ADMIN_PASS:-adminpassword}"
KEYFILE="/keyfile/mongo-keyfile"
DATA_DIR="/data/db"
INIT_FLAG="$DATA_DIR/.shard_initialized"
PORT=27018

echo "[$HOST] Spouštím Shard Server (primární, replSet=$REPLSET)..."

# Spustit mongod s keyFile v pozadí
mongod \
  --shardsvr \
  --replSet "$REPLSET" \
  --keyFile "$KEYFILE" \
  --bind_ip_all \
  --port "$PORT" \
  --dbpath "$DATA_DIR" \
  --logpath /var/log/mongodb/mongod.log \
  --logappend \
  --fork

echo "[$HOST] Čekám na start mongod..."
until mongosh --port "$PORT" --eval "db.runCommand('ping').ok" --quiet 2>/dev/null; do
  sleep 2
done
echo "[$HOST] Mongod běží."

if [ ! -f "$INIT_FLAG" ]; then
  echo "[$HOST] První spuštění – inicializuji repliku $REPLSET..."

  # Počkat na ostatní uzly shard repliky
  sleep 20

  # Sestavit JSON pole members z SHARD_PEERS
  IFS=',' read -ra PEER_ARR <<< "$PEERS"
  MEMBERS_JSON=""
  idx=0
  for peer in "${PEER_ARR[@]}"; do
    if [ -n "$MEMBERS_JSON" ]; then
      MEMBERS_JSON+=","
    fi
    if [ $idx -eq 0 ]; then
      MEMBERS_JSON+="{ _id: $idx, host: '$peer', priority: 2 }"
    else
      MEMBERS_JSON+="{ _id: $idx, host: '$peer', priority: 1 }"
    fi
    idx=$((idx+1))
  done

  mongosh --port "$PORT" --eval "
  rs.initiate({
    _id: '$REPLSET',
    members: [$MEMBERS_JSON]
  });
  print('rs.initiate() dokončeno pro $REPLSET');
  " || echo "[$HOST] VAROVÁNÍ: rs.initiate() selhalo (možná již existuje)"

  echo "[$HOST] Čekám na volbu PRIMARY (30s)..."
  sleep 30

  # Vytvořit admin uživatele (localhost exception)
  echo "[$HOST] Vytvářím admin uživatele na shardu..."
  mongosh --port "$PORT" --eval "
  try {
    db.getSiblingDB('admin').createUser({
      user: '$ADMIN_USER',
      pwd:  '$ADMIN_PASS',
      roles: [{ role: 'root', db: 'admin' }]
    });
    print('Admin uživatel vytvořen na $HOST.');
  } catch(e) {
    print('Admin uživatel již existuje nebo chyba: ' + e);
  }
  "

  touch "$INIT_FLAG"
  echo "[$HOST] Inicializace dokončena."
fi

echo "[$HOST] Shard běží, čekám na mongod..."
tail -f /var/log/mongodb/mongod.log &
wait $(pgrep mongod)
