# 30 Netriviálních MongoDB Dotazů – Streaming DB

Databáze: `streaming_db`  
Kolekce: `netflix_titles` (8 807 dok.), `platform_financials` (10 dok.), `streaming_shifts` (81 dok.)  
Připojení: `mongosh --host localhost --port 27017 -u admin -p adminpassword --authenticationDatabase admin`

---

## KATEGORIE 1 – Agregační a analytické dotazy

### Dotaz 1
**Zadání:** Zjisti počet filmů a seriálů přidaných na Netflix každý rok od 2015, seřazeno od nejnovějšího.

**Obecné chování:** Agregační pipeline extrahuje rok z textového pole `date_added` pomocí `$addFields` + `$split`, filtruje záznamy od 2015, seskupuje podle roku a typu obsahu pomocí `$group`, a výsledky pivotuje zpět pomocí druhého `$group` s `$push`. Kombinuje `$addFields` → `$match` → `$group` → `$group` → `$sort`.

**Konkrétní práce s daty:** Pole `date_added` je ve formátu `"September 25, 2021"`. Split podle `", "` dá pole `["September 25", "2021"]` – index 1 je rok. Dotaz ukazuje, jak Netflix postupně rozšiřoval knihovnu.

```javascript
use streaming_db

db.netflix_titles.aggregate([
  { $match: { date_added: { $ne: null, $ne: "" } } },
  { $addFields: {
      rok_pridani: {
        $toInt: { $arrayElemAt: [{ $split: ["$date_added", ", "] }, 1] }
      }
  }},
  { $match: { rok_pridani: { $gte: 2015 } } },
  { $group: {
      _id: { rok: "$rok_pridani", typ: "$type" },
      pocet: { $sum: 1 }
  }},
  { $sort: { "_id.rok": -1, "_id.typ": 1 } },
  { $group: {
      _id: "$_id.rok",
      celkem: { $sum: "$pocet" },
      typy: { $push: { typ: "$_id.typ", pocet: "$pocet" } }
  }},
  { $sort: { _id: -1 } }
])
```

---

### Dotaz 2
**Zadání:** Najdi top 10 zemí s nejvíce Netflix tituly. Pro každou zemi uveď počet filmů, seriálů, průměrný rok vydání a procentuální podíl na celkovém katalogu.

**Obecné chování:** `$match` odfiltruje záznamy bez země. `$group` seskupí podle prvního státu (kolekce může obsahovat více zemí oddělených čárkou – `$arrayElemAt` + `$split` bere primární zemi). `$project` vypočítá podíl pomocí `$divide` a `$multiply`. Kombinace: `$match` → `$group` → `$sort` → `$limit` → `$project`.

**Konkrétní práce s daty:** Pole `country` může obsahovat `"United States, India"` – bere se první země. Celkový počet dokumentů je 8 807.

```javascript
db.netflix_titles.aggregate([
  { $match: { country: { $ne: null, $ne: "" } } },
  { $group: {
      _id: { $arrayElemAt: [{ $split: ["$country", ", "] }, 0] },
      pocet_titulu:  { $sum: 1 },
      prumerny_rok:  { $avg: "$release_year" },
      pocet_movies:  { $sum: { $cond: [{ $eq: ["$type", "Movie"]   }, 1, 0] } },
      pocet_shows:   { $sum: { $cond: [{ $eq: ["$type", "TV Show"] }, 1, 0] } }
  }},
  { $sort: { pocet_titulu: -1 } },
  { $limit: 10 },
  { $project: {
      _id: 0,
      zeme:          "$_id",
      pocet_titulu:  1,
      pocet_movies:  1,
      pocet_shows:   1,
      prumerny_rok:  { $round: ["$prumerny_rok", 0] },
      podil_katalogu_pct: {
        $round: [{ $multiply: [{ $divide: ["$pocet_titulu", 8807] }, 100] }, 2]
      }
  }}
])
```

---

### Dotaz 3
**Zadání:** Proveď distribuci věkových hodnocení (rating) pro filmy a seriály zvlášť. Pro každé hodnocení vypočítej procentuální zastoupení v rámci svého typu.

**Obecné chování:** Filtruje jen platná hodnocení pomocí `$in`. Dvoustupňový `$group`: první seskupí rating+typ, druhý přidá celkový součet. Po `$unwind` `$project` vypočítá procentuální podíl. Tato technika (double group pro výpočet podílu) je typicky netriviální.

**Konkrétní práce s daty:** `rating` sloupec obsahuje mix TV hodnocení (`TV-MA`, `TV-PG`) i filmových (`PG-13`, `R`). Výsledek ukáže dominanci `TV-MA` u seriálů a `TV-14` u filmů.

```javascript
db.netflix_titles.aggregate([
  { $match: {
      rating: { $in: ["G","PG","PG-13","R","NC-17","NR",
                      "TV-Y","TV-Y7","TV-G","TV-PG","TV-14","TV-MA"] }
  }},
  { $group: { _id: { rating: "$rating", typ: "$type" }, count: { $sum: 1 } } },
  { $group: {
      _id: "$_id.typ",
      celkem: { $sum: "$count" },
      hodnoceni: { $push: { rating: "$_id.rating", count: "$count" } }
  }},
  { $unwind: "$hodnoceni" },
  { $project: {
      _id: 0,
      typ:    "$_id",
      rating: "$hodnoceni.rating",
      count:  "$hodnoceni.count",
      podil_pct: {
        $round: [{ $multiply: [{ $divide: ["$hodnoceni.count", "$celkem"] }, 100] }, 1]
      }
  }},
  { $sort: { typ: 1, count: -1 } }
])
```

---

### Dotaz 4
**Zadání:** Analyzuj délku filmů pomocí bucket agregace. Rozděl filmy do kategorií podle délky (do 60 min, 60–89, 90–119, 120–149, 150+ min) a pro každou kategorii uveď počet, průměrnou délku a nejkratší/nejdelší film.

**Obecné chování:** `$match` vybere jen filmy s délkou v minutách. `$addFields` parsuje číslo z řetězce `"90 min"`. `$bucket` rozdělí do předem definovaných intervalů (boundaries) s výstupními metrikami. Kombinace `$match` → `$addFields` → `$bucket` je typicky netriviální.

**Konkrétní práce s daty:** Pole `duration` má formát `"90 min"` nebo `"2 Seasons"`. `$split` + `$toInt` extrahuje číslo. Výsledek odhalí, že nejčastější délka je 90–119 minut.

