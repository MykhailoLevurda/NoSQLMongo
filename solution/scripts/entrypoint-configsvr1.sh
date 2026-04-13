#!/bin/bash
# entrypoint-configsvr1.sh
# Spouštěcí skript pro PRIMÁRNÍ uzel config server repliky (configsvr1).
# Tento uzel inicializuje repliku configReplSet a vytvoří admin uživatele
# pomocí MongoDB localhost exception (platí před vytvořením prvního uživatele).

set -e

KEYFILE="/keyfile/mongo-keyfile"
DATA_DIR="/data/db"
INIT_FLAG="$DATA_DIR/.configsvr_initialized"
PORT=27019
REPLSET="configReplSet"

echo "[configsvr1] Spouštím Config Server (primární uzel)..."

# Spustit mongod s keyFile v pozadí
mongod \
  --configsvr \
  --replSet "$REPLSET" \
  --keyFile "$KEYFILE" \
  --bind_ip_all \
  --port "$PORT" \
  --dbpath "$DATA_DIR" \
  --logpath /var/log/mongodb/mongod.log \
  --logappend \
  --fork

echo "[configsvr1] Čekám na start mongod..."
until mongosh --port "$PORT" --eval "db.runCommand('ping').ok" --quiet 2>/dev/null; do
  sleep 2
done
echo "[configsvr1] Mongod běží."

if [ ! -f "$INIT_FLAG" ]; then
  echo "[configsvr1] První spuštění – inicializuji repliku $REPLSET..."

  # Počkat až ostatní config servery nastartují
  sleep 20

  # Inicializovat repliku (localhost exception – funguje bez auth při prvním startu)
  mongosh --port "$PORT" --eval "
  rs.initiate({
    _id: '$REPLSET',
    configsvr: true,
    members: [
      { _id: 0, host: 'configsvr1:$PORT', priority: 2 },
      { _id: 1, host: 'configsvr2:$PORT', priority: 1 },
      { _id: 2, host: 'configsvr3:$PORT', priority: 1 }
    ]
  });
  print('rs.initiate() dokončeno');
  " || echo "[configsvr1] VAROVÁNÍ: rs.initiate() mohlo selhat (replika možná již existuje)"

  echo "[configsvr1] Čekám na volbu PRIMARY (30s)..."
  sleep 30

  # Vytvořit admin uživatele (localhost exception – bez autentizace)
  echo "[configsvr1] Vytvářím admin uživatele..."
  mongosh --port "$PORT" --eval "
  try {
    db.getSiblingDB('admin').createUser({
      user: '${MONGO_ADMIN_USER:-admin}',
      pwd:  '${MONGO_ADMIN_PASS:-adminpassword}',
      roles: [{ role: 'root', db: 'admin' }]
    });
    print('Admin uživatel vytvořen.');
  } catch(e) {
    print('Admin uživatel již existuje nebo chyba: ' + e);
  }
  "

  touch "$INIT_FLAG"
  echo "[configsvr1] Inicializace dokončena."
fi

echo "[configsvr1] Čekám na ukončení mongod procesu..."
# Přejít na foreground – sledovat mongod log
tail -f /var/log/mongodb/mongod.log &
wait $(pgrep mongod)
