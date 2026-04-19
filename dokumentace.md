UNIVERZITA PARDUBICE
Fakulta elektrotechniky a informatiky
MongoDB – Shardovaný cluster pro streamingovou databázi
Mykhailo Levurda, 2. ročník




V Pardubicích dne 14. 4. 2026

---

# Obsah

- Úvod
- 1 Architektura
  - 1.1 Schéma a popis architektury
  - 1.2 Specifika konfigurace
    - 1.2.1 CAP teorém
    - 1.2.2 Cluster
    - 1.2.3 Uzly
    - 1.2.4 Sharding
    - 1.2.5 Replikace
    - 1.2.6 Perzistence dat
    - 1.2.7 Distribuce dat
    - 1.2.8 Zabezpečení
- 2 Funkční řešení
  - 2.1 Struktura
  - 2.2 Instalace
- 3 Případy užití a případové studie
- 4 Výhody a nevýhody
- 5 Další specifika
- 6 Data
- 7 Dotazy
- Závěr
- Zdroje
- Přílohy

---

## Úvod

Tato dokumentace popisuje návrh a implementaci NoSQL databázového systému postaveného na technologii MongoDB. Jako téma byl zvolen svět streamingových platforem – oblast, která v posledních letech zaznamenala obrovský nárůst dat i uživatelů, a která tak dobře ilustruje potřebu horizontálně škálovatelných databázových řešení.

Cílem projektu bylo vytvořit plně funkční MongoDB shardovaný cluster provozovaný v prostředí Docker, naplnit jej reálnými daty a demonstrovat možnosti NoSQL databází prostřednictvím sady netriviálních dotazů a datové analýzy.

Projekt pracuje se třemi datasety: katalogem titulů platformy Netflix (8 807 záznamů), finančními ukazateli streamingových platforem a přehledem streamingových trendů roku 2026. Tato kombinace umožňuje provádět jak jednoduché analytické dotazy, tak složité mezikolekcové spoje a agregace.

Celé řešení je automatizované – jediným příkazem `docker compose up` se spustí cluster, nakonfigurují se replikační sady, povolí sharding, vytvoří kolekce s validačními schématy a naimportují data. Tím je zajištěna reprodukovatelnost a přenositelnost řešení na libovolný stroj s nainstalovaným Dockerem.

---

## 1 Architektura

Architektura systému vychází z doporučené produkční topologie MongoDB shardovaného clusteru. Skládá se ze čtyř logických vrstev: klientské vrstvy, vrstvy směrování (mongos), vrstvy konfigurace (config servery) a vrstvy ukládání dat (shardy).

### 1.1 Schéma a popis architektury

Celý cluster se skládá z 16 Docker kontejnerů, přičemž 13 z nich jsou MongoDB procesy. Klientská aplikace (nebo příkazový řádek mongosh) se připojuje výhradně na mongos router, který transparentně směruje dotazy na příslušné shardy.

```
                    KLIENT / APLIKACE
                           │
                           ▼
                ┌─────────────────────┐
                │       MONGOS         │
                │    router :27017     │
                └──────────┬──────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  configsvr1  │  │  configsvr2  │  │  configsvr3  │
  │  (PRIMARY)   │  │  (SECONDARY) │  │  (SECONDARY) │
  │   :27019     │  │   :27019     │  │   :27019     │
  └──────────────┘  └──────────────┘  └──────────────┘
        configReplSet – metadata shardingu

          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │   SHARD 1    │  │   SHARD 2    │  │   SHARD 3    │
  │ shard1-1 PRI │  │ shard2-1 PRI │  │ shard3-1 PRI │
  │ shard1-2 SEC │  │ shard2-2 SEC │  │ shard3-2 SEC │
  │ shard1-3 SEC │  │ shard2-3 SEC │  │ shard3-3 SEC │
  │   :27018     │  │   :27018     │  │   :27018     │
  └──────────────┘  └──────────────┘  └──────────────┘
```

**Popis jednotlivých vrstev:**

Mongos router je vstupní bod pro veškerou komunikaci. Neukládá žádná data – pouze čte metadata z config serverů a na jejich základě rozhoduje, na který shard přeposlat dotaz nebo zápis. V případě dotazů, které zasahují více shardů (scatter-gather), kontaktuje všechny relevantní shardy a výsledky agreguje.

Config servery uchovávají metadata o rozložení dat v clusteru – konkrétně mapování rozsahů shard klíčů na jednotlivé shardy a seznam registrovaných shardů. Tvoří replikační sadu `configReplSet` se třemi uzly pro zajištění vysoké dostupnosti metadat.

