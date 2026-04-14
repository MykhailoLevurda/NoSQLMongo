// =============================================================
// 30 MongoDB Queries – Streaming DB
// Spusteni: mongosh --host localhost --port 27017 \
//   -u admin -p adminpassword --authenticationDatabase admin \
//   streaming_db queries/queries.js
// =============================================================

use("streaming_db");

// =============================================================
// KATEGORIE 1 – Agregacni a analyticke dotazy
// =============================================================

print("\n===== Q1: Obsah pridany na Netflix per rok (od 2015) =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q2: Top 10 zemi s nejvice Netflix tituly =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q3: Distribuce vekoveho hodnoceni (Movie vs TV Show) =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q4: Bucket distribuce delky filmu (minuty) =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q5: Top 10 nejplodnejsich reziséru filmu =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q6: Top 3 zanry per dekada (1940s-2020s) =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// =============================================================
// KATEGORIE 2 – Propojovani dat a vazby mezi datasety
// =============================================================

print("\n===== Q7: Netflix katalog + financni data (spend per titul) =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q8: streaming_shifts + financials ($lookup s $let/$expr), top 15 dle popularity =====");
printjson(db.streaming_shifts.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q9: Per platforma – pocet titulu 2026, avg popularita, avg hodnoceni =====");
printjson(db.platform_financials.aggregate([
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
      pocet_titulu_2026:   { $ifNull: [{ $arrayElemAt: ["$tituly_2026.pocet_titulu",   0] }, 0] },
      avg_vote_2026:       { $round: [{ $ifNull: [{ $arrayElemAt: ["$tituly_2026.avg_vote",       0] }, 0] }, 2] },
      avg_popularity_2026: { $round: [{ $ifNull: [{ $arrayElemAt: ["$tituly_2026.avg_popularity", 0] }, 0] }, 2] }
  }},
  { $sort: { pocet_titulu_2026: -1 } }
]).toArray());

// -------------------------------------------------------------

print("\n===== Q10: Top 5 zemi Netflixu + financni kontext =====");
printjson(db.netflix_titles.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q11: $facet – statistiky platforem, top 10 popularity, distribuce hodnoceni =====");
printjson(db.streaming_shifts.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q12: Multi-platform vs exkluzivni tituly – korelace s popularitou =====");
printjson(db.streaming_shifts.aggregate([
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
      pocet_platforem:    "$_id",
      count:              1,
      avg_popularity:     { $round: ["$avg_popularity", 2] },
      avg_vote:           { $round: ["$avg_vote", 2] },
      sample_tituly:      { $slice: ["$tituly", 3] },
      total_market_sub_M: "$market_context.total_subscribers_M"
  }},
  { $sort: { pocet_platforem: 1 } }
]).toArray());

// =============================================================
// KATEGORIE 3 – Transformace a obohaceni dat
// =============================================================

print("\n===== Q13: Kategorizace filmu dle delky ($switch) =====");
printjson(db.netflix_titles.aggregate([
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
            { case: { $lt: ["$duration_min",  60] }, then: "kratky (<60 min)"     },
            { case: { $lt: ["$duration_min", 100] }, then: "stredni (60-99 min)"  },
            { case: { $lt: ["$duration_min", 140] }, then: "dlouhy (100-139 min)" }
          ],
          default: "extra dlouhy (140+ min)"
        }
      }
  }},
  { $group: {
      _id:       "$kategorie",
      pocet:     { $sum: 1 },
      avg_min:   { $avg: "$duration_min" },
      min_delka: { $min: "$duration_min" },
      max_delka: { $max: "$duration_min" },
      priklady:  { $push: "$title" }
  }},
  { $project: {
      _id: 0,
      kategorie: "$_id",
      pocet:     1,
      avg_min:   { $round: ["$avg_min", 1] },
      min_delka: 1,
      max_delka: 1,
      priklady:  { $slice: ["$priklady", 3] }
  }},
  { $sort: { avg_min: 1 } }
]).toArray());

// -------------------------------------------------------------