```javascript
db.netflix_titles.aggregate([
  { $match: { type: "Movie", duration: { $regex: "min$" } } },
  { $addFields: {
      duration_min: {
        $toInt: { $arrayElemAt: [{ $split: ["$duration", " "] }, 0] }
      }
  }},
  { $bucket: {
      groupBy: "$duration_min",
      boundaries: [0, 60, 90, 120, 150, 700],
      default: "ostatni",
      output: {
        pocet:         { $sum: 1 },
        prumerna_min:  { $avg: "$duration_min" },
        nejkratsi_min: { $min: "$duration_min" },
        nejdelsi_min:  { $max: "$duration_min" },
        priklady:      { $push: "$title" }
      }
  }},
  { $project: {
      pocet: 1,
      prumerna_min:  { $round: ["$prumerna_min", 1] },
      nejkratsi_min: 1,
      nejdelsi_min:  1,
      priklady:      { $slice: ["$priklady", 3] }
  }}
])
```

---

### Dotaz 5
**Zadání:** Najdi 10 nejplodnějších režisérů filmů. Pro každého uveď počet filmů, průměrný rok vydání, počet různých zemí ve kterých tvořil, a seznam unikátních hodnocení.

**Obecné chování:** `$match` odfiltruje záznamy bez režiséra a pouze filmy. `$group` seskupí podle jména s `$addToSet` pro unikátní hodnoty (země, hodnocení). `$project` doplní `$size` pro počet zemí. Kombinace `$match` → `$group` → `$sort` → `$limit` → `$project`.

**Konkrétní práce s daty:** Pole `director` může obsahovat více jmen (`"Robert Cullen, José Luis Ucha"`). Tato analýza bere celý řetězec jako jméno – ukáže režiséry s největším počtem titulů v Netflix katalogu (typicky Bollywood nebo dokumentaristé).

```javascript
db.netflix_titles.aggregate([
  { $match: { director: { $ne: null, $ne: "" }, type: "Movie" } },
  { $group: {
      _id:          "$director",
      pocet_filmu:  { $sum: 1 },
      prumerny_rok: { $avg: "$release_year" },
      zeme:         { $addToSet: "$country" },
      hodnoceni:    { $addToSet: "$rating" }
  }},
  { $match: { _id: { $ne: null } } },
  { $sort: { pocet_filmu: -1 } },
  { $limit: 10 },
  { $project: {
      _id: 0,
      rezisor:      "$_id",
      pocet_filmu:  1,
      prumerny_rok: { $round: ["$prumerny_rok", 0] },
      pocet_zemi:   { $size: "$zeme" },
      hodnoceni:    1
  }}
])
```

---

### Dotaz 6
**Zadání:** Pro každou dekádu (1940s–2020s) zjisti top 3 nejčastější žánry (listed_in). Ukaž celkový počet titulů vydaných v dané dekádě.

**Obecné chování:** `$addFields` vypočítá dekádu pomocí `$floor` a `$multiply` a rozloží `listed_in` na pole žánrů. `$unwind` rozvine pole. Dvojnásobný `$group` – první seskupí decade+žánr, druhý sestaví top žánry pomocí `$push` a ořízne `$slice`. Kombinace `$addFields` → `$unwind` → `$group` → `$group` → `$project` → `$sort`.

**Konkrétní práce s daty:** `listed_in = "Dramas, International Movies"` → po `$split` → `["Dramas", "International Movies"]` → `$unwind` → dva dokumenty. Výsledek ukazuje jak se žánrové preference vyvíjely napříč dekádami.

```javascript
db.netflix_titles.aggregate([
  { $match: { listed_in: { $ne: null, $ne: "" }, release_year: { $gte: 1940 } } },
  { $addFields: {
      decade: {
        $concat: [
          { $toString: { $multiply: [{ $floor: { $divide: ["$release_year", 10] } }, 10] } },
          "s"
        ]
      },
      zanry_pole: { $split: ["$listed_in", ", "] }
  }},
  { $unwind: "$zanry_pole" },
  { $group: {
      _id: { decade: "$decade", zanr: "$zanry_pole" },
      pocet: { $sum: 1 }
  }},
  { $sort: { "_id.decade": 1, pocet: -1 } },
  { $group: {
      _id:            "$_id.decade",
      celkem_titulu:  { $sum: "$pocet" },
      top_zanry:      { $push: { zanr: "$_id.zanr", pocet: "$pocet" } }
  }},
  { $project: {
      _id: 0,
      decade:        "$_id",
      celkem_titulu: 1,
      top3_zanry:    { $slice: ["$top_zanry", 3] }
  }},
  { $sort: { decade: 1 } }
])
```

---

## KATEGORIE 2 – Propojování dat a vazby mezi datasety

### Dotaz 7
**Zadání:** Obohať statistiku obsahu Netflix katalogu (počet filmů, počet seriálů, průměrný rok) o finanční data platformy Netflix z kolekce `platform_financials`. Vypočítej odhadovaný výdaj na obsah na jeden titul.

**Obecné chování:** Nejdřív `$group` agreguje statistiky z `netflix_titles`. Pak `$lookup` s `pipeline` (korelovaný poddotaz bez lokálního klíče) přitáhne dokument platformy Netflix. `$unwind` rozbalí výsledek. `$addFields` vypočítá odvozené pole. Kombinace `$group` → `$lookup(pipeline)` → `$unwind` → `$addFields` → `$project`.

**Konkrétní práce s daty:** `platform_financials` obsahuje Netflix s `annual_content_spend_usd_millions: 20000` (20 mld. USD). Vydělením počtem titulů dostaneme odhadovaný náklad na 1 titul v katalogu.

```javascript
db.netflix_titles.aggregate([
  { $group: {
      _id:           "$type",
      pocet_titulu:  { $sum: 1 },
      avg_rok:       { $avg: "$release_year" },
      unikatni_zeme: { $addToSet: "$country" }
  }},
  { $lookup: {
      from: "platform_financials",
      pipeline: [
        { $match: { platform: "Netflix" } },
        { $project: {
            _id: 0,
            subscribers_millions: 1,
            quarterly_revenue_usd_millions: 1,
            annual_content_spend_usd_millions: 1,
            projected_2026_revenue_usd_millions: 1
        }}
      ],
      as: "netflix_finance"
  }},
  { $unwind: "$netflix_finance" },
  { $addFields: {
      spend_per_title_M_usd: {
        $round: [{
          $divide: ["$netflix_finance.annual_content_spend_usd_millions", "$pocet_titulu"]
        }, 4]
      }
  }},
  { $project: {
      _id: 0,
      typ_obsahu:           "$_id",
      pocet_titulu:         1,
      avg_rok:              { $round: ["$avg_rok", 0] },
      pocet_zemi:           { $size: "$unikatni_zeme" },
      subscribers_M:        "$netflix_finance.subscribers_millions",
      content_spend_M:      "$netflix_finance.annual_content_spend_usd_millions",
      spend_per_title_M:    "$spend_per_title_M_usd"
  }}
])
```

---

### Dotaz 8
**Zadání:** Pro každý titul v `streaming_shifts` dostupný na Netflixu nebo Amazon Prime, připoj finanční data příslušné platformy. Seřaď podle popularity.

