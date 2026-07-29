// Serving math shared by the browser (src/Dashboard.jsx) and the serverless
// functions under api/. Nothing in here may touch the DOM, Supabase, or
// process.env — it's pure arithmetic over the food_items shape defined in
// supabase_food.sql.
//
// Food rows keep their database (snake_case) shape end to end: they come out
// of Supabase, get scaled here, and go back in without a translation layer.

export const MEAL_SECTIONS = [
  { key: "breakfast", label: "Breakfast", short: "Breakfast" },
  { key: "lunch", label: "Lunch", short: "Lunch" },
  { key: "snack_early", label: "Early Afternoon Snack", short: "Early Snack" },
  { key: "snack_late", label: "Late Afternoon Snack", short: "Late Snack" },
  { key: "dinner", label: "Dinner", short: "Dinner" },
  { key: "dessert", label: "Dessert", short: "Dessert" },
];

export const SECTION_KEYS = MEAL_SECTIONS.map(s => s.key);

export function sectionLabel(key) {
  return MEAL_SECTIONS.find(s => s.key === key)?.label || key;
}

// Which section a meal logged "right now" most likely belongs to. Used as the
// default for the add button and as the fallback when the voice entry doesn't
// name a section itself.
export function sectionForHour(hour) {
  if (hour < 11) return "breakfast";
  if (hour < 14) return "lunch";
  if (hour < 16) return "snack_early";
  if (hour < 18) return "snack_late";
  if (hour < 21) return "dinner";
  return "dessert";
}

const MASS_G = {
  g: 1, gram: 1, grams: 1, gm: 1, gs: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  mg: 0.001,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
};

const VOLUME_ML = {
  ml: 1, milliliter: 1, milliliters: 1, cc: 1,
  l: 1000, liter: 1000, liters: 1000, litre: 1000,
  tsp: 4.92892, teaspoon: 4.92892, teaspoons: 4.92892,
  tbsp: 14.7868, tablespoon: 14.7868, tablespoons: 14.7868,
  "fl oz": 29.5735, floz: 29.5735, "fluid ounce": 29.5735, "fluid ounces": 29.5735,
  cup: 236.588, cups: 236.588,
  pint: 473.176, pints: 473.176,
  quart: 946.353, quarts: 946.353,
  gallon: 3785.41, gallons: 3785.41,
};

// Units that mean "one of the thing" rather than a measurement — they only
// ever scale against the food's own base serving.
const COUNT_UNITS = new Set([
  "serving", "servings", "each", "ea", "item", "items", "unit", "units",
  "piece", "pieces", "whole", "count",
]);