Shardy jsou fyzická úložiště dat. Každý shard je samostatná replikační sada se třemi uzly (jeden PRIMARY, dva SECONDARY). Data jsou mezi shardy rozdělena na základě shard klíče pomocí hašování.

### 1.2 Specifika konfigurace

#### 1.2.1 CAP teorém

CAP teorém říká, že distribuovaný systém může současně zaručit nejvýše dvě ze tří vlastností: konzistenci (Consistency), dostupnost (Availability) a odolnost vůči rozdělení sítě (Partition tolerance).

MongoDB je systém typu **CP** – upřednostňuje konzistenci a odolnost vůči rozdělení sítě před absolutní dostupností. V praxi to znamená:

- Všechny zápisy jdou na PRIMARY uzel replikační sady. Tím je zaručena konzistence – nikdy nenastane situace, kdy dva klienti vidí různé verze dat.
- Při výpadku PRIMARY uzlu cluster dočasně odmítá zápisy po dobu volby nového PRIMARY (obvykle 10–30 sekund). V tomto okamžiku obětuje dostupnost ve prospěch konzistence.
- Čtení lze nakonfigurovat jako `readPreference: secondary`, čímž se dosáhne vyšší dostupnosti čtení za cenu případné mírně zastaralých dat (eventual consistency pro čtení).

V tomto projektu je použito výchozí nastavení – zápisy i čtení jdou na PRIMARY, cluster tedy pracuje v plném CP módu.

#### 1.2.2 Cluster

Cluster je logická jednotka, která sdružuje všechny MongoDB procesy do jednoho systému. V tomto projektu tvoří cluster:

- 3 config servery (replikační sada `configReplSet`)
- 3 shardy, každý jako replikační sada (celkem 9 datových uzlů)
- 1 mongos router

Cluster je plně kontejnerizovaný v Dockeru a komunikuje přes interní síť `mongo-net` (bridge driver). Interní autentizace mezi uzly clusteru je zajištěna sdíleným keyfile (`/keyfile/mongo-keyfile`).

Celý cluster se inicializuje automaticky pomocí init kontejnerů: `keyfile-init` vygeneruje keyfile, primární uzly každé replikační sady inicializují repliku a vytvoří admin uživatele, a `mongos-init` registruje shardy, vytváří kolekce a importuje data.

#### 1.2.3 Uzly

Cluster obsahuje celkem 13 MongoDB procesů rozdělených do čtyř skupin:

**Config servery (3 uzly, port 27019):**
Uzly `configsvr1`, `configsvr2`, `configsvr3` tvoří replikační sadu `configReplSet`. Spouštějí se s přepínačem `--configsvr`, který omezuje velikost chunků a optimalizuje chování pro ukládání metadat. `configsvr1` je PRIMARY a provádí inicializaci repliky i vytvoření admin uživatele pomocí localhost exception.

**Shard 1 (3 uzly, port 27018):**
Uzly `shard1-1` (PRIMARY, priorita 2), `shard1-2` a `shard1-3` (oba SECONDARY, priorita 1) tvoří replikační sadu `shard1ReplSet`. Vyšší priorita PRIMARY uzlu zajišťuje, že po restartu se PRIMARY role vrátí na `shard1-1`.

**Shard 2 a Shard 3** mají stejnou strukturu jako Shard 1, s replikačními sadami `shard2ReplSet` a `shard3ReplSet`.

**Mongos router (1 uzel, port 27017):**
Jediný vstupní bod pro klienty. Nezná hesla ani data, pouze směruje dotazy na základě metadat z config serverů.

#### 1.2.4 Sharding

Sharding je mechanismus horizontálního škálování, který rozděluje data kolekce mezi více fyzických serverů (shardů). Každý shard spravuje pouze část dat, takže dotazy a zápisy mohou probíhat paralelně.

V tomto projektu jsou shardovány všechny tři kolekce s použitím **hašovaného shard klíče**:

| Kolekce | Shard klíč | Typ |
|---|---|---|
| `netflix_titles` | `show_id` | hashed |
| `platform_financials` | `platform` | hashed |
| `streaming_shifts` | `movie_id` | hashed |

Hašované shardování zajišťuje rovnoměrné rozložení dat bez ohledu na hodnoty klíče. Alternativou je rozsahové (range-based) shardování, které je vhodné pro dotazy na rozsahy hodnot, ale hrozí u něj vznik hotspotů (nerovnoměrné zatížení).

