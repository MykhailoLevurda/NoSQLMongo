#!/bin/bash
# init-mongos.sh
# Inicializační skript pro mongos router.
# Spouští se jako samostatný init kontejner po startu mongos a všech shard primárních uzlů.
# Provádí:
#   1. Přidání 3 shardů do clusteru
#   2. Povolení shardingu pro databázi streaming_db
#   3. Vytvoření kolekcí s validačními schématy (JSON Schema)
#   4. Povolení shardingu na kolekcích (hashed shard key)
#   5. Vytvoření sekundárních indexů
#   6. Vytvoření aplikačního uživatele
#   7. Import dat ze 3 CSV souborů

set -e

MONGOS="mongos"
PORT="27017"
ADMIN_USER="${MONGO_ADMIN_USER:-admin}"
ADMIN_PASS="${MONGO_ADMIN_PASS:-adminpassword}"

log() { echo "[init-mongos] $1"; }

MONGO_CMD="mongosh --host $MONGOS --port $PORT -u $ADMIN_USER -p $ADMIN_PASS --authenticationDatabase admin --quiet"

# -------------------------------------------------------
# 1. Čekání na mongos + autentizaci
# -------------------------------------------------------
log "Čekám na mongos s autentizací..."
until $MONGO_CMD --eval "db.runCommand('ping').ok" 2>/dev/null | grep -q "1"; do
  log "Mongos ještě není připraven, čekám 5s..."
  sleep 5
done
log "Mongos je dostupný a autentizace funguje."

# -------------------------------------------------------
# 2. Přidání shardů
# -------------------------------------------------------
log "Přidávám shardy do clusteru..."
$MONGO_CMD --eval "
sh.addShard('shard1ReplSet/shard1-1:27018,shard1-2:27018,shard1-3:27018');
sh.addShard('shard2ReplSet/shard2-1:27018,shard2-2:27018,shard2-3:27018');
sh.addShard('shard3ReplSet/shard3-1:27018,shard3-2:27018,shard3-3:27018');
print('Shardy přidány.');
"

log "Čekám na registraci shardů (10s)..."
sleep 10

# -------------------------------------------------------
# 3. Povolení shardingu na databázi
# -------------------------------------------------------
log "Povoluji sharding pro databázi streaming_db..."
$MONGO_CMD --eval "
sh.enableSharding('streaming_db');
print('Sharding povolen na streaming_db.');
"

# -------------------------------------------------------
# 4. Vytvoření kolekcí s validačními schématy
# -------------------------------------------------------
log "Vytvářím kolekce s validačními schématy (JSON Schema)..."
$MONGO_CMD --eval "
const db2 = db.getSiblingDB('streaming_db');

// --- netflix_titles ---
db2.createCollection('netflix_titles', {
  validator: {
    \$jsonSchema: {
      bsonType: 'object',
      title: 'Netflix Title Object Validation',
      required: ['show_id', 'type', 'title'],
      properties: {
        show_id:      { bsonType: 'string',             description: 'Unikátní ID titulu (povinné)' },
        type:         { bsonType: 'string', enum: ['Movie', 'TV Show'], description: 'Typ obsahu – Movie nebo TV Show' },
        title:        { bsonType: 'string', minLength: 1, description: 'Název titulu (povinné, neprázdné)' },
        director:     { bsonType: ['string', 'null'],   description: 'Jméno režiséra' },
        cast:         { bsonType: ['string', 'null'],   description: 'Obsazení (čárkou oddělená jména)' },
        country:      { bsonType: ['string', 'null'],   description: 'Země původu' },
        date_added:   { bsonType: ['string', 'null'],   description: 'Datum přidání na Netflix' },
        release_year: { bsonType: ['int', 'double', 'null'], minimum: 1900, maximum: 2030, description: 'Rok vydání' },
        rating:       { bsonType: ['string', 'null'],   description: 'Věkové hodnocení (TV-MA, PG-13 …)' },
        duration:     { bsonType: ['string', 'null'],   description: 'Délka (např. 90 min nebo 2 Seasons)' },
        listed_in:    { bsonType: ['string', 'null'],   description: 'Kategorie/žánry' },
        description:  { bsonType: ['string', 'null'],   description: 'Popis obsahu' }
      }
    }
  },
  validationAction: 'warn',
  validationLevel: 'moderate'
});
print('Kolekce netflix_titles vytvořena.');