**Obecné chování:** `$lookup` s `let` + `pipeline` + `$expr` umožňuje podmíněné propojení bez přímého klíče – přiřadí data platformy na základě binárních příznaků `on_netflix`/`on_prime`. `$match` filtruje jen záznamy s nalezenou platformou. Kombinace `$lookup(let+pipeline+$expr)` → `$match` → `$project` → `$sort`.

**Konkrétní práce s daty:** `streaming_shifts` má příznaky `on_netflix: 1` a `on_prime: 1`. `$expr` v pipeline lookup zkombinuje logiku `AND/OR` pro mapování titulu na platformu. Výsledek propojuje aktuální streaming data s finančními ukazateli platforem.

```javascript
db.streaming_shifts.aggregate([
  { $lookup: {
      from: "platform_financials",
      let: { onNetflix: "$on_netflix", onPrime: "$on_prime" },
      pipeline: [
        { $match: {
            $expr: {
              $or: [
                { $and: [{ $eq: ["$platform", "Netflix"]            }, { $eq: ["$$onNetflix", 1] }] },
                { $and: [{ $eq: ["$platform", "Amazon Prime Video"] }, { $eq: ["$$onPrime",   1] }] }
              ]
            }
        }},
        { $project: {
            _id: 0,
            platform: 1,
            subscribers_millions: 1,
            quarterly_revenue_usd_millions: 1,
            annual_content_spend_usd_millions: 1
        }}
      ],
      as: "platform_data"
  }},
  { $match: { "platform_data.0": { $exists: true } } },
  { $project: {
      _id: 0,
      title: 1,
      popularity: 1,
      vote_average: 1,
      streaming_platforms: 1,
      platform_data: 1
  }},
  { $sort: { popularity: -1 } },
  { $limit: 15 }
])
```

---

### Dotaz 9
**Zadání:** Pro každou platformu v `platform_financials` (Netflix, Amazon Prime) spočítej počet titulů v `streaming_shifts` z roku 2026, průměrnou popularitu a průměrné hodnocení.

**Obecné chování:** Reverzní $lookup – výchozí kolekcí jsou `platform_financials` a $lookup přitáhne záznamy z `streaming_shifts`. Pipeline uvnitř $lookup obsahuje `$match` s `$expr` a `$group` pro přímou agregaci v poddotazu. Kombinace `$lookup(pipeline s $group)` → `$project` → `$sort`.

**Konkrétní práce s daty:** Ukazuje kolik titulů z aktuálního katalogu 2026 (`streaming_shifts`) má na dané platformě zastoupení, v kontextu finančních dat té platformy. Amazon Prime má 3 800 mil. USD ve sportovních právech – jak se to odráží v katalogu?

```javascript
db.platform_financials.aggregate([
  { $lookup: {
      from: "streaming_shifts",
      let: { platforma: "$platform" },
      pipeline: [
        { $match: {
            $expr: {
              $or: [
                { $and: [{ $eq: ["$$platforma", "Netflix"]            }, { $eq: ["$on_netflix", 1] }] },
                { $and: [{ $eq: ["$$platforma", "Amazon Prime Video"] }, { $eq: ["$on_prime",   1] }] },
                { $and: [{ $eq: ["$$platforma", "Hulu"]               }, { $eq: ["$on_hulu",    1] }] }
              ]
            }
        }},
        { $group: {
            _id:            null,
            pocet_titulu:   { $sum: 1 },
            avg_popularity: { $avg: "$popularity" },
            avg_vote:       { $avg: "$vote_average" },
            max_popularity: { $max: "$popularity" }
        }}
      ],
      as: "tituly_2026"
  }},
  { $project: {
      _id: 0,
      platform: 1,
      subscribers_millions: 1,
      quarterly_revenue_usd_millions: 1,
      pocet_titulu_2026:  { $ifNull: [{ $arrayElemAt: ["$tituly_2026.pocet_titulu",   0] }, 0] },
      avg_vote_2026:      { $round: [{ $ifNull: [{ $arrayElemAt: ["$tituly_2026.avg_vote",       0] }, 0] }, 2] },
      avg_popularity_2026:{ $round: [{ $ifNull: [{ $arrayElemAt: ["$tituly_2026.avg_popularity", 0] }, 0] }, 2] }
  }},
  { $sort: { pocet_titulu_2026: -1 } }
])
```

---

### Dotaz 10
**Zadání:** Analyzuj top 5 zemí v Netflix katalogu. Pro každou zemi uveď podíl na celkovém katalogu a připoj finanční data Netflix platformy jako kontext.

**Obecné chování:** Nejdřív `$match` + `$group` + `$sort` + `$limit` identifikuje top 5 zemí. Pak `$lookup` připojí dokument Netflix bez lokálního klíče (cross-join na jeden dokument). `$unwind` + `$project` doplní finanční kontext. Ukazuje reálný use-case cross-collection enrichment.

**Konkrétní práce s daty:** Největší producenti obsahu pro Netflix (USA, Indie, UK) jsou doplněni o Netflix subscribers (325M) a content spend (20 mld. USD) – ukazuje globální dosah platformy skrze obsah.

```javascript
db.netflix_titles.aggregate([
  { $match: { country: { $ne: null, $ne: "" } } },
  { $group: {
      _id:         { $arrayElemAt: [{ $split: ["$country", ", "] }, 0] },
      pocet:       { $sum: 1 },
      avg_year:    { $avg: "$release_year" },
      typy:        { $push: "$type" }
  }},
  { $sort: { pocet: -1 } },
  { $limit: 5 },
  { $lookup: {
      from: "platform_financials",
      pipeline: [{ $match: { platform: "Netflix" } }],
      as: "netflix_data"
  }},
  { $unwind: "$netflix_data" },
  { $project: {
      _id: 0,
      zeme:               "$_id",
      pocet_titulu:       "$pocet",
      podil_katalogu_pct: { $round: [{ $multiply: [{ $divide: ["$pocet", 8807] }, 100] }, 2] },
      avg_rok:            { $round: ["$avg_year", 0] },
      netflix_sub_M:      "$netflix_data.subscribers_millions",
      content_spend_M:    "$netflix_data.annual_content_spend_usd_millions"
  }}
])
```

---

### Dotaz 11
**Zadání:** Pomocí `$facet` proveď vícerozměrnou analýzu streaming katalogu 2026 najednou: (a) statistiky per platforma, (b) top 10 nejpopulárnějších titulů, (c) distribuce hodnocení do skupin.

**Obecné chování:** `$facet` spustí více nezávislých agregačních pipeline nad stejnými vstupními daty v jednom průchodu. Každá větev provádí vlastní `$match`/`$group`/`$bucket`/`$sort`. Výsledkem je jeden dokument s více výsledkovými poli. Kombinace `$facet` → více pipeline větví.