print("\n===== Q14: Stari titulu pri pridani na Netflix (Movie vs TV Show) =====");
printjson(db.netflix_titles.aggregate([
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
      _id:          "$type",
      avg_stari:    { $avg: "$stari_pri_pridani" },
      median_stari: { $percentile: { input: "$stari_pri_pridani", p: [0.5], method: "approximate" } },
      min_stari:    { $min: "$stari_pri_pridani" },
      max_stari:    { $max: "$stari_pri_pridani" },
      pocet:        { $sum: 1 }
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q15: Top 15 hercu dle poctu titulu ($split + $unwind) =====");
printjson(db.netflix_titles.aggregate([
  { $match: { cast: { $ne: null, $ne: "" } } },
  { $project: {
      herci:   { $split: ["$cast", ", "] },
      type:    1,
      country: 1
  }},
  { $unwind: "$herci" },
  { $group: {
      _id:          "$herci",
      pocet_titulu: { $sum: 1 },
      typy:         { $addToSet: "$type" },
      zeme:         { $addToSet: "$country" }
  }},
  { $sort: { pocet_titulu: -1 } },
  { $limit: 15 },
  { $project: {
      _id: 0,
      herec:         "$_id",
      pocet_titulu:  1,
      filmy_i_serie: { $setIntersection: ["$typy", ["Movie", "TV Show"]] },
      pocet_zemi:    { $size: "$zeme" }
  }}
]).toArray());

// -------------------------------------------------------------

print("\n===== Q16: Ziskovost platforem – marze, ARPU, predikce rustu ($set) =====");
printjson(db.platform_financials.aggregate([
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q17: Ploche dokumenty – $replaceRoot + $mergeObjects + $unset =====");
printjson(db.streaming_shifts.aggregate([
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
            netflix_sub_M:     "$netflix_finance.subscribers_millions",
            netflix_revenue_Q: "$netflix_finance.quarterly_revenue_usd_millions",
            content_spend_M:   "$netflix_finance.annual_content_spend_usd_millions"
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
]).toArray());

// -------------------------------------------------------------

print("\n===== Q18: Normalizovane skore popularity a kombinovane skore kvality =====");
printjson(db.streaming_shifts.aggregate([
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
        $round: [{ $multiply: [{ $divide: ["$vsechny_tituly.vote_average", "$max_vote"] }, 100] }, 2]
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
      title:              "$vsechny_tituly.title",
      streaming_platforms:"$vsechny_tituly.streaming_platforms",
      popularity:         "$vsechny_tituly.popularity",
      vote_average:       "$vsechny_tituly.vote_average",
      norm_popularity:    1,
      norm_vote:          1,
      combined_score:     1
  }},
  { $sort: { combined_score: -1 } },
  { $limit: 15 }
]).toArray());

// =============================================================
// KATEGORIE 4 – Indexy a optimalizace
// =============================================================

print("\n===== Q19: COLLSCAN vs IXSCAN – explain() pro country+type =====");
print("-- Bez indexu (COLLSCAN) --");
printjson(db.netflix_titles.find(
  { country: "United States", type: "Movie" },
  { title: 1, country: 1, type: 1, _id: 0 }
).hint({ $natural: 1 }).explain("executionStats"));

print("-- S compound indexem idx_country_type_year (IXSCAN) --");
printjson(db.netflix_titles.find(
  { country: "United States", type: "Movie" },
  { title: 1, country: 1, type: 1, _id: 0 }
).hint("idx_country_type_year").explain("executionStats"));

// -------------------------------------------------------------

print("\n===== Q20: Vsechny indexy na vsech 3 kolekcich =====");
print("=== netflix_titles ===");
db.netflix_titles.getIndexes().forEach(idx =>
  print(idx.name, "->", JSON.stringify(idx.key))
);
print("=== platform_financials ===");
db.platform_financials.getIndexes().forEach(idx =>
  print(idx.name, "->", JSON.stringify(idx.key))
);
print("=== streaming_shifts ===");
db.streaming_shifts.getIndexes().forEach(idx =>
  print(idx.name, "->", JSON.stringify(idx.key))
);

// -------------------------------------------------------------

print("\n===== Q21: $indexStats – statistiky vyuziti indexu =====");
printjson(db.netflix_titles.aggregate([
  { $indexStats: {} },
  { $project: {
      _id: 0,
      nazev_indexu:  "$name",
      klic_indexu:   "$key",
      pocet_pouziti: "$accesses.ops",
      pouzivan_od:   "$accesses.since",
      host:          "$host"
  }},
  { $sort: { pocet_pouziti: -1 } }
]).toArray());

// -------------------------------------------------------------

print("\n===== Q22: TV serialy od 2018 s idx_type_year + explain =====");
printjson(db.netflix_titles.find(
  { type: "TV Show", release_year: { $gte: 2018 } },
  { title: 1, type: 1, release_year: 1, country: 1, _id: 0 }
).hint("idx_type_year").sort({ release_year: -1 }).explain("executionStats"));

// -------------------------------------------------------------

print("\n===== Q23: Audit kvality dat – vyplnenost poli (%) =====");
printjson(db.netflix_titles.aggregate([
  { $group: {
      _id: null,
      total:          { $sum: 1 },
      bez_director:   { $sum: { $cond: [{ $or: [{ $eq: ["$director",   null] }, { $eq: ["$director",   ""] }] }, 1, 0] } },
      bez_cast:       { $sum: { $cond: [{ $or: [{ $eq: ["$cast",       null] }, { $eq: ["$cast",       ""] }] }, 1, 0] } },
      bez_country:    { $sum: { $cond: [{ $or: [{ $eq: ["$country",    null] }, { $eq: ["$country",    ""] }] }, 1, 0] } },
      bez_date_added: { $sum: { $cond: [{ $or: [{ $eq: ["$date_added", null] }, { $eq: ["$date_added", ""] }] }, 1, 0] } },
      bez_rating:     { $sum: { $cond: [{ $in:  ["$rating", [null, ""]] }, 1, 0] } },
      bez_duration:   { $sum: { $cond: [{ $or: [{ $eq: ["$duration",   null] }, { $eq: ["$duration",   ""] }] }, 1, 0] } }
  }},
  { $project: {
      _id: 0,
      total: 1,
      director_vyplnenost_pct:   { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total", "$bez_director"]   }, "$total"] }, 100] }, 1] },
      cast_vyplnenost_pct:       { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total", "$bez_cast"]       }, "$total"] }, 100] }, 1] },
      country_vyplnenost_pct:    { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total", "$bez_country"]    }, "$total"] }, 100] }, 1] },
      date_added_vyplnenost_pct: { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total", "$bez_date_added"] }, "$total"] }, 100] }, 1] },
      rating_vyplnenost_pct:     { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total", "$bez_rating"]     }, "$total"] }, 100] }, 1] },
      duration_vyplnenost_pct:   { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$total", "$bez_duration"]   }, "$total"] }, 100] }, 1] }
  }}
]).toArray());

// -------------------------------------------------------------

print("\n===== Q24: Validacni schema netflix_titles + dokumenty porušujici type =====");
const info = db.getCollectionInfos({ name: "netflix_titles" });
printjson(info[0].options.validator);

printjson(db.netflix_titles.aggregate([
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
]).toArray());

// =============================================================
// KATEGORIE 5 – Distribuce dat, cluster, replikace
// =============================================================

print("\n===== Q25: Stav celeho shardovaneho clusteru =====");
sh.status();

// -------------------------------------------------------------

print("\n===== Q26: Distribuce netflix_titles na shardech =====");
db.netflix_titles.getShardDistribution();
printjson(db.netflix_titles.stats());

// -------------------------------------------------------------

print("\n===== Q27: Stav replikacnich sad – PRIMARY/SECONDARY/lag =====");
print("-- Prikazy pro spusteni primoze v kontejnerech:");
print("docker exec shard1-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval \"rs.status().members.forEach(m => print(m.name, m.stateStr))\"");
print("docker exec shard2-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval \"rs.status().members.forEach(m => print(m.name, m.stateStr))\"");
print("docker exec shard3-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval \"rs.status().members.forEach(m => print(m.name, m.stateStr))\"");
print("docker exec configsvr1 mongosh --port 27019 -u admin -p adminpassword --authenticationDatabase admin --eval \"rs.status().members.forEach(m => print(m.name, m.stateStr))\"");
// Pokud dotaz bezis primo na uzlu shard (ne mongos):
// printjson(db.adminCommand({ replSetGetStatus: 1 }));

// -------------------------------------------------------------

print("\n===== Q28: Statistiky databaze a kolekce netflix_titles =====");
printjson(db.stats(1024 * 1024));
printjson(db.netflix_titles.stats());
["netflix_titles", "platform_financials", "streaming_shifts"].forEach(c => {
  print(c + ": " + db.getCollection(c).countDocuments() + " dokumentu");
});

// -------------------------------------------------------------

print("\n===== Q29: Simulace vypadku shard1-2 a overeni funkce clusteru =====");
print("-- Krok 1: Zastav sekundarni uzel (v terminalu na hostiteli):");
print("   docker compose -f solution/docker-compose.yml stop shard1-2");
print("-- Krok 2: Overeni dostupnosti pres mongos:");
printjson(db.getSiblingDB("streaming_db").netflix_titles.findOne({ type: "Movie" }));
print("-- Krok 3: Obnov uzel:");
print("   docker compose -f solution/docker-compose.yml start shard1-2");
print("-- Krok 4: Sleduj re-synchronizaci:");
print("   docker exec shard1-1 mongosh --port 27018 -u admin -p adminpassword --authenticationDatabase admin --eval \"rs.status().members.forEach(m => print(m.name, m.stateStr, m.infoMessage))\"");

// -------------------------------------------------------------

print("\n===== Q30: Audit clusteru – shardy, keyfile, uzivatele a role =====");
printjson(db.adminCommand({ listShards: 1 }));
printjson(db.adminCommand({ getShardMap: 1 }));

print("=== Admin uzivatele ===");
db.getSiblingDB("admin").getUsers().forEach(u =>
  print(u.user, "->", JSON.stringify(u.roles))
);

print("=== streaming_db uzivatele ===");
db.getSiblingDB("streaming_db").getUsers().forEach(u =>
  print(u.user, "->", JSON.stringify(u.roles))
);

print("-- Overeni keyfile (v terminalu na hostiteli):");
print("   docker exec configsvr1 bash -c \"ls -la /keyfile/mongo-keyfile && stat /keyfile/mongo-keyfile\"");

print("\n========== Vsech 30 dotazu dokonceno ==========");
