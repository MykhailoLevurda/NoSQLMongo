Základní samokontrola semestrální práce před odevzdáním
OBECNÉ
Zobrazení logů konkrétní služby
docker compose logs <service_name>
Očekávání: v logu nejsou chybová hlášení při startu (např. authentication failed, bind failed, out of memory) a u databází jsou uvedeny informace o úspěšném startu clusteru.

Restart konkrétní služby (simulace výpadku)
docker compose restart <service_name>
Očekávání: dojde ke krátkodobému výpadku, ale cluster se po chvíli stabilizuje a klientské dotazy jsou opět obsluhovány.

Stop/start pro simulaci výpadku uzlu
docker compose stop <service_name>
docker compose start <service_name>
Očekávání: při výpadku se projeví degradace (např. horší dostupnost, žlutý stav clusteru, snížený replikační faktor), po opětovném spuštění služby se stav zlepší.

MONGODB
Základní health check
Ping databáze (přes mongosh)
mongosh --eval 'db.runCommand("ping")'
Očekávání: dokument obsahující ok: 1.
Info o buildu (verze)
mongosh --eval 'db.runCommand({ buildInfo: 1 })'
Očekávání: pole version odpovídá použité verzi (>= 8.0.x dle zadání).

Replika set / cluster
Status repliky (na primáru)
mongosh --eval 'rs.status()'
Očekávání:
set – jméno replika setu

node se stateStr: "PRIMARY"

další s stateStr: "SECONDARY"
ok: 1
Konfigurace repliky
mongosh --eval 'rs.conf()'
Očekávání: počet členů = počet nodů, replikationFactor odpovídá zadání.
Sharding
Stav shardu
mongosh --eval 'sh.status()'
Očekávání:

seznam shardů (min. 3)

rozdělení chunků podle klíče

počet chunků na shardech odpovídá popisu

Statistika a distribuce dat
Stav databáze
mongosh --eval 'db.stats()'
Očekávání: collections, objects, dataSize, storageSize odpovídají datům.
Statistika kolekce
mongosh --eval 'db.yourCollection.stats()'
Očekávání: count = počet dokumentů, sharded: true pokud je kolekce shardovaná, rozdělení shardů v poli shards.
Indexy v kolekci
mongosh --eval 'db.yourCollection.getIndexes()'
Očekávání: primární a sekundární indexy, které jsou popsány v dokumentaci
Zabezpečení
Přihlášení s uživatelem
mongosh -u <user> -p <password> --authenticationDatabase admin
Očekávání: přihlášení úspěšné.

Kontrola uživatelů a rolí
mongosh --eval 'db.getUsers()' (v odpovídající DB)
Očekávání: definovaní uživatelé s rolemi (readWrite, dbAdmin, apod.).

Kontrola keyfile a interní autentizace
Ověření, že je keyfile uveden v konfiguraci MongoDB.
grep -n "keyFile" /etc/mongod.conf
nebo
cat /etc/mongod.conf
Očekávání: je uvedena položka security.keyFile: s cestou ke keyfile, případně je při startu použit parametr --keyFile. MongoDB pro interní autentizaci členů replika setu nebo sharded clusteru používá právě security.keyFile nebo --keyFile.
Ověření oprávnění ke keyfile.
ls -l <cesta-ke-keyfile>
Očekávání: soubor nemá group ani world permissions; na UNIX systémech je doporučeno použít omezená oprávnění, typicky chmod 400 nebo chmod 600. Keyfile nesmí být ponechán jako nechráněný statický soubor.
Ověření, že keyfile není sdílen jako veřejně přístupný statický soubor.
stat <cesta-ke-keyfile>
Očekávání: vlastníkem je účet používaný pro běh MongoDB a soubor je chráněn proti neautorizovanému přístupu.
Ověření interní autentizace mezi uzly.
mongosh --eval 'rs.status()'
Očekávání: replika set funguje bez chyb autentizace mezi uzly a členové clusteru se mezi sebou ověřují pomocí keyfile.