**Konkrétní práce s daty:** Nad `streaming_shifts` (81 titulů) zároveň: seskupí statistiky per platforma, identifikuje top 10 dle popularity, a rozdělí tituly do skupin dle vote_average (špatné/průměrné/dobré/výborné).

```javascript
db.streaming_shifts.aggregate([
  { $facet: {
      "statistiky_platforem": [
        { $group: {
            _id: {
              netflix: { $toInt: "$on_netflix" },
              hulu:    { $toInt: "$on_hulu"    },
              prime:   { $toInt: "$on_prime"   }
            },
            count:          { $sum: 1 },
            avg_vote:       { $avg: "$vote_average" },
            avg_popularity: { $avg: "$popularity" }
        }},
        { $sort: { count: -1 } }
      ],
      "top10_popularity": [
        { $sort: { popularity: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, title: 1, popularity: 1, vote_average: 1, streaming_platforms: 1 } }
      ],
      "distribuce_hodnoceni": [
        { $bucket: {
            groupBy: "$vote_average",
            boundaries: [0, 4, 6, 7, 8, 10],
            default: "no_rating",
            output: {
              count:         { $sum: 1 },
              avg_popularity:{ $avg: "$popularity" },
              sample_titles: { $push: "$title" }
            }
        }},
        { $project: {
            count: 1,
            avg_popularity: { $round: ["$avg_popularity", 2] },
            sample_titles: { $slice: ["$sample_titles", 2] }
        }}
      ]
  }}
])
```

---

### Dotaz 12
**Zadání:** Zjisti, zda tituly dostupné na více platformách mají vyšší průměrnou popularitu než exkluzivní tituly. Připoj celkový počet předplatitelů ze všech platforem jako kontext trhu.

**Obecné chování:** `$addFields` vypočítá počet platforem součtem binárních příznaků. `$group` seskupí podle počtu platforem. `$lookup` bez podmínky (pipeline bez $match) přitáhne všechny `platform_financials` a `$group` uvnitř poddotazu je agreguje na jeden celkový součet. Kombinace `$addFields` → `$group` → `$lookup(pipeline s $group)` → `$unwind` → `$project` → `$sort`.

**Konkrétní práce s daty:** Ukazuje zda multi-platform dostupnost koreluje s popularitou. Celkový součet subscribers ze `platform_financials` (přes 700M) dává kontextový rámec pro interpretaci.

```javascript
db.streaming_shifts.aggregate([
  { $addFields: {
      pocet_platforem: {
        $add: [
          { $ifNull: [{ $toInt: "$on_netflix" }, 0] },
          { $ifNull: [{ $toInt: "$on_hulu"    }, 0] },
          { $ifNull: [{ $toInt: "$on_prime"   }, 0] }
        ]
      }
  }},
  { $group: {
      _id:            "$pocet_platforem",
      count:          { $sum: 1 },
      avg_popularity: { $avg: "$popularity" },
      avg_vote:       { $avg: "$vote_average" },
      tituly:         { $push: "$title" }
  }},
  { $lookup: {
      from: "platform_financials",
      pipeline: [
        { $group: {
            _id: null,
            total_subscribers_M: { $sum: "$subscribers_millions" },
            pocet_platforem_db:  { $sum: 1 }
        }}
      ],
      as: "market_context"
  }},
  { $unwind: "$market_context" },
  { $project: {
      _id: 0,
      pocet_platforem:       "$_id",
      count:                 1,
      avg_popularity:        { $round: ["$avg_popularity", 2] },
      avg_vote:              { $round: ["$avg_vote", 2] },
      sample_tituly:         { $slice: ["$tituly", 3] },
      total_market_sub_M:    "$market_context.total_subscribers_M"
  }},
  { $sort: { pocet_platforem: 1 } }
])
```

---

## KATEGORIE 3 – Transformace a obohacení dat

### Dotaz 13
**Zadání:** Transformuj pole `duration` filmů na číselnou hodnotu minut a kategorizuj filmy do skupin (krátký/střední/dlouhý/extra dlouhý). Pro každou skupinu uveď počet, průměrnou délku a 3 příklady.

**Obecné chování:** `$match` + `$addFields` s `$toInt` + `$split` parsuje text na číslo. Druhý `$addFields` s `$switch` kategorizuje podle hodnoty. `$group` seskupí kategorii s `$push` pro příklady. `$project` ořízne příklady pomocí `$slice`. Kombinace `$match` → `$addFields` → `$addFields` → `$group` → `$project` → `$sort`.

**Konkrétní práce s daty:** `duration = "90 min"` → `$split(" ")` → `["90","min"]` → `$toInt($arrayElemAt(...,0))` → `90`. `$switch` pak zařadí do kategorie. Výsledek ukazuje že Netflix preferuje filmy délky 90–119 minut.

```javascript
db.netflix_titles.aggregate([
  { $match: { type: "Movie", duration: { $regex: "min$" } } },
  { $addFields: {
      duration_min: {
        $toInt: { $arrayElemAt: [{ $split: ["$duration", " "] }, 0] }
      }
  }},
  { $addFields: {
      kategorie: {
        $switch: {
          branches: [
            { case: { $lt: ["$duration_min",  60] }, then: "kratky (<60 min)"          },
            { case: { $lt: ["$duration_min", 100] }, then: "stredni (60-99 min)"       },
            { case: { $lt: ["$duration_min", 140] }, then: "dlouhy (100-139 min)"      }
          ],
          default: "extra dlouhy (140+ min)"
        }
      }
  }},
  { $group: {
      _id:          "$kategorie",
      pocet:        { $sum: 1 },
      avg_min:      { $avg: "$duration_min" },
      min_delka:    { $min: "$duration_min" },
      max_delka:    { $max: "$duration_min" },
      priklady:     { $push: "$title" }
  }},
  { $project: {
      _id: 0,
      kategorie:  "$_id",
      pocet:      1,
      avg_min:    { $round: ["$avg_min", 1] },
      min_delka:  1,
      max_delka:  1,
      priklady:   { $slice: ["$priklady", 3] }
  }},
  { $sort: { avg_min: 1 } }
])
```

---

### Dotaz 14
**Zadání:** Vypočítej kolik let bylo dílo staré, když bylo přidáno na Netflix (stáří při přidání = rok přidání − rok vydání). Porovnej průměrné stáří pro filmy a seriály.

**Obecné chování:** Dva `$addFields` v sekvenci – první extrahuje rok přidání z textového pole, druhý vypočítá diferenci. `$match` odstraní záporné nebo nereálné hodnoty. `$group` agreguje statistiky per typ. Kombinace `$match` → `$addFields` → `$addFields` → `$match` → `$group` → `$project`.