export function normalizeUnit(unit) {
  return String(unit ?? "")
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

export function isMassUnit(unit) {
  return MASS_G[normalizeUnit(unit)] != null;
}

export function isVolumeUnit(unit) {
  return VOLUME_ML[normalizeUnit(unit)] != null;
}

export function toGrams(qty, unit) {
  const f = MASS_G[normalizeUnit(unit)];
  return f == null ? null : qty * f;
}

export function toMl(qty, unit) {
  const f = VOLUME_ML[normalizeUnit(unit)];
  return f == null ? null : qty * f;
}

// "slices" -> "slice", so a food whose portion is labelled "slice" still
// matches when you say "two slices".
function singular(unit) {
  const u = normalizeUnit(unit);
  if (u.length > 3 && u.endsWith("es") && /(ch|sh|ss|x|z)es$/.test(u)) return u.slice(0, -2);
  if (u.length > 2 && u.endsWith("s") && !u.endsWith("ss")) return u.slice(0, -1);
  return u;
}

function unitsMatch(a, b) {
  const na = normalizeUnit(a), nb = normalizeUnit(b);
  return na === nb || singular(na) === singular(nb);
}

function altMatches(alt, unit) {
  const target = singular(unit);

  // The portion's declared unit matches outright. Volume names count here:
  // when a food states what a cup of it weighs, that beats assuming a density.
  if (alt.unit && singular(alt.unit) === target) return true;
  if (!alt.label) return false;

  // A measurement word must never match through the label. Portion labels
  // routinely read "32 g" or "1 cup", and matching the "g" in one of those
  // made "32 g" resolve to thirty-two portions instead of thirty-two grams.
  // Weights and volumes belong to the conversion path below, not here.
  if (isMassUnit(target) || isVolumeUnit(target)) return false;

  if (singular(alt.label) === target) return true;
  // Otherwise a noun inside the label counts: "1 cup, cooked" answers to
  // "cup", "1 medium apple" to "apple".
  return normalizeUnit(alt.label).split(/[\s,()]+/).some(w => w && singular(w) === target);
}

/**
 * How many base servings of `food` a given quantity/unit works out to.
 *
 * Resolution order is most-specific-first: a portion the food itself declares
 * beats a generic mass conversion, which beats "just treat it as servings".
 * `exact: false` means we fell through to that last guess, which the UI shows
 * as an estimate rather than a number to trust.
 */
export function servingFactor(food, qty, unit) {
  const n = Number(qty);
  if (!food || !Number.isFinite(n)) return { factor: 0, exact: false };

  const baseQty = Number(food.serving_qty) || 1;
  const baseGrams = food.serving_grams != null ? Number(food.serving_grams) : null;
  const u = normalizeUnit(unit);
  const alts = Array.isArray(food.alt_servings) ? food.alt_servings : [];

  // A portion the food declares (cup, slice, can, medium…) — checked first,
  // and that ordering is load-bearing. A packaged food's label serving comes
  // through named "serving" ("1 serving = 32 g"), so short-circuiting the
  // word "serving" to mean "one base serving" ahead of this silently returned
  // the 100 g storage base and ignored the real 32 g portion.
  const alt = alts.find(a => altMatches(a, u));
  if (alt) {
    const altGrams = alt.grams != null ? Number(alt.grams) : null;
    if (altGrams != null && baseGrams) return { factor: (n * altGrams) / baseGrams, exact: true };
    const altQty = Number(alt.qty) || 1;
    return { factor: (n * altQty) / baseQty, exact: true };
  }

  // "2 servings" means two of whatever the food calls a serving, even when
  // that serving is itself "100 g". Only reached when the food declares no
  // portion of its own by that name.
  if (singular(u) === "serving") return { factor: n, exact: true };

  // No unit at all, or a bare count word ("3 each"): N of the base unit, so a
  // food whose serving is "2 cookies" makes 3 cookies 1.5 servings.
  if (!u || COUNT_UNITS.has(singular(u))) return { factor: n / baseQty, exact: true };

  // Weight, converted through the base serving's own weight.
  const grams = toGrams(n, u);
  if (grams != null) {
    if (baseGrams) return { factor: grams / baseGrams, exact: true };
    const baseAsGrams = toGrams(baseQty, food.serving_unit);
    if (baseAsGrams) return { factor: grams / baseAsGrams, exact: true };
  }

  // Volume, but only against a food whose base serving is also a volume —
  // guessing a density for an arbitrary solid does more harm than good.
  const ml = toMl(n, u);
  if (ml != null) {
    const baseAsMl = toMl(baseQty, food.serving_unit);
    if (baseAsMl) return { factor: ml / baseAsMl, exact: true };
  }

  if (unitsMatch(u, food.serving_unit)) return { factor: n / baseQty, exact: true };

  // Nothing lined up — "cup" against a food with no cup portion, say. Count it
  // as N servings and flag it, which the UI shows as "check this". Scaling by
  // the base quantity instead would silently divide a per-100 g food by 100
  // and quietly under-count the day.
  return { factor: n, exact: false };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

/** Macros for `qty` `unit` of `food`, rounded the way they're displayed. */
export function scaleMacros(food, qty, unit) {
  const { factor, exact } = servingFactor(food, qty, unit);
  return {
    cal: Math.round((Number(food.cal) || 0) * factor),
    protein: round1((Number(food.protein) || 0) * factor),
    carbs: round1((Number(food.carbs) || 0) * factor),
    fat: round1((Number(food.fat) || 0) * factor),
    exact,
  };
}

/**
 * Just the four macro columns of a logged row.
 *
 * scaleMacros() also returns an `exact` flag for the UI, which is not a column
 * in food_log — spreading its whole result into a database write gets the
 * request rejected outright. Anything writing macros to a row should go
 * through here rather than remembering that.
 */
export function macroColumns(food, qty, unit) {
  const { cal, protein, carbs, fat } = scaleMacros(food, qty, unit);
  return { cal, protein, carbs, fat };
}

/** Units worth offering in the quantity picker for a given food. */
export function unitOptions(food) {
  if (!food) return ["serving"];
  const out = [];
  const push = (u) => {
    const n = normalizeUnit(u);
    if (n && !out.some(o => unitsMatch(o, n))) out.push(n);
  };
  push(food.serving_unit);
  (food.alt_servings || []).forEach(a => push(a.unit || a.label));
  if (food.serving_grams || isMassUnit(food.serving_unit)) {
    push("g");
    push("oz");
  }
  if (isVolumeUnit(food.serving_unit)) {
    push("ml");
    push("cup");
  }
  push("serving");
  return out;
}

/**
 * The amount to pre-fill the quantity picker with. A real portion ("1 can")
 * beats the storage base, because per-100 g foods would otherwise default to
 * a useless "1 g".
 */
export function defaultPortion(food) {
  if (!food) return { qty: 1, unit: "serving" };
  const alt = (food.alt_servings || []).find(a => a.unit || a.label);
  if (alt) return { qty: Number(alt.qty) || 1, unit: normalizeUnit(alt.unit || alt.label) };
  return { qty: Number(food.serving_qty) || 1, unit: normalizeUnit(food.serving_unit) || "serving" };
}

/**
 * How a food should be *shown* and what the quantity box should start at.
 *
 * Nutrition databases report almost everything per 100 g, which is the right
 * thing to store but a terrible thing to show: nobody eats 100 g of anything
 * on purpose. When the food declares a real portion — a can, a slice, a cup,
 * a label serving — that's what gets displayed and pre-filled, with macros
 * scaled to match. Only foods that genuinely have no portion on file fall
 * back to reading per-100 g.
 */
export function displayServing(food) {
  const { qty, unit } = defaultPortion(food);
  const macros = scaleMacros(food, qty, unit);
  const grams = servingFactor(food, qty, unit).factor * (Number(food.serving_grams) || 0);
  const label = `${round1(qty)} ${unit}`;
  return {
    qty,
    unit,
    grams: grams ? Math.round(grams * 10) / 10 : null,
    label: grams && !isMassUnit(unit) ? `${label} (${Math.round(grams)} g)` : label,
    isBaseUnit: unit === normalizeUnit(food.serving_unit) && qty === (Number(food.serving_qty) || 1),
    ...macros,
  };
}

// --- fuzzy name matching ---------------------------------------------------
// Used in two places: picking the best database hit for a spoken food name on
// the server, and checking whether something you've already eaten covers it
// before importing anything new on the client.

const STOP_WORDS = new Set(["a", "an", "of", "the", "with", "and", "raw", "fresh"]);

export function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t && !STOP_WORDS.has(t));
}