Sharding byl povolen příkazem `sh.enableSharding('streaming_db')` a pro každou kolekci aktivován pomocí `sh.shardCollection()`. MongoDB automaticky vytváří hašovaný index na shard klíči.

#### 1.2.5 Replikace

Každý shard i config server tvoří replikační sadu (Replica Set) se třemi členy. Replikace zajišťuje:

- **High availability** – při výpadku PRIMARY se automaticky zvolí nový PRIMARY z dostupných SECONDARY uzlů (volba trvá 10–30 sekund)
- **Redundanci dat** – každý dokument je uložen na třech nezávislých uzlech
- **Možnost čtení ze SECONDARY** – odlehčení PRIMARY při read-heavy zátěži

Replikace funguje prostřednictvím **operation logu (oplog)** – kruhového bufferu operací na PRIMARY. SECONDARY uzly kontinuálně čtou oplog a aplikují operace na svou kopii dat. Replikační lag (zpoždění SECONDARY za PRIMARY) je za normálních podmínek v řádu milisekund.

Inicializace replikačních sad probíhá automaticky: primární uzel spustí `rs.initiate()` se seznamem všech tří členů, počká na volbu PRIMARY a poté vytvoří admin uživatele pomocí localhost exception (před aktivací autentizace).

#### 1.2.6 Perzistence dat

Data každého MongoDB uzlu jsou uložena na Docker volume, nikoli uvnitř kontejneru. Tím je zajištěno, že data přežijí restart nebo nahrazení kontejneru.

Každý ze 13 datových uzlů má vlastní pojmenovaný volume:

```
configsvr1-data, configsvr2-data, configsvr3-data
shard1-1-data, shard1-2-data, shard1-3-data
shard2-1-data, shard2-2-data, shard2-3-data
shard3-1-data, shard3-2-data, shard3-3-data
```

Sdílený keyfile je uložen ve volume `keyfile-vol`, který je připojen ke všem MongoDB uzlům jako read-only.

MongoDB používá úložný engine **WiredTiger** (výchozí od verze 3.2), který podporuje kompresi dat (snappy/zlib), document-level concurrency locking a checkpointing každých 60 sekund nebo při 2 GB dat v journalu.

#### 1.2.7 Distribuce dat

Po importu dat se kolekce `netflix_titles` (8 807 dokumentů) rozdělila mezi tři shardy přibližně rovnoměrně:

| Shard | Dokumenty | Podíl |
|---|---|---|
| shard1ReplSet | ~2 885 | ~32,8 % |
| shard2ReplSet | ~2 953 | ~33,5 % |
| shard3ReplSet | ~2 969 | ~33,7 % |

Rovnoměrnost distribuce je výsledkem hašovaného shard klíče na poli `show_id` (hodnoty typu "s1", "s2", ..., "s8807"). Hašovací funkce rozloží hodnoty rovnoměrně do hashovacího prostoru, který je rozdělen mezi shardy pomocí chunků.

MongoDB automaticky balancuje chunky na pozadí pomocí **balancer procesu** spuštěného na mongos. Pokud jeden shard obsahuje výrazně více chunků než ostatní, balancer přesune přebytečné chunky na méně vytížené shardy.

#### 1.2.8 Zabezpečení

Zabezpečení clusteru je řešeno na dvou úrovních:

**Interní autentizace (keyfile):**
Komunikace mezi uzly clusteru je chráněna sdíleným keyfile. Soubor `/keyfile/mongo-keyfile` je generován dynamicky při každém spuštění příkazem `openssl rand -base64 756`. Soubor má oprávnění `400` (čitelný pouze vlastníkem) a vlastníka `999:999` (UID uživatele mongodb v kontejneru). Všechny MongoDB procesy jsou spuštěny s přepínačem `--keyFile`, který vynutí ověření každého připojení mezi uzly clusteru.

**Uživatelská autentizace (SCRAM-SHA-256):**
Cluster používá dva uživatelské účty:

| Uživatel | Databáze | Role | Účel |
|---|---|---|---|
| `admin` | `admin` | `root` | Administrace clusteru |
| `streaming_user` | `streaming_db` | `readWrite`, `dbAdmin` | Aplikační přístup |

Admin uživatel je vytvořen pomocí localhost exception (před aktivací autentizace) na každém PRIMARY uzlu. Aplikační uživatel `streaming_user` je vytvořen skriptem `init-mongos.sh` po dokončení inicializace clusteru.

---

## 2 Funkční řešení

### 2.1 Struktura

Projekt je organizován do následujících adresářů:

```
NoSql/
├── solution/
│   ├── docker-compose.yml       # Definice celého clusteru (16 služeb)
│   ├── .env                     # Volitelné přepsání výchozích hodnot
│   ├── scripts/
│   │   ├── init-keyfile.sh              # Generování keyfile
│   │   ├── entrypoint-configsvr1.sh     # Config server PRIMARY
│   │   ├── entrypoint-configsvr.sh      # Config/shard SECONDARY uzly
│   │   ├── entrypoint-shard-primary.sh  # Shard PRIMARY uzly
│   │   └── init-mongos.sh               # Inicializace clusteru
│   └── datasets/
│       ├── netflix_titles.csv                    # 8 807 záznamů
│       ├── platform_financials_comprehensive.csv  # 10 záznamů
│       └── streaming_platform_shifts_2026.csv     # 81 záznamů
├── queries/
│   ├── dotazy.md     # Dokumentace 30 dotazů s popisem
│   └── queries.js    # Spustitelný soubor se všemi 30 dotazy
├── Data/
│   └── analysis.ipynb  # Jupyter notebook s datovou analýzou
└── dokumentace.md      # Tato dokumentace
```

**Klíčové soubory:**

`docker-compose.yml` definuje všech 16 služeb s jejich závislostmi, health checks, volumes a sítěmi. Závislosti jsou řešeny pomocí podmínek `service_healthy` (čeká na úspěšný ping) a `service_completed_successfully` (čeká na dokončení init kontejneru).

`entrypoint-shard-primary.sh` je parametrizovaný skript pro PRIMARY uzly shardů. Přijímá konfiguraci přes proměnné prostředí (`SHARD_REPLSET`, `SHARD_HOST`, `SHARD_PEERS`), takže stejný skript slouží pro všechny tři shardy.

`init-mongos.sh` provádí celou inicializaci v jednom průběhu: přidání shardů, povolení shardingu, vytvoření kolekcí s JSON Schema validací, vytvoření indexů, vytvoření aplikačního uživatele a import dat ze tří CSV souborů.

### 2.2 Instalace

**Požadavky:**
- Docker Desktop (Windows/Mac) nebo Docker Engine + Docker Compose (Linux)
- Git
- Minimálně 4 GB RAM volné pro Docker (doporučeno 8 GB)

**Postup spuštění:**

1. Klonování repozitáře:
```bash
git clone https://github.com/MykhailoLevurda/NoSQLMongo.git
cd NoSQLMongo
```

2. Spuštění clusteru:
```bash
cd solution
docker compose up -d
```

3. Sledování inicializace (volitelné):
```bash
docker compose logs -f mongos-init
```

4. Ověření funkčnosti (po dokončení inicializace, cca 3–5 minut):
```bash
mongosh --host localhost --port 27017 \
  -u admin -p adminpassword \
  --authenticationDatabase admin \
  --eval "sh.status()"
```

5. Webové rozhraní Mongo Express je dostupné na `http://localhost:8081` (přihlášení: admin / adminpassword).

**Zastavení a vyčištění:**
```bash
# Zastavení bez smazání dat
docker compose down

# Zastavení včetně smazání všech volumes (data budou ztracena)
docker compose down -v
```

**Konfigurace přes proměnné prostředí (.env):**
```
MONGO_ADMIN_USER=admin
MONGO_ADMIN_PASS=adminpassword
MONGOS_PORT=27017
MONGO_EXPRESS_PORT=8081
```

---

## 3 Případy užití a případové studie

### Případová studie 1: Analýza obsahu Netflix katalogu

**Popis situace:**
Analytický tým streamingové platformy potřebuje zjistit, jak se vyvíjela nabídka obsahu v průběhu let, které země jsou největšími dodavateli obsahu a jaká je struktura žánrů napříč dekádami.

**Řešení pomocí MongoDB:**
Kolekce `netflix_titles` obsahuje 8 807 dokumentů s metadaty každého titulu. Díky agregačnímu frameworku MongoDB lze provádět komplexní analýzy bez nutnosti exportu dat do externího analytického nástroje.

Dotaz pro analýzu ročního přírůstku obsahu (Q1) využívá pipeline `$addFields` → `$match` → `$group` → `$group` → `$sort`. Textové pole `date_added` (formát "September 25, 2021") je parsováno pomocí `$split` a `$toInt` přímo v pipeline, bez nutnosti předchozí transformace dat.