**Konkrétní práce s daty:** Ukazuje strategii Netflixu – přidávají převážně relativně čerstvý obsah nebo starší katalogy? Průměrné stáří 5–7 let by naznačovalo licenční katalogy, 0–2 roky by indikovaly vlastní produkci.

```javascript
db.netflix_titles.aggregate([
  { $match: { date_added: { $ne: null, $ne: "" }, release_year: { $gt: 1900 } } },
  { $addFields: {
      rok_pridani: {
        $toInt: { $arrayElemAt: [{ $split: ["$date_added", ", "] }, 1] }
      }
  }},
  { $addFields: {
      stari_pri_pridani: { $subtract: ["$rok_pridani", "$release_year"] }
  }},
  { $match: { stari_pri_pridani: { $gte: 0, $lte: 80 } } },
  { $group: {
      _id:         "$type",
      avg_stari:   { $avg: "$stari_pri_pridani" },
      median_stari:{ $percentile: { input: "$stari_pri_pridani", p: [0.5], method: "approximate" } },
      min_stari:   { $min: "$stari_pri_pridani" },
      max_stari:   { $max: "$stari_pri_pridani" },
      pocet:       { $sum: 1 }
  }},
  { $project: {
      _id: 0,
      typ:              "$_id",
      avg_stari_let:    { $round: ["$avg_stari", 1] },
      median_stari_let: { $round: [{ $arrayElemAt: ["$median_stari", 0] }, 1] },
      min_stari_let:    "$min_stari",
      max_stari_let:    "$max_stari",
      pocet:            1
  }}
])
```

---

### Dotaz 15
**Zadání:** Rozlož pole `cast` na jednotlivé herce pomocí `$split` a `$unwind`. Zjisti top 15 herců s největším počtem titulů v Netflix katalogu.

**Obecné chování:** `$match` odfiltruje záznamy bez obsazení. `$project` s `$split` rozloží herci do pole. `$unwind` vytvoří jeden dokument per herec. `$group` seskupí a počítá výskyty. `$sort` + `$limit` ořízne top 15. Kombinace `$match` → `$project` → `$unwind` → `$group` → `$sort` → `$limit` → `$project`.

**Konkrétní práce s daty:** `cast = "Vanessa Hudgens, Kimiko Glenn, James Marsden"` → `$split(", ")` → pole 3 herců → `$unwind` → 3 dokumenty. Analýza odhalí nejčastěji zastoupené herce v katalogu Netflix – pravděpodobně bollywoodské hvězdy nebo stand-up komici.

```javascript
db.netflix_titles.aggregate([
  { $match: { cast: { $ne: null, $ne: "" } } },
  { $project: {
      herci: { $split: ["$cast", ", "] },
      type: 1,
      country: 1
  }},
  { $unwind: "$herci" },
  { $group: {
      _id:           "$herci",
      pocet_titulu:  { $sum: 1 },
      typy:          { $addToSet: "$type" },
      zeme:          { $addToSet: "$country" }
  }},
  { $sort: { pocet_titulu: -1 } },
  { $limit: 15 },
  { $project: {
      _id: 0,
      herec:          "$_id",
      pocet_titulu:   1,
      filmy_i_serie:  { $setIntersection: ["$typy", ["Movie", "TV Show"]] },
      pocet_zemi:     { $size: "$zeme" }
  }}
])
```

---

### Dotaz 16
**Zadání:** Obohať záznamy `platform_financials` o vypočítaná odvozená pole: zisková marže, příjem na předplatitele, a predikce růstu příjmů. Výstup seřaď podle marže.

**Obecné chování:** `$match` odfiltruje záznamy s nulovými hodnotami (dělení nulou). `$set` (alias pro `$addFields`) přidá více vypočítaných polí v jednom kroku. `$project` s `$cond` ošetří null hodnoty. `$sort` seřadí výsledky. Kombinace `$match` → `$set` → `$project` → `$sort`.

**Konkrétní práce s daty:** Netflix má `quarterly_revenue = 12050M` a `quarterly_profit = 2410M` → marže ~20%. Roku 2026 se predikuje `51200M` ročních příjmů. Výsledek ukazuje finanční zdraví platforem.

```javascript
db.platform_financials.aggregate([
  { $match: {
      quarterly_revenue_usd_millions: { $gt: 0 },
      quarterly_profit_usd_millions:  { $gt: 0 }
  }},
  { $set: {
      profit_margin_pct: {
        $round: [{
          $multiply: [
            { $divide: ["$quarterly_profit_usd_millions", "$quarterly_revenue_usd_millions"] },
            100
          ]
        }, 2]
      },
      revenue_per_subscriber_usd: {
        $cond: {
          if:   { $gt: ["$subscribers_millions", 0] },
          then: { $round: [{ $divide: ["$quarterly_revenue_usd_millions", "$subscribers_millions"] }, 2] },
          else: null
        }
      },
      predikce_rustu_pct: {
        $cond: {
          if: { $and: [
            { $gt: ["$projected_2026_revenue_usd_millions", 0] },
            { $gt: ["$quarterly_revenue_usd_millions", 0] }
          ]},
          then: { $round: [{
            $multiply: [{
              $subtract: [
                { $divide: ["$projected_2026_revenue_usd_millions", { $multiply: ["$quarterly_revenue_usd_millions", 4] }] },
                1
              ]
            }, 100]
          }, 1]},
          else: null
        }
      }
  }},
  { $project: {
      _id: 0,
      platform: 1,
      subscribers_millions: 1,
      quarterly_revenue_usd_millions: 1,
      quarterly_profit_usd_millions: 1,
      profit_margin_pct: 1,
      revenue_per_subscriber_usd: 1,
      predikce_rustu_pct: 1
  }},
  { $sort: { profit_margin_pct: -1 } }
])
```

---

### Dotaz 17
**Zadání:** Pomocí `$unset` odstraň interní pole a pomocí `$replaceRoot` s `$mergeObjects` sluč data z `streaming_shifts` s relevantními finančními daty do jednoho plochého dokumentu.

**Obecné chování:** `$lookup` přitáhne financials. `$unwind` rozbalí. `$replaceRoot` s `$mergeObjects` sloučí původní dokument s vybranými poli z financials do nové root struktury. `$unset` odstraní nepotřebná pole. Kombinace `$match` → `$lookup` → `$unwind` → `$replaceRoot($mergeObjects)` → `$unset` → `$sort`.

**Konkrétní práce s daty:** Tituly na Netflixu v `streaming_shifts` jsou sloučeny s daty o 325M předplatitelích a 20 mld. USD content spend. Výsledný plochý dokument lépe reprezentuje kontext pro analytické nástroje.