// --- platform_financials ---
db2.createCollection('platform_financials', {
  validator: {
    \$jsonSchema: {
      bsonType: 'object',
      title: 'Platform Financials Validation',
      required: ['platform'],
      properties: {
        platform:                            { bsonType: 'string',                  description: 'Název platformy (povinné)' },
        subscribers_millions:                { bsonType: ['double', 'int', 'null'], minimum: 0 },
        quarterly_revenue_usd_millions:      { bsonType: ['double', 'int', 'null'], minimum: 0 },
        quarterly_profit_usd_millions:       { bsonType: ['double', 'int', 'null'] },
        annual_content_spend_usd_millions:   { bsonType: ['double', 'int', 'null'], minimum: 0 },
        ad_revenue_2025_usd_millions:        { bsonType: ['double', 'int', 'null'], minimum: 0 },
        projected_2026_revenue_usd_millions: { bsonType: ['double', 'int', 'null'], minimum: 0 }
      }
    }
  },
  validationAction: 'warn',
  validationLevel: 'moderate'
});
print('Kolekce platform_financials vytvořena.');

// --- streaming_shifts ---
db2.createCollection('streaming_shifts', {
  validator: {
    \$jsonSchema: {
      bsonType: 'object',
      title: 'Streaming Shifts 2026 Validation',
      required: ['movie_id', 'title'],
      properties: {
        movie_id:           { bsonType: ['int', 'double', 'string'], description: 'ID filmu (povinné)' },
        title:              { bsonType: 'string', minLength: 1,      description: 'Název filmu (povinné)' },
        release_date:       { bsonType: ['string', 'null'] },
        popularity:         { bsonType: ['double', 'int', 'null'], minimum: 0 },
        vote_average:       { bsonType: ['double', 'int', 'null'], minimum: 0, maximum: 10 },
        vote_count:         { bsonType: ['int', 'double', 'null'], minimum: 0 },
        streaming_platforms:{ bsonType: ['string', 'null'] },
        on_netflix:         { bsonType: ['int', 'double', 'null'] },
        on_hulu:            { bsonType: ['int', 'double', 'null'] },
        on_prime:           { bsonType: ['int', 'double', 'null'] }
      }
    }
  },
  validationAction: 'warn',
  validationLevel: 'moderate'
});
print('Kolekce streaming_shifts vytvořena.');
"

# -------------------------------------------------------
# 5. Sharding kolekcí (hashed shard key pro rovnoměrné rozdělení)
# -------------------------------------------------------
log "Povoluji sharding na kolekcích..."
$MONGO_CMD --eval "
sh.shardCollection('streaming_db.netflix_titles',    { show_id: 'hashed' });
sh.shardCollection('streaming_db.platform_financials', { platform: 'hashed' });
sh.shardCollection('streaming_db.streaming_shifts',  { movie_id: 'hashed' });
print('Sharding kolekcí dokončen.');
printjson(sh.status());
"

# -------------------------------------------------------
# 6. Vytvoření indexů
# -------------------------------------------------------
log "Vytvářím sekundární indexy..."
$MONGO_CMD --eval "
const db2 = db.getSiblingDB('streaming_db');

// netflix_titles – filtrování a třídění
db2.netflix_titles.createIndex({ type: 1 },                       { name: 'idx_type' });
db2.netflix_titles.createIndex({ release_year: -1 },              { name: 'idx_release_year' });
db2.netflix_titles.createIndex({ country: 1 },                    { name: 'idx_country' });
db2.netflix_titles.createIndex({ rating: 1 },                     { name: 'idx_rating' });
db2.netflix_titles.createIndex({ type: 1, release_year: -1 },     { name: 'idx_type_year' });
db2.netflix_titles.createIndex({ listed_in: 1 },                  { name: 'idx_listed_in' });
db2.netflix_titles.createIndex({ director: 1 },                   { name: 'idx_director' });
db2.netflix_titles.createIndex({ country: 1, type: 1, release_year: -1 }, { name: 'idx_country_type_year' });