/**
 * 0..1 overlap between a search phrase and a food's name. Deliberately blunt:
 * it only has to be good enough to prefer "Rice, white, cooked" over "Rice
 * cake, caramel" when the person said "white rice".
 */
export function matchScore(query, food) {
  const q = tokenize(query);
  if (!q.length) return 0;
  const hay = new Set(tokenize(`${food.name} ${food.brand || ""}`));
  const hit = q.filter(t => hay.has(t)).length;
  let score = hit / q.length;
  // A short, focused name that matched every word beats a long one that
  // happened to contain those words somewhere.
  if (score === 1) score += Math.max(0, 0.3 - tokenize(food.name).length * 0.02);
  return score;
}

export const EMPTY_TOTALS = { cal: 0, protein: 0, carbs: 0, fat: 0 };

/** Sum the macro columns off any list of logged rows. */
export function sumMacros(rows) {
  return (rows || []).reduce((acc, r) => ({
    cal: acc.cal + (Number(r.cal) || 0),
    protein: acc.protein + (Number(r.protein) || 0),
    carbs: acc.carbs + (Number(r.carbs) || 0),
    fat: acc.fat + (Number(r.fat) || 0),
  }), { ...EMPTY_TOTALS });
}

export function roundTotals(t) {
  return {
    cal: Math.round(t.cal),
    protein: round1(t.protein),
    carbs: round1(t.carbs),
    fat: round1(t.fat),
  };
}