```javascript
db.streaming_shifts.aggregate([
  { $match: { on_netflix: 1 } },
  { $lookup: {
      from: "platform_financials",
      pipeline: [{ $match: { platform: "Netflix" } }],
      as: "netflix_finance"
  }},
  { $unwind: "$netflix_finance" },
  { $replaceRoot: {
      newRoot: {
        $mergeObjects: [
          "$$ROOT",
          {
            netflix_sub_M:    "$netflix_finance.subscribers_millions",
            netflix_revenue_Q:"$netflix_finance.quarterly_revenue_usd_millions",
            content_spend_M:  "$netflix_finance.annual_content_spend_usd_millions"
          }
        ]
      }
  }},
  { $unset: ["netflix_finance", "_id"] },
  { $project: {
      title: 1,
      popularity: 1,
      vote_average: 1,
      vote_count: 1,
      release_date: 1,
      netflix_sub_M: 1,
      netflix_revenue_Q: 1,
      content_spend_M: 1
  }},
  { $sort: { popularity: -1 } }
])
```

---

### Dotaz 18
**Zadání:** Transformuj `streaming_shifts` – přidej normalizované skóre popularity (0–100) a kombinované skóre kvality (váhovaný průměr vote_average a popularity). Seřaď podle kombinovaného skóre.

**Obecné chování:** Nejdřív `$group` na null zjistí max hodnoty pro normalizaci. `$lookup` na stejnou kolekci (self-lookup) přitáhne všechna data. `$unwind` + `$addFields` vypočítá normalizovaná skóre pomocí `$divide`. Kombinace `$group` → `$lookup(self)` → `$unwind` → `$addFields` → `$project` → `$sort`.

**Konkrétní práce s daty:** Popularity se pohybuje od ~20 do ~172. Normalizace na 0–1 umožňuje kombinovat s `vote_average` (0–10 → normalizovat na 0–1). Výsledné kombinované skóre (60% vote + 40% popularity) lépe zachytí celkovou kvalitu titulu.

```javascript
db.streaming_shifts.aggregate([
  { $group: {
      _id:            null,
      max_popularity: { $max: "$popularity" },
      max_vote:       { $max: "$vote_average" }
  }},
  { $lookup: {
      from: "streaming_shifts",
      pipeline: [],
      as: "vsechny_tituly"
  }},
  { $unwind: "$vsechny_tituly" },
  { $addFields: {
      norm_popularity: {
        $round: [{ $multiply: [{ $divide: ["$vsechny_tituly.popularity", "$max_popularity"] }, 100] }, 2]
      },
      norm_vote: {
        $round: [{ $multiply: [{ $divide: ["$vsechny_tituly.vote_average", "$max_vote"]    }, 100] }, 2]
      }
  }},
  { $addFields: {
      combined_score: {
        $round: [{
          $add: [
            { $multiply: ["$norm_vote",       0.6] },
            { $multiply: ["$norm_popularity", 0.4] }
          ]
        }, 2]
      }
  }},
  { $project: {
      _id: 0,
      title:             "$vsechny_tituly.title",
      streaming_platforms:"$vsechny_tituly.streaming_platforms",
      popularity:        "$vsechny_tituly.popularity",
      vote_average:      "$vsechny_tituly.vote_average",
      norm_popularity:   1,
      norm_vote:         1,
      combined_score:    1
  }},
  { $sort: { combined_score: -1 } },
  { $limit: 15 }
])
```

---

## KATEGORIE 4 – Indexy a optimalizace

### Dotaz 19
**Zadání:** Porovnej plán provádění dotazu `{ country: "United States", type: "Movie" }` bez indexu (COLLSCAN) a s compound indexem `idx_country_type_year`. Ukaž rozdíl v počtu prohledaných dokumentů.

**Obecné chování:** `.explain("executionStats")` vrátí plán provádění dotazu včetně `totalDocsExamined`, `totalKeysExamined`, `executionTimeMillis` a `stage` (COLLSCAN vs IXSCAN). `.hint({ $natural: 1 })` vynutí sekvenční prohledávání, `.hint("idx_country_type_year")` vynutí použití konkrétního indexu.

**Konkrétní práce s daty:** Bez indexu se prohledají všechny ~8 807 dokumentů. S indexem `idx_country_type_year` se prohledá jen klíčová část indexu – o řády méně. Výsledek demonstruje dopad indexace na výkon dotazů v shardovaném clusteru.

```javascript
// Bez indexu – COLLSCAN (všechny dokumenty)
db.netflix_titles.find(
  { country: "United States", type: "Movie" },
  { title: 1, country: 1, type: 1, _id: 0 }
).hint({ $natural: 1 }).explain("executionStats")

// S compound indexem – IXSCAN
db.netflix_titles.find(
  { country: "United States", type: "Movie" },
  { title: 1, country: 1, type: 1, _id: 0 }
).hint("idx_country_type_year").explain("executionStats")
```

---

### Dotaz 20
**Zadání:** Zobraz všechny existující indexy na všech třech kolekcích včetně shard key indexů. Ověř přítomnost hashed indexů na shard klíčích.

**Obecné chování:** `getIndexes()` vrátí pole objektů popisujících každý index – `name`, `key` (specifikace klíče), `unique`, `sparse`, `background`. Pro shardované kolekce MongoDB automaticky vytváří hashed index na shard klíči. Příkaz je klíčový pro audit indexové struktury.

**Konkrétní práce s daty:** Ověří přítomnost indexů jako `idx_type`, `idx_country`, `idx_country_type_year` (compound) a hashed indexu `{ show_id: "hashed" }` vytvořeného pro sharding. Ukazuje celkovou indexovou strategii pro kolekci s 8 807 dokumenty.

```javascript
// Indexy na netflix_titles
print("=== netflix_titles ===");
db.netflix_titles.getIndexes().forEach(idx =>
  print(idx.name, "->", JSON.stringify(idx.key))
);

// Indexy na platform_financials
print("=== platform_financials ===");
db.platform_financials.getIndexes().forEach(idx =>
  print(idx.name, "->", JSON.stringify(idx.key))
);

// Indexy na streaming_shifts
print("=== streaming_shifts ===");
db.streaming_shifts.getIndexes().forEach(idx =>
  print(idx.name, "->", JSON.stringify(idx.key))
);
```

---

### Dotaz 21
**Zadání:** Pomocí `$indexStats` zjisti statistiky využití indexů na `netflix_titles`. Identifikuj nepoužívané indexy.

**Obecné chování:** `$indexStats` je speciální agregační stage, která vrací dokument pro každý index kolekce s metadaty: `name`, `key`, `host`, `accesses.ops` (počet použití od posledního restartu), `accesses.since` (časová razítka). Umožňuje identifikovat nepoužívané indexy, které zbytečně zpomalují zápisy.

**Konkrétní práce s daty:** Na kolekci s 8 807 dokumenty lze vidět, které indexy byly využity dotazy v rámci tohoto projektu. Indexy s `accesses.ops = 0` jsou kandidáti na odstranění pokud nejsou potřeba pro plánované dotazy.

