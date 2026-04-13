Vážené studentky, vážení studenti,

na základě vašich četných dotazů jsem doupřesnila zadání v oblasti 7. Dotazy.

Hezký den

Monika Borkovcová

Téma 1,2 a 3

7. DOTAZY
Uveďte a popište 30 skutečně NETRIVIÁLNÍCH, navazujících a vzájemně odlišných dotazů včetně řešení. Všechny tři datasaty musí popisovat jedno společné téma a dotazy musí z těchto dat vycházet tak, aby bylo zřejmé, že nad daty byla provedena reálná analytická, transformační nebo konfigurační práce, nikoli pouze formální ukázka syntaxe.
Každý dotaz musí být navržen tak, aby ukazoval reálnou schopnost zvolené databáze řešit analytický, provozní nebo architektonický problém. Není cílem předvést syntaxi jednotlivých příkazů, ale demonstrovat pochopení datového modelu, indexace, distribuce dat, vazeb mezi datasety a pokročilých možností dotazování. Jednoduché dotazy, prosté CRUD operace a formální obměny stejného dotazu nebudou považovány za splnění požadavku.
NETRIVIÁLNÍ dotaz je například dotaz využívající v MongoDB aggregate a zároveň unwind a zároveň group a zároveň sort nebo například aggregate a zároveň lookup a zároveň match a zároveň project nebo aggregate a zároveň unset a zároveň ... u Redisu je nutné použít LUA skripty, u Apache Cassandra vlastní funkce.
Za netriviální dotaz v MongoDB bude považován zejména takový dotaz, který využívá agregační pipeline a kombinuje více stupňů, mongoDB oficiálně uvádí agregační pipeline jako hlavní mechanismus pro vícestupňové zpracování dat a $lookup jako operaci pro spojování kolekcí.
Za netriviální dotaz v Redisu nebude považováno prosté GET, SET, HGETALL, LRANGE nebo obdobný elementární přístup ke struktuře. U Redis Stack je pro skutečné analytické nebo agregační dotazy určen FT.AGGREGATE, zatímco FT.SEARCH je vhodný spíše pro selekci a projekci. Využijte například FT.SEARCH s více podmínkami, filtrem a řazením nad indexovanými JSON dokumenty; FT.AGGREGATE s LOAD, APPLY, GROUPBY, REDUCE, SORTBY; agregaci s výpočtem odvozeného pole a následným seskupením; práci nad více typy struktur, například JSON + HASH + indexy RediSearch; měření dopadu změny indexu nebo rozložení slotů v clusteru na dotaz.
Za netriviální dotaz v Apache Cassandře nebude považováno prosté čtení podle partition key bez dalšího vysvětlení. Netrivialita by měla být spojena s vědomou prací s partition key, clustering columns, tokeny, konzistenční úrovní, materialized views, indexy nebo s porovnáním dotazů nad různými modely tabulek. Využijte např. srovnání dvou modelů tabulek pro tentýž use case; dotaz, který ukáže význam partition key a clustering columns; práce s token(partition_key) a vysvětlení rozložení dat; měření dopadu různých consistency level; dotaz doplněný kontrolou přes nodetool tablestats, nodetool status, DESCRIBE KEYSPACE, případně statistiky partition.
Za netriviální dotaz nebude považován jednoduchý příkaz typu prosté find, select, GET, FT.SEARCH, jednoduchý match, jednoduché filtrování jedním polem, prostý COUNT, ani pouhá variace téhož dotazu s jinou konstantou. 
Za netriviální dotaz bude považován pouze takový dotaz, který kombinuje více operací, pracuje s vazbami mezi daty, s agregací, se strukturou dokumentů/záznamů, s indexy, s clusterem nebo s distribucí dat a přináší výsledek, který má interpretační hodnotu.
Příkazy řádně okomentujete tzn., že každý příkaz zkopírujete z konzole a u každého příkazu uvedete, jaké je jeho obecné chování a jak konkrétně pracuje s daty ve vašem případě a řeší konkrétní úlohu.
Předpoklad je takový, že budete mít příkazy z různých kategorií např.:
"agregační funkce",
"konfigurace",
"nested (embedded) dokumenty",
"indexy"
"propojování dat a vazeb mezi datasety"
"agregační a analytické dotazy"
"transformace a obohacení dat"
"strukturovaná nebo vnořená data"
"indexy a optimalizace"
"distribuce dat, cluster, replikace a chování při výpadku"
"validace a kvalita dat a kontrola konzistence"
"pokročilé fulltextové nebo podobnostní vyhledávání"
takových kategorií je požadováno alespoň 5, kdy u každé "kategorie" uvedete alespoň 6 příkazů. 
Každý dotaz musí vracet nějaká data.
Každý dotaz musí vracet různá data. Nelze, aby stejná data vracelo více dotazů.
Dle zvoleného typu databáze využijte i možnost práce s clusterem, replikačním faktorem a shardingem.
Pokuste se například (mimo jiné) nasimulovat výpadek některého z uzlů a popište možnosti řešení.
Upozornění: V případě MongoDB je nutné mít validační schéma.