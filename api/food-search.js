// GET /api/food-search?q=white+rice[&limit=20]  -> search both databases
// GET /api/food-search?id=usda:2512381                -> full detail for one food
//
// Returns foods already normalized into the food_items shape, so the client
// can cache a picked result straight into Supabase without translating.

import { searchUsda, searchOff, detailUsda, detailOff, matchScore } from "./_food.js";

export default async function handler(req, res) {
  const { q, id, limit } = req.query || {};

  if (id) {
    const [source, sourceId] = String(id).split(":");
    try {
      const food = source === "off" ? await detailOff(sourceId) : await detailUsda(sourceId);
      if (!food) return res.status(404).json({ error: "That food isn't in the database anymore." });
      return res.status(200).json({ food });
    } catch (e) {
      return res.status(502).json({ error: `Couldn't load that food: ${e.message}` });
    }
  }

  const query = String(q || "").trim();
  if (!query) return res.status(400).json({ error: "Missing search term." });
  const n = Math.min(Math.max(Number(limit) || 20, 1), 40);

  // Both databases are queried together and merged: USDA is far better at
  // generic whole foods, Open Food Facts at packaged products. Either one
  // failing (or USDA having no key configured) still returns the other's hits.
  const [usda, off] = await Promise.allSettled([
    searchUsda(query, n),
    searchOff(query, Math.ceil(n / 2)),
  ]);

  const foods = [];
  const warnings = [];
  const seen = new Set();

  const take = (result, label) => {
    if (result.status === "rejected") {
      warnings.push(`${label} search failed: ${result.reason?.message || "unknown error"}`);
      return;
    }
    if (result.value.error === "no-key") {
      warnings.push("USDA_API_KEY isn't set, so only Open Food Facts was searched.");
      return;
    }
    for (const f of result.value.foods) {
      const key = `${f.name.toLowerCase()}|${(f.brand || "").toLowerCase()}|${f.cal}`;
      if (seen.has(key)) continue;
      seen.add(key);
      foods.push(f);
    }
  };

  take(usda, "USDA");
  take(off, "Open Food Facts");

  foods.sort((a, b) => matchScore(query, b) - matchScore(query, a));

  return res.status(200).json({ foods: foods.slice(0, n), warnings });
}
