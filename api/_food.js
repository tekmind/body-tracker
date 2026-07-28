// Shared helpers for the food endpoints. Normalizes two very different
// nutrition APIs into the single food_items shape the app stores (see
// supabase_food.sql) so the client never has to know where a food came from.

// Name matching is shared with the browser so a food scores the same whether
// it's being ranked here or checked against your history there.
export { tokenize, matchScore } from "../src/foodMath.js";

export const USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
export const USDA_DETAIL_URL = "https://api.nal.usda.gov/fdc/v1/food";
export const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
export const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";

// Open Food Facts asks every client to identify itself; anonymous traffic gets
// rate-limited hard.
const OFF_HEADERS = { "User-Agent": "BodyTracker/1.0 (personal calorie tracker)" };

// FoodData Central nutrient IDs.
const N_ENERGY = 1008;   // Energy (kcal)
const N_PROTEIN = 1003;
const N_FAT = 1004;      // Total lipid
const N_CARBS = 1005;    // Carbohydrate, by difference
const N_ENERGY_ATWATER = 2047;

const round1 = (v) => Math.round(v * 10) / 10;

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function getJson(url, { headers, timeout = 9000 } = {}) {
  const resp = await fetch(url, { headers, signal: timeoutSignal(timeout) });
  if (!resp.ok) throw new Error(`${resp.status} from ${new URL(url).host}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// USDA FoodData Central
// ---------------------------------------------------------------------------

// Search hits and detail responses spell nutrients differently
// (`nutrientId`/`value` vs `nutrient.id`/`amount`), so read both shapes.
function usdaNutrient(food, id) {
  const list = food.foodNutrients || [];
  for (const n of list) {
    const nid = n.nutrientId ?? n.nutrient?.id;
    if (nid !== id) continue;
    const v = n.value ?? n.amount;
    if (v != null) return Number(v);
  }
  return null;
}

function usdaPortions(food) {
  const out = [];
  const seen = new Set();
  const push = (label, qty, unit, grams) => {
    const key = `${unit}|${grams}`;
    if (!unit || !grams || seen.has(key)) return;
    seen.add(key);
    out.push({ label, qty, unit, grams: round1(grams) });
  };

  // Branded items carry a single label serving.
  if (food.servingSize && food.servingSizeUnit) {
    const unit = String(food.servingSizeUnit).toLowerCase();
    const household = (food.householdServingFullText || "").trim();
    if (unit === "g" || unit === "ml") {
      // A "1 cup (240ml)" style household text is the useful, speakable unit.
      const m = household.match(/^([\d./\s]+)?\s*([a-zA-Z][a-zA-Z\s.]*)$/);
      if (m) {
        const qty = parseLooseNumber(m[1]) ?? 1;
        push(household || `${food.servingSize} ${unit}`, qty, m[2].trim().toLowerCase(), Number(food.servingSize) / qty);
      } else {
        push(`${food.servingSize} ${unit}`, 1, "serving", Number(food.servingSize));
      }
    }
  }

  // Foundation / SR Legacy items carry a full portion table.
  for (const p of food.foodPortions || []) {
    const grams = Number(p.gramWeight);
    const amount = Number(p.amount) || 1;
    const unit = (p.measureUnit?.name && p.measureUnit.name !== "undetermined"
      ? p.measureUnit.name
      : p.modifier || p.portionDescription || "").toString().toLowerCase().trim();
    if (!grams || !unit) continue;
    const label = `${amount} ${unit}`.trim();
    push(label, amount, unit.split(",")[0].trim(), grams / amount);
  }

  // Search results expose the same data in a flatter form.
  for (const m of food.foodMeasures || []) {
    const grams = Number(m.gramWeight);
    const unit = (m.disseminationText || m.measureUnitName || "").toLowerCase().trim();
    if (!grams || !unit || unit === "undetermined") continue;
    push(unit, 1, unit.split(",")[0].trim(), grams);
  }

  return out.slice(0, 8);
}

function parseLooseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const frac = s.match(/^(\d+)?\s*(\d)\/(\d)$/);
  if (frac) return (Number(frac[1]) || 0) + Number(frac[2]) / Number(frac[3]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeUsda(food) {
  const cal = usdaNutrient(food, N_ENERGY) ?? usdaNutrient(food, N_ENERGY_ATWATER);
  const protein = usdaNutrient(food, N_PROTEIN);
  const carbs = usdaNutrient(food, N_CARBS);
  const fat = usdaNutrient(food, N_FAT);
  if (cal == null) return null; // a food with no calories is no use here

  // USDA reports every nutrient per 100 g (per 100 ml for a few liquids), so
  // that's the base serving; everything else becomes an alternate portion.
  const perMl = String(food.servingSizeUnit || "").toLowerCase() === "ml";
  const brandParts = [food.brandName, food.brandOwner].filter(Boolean);

  return {
    source: "usda",
    source_id: String(food.fdcId),
    name: cleanName(food.description || food.lowercaseDescription || "Unknown food"),
    brand: brandParts.length ? cleanName(brandParts[0]) : null,
    serving_qty: 100,
    serving_unit: perMl ? "ml" : "g",
    serving_grams: perMl ? null : 100,
    alt_servings: usdaPortions(food),
    cal: Math.round(cal),
    protein: round1(protein ?? 0),
    carbs: round1(carbs ?? 0),
    fat: round1(fat ?? 0),
    data_type: food.dataType || null,
  };
}

function cleanName(s) {
  const t = String(s).trim().replace(/\s+/g, " ");
  // USDA descriptions are SHOUTED for branded items; title-case those.
  if (t === t.toUpperCase() && /[A-Z]{4,}/.test(t)) {
    return t.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }
  return t;
}

export async function searchUsda(query, limit) {
  const key = process.env.USDA_API_KEY;
  if (!key) return { foods: [], error: "no-key" };
  const url = `${USDA_SEARCH_URL}?${new URLSearchParams({
    api_key: key,
    query,
    pageSize: String(Math.min(limit * 2, 40)),
    dataType: "Foundation,SR Legacy,Branded",
  })}`;
  const json = await getJson(url);
  const foods = (json.foods || []).map(normalizeUsda).filter(Boolean);
  // Whole foods before packaged ones — "chicken breast" should not lead with
  // a frozen dinner just because the brand name matched.
  foods.sort((a, b) => rankDataType(a.data_type) - rankDataType(b.data_type));
  return { foods: foods.slice(0, limit) };
}

function rankDataType(t) {
  if (t === "Foundation") return 0;
  if (t === "SR Legacy") return 1;
  if (t === "Survey (FNDDS)") return 2;
  return 3;
}

export async function detailUsda(fdcId) {
  const key = process.env.USDA_API_KEY;
  if (!key) throw new Error("USDA_API_KEY is not configured");
  const json = await getJson(`${USDA_DETAIL_URL}/${encodeURIComponent(fdcId)}?api_key=${key}`);
  return normalizeUsda(json);
}

// ---------------------------------------------------------------------------
// Open Food Facts
// ---------------------------------------------------------------------------

export function normalizeOff(product) {
  const n = product.nutriments || {};
  const cal = n["energy-kcal_100g"] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null);
  if (cal == null) return null;
  const name = (product.product_name || "").trim();
  if (!name) return null;

  const alt = [];
  const servingGrams = Number(product.serving_quantity);
  if (servingGrams > 0) {
    alt.push({
      label: (product.serving_size || `${servingGrams} g`).trim(),
      qty: 1,
      unit: "serving",
      grams: round1(servingGrams),
    });
  }

  return {
    source: "off",
    source_id: String(product.code),
    name: cleanName(name),
    brand: product.brands ? cleanName(String(product.brands).split(",")[0]) : null,
    serving_qty: 100,
    serving_unit: "g",
    serving_grams: 100,
    alt_servings: alt,
    cal: Math.round(cal),
    protein: round1(Number(n.proteins_100g) || 0),
    carbs: round1(Number(n.carbohydrates_100g) || 0),
    fat: round1(Number(n.fat_100g) || 0),
    data_type: "Off",
  };
}

const OFF_FIELDS = "code,product_name,brands,nutriments,serving_size,serving_quantity";

export async function searchOff(query, limit) {
  const url = `${OFF_SEARCH_URL}?${new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(Math.min(limit, 20)),
    fields: OFF_FIELDS,
  })}`;
  const json = await getJson(url, { headers: OFF_HEADERS });
  return { foods: (json.products || []).map(normalizeOff).filter(Boolean).slice(0, limit) };
}

export async function detailOff(barcode) {
  const url = `${OFF_PRODUCT_URL}/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
  const json = await getJson(url, { headers: OFF_HEADERS });
  if (!json.product) return null;
  return normalizeOff({ ...json.product, code: barcode });
}

export function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}