```javascript
db.netflix_titles.aggregate([
  { $indexStats: {} },
  { $project: {
      _id: 0,
      nazev_indexu:    "$name",
      klic_indexu:     "$key",
      pocet_pouziti:   "$accesses.ops",
      pouzivan_od:     "$accesses.since",
      host:            "$host"
  }},
  { $sort: { pocet_pouziti: -1 } }
])
```

---

### Dotaz 22
**Zadání:** Proveď dotaz na TV seriály od roku 2018 s využitím compound indexu `idx_type_year` a ověř pomocí `explain()` že je index skutečně použit (IXSCAN stage).

**Obecné chování:** `.hint("idx_type_year")` vynutí použití compound indexu `{ type: 1, release_year: -1 }`. `explain("executionStats")` ověří použití indexu (stage = IXSCAN), ukáže `totalKeysExamined` vs `totalDocsExamined` a celkový čas provádění. Index prefix rule – compound index lze použít i na prefix klíčů.

**Konkrétní práce s daty:** Index `idx_type_year` byl vytvořen pro rychlé filtrování podle typu a roku. TV seriálů od 2018 je v kolekci ~1 000 – bez indexu by se procházel celý dataset, s indexem jen relevantní část.

```javascript
// Dotaz s vynutím compound indexu
db.netflix_titles.find(
  { type: "TV Show", release_year: { $gte: 2018 } },
  { title: 1, type: 1, release_year: 1, country: 1, _id: 0 }
).hint("idx_type_year").sort({ release_year: -1 }).explain("executionStats")
```

---

### Dotaz 23
**Zadání:** Proveď audit kvality dat v `netflix_titles` – zjisti počet chybějících hodnot pro každé pole a vypočítej procento vyplněnosti.

**Obecné chování:** `$group` na `null` počítá výskyt prázdných/null hodnot pro každé sledované pole pomocí `$sum` s `$cond`. `$project` vypočítá procento vyplněnosti jako `(total - missing) / total * 100`. Výsledek dá přehled o datové kvalitě – důležité pro interpretaci výsledků dotazů.

**Konkrétní práce s daty:** Pole `director` a `cast` mají hodně null hodnot (dokumentární filmy, stand-up). `rating` má nevalidní hodnoty (minuty místo hodnocení – datový problém). Výsledek přesně ukáže problémy v datech.

```javascript
db.netflix_titles.aggregate([
  { $group: {
      _id: null,
      total:          { $sum: 1 },
      bez_director:   { $sum: { $cond: [{ $or: [{ $eq: ["$director", null] }, { $eq: ["$director", ""] }] }, 1, 0] } },
      bez_cast:       { $sum: { $cond: [{ $or: [{ $eq: ["$cast",     null] }, { $eq: ["$cast",     ""] }] }, 1, 0] } },
      bez_country:    { $sum: { $cond: [{ $or: [{ $eq: ["$country",  null] }, { $eq: ["$country",  ""] }] }, 1, 0] } },
      bez_date_added: { $sum: { $cond: [{ $or: [{ $eq: ["$date_added",null]}, { $eq: ["$date_added",""] }] }, 1, 0] } },
      bez_rating:     { $sum: { $cond: [{ $in: ["$rating", [null, ""]] }, 1, 0] } },
      bez_duration:   { $sum: { $cond: [{ $or: [{ $eq: ["$duration", null] }, { $eq: ["$duration", ""] }] }, 1, 0] } }
  }},
  { $project: {
      _id: 0,
      total: 1,
      director_vyplnenost_pct:   { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total","$bez_director"]   },"$total"] }, 100] }, 1] },
      cast_vyplnenost_pct:       { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total","$bez_cast"]       },"$total"] }, 100] }, 1] },
      country_vyplnenost_pct:    { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total","$bez_country"]    },"$total"] }, 100] }, 1] },
      date_added_vyplnenost_pct: { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total","$bez_date_added"] },"$total"] }, 100] }, 1] },
      rating_vyplnenost_pct:     { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total","$bez_rating"]     },"$total"] }, 100] }, 1] },
      duration_vyplnenost_pct:   { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total","$bez_duration"]   },"$total"] }, 100] }, 1] }
  }}
])
```

---

### Dotaz 24
**Zadání:** Zobraz aktivní validační schéma (JSON Schema) kolekce `netflix_titles` a ověř, zda existují dokumenty s neplatnými hodnotami pole `type` (mimo "Movie" / "TV Show").

**Obecné chování:** `db.getCollectionInfos()` vrátí metadata kolekce včetně `options.validator`. `$match` s `$nin` vyhledá dokumenty nesplňující validační pravidlo pro pole `type`. `$count` spočítá výskyt narušení. Kombinace příkazů ukazuje jak MongoDB validace funguje v praxi.

**Konkrétní práce s daty:** Validační schéma bylo definováno s `validationAction: "warn"` – neplatné dokumenty jsou přijaty ale zalogují varování. Dotaz ověří zda jsou v kolekci dokumenty s jiným než povolený `type` hodnotou.

```javascript
// Zobraz validační schéma kolekce
const info = db.getCollectionInfos({ name: "netflix_titles" });
printjson(info[0].options.validator);

// Najdi dokumenty porušující validaci type (mimo Movie/TV Show)
db.netflix_titles.aggregate([
  { $match: { type: { $nin: ["Movie", "TV Show"] } } },
  { $group: {
      _id:    "$type",
      count:  { $sum: 1 },
      sample: { $push: "$title" }
  }},
  { $project: {
      neplatny_typ: "$_id",
      count: 1,
      sample: { $slice: ["$sample", 3] }
  }}
])
```

---

## KATEGORIE 5 – Distribuce dat, cluster, replikace a chování při výpadku

### Dotaz 25
**Zadání:** Zobraz kompletní stav shardovaného clusteru – seznam shardů, aktivní mongos, stav balanceru, a distribuci chunků pro každou shardovanou kolekci.

**Obecné chování:** `sh.status()` je administrativní příkaz mongos routeru, který vrací kompletní přehled: verzi shardingu, seznam shardů s hostnames a stavem, aktivní mongos instance, stav autosplitu a balanceru, a pro každou databázi seznam shardovaných kolekcí s chunk distribucí a shard klíči.

**Konkrétní práce s daty:** Výstup ukazuje 3 shardy (shard1-3ReplSet), každý s 3 uzly. `netflix_titles` je shardována hashovým klíčem `show_id` – chunky by měly být rovnoměrně rozděleny (~2 885/2 953/2 969 dokumentů na shard).

```javascript
// Spustit na mongos
sh.status()
```

---

### Dotaz 26
**Zadání:** Zobraz detailní distribuci dat kolekce `netflix_titles` na shardech – počet dokumentů, velikost dat a počet chunků na každém shardu.