Výsledek ukazuje, že Netflix nejvíce rozšiřoval katalog v letech 2018–2019 (přes 1 500 nových titulů ročně), přičemž filmy tvoří přibližně 70 % katalogu a seriály 30 %. Největšími dodavateli obsahu jsou USA (36 % katalogu), Indie (12 %) a Velká Británie (6 %).

**Přidaná hodnota MongoDB:**
Flexibilní schéma umožnilo pracovat s daty přímo ve formátu, v jakém byla importována z CSV (textové datum, smíšené hodnoty v poli `country`). Agregační pipeline nahradila nutnost psát složité SQL dotazy s více JOINy a podvýběry.

### Případová studie 2: Finanční srovnání streamingových platforem

**Popis situace:**
Investiční analytik potřebuje porovnat finanční zdraví streamingových platforem – ziskové marže, příjem na předplatitele a predikci růstu příjmů pro rok 2026. Zároveň chce zjistit, jak se finanční síla platformy promítá do šíře katalogového zastoupení v aktuálních streamingových trendech.

**Řešení pomocí MongoDB:**
Dotaz Q16 využívá operátor `$set` (alias pro `$addFields`) pro přidání tří odvozených polí do jednoho průchodu pipeline: `profit_margin_pct`, `revenue_per_subscriber_usd` a `predikce_rustu_pct`. Operátor `$cond` ošetřuje dělení nulou pro platformy bez zveřejněných dat.

Pro mezikolekcové propojení dotaz Q9 provádí reverzní `$lookup` – výchozí kolekcí jsou `platform_financials` a poddotaz v `$lookup` pipeline přímo agreguje záznamy z `streaming_shifts`. Výsledkem je jeden dokument per platforma s počtem titulů v aktuálním katalogu 2026 a průměrným hodnocením.

Výsledky ukazují, že Netflix má ziskovou marži ~20 % a příjem na předplatitele ~37 USD za čtvrtletí. Amazon Prime Video dosahuje nižší marže, ale kompenzuje to širší katalogovou dostupností titulů v `streaming_shifts`.

**Přidaná hodnota MongoDB:**
Schopnost provádět výpočty odvozených polí přímo v databázové vrstvě bez nutnosti stahovat data do aplikace. Mezikolekcové `$lookup` s korelovanými poddotazy nahrazuje klasické SQL JOINy a umožňuje komplexní analytické dotazy na heterogenních datech.

### Případová studie 3: Odolnost clusteru při výpadku uzlu

**Popis situace:**
DevOps tým potřebuje ověřit, že produkční cluster zvládne výpadek jednoho uzlu bez přerušení služby. Konkrétně simulují výpadek sekundárního uzlu `shard1-2` a sledují chování clusteru.

**Řešení pomocí MongoDB:**
Replikační faktor 3 zajišťuje, že každý shard má vždy k dispozici quorum (2 z 3 uzlů) i při výpadku jednoho člena. Postup simulace (dotaz Q29):

1. Zastavení kontejneru `shard1-2`: `docker compose stop shard1-2`
2. Ověření stavu repliky – `shard1-2` zobrazí stav `(not reachable/healthy)`
3. Dotaz přes mongos funguje normálně – PRIMARY `shard1-1` a SECONDARY `shard1-3` tvoří quorum
4. Obnovení uzlu: `docker compose start shard1-2`
5. Automatická re-synchronizace – uzel přejde ze stavu `STARTUP2` do `SECONDARY` a doplní si chybějící operace z oplog PRIMARY uzlu

Celý proces obnovení trvá typicky 30–60 sekund a nevyžaduje žádný manuální zásah.

**Přidaná hodnota MongoDB:**
Automatická správa replikace a volba PRIMARY pomocí Raft-based algoritmu eliminuje potřebu manuálního failoveru. Oplog zajišťuje konzistentní re-synchronizaci i po delším výpadku, pokud uzel nechyběl déle, než je délka oplog bufferu.

---

## 4 Výhody a nevýhody

### Výhody MongoDB

**Flexibilní schéma (schema-less):**
Dokumenty v kolekci nemusí mít stejnou strukturu. To umožňuje postupný vývoj datového modelu bez nutnosti migrací (ALTER TABLE). V tomto projektu bylo možné importovat CSV data přímo bez předchozí transformace – MongoDB přijalo dokumenty s různými kombinacemi přítomných/nepřítomných polí.

**Horizontální škálovatelnost:**
Sharding umožňuje distribuovat data a zátěž na libovolný počet serverů. Přidání nového shardu do existujícího clusteru nevyžaduje prostoje – balancer postupně přesune část dat na nový shard. Tím se MongoDB zásadně liší od relačních databází, kde horizontální škálování vyžaduje složité middleware řešení.

