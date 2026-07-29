// GET /api/food-search?q=white+rice[&limit=20]  -> search every database
// GET /api/food-search?id=usda:2512381                -> full detail for one food
// GET /api/food-search?barcode=049000028911           -> look up a scanned package
//
// Returns foods already normalized into the food_items shape, so the client
// can cache a picked result straight into Supabase without translating.

import {
  searchUsda, searchOff, searchNutritionix,
  detailUsda, detailOff,
  lookupUpcUsda, lookupUpcNutritionix,
  matchScore,
} from "./_food.js";

// Nutritionix's free tier requires visible attribution wherever its data is
// shown, so the client is told which sources actually contributed.
const ATTRIBUTION = { nutritionix: "Nutrition data by Nutritionix" };

export default async function handler(req, res) {
  const { q, id, barcode, limit } = req.query || {};

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

  if (barcode) {
    const code = String(barcode).replace(/\D/g, "");
    if (code.length < 6) return res.status(400).json({ error: "That doesn't look like a barcode." });
    // Open Food Facts first: it has by far the widest barcode coverage and
    // costs nothing. The other two only get asked if it comes up empty.
    const lookups = [
      () => detailOff(code),
      () => lookupUpcNutritionix(code),
      () => lookupUpcUsda(code),
    ];
    for (const lookup of lookups) {
      try {
        const food = await lookup();
        if (food) return res.status(200).json({ food, attribution: attributionFor([food]) });
      } catch { /* try the next source */ }
    }
    return res.status(404).json({
      error: "No product found for that barcode. Add it as a custom food and it'll be there next time.",
    });
  }

  const query = String(q || "").trim();
  if (!query) return res.status(400).json({ error: "Missing search term." });
  const n = Math.min(Math.max(Number(limit) || 20, 1), 40);

  // All three are queried together and merged. They cover different ground:
  // USDA is best at generic whole and prepared foods, Nutritionix at
  // restaurant menus and grocery brands, Open Food Facts at packaged goods
  // worldwide. Any of them failing (or having no key) still returns the rest.
  const [usda, nutritionix, off] = await Promise.allSettled([
    searchUsda(query, n),
    searchNutritionix(query, 5),
    searchOff(query, Math.ceil(n / 3)),
  ]);

  const foods = [];
  const warnings = [];
  const seen = new Set();

  const take = (result, label, missingKeyNote) => {
    if (result.status === "rejected") {
      warnings.push(`${label} search failed: ${result.reason?.message || "unknown error"}`);
      return;
    }
    if (result.value.error === "no-key") {
      if (missingKeyNote) warnings.push(missingKeyNote);
      return;
    }
    for (const f of result.value.foods) {
      const key = `${f.name.toLowerCase()}|${(f.brand || "").toLowerCase()}|${f.cal}`;
      if (seen.has(key)) continue;
      seen.add(key);
      foods.push(f);
    }
  };

  take(usda, "USDA", "USDA_API_KEY isn't set, so USDA's food database was skipped.");
  take(nutritionix, "Nutritionix", null); // silent: it's optional, unlike USDA
  take(off, "Open Food Facts", null);

  foods.sort((a, b) => matchScore(query, b) - matchScore(query, a));
  const top = foods.slice(0, n);

  return res.status(200).json({ foods: top, warnings, attribution: attributionFor(top) });
}

function attributionFor(foods) {
  const out = [];
  for (const [source, text] of Object.entries(ATTRIBUTION)) {
    if (foods.some(f => f.source === source) && !out.includes(text)) out.push(text);
  }
  return out;
}