**Obecné chování:** `getShardDistribution()` je metoda na kolekci, která vrací statistiky distribuce dat: pro každý shard zobrazí `data` (velikost v B), `docs` (počet dokumentů), `chunks` (počet chunků) a procentuální podíl. Doplněna příkazem `db.netflix_titles.stats()` pro celkové statistiky kolekce.

**Konkrétní práce s daty:** Hashed sharding na `show_id` zajišťuje rovnoměrnou distribuci. Každý shard by měl mít ~33% dat. Výrazná nerovnováha by indikovala problém s výběrem shard klíče nebo potřebu re-shardingu.

```javascript
// Distribuce na shardech
use streaming_db
db.netflix_titles.getShardDistribution()

// Celkové statistiky kolekce
db.netflix_titles.stats()
```

---

### Dotaz 27
**Zadání:** Zkontroluj stav replikačních sad pro všechny 3 shardy a config server. Identifikuj PRIMARY a SECONDARY uzly a zkontroluj replikační lag.

**Obecné chování:** `rs.status()` vrátí stav každého člena repliky: `stateStr` (PRIMARY/SECONDARY/ARBITER), `health` (1 = OK), `optime` (pozice v operation logu), `optimeDurable` a `lastHeartbeat`. `optimeDate` rozdíl mezi PRIMARY a SECONDARY ukazuje replikační lag.

**Konkrétní práce s daty:** Všechny 3 shardy mají 1 PRIMARY + 2 SECONDARY uzly (RF=3). Config server (configReplSet) taktéž 1 PRIMARY + 2 SECONDARY. Nulový lag = synchronní replikace, cluster je v plném zdraví.

```javascript
// Na mongos není rs.status() - musíme se připojit přímo na uzly
// Stav shard1
db.adminCommand({ replSetGetStatus: 1 })
// nebo přímo na shard primárních uzlech:

// docker exec shard1-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval "rs.status().members.forEach(m => print(m.name, m.stateStr, 'lag:', m.optimeDate))"
// docker exec shard2-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
// docker exec shard3-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
// docker exec configsvr1 mongosh --port 27019 -u admin -p adminpassword --authenticationDatabase admin --eval "rs.status().members.forEach(m => print(m.name, m.stateStr))"
```

---

### Dotaz 28
**Zadání:** Zobraz statistiky databáze `streaming_db` a kolekce `netflix_titles` – celkovou velikost dat, počet dokumentů, průměrnou velikost dokumentu a využití indexů.

**Obecné chování:** `db.stats()` vrátí souhrnné statistiky celé databáze: `collections`, `objects` (celkový počet dokumentů), `dataSize`, `storageSize`, `indexes`, `indexSize`. `db.collection.stats()` pak detailní statistiky jedné kolekce včetně distribuce na shardech (`shards` pole).

**Konkrétní práce s daty:** `streaming_db` obsahuje 3 kolekce s celkem ~8 898 dokumenty. `netflix_titles.stats()` ukáže sharding info: `sharded: true`, pole `shards` s přesným počtem dokumentů a velikostí na každém ze 3 shardů.

```javascript
use streaming_db

// Statistiky celé databáze (velikosti v MB)
db.stats(1024 * 1024)

// Detailní statistiky shardované kolekce
db.netflix_titles.stats()

// Počty dokumentů ve všech kolekcích
["netflix_titles","platform_financials","streaming_shifts"].forEach(c => {
  print(c + ": " + db.getCollection(c).countDocuments() + " dokumentů")
})
```

---

### Dotaz 29
**Zadání:** Simuluj výpadek sekundárního uzlu `shard1-2` a ověř, že cluster zůstane funkční (dotazy stále fungují). Po obnovení uzlu zkontroluj re-synchronizaci.

**Obecné chování:** `docker compose stop shard1-2` zastaví kontejner. MongoDB shard1ReplSet pokračuje s 1 PRIMARY + 1 SECONDARY (stále má quorum 2 z 3). Po `docker compose start shard1-2` se uzel automaticky re-synchronizuje s PRIMARY přes oplog. `rs.status()` ukáže přechod STARTUP2 → SECONDARY.

**Konkrétní práce s daty:** Dotaz na `netflix_titles` přes mongos funguje i při výpadku jednoho SECONDARY uzlu – data jsou stále dostupná z PRIMARY. Výpadek PRIMARY by způsobil krátkodobý výpadek (volba nového PRIMARY trvá ~10 s).

```javascript
// 1. Zastav sekundární uzel (spustit v terminálu na hostiteli)
// docker compose stop shard1-2

// 2. Ověř stav repliky – shard1-2 bude (not reachable/healthy)
// docker exec shard1-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval "rs.status()"

// 3. Ověř že dotazy stále fungují přes mongos
db.getSiblingDB("streaming_db").netflix_titles.findOne({ type: "Movie" })

// 4. Obnov uzel
// docker compose start shard1-2

// 5. Sleduj re-synchronizaci (STARTUP2 -> SECONDARY)
// docker exec shard1-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval "rs.status().members.forEach(m => print(m.name, m.stateStr, m.infoMessage))"
```

---

### Dotaz 30
**Zadání:** Pomocí `listShards`, `getShardMap` a `adminCommand` ověř registraci všech 3 shardů v clusteru, zkontroluj keyfile autentizaci a zobraz seznam uživatelů s jejich rolemi.

**Obecné chování:** `db.adminCommand({ listShards: 1 })` vrátí registrované shardy s hostname, stavem a topologyTime. `db.adminCommand({ getShardMap: 1 })` ukáže mapování hostnames na shard ID. `db.getUsers()` + `db.getSiblingDB("streaming_db").getUsers()` zobrazí uživatele a jejich role – ověří bezpečnostní konfiguraci.

**Konkrétní práce s daty:** Ověří že všechny 3 shardy (shard1/2/3ReplSet) jsou registrovány. Uživatelé: `admin` (root v admin DB) a `streaming_user` (readWrite + dbAdmin v streaming_db). Keyfile v `/keyfile/mongo-keyfile` s oprávněním 400 zajišťuje interní autentizaci clusteru.

```javascript
// Seznam registrovaných shardů
printjson(db.adminCommand({ listShards: 1 }))

// Mapa shardů
printjson(db.adminCommand({ getShardMap: 1 }))

// Uživatelé v admin databázi
print("=== Admin uživatelé ===")
db.getSiblingDB("admin").getUsers().forEach(u =>
  print(u.user, "->", JSON.stringify(u.roles))
)

// Uživatelé v streaming_db
print("=== streaming_db uživatelé ===")
db.getSiblingDB("streaming_db").getUsers().forEach(u =>
  print(u.user, "->", JSON.stringify(u.roles))
)

// Ověření keyfile (spustit uvnitř configsvr1 kontejneru)
// docker exec configsvr1 bash -c "ls -la /keyfile/mongo-keyfile && stat /keyfile/mongo-keyfile"
```