**Výkonný agregační framework:**
Operátory jako `$bucket`, `$facet`, `$lookup` s pipeline, `$replaceRoot`, `$mergeObjects` a `$indexStats` umožňují provádět komplexní analytické dotazy přímo v databázové vrstvě. To eliminuje potřebu přenosu velkých objemů dat do aplikační vrstvy pro zpracování.

**Nativní podpora JSON/BSON:**
Dokumentový model přirozeně odpovídá datovým strukturám používaným v moderních aplikacích (JavaScript objekty, Python slovníky, REST API odpovědi). Odpadá impedanční nesoulad mezi aplikačním a databázovým modelem.

**Vysoká dostupnost:**
Replikační sady s automatickým failoverem zajišťují, že výpadek jednoho uzlu nezpůsobí výpadek služby. Volba nového PRIMARY trvá typicky 10–30 sekund.

### Nevýhody MongoDB

**Absence ACID transakcí na úrovni více dokumentů (historicky):**
MongoDB podporuje multi-document ACID transakce od verze 4.0 (2018), ale jejich výkon je výrazně nižší než u relačních databází a v shardovaném prostředí jsou složitější. Pro aplikace s vysokými požadavky na transakční integritu (bankovnictví, e-commerce) může být MongoDB méně vhodnou volbou.

**Vyšší spotřeba paměti:**
MongoDB agresivně využívá dostupnou RAM pro cache (WiredTiger cache). V prostředí s omezenými zdroji (jako vývojový Docker cluster) může docházet k degradaci výkonu. V tomto projektu je každý z 13 MongoDB procesů spuštěn s výchozím nastavením cache.

**Složitost shardovaného clusteru:**
Provoz shardovaného clusteru je výrazně složitější než provoz standalone instance nebo replikační sady. Správná volba shard klíče je kritická – špatný shard klíč (s nízkou kardinalitou nebo nerovnoměrným rozložením hodnot) způsobí hotspoty a degradaci výkonu. Změna shard klíče po nasazení je v MongoDB 5.0+ možná, ale stále složitá operace.

**Neefektivní pro silně relační data:**
Pokud aplikační doména přirozeně odpovídá relačnímu modelu (mnoho tabulek s komplexními vazbami N:M, referenční integrita), MongoDB nabízí méně pohodlné řešení než PostgreSQL nebo MySQL. Operátor `$lookup` je funkčním ekvivalentem JOINu, ale není tak výkonný jako nativní JOIN v RDBMS.

---

## 5 Další specifika

### JSON Schema validace

Všechny tři kolekce mají definované validační schéma pomocí MongoDB JSON Schema validátoru. Validace je nastavena na `validationAction: "warn"` a `validationLevel: "moderate"` – neplatné dokumenty jsou přijaty, ale do logu se zapíše varování. Toto nastavení je vhodné pro migraci dat, kde nelze zaručit 100% kvalitu zdrojových dat.

Příklad validačního schématu pro `netflix_titles`:
```javascript
{
  $jsonSchema: {
    bsonType: "object",
    required: ["show_id", "type", "title"],
    properties: {
      show_id: { bsonType: "string" },
      type:    { bsonType: "string", enum: ["Movie", "TV Show"] },
      title:   { bsonType: "string", minLength: 1 },
      release_year: {
        bsonType: ["int", "double", "null"],
        minimum: 1900, maximum: 2030
      }
    }
  }
}
```

### Indexová strategie

Projekt využívá 15 sekundárních indexů napříč třemi kolekcemi. Kromě jednoduchých indexů jsou vytvořeny dva compound indexy na `netflix_titles`:

- `idx_type_year` (`type: 1, release_year: -1`) – pro dotazy filtrující typ obsahu a rok zároveň
- `idx_country_type_year` (`country: 1, type: 1, release_year: -1`) – pro víceúrovňové geografické filtrování

Hašované indexy na shard klíčích jsou vytvořeny automaticky MongoDB při povolení shardingu. Celkem má každý uzel `netflix_titles` 10 indexů (8 sekundárních + 1 výchozí `_id` + 1 hašovaný shard key index).

Dopad indexace lze ověřit dotazem Q19, který porovnává plán provádění (explain) bez indexu (COLLSCAN, 8 807 prohledaných dokumentů) a s compound indexem `idx_country_type_year` (IXSCAN, výrazně méně prohledaných klíčů).

### Autentizace a autorizace