// platform_financials – řazení podle předplatitelů a příjmů
db2.platform_financials.createIndex({ platform: 1 },                      { name: 'idx_platform' });
db2.platform_financials.createIndex({ subscribers_millions: -1 },         { name: 'idx_subscribers' });
db2.platform_financials.createIndex({ quarterly_revenue_usd_millions: -1 }, { name: 'idx_revenue' });

// streaming_shifts – filtrování podle platforem a hodnocení
db2.streaming_shifts.createIndex({ on_netflix: 1, on_hulu: 1, on_prime: 1 }, { name: 'idx_platforms' });
db2.streaming_shifts.createIndex({ vote_average: -1 },                        { name: 'idx_vote' });
db2.streaming_shifts.createIndex({ popularity: -1 },                          { name: 'idx_popularity' });
db2.streaming_shifts.createIndex({ release_date: 1 },                         { name: 'idx_release_date' });

print('Všechny indexy vytvořeny.');
"

# -------------------------------------------------------
# 7. Vytvoření aplikačního uživatele
# -------------------------------------------------------
log "Vytvářím aplikačního uživatele streaming_user..."
$MONGO_CMD --eval "
try {
  db.getSiblingDB('streaming_db').createUser({
    user: 'streaming_user',
    pwd:  'streaming_pass_2024',
    roles: [
      { role: 'readWrite', db: 'streaming_db' },
      { role: 'dbAdmin',   db: 'streaming_db' }
    ]
  });
  print('Uživatel streaming_user vytvořen.');
} catch(e) {
  print('Uživatel již existuje nebo chyba: ' + e);
}
"

# -------------------------------------------------------
# 8. Import dat
# -------------------------------------------------------
log "Importuji netflix_titles.csv (8809 záznamů)..."
mongoimport \
  --host "$MONGOS" --port "$PORT" \
  -u "$ADMIN_USER" -p "$ADMIN_PASS" --authenticationDatabase admin \
  --db streaming_db --collection netflix_titles \
  --type csv --headerline --ignoreBlanks \
  /datasets/netflix_titles.csv

log "Importuji platform_financials_comprehensive.csv..."
mongoimport \
  --host "$MONGOS" --port "$PORT" \
  -u "$ADMIN_USER" -p "$ADMIN_PASS" --authenticationDatabase admin \
  --db streaming_db --collection platform_financials \
  --type csv --headerline --ignoreBlanks \
  /datasets/platform_financials_comprehensive.csv

log "Importuji streaming_platform_shifts_2026.csv..."
mongoimport \
  --host "$MONGOS" --port "$PORT" \
  -u "$ADMIN_USER" -p "$ADMIN_PASS" --authenticationDatabase admin \
  --db streaming_db --collection streaming_shifts \
  --type csv --headerline --ignoreBlanks \
  /datasets/streaming_platform_shifts_2026.csv

# -------------------------------------------------------
# 9. Ověření
# -------------------------------------------------------
log "Ověřuji počty dokumentů..."
$MONGO_CMD --eval "
const db2 = db.getSiblingDB('streaming_db');
print('netflix_titles:    ' + db2.netflix_titles.countDocuments()    + ' dokumentů');
print('platform_financials: ' + db2.platform_financials.countDocuments() + ' dokumentů');
print('streaming_shifts:  ' + db2.streaming_shifts.countDocuments()  + ' dokumentů');
print('');
printjson(sh.status());
"

log "=========================================="
log "  Inicializace MongoDB clusteru DOKONČENA"
log "  Mongos:        mongodb://$ADMIN_USER:***@localhost:27017"
log "  Mongo Express: http://localhost:8081"
log "=========================================="