Cluster implementuje dvouvrstvé zabezpečení. Na úrovni interní komunikace clusteru je použit keyfile mechanismus – sdílený tajný klíč, jehož znalost prokazuje, že se jedná o legitimní člen clusteru. Na úrovni uživatelského přístupu MongoDB implementuje RBAC (Role-Based Access Control) s granulárními oprávněními na úrovni databáze, kolekce i operace.

---

## 6 Data

Projekt pracuje se třemi datasety na společném tématu streamingových platforem:

### netflix_titles.csv
**Zdroj:** Kaggle (dataset Shivam Bansal, aktualizace 2021)
**Počet záznamů:** 8 807
**Popis:** Kompletní katalog titulů dostupných na platformě Netflix. Každý záznam obsahuje unikátní ID (`show_id`), typ obsahu (Movie/TV Show), název, režiséra, obsazení, zemi původu, datum přidání na Netflix, rok vydání, věkové hodnocení, délku trvání, žánry a popis.
**Využití v projektu:** Hlavní datová sada. Shardována pomocí `show_id: hashed`. Slouží jako základ pro analytické dotazy v kategoriích 1, 3 a 4.

### platform_financials_comprehensive.csv
**Zdroj:** Vlastní dataset sestavený z veřejně dostupných finančních zpráv platforem (2024–2025)
**Počet záznamů:** 10
**Popis:** Finanční ukazatele 10 streamingových platforem. Každý záznam obsahuje název platformy, počet předplatitelů (v milionech), čtvrtletní příjmy a zisky (v mil. USD), roční výdaje na obsah, příjmy z reklamy a predikci příjmů pro rok 2026.
**Využití v projektu:** Referenční dataset pro mezikolekcové dotazy. Slouží jako zdroj finančního kontextu při analýze katalogových dat.

### streaming_platform_shifts_2026.csv
**Zdroj:** Dataset trendů streamingového trhu pro rok 2026
**Počet záznamů:** 81
**Popis:** Přehled filmových titulů roku 2026 dostupných na streamingových platformách. Každý záznam obsahuje ID titulu, název, datum vydání, popularitu, průměrné hodnocení, počet hodnocení, název platformy a binární příznaky dostupnosti na Netflix (`on_netflix`), Hulu (`on_hulu`) a Amazon Prime (`on_prime`).
**Využití v projektu:** Propojovací dataset mezi aktuálními streamovými trendy a finančními daty platforem.

### Vztahy mezi datasety

Přímý join pomocí názvu titulu mezi `netflix_titles` a `streaming_shifts` není možný – `netflix_titles` obsahuje starší katalog (do 2021), zatímco `streaming_shifts` zachycuje tituly roku 2026. Mezikolekcové dotazy proto využívají binární příznaky platformy (`on_netflix`, `on_prime`) pro propojení s `platform_financials` přes název platformy.

---

## 7 Dotazy

Projekt obsahuje 30 netriviálních MongoDB dotazů rozdělených do 5 kategorií (6 dotazů v každé kategorii). Dotazy jsou dostupné ve dvou formátech:

- `queries/dotazy.md` – dokumentační formát s popisem každého dotazu, vysvětlením chování pipeline a kontextem k datům
- `queries/queries.js` – spustitelný soubor pro mongosh

**Kategorie 1 – Agregační a analytické dotazy (Q1–Q6):**
Analýza obsahu Netflix katalogu. Využívají operátory `$addFields`, `$split`, `$toInt`, `$bucket`, `$group`, `$unwind`, `$facet`. Příklad: Q4 rozděluje filmy do kategorií podle délky trvání pomocí `$bucket` s definovanými hranicemi.

**Kategorie 2 – Propojování dat a vazby mezi datasety (Q7–Q12):**
Mezikolekcové dotazy využívající `$lookup` s pipeline, `$let`/`$expr`, `$facet` a self-lookup. Příklad: Q8 propojuje `streaming_shifts` s `platform_financials` pomocí `$lookup` s `let` a `$expr` pro podmíněný join bez přímého klíče.

**Kategorie 3 – Transformace a obohacení dat (Q13–Q18):**
Transformace textových polí na číselné hodnoty, kategorizace pomocí `$switch`, normalizace dat. Příklad: Q18 provádí self-lookup pro výpočet normalizovaných skóre popularity a kombinovaného skóre kvality.

**Kategorie 4 – Indexy a optimalizace (Q19–Q24):**
Demonstrace dopadu indexace, explain analýzy, `$indexStats` a audit kvality dat. Příklad: Q19 porovnává COLLSCAN (8 807 prohledaných dokumentů) s IXSCAN (compound index) pro stejný dotaz.

**Kategorie 5 – Distribuce dat, cluster, replikace (Q25–Q30):**
Administrativní dotazy pro monitoring clusteru. Příklad: Q29 simuluje výpadek sekundárního uzlu a ověřuje automatické obnovení clusteru.

---

## Závěr

Projekt úspěšně demonstroval nasazení, konfiguraci a provoz MongoDB shardovaného clusteru v produkční topologii. Klíčovými výstupy jsou:

**Technické:** Plně automatizovaný cluster s 16 Docker kontejnery, hašovým shardingem na třech sadách, replikačním faktorem 3, dynamickým keyfile, JSON Schema validací a 15 sekundárními indexy. Celá inicializace probíhá bez manuálního zásahu.

**Analytické:** 30 netriviálních dotazů pokrývajících agregace, mezikolekcové propojování, transformace dat, indexovou optimalizaci a administraci clusteru. Jupyter notebook s vizualizacemi pro všechny tři datasety.

**Architekturální:** Projekt ilustruje silné stránky MongoDB – flexibilní schéma, výkonný agregační framework a horizontální škálovatelnost – i jeho omezení, jako je složitost správy shardovaného clusteru a historicky slabší podpora ACID transakcí.

MongoDB shardovaný cluster je vhodným řešením pro datově náročné aplikace s potřebou horizontálního škálování a flexibilního datového modelu. Pro aplikace s dominantně relačním charakterem dat nebo vysokými požadavky na transakční konzistenci zůstávají tradiční RDBMS konkurenceschopnou alternativou.

---

## Zdroje

1. MongoDB Documentation – Sharding. https://www.mongodb.com/docs/manual/sharding/
2. MongoDB Documentation – Replication. https://www.mongodb.com/docs/manual/replication/
3. MongoDB Documentation – Aggregation Pipeline. https://www.mongodb.com/docs/manual/aggregation/
4. MongoDB Documentation – JSON Schema Validation. https://www.mongodb.com/docs/manual/core/schema-validation/
5. Brewer, E. (2000). Towards robust distributed systems. PODC Keynote. (CAP theorem)
6. Banker, K. et al. (2016). MongoDB in Action, 2nd Edition. Manning Publications.
7. Chodorow, K. (2013). MongoDB: The Definitive Guide. O'Reilly Media.
8. Dataset: Netflix Movies and TV Shows. Kaggle – Shivam Bansal. https://www.kaggle.com/datasets/shivamb/netflix-shows
9. Docker Documentation – Compose file reference. https://docs.docker.com/compose/compose-file/
10. MongoDB Docker Image. https://hub.docker.com/_/mongo

---

## Přílohy

### Příloha A – Architekturní schéma

*(Schéma clusteru vložit jako obrázek z draw.io – viz kapitola 1.1)*

### Příloha B – Struktura kolekcí

**netflix_titles** (8 807 dokumentů):
```
show_id, type, title, director, cast, country,
date_added, release_year, rating, duration,
listed_in, description
```

**platform_financials** (10 dokumentů):
```
platform, subscribers_millions, quarterly_revenue_usd_millions,
quarterly_profit_usd_millions, annual_content_spend_usd_millions,
ad_revenue_2025_usd_millions, projected_2026_revenue_usd_millions
```

**streaming_shifts** (81 dokumentů):
```
movie_id, title, release_date, popularity, vote_average,
vote_count, streaming_platforms, on_netflix, on_hulu, on_prime
```

### Příloha C – Seznam indexů

| Kolekce | Index | Pole |
|---|---|---|
| netflix_titles | idx_type | type: 1 |
| netflix_titles | idx_release_year | release_year: -1 |
| netflix_titles | idx_country | country: 1 |
| netflix_titles | idx_rating | rating: 1 |
| netflix_titles | idx_type_year | type: 1, release_year: -1 |
| netflix_titles | idx_listed_in | listed_in: 1 |
| netflix_titles | idx_director | director: 1 |
| netflix_titles | idx_country_type_year | country: 1, type: 1, release_year: -1 |
| platform_financials | idx_platform | platform: 1 |
| platform_financials | idx_subscribers | subscribers_millions: -1 |
| platform_financials | idx_revenue | quarterly_revenue_usd_millions: -1 |
| streaming_shifts | idx_platforms | on_netflix: 1, on_hulu: 1, on_prime: 1 |
| streaming_shifts | idx_vote | vote_average: -1 |
| streaming_shifts | idx_popularity | popularity: -1 |
| streaming_shifts | idx_release_date | release_date: 1 |
