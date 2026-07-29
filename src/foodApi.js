// Data access for the Food tab. Everything the browser does to food_items /
// food_meals / food_log goes through here; the two serverless endpoints
// (/api/food-search, /api/food-parse) are read-only lookups, so this file is
// the single place the log actually changes.
//
// Rows keep their database (snake_case) shape — see supabase_food.sql.

import { supabase } from "./supabaseClient.js";

const ITEM_COLUMNS =
  "id,name,brand,source,source_id,serving_qty,serving_unit,serving_grams,alt_servings,cal,protein,carbs,fat,use_count,last_used_at";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// --- catalog ---------------------------------------------------------------

/** Everything you've eaten before, most recently used first. */
export async function fetchFoodItems(limit = 400) {
  return unwrap(
    await supabase
      .from("food_items")
      .select(ITEM_COLUMNS)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("use_count", { ascending: false })
      .limit(limit)
  ) || [];
}

const EXTERNAL_FIELDS = [
  "name", "brand", "serving_qty", "serving_unit", "serving_grams",
  "alt_servings", "cal", "protein", "carbs", "fat",
];

/**
 * Cache a USDA / Open Food Facts result locally so the next time you eat it,
 * it's a local lookup and shows up in your history for voice matching.
 *
 * Done as select-then-write rather than upsert(): the uniqueness rule is a
 * partial index (source_id must be non-null), which ON CONFLICT can't infer.
 */
export async function importExternalFood(food) {
  const existing = unwrap(
    await supabase
      .from("food_items")
      .select(ITEM_COLUMNS)
      .eq("source", food.source)
      .eq("source_id", String(food.source_id))
      .maybeSingle()
  );

  const payload = {};
  for (const k of EXTERNAL_FIELDS) if (food[k] !== undefined) payload[k] = food[k];

  if (existing) {
    return unwrap(
      await supabase.from("food_items").update(payload).eq("id", existing.id).select(ITEM_COLUMNS).single()
    );
  }

  try {
    return unwrap(
      await supabase
        .from("food_items")
        .insert({ ...payload, source: food.source, source_id: String(food.source_id) })
        .select(ITEM_COLUMNS)
        .single()
    );
  } catch (e) {
    // Lost a race with another tab — the row exists now, so just read it.
    if (e?.code === "23505") {
      return unwrap(
        await supabase
          .from("food_items")
          .select(ITEM_COLUMNS)
          .eq("source", food.source)
          .eq("source_id", String(food.source_id))
          .single()
      );
    }
    throw e;
  }
}

export async function createCustomFood(fields) {
  return unwrap(
    await supabase.from("food_items").insert({ ...fields, source: "custom" }).select(ITEM_COLUMNS).single()
  );
}

export async function updateFoodItem(id, patch) {
  return unwrap(await supabase.from("food_items").update(patch).eq("id", id).select(ITEM_COLUMNS).single());
}

export async function deleteFoodItem(id) {
  unwrap(await supabase.from("food_items").delete().eq("id", id));
}

/** Bump recency/frequency so the food surfaces first next time. */
export async function touchFood(food) {
  if (!food?.id) return food;
  const patch = {
    use_count: (Number(food.use_count) || 0) + 1,
    last_used_at: new Date().toISOString(),
  };
  try {
    return unwrap(await supabase.from("food_items").update(patch).eq("id", food.id).select(ITEM_COLUMNS).single());
  } catch {
    // Recency is a nicety — never fail a meal entry over it.
    return { ...food, ...patch };
  }
}

// --- the log ---------------------------------------------------------------

/** Every logged row for the given "M/D/YY" dates. */
export async function fetchFoodLog(dates) {
  if (!dates.length) return [];
  return unwrap(
    await supabase
      .from("food_log")
      .select("*")
      .in("date", dates)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
  ) || [];
}

export async function insertFoodRows(rows) {
  if (!rows.length) return [];
  return unwrap(await supabase.from("food_log").insert(rows).select("*")) || [];
}

export async function updateFoodRow(id, patch) {
  return unwrap(await supabase.from("food_log").update(patch).eq("id", id).select("*").single());
}

export async function deleteFoodRows(ids) {
  if (!ids.length) return;
  unwrap(await supabase.from("food_log").delete().in("id", ids));
}

// --- saved meals -----------------------------------------------------------

export async function fetchMeals() {
  return unwrap(
    await supabase.from("food_meals").select("*").order("use_count", { ascending: false }).order("name")
  ) || [];
}

export async function saveMeal({ name, section, items }) {
  return unwrap(await supabase.from("food_meals").insert({ name, section, items }).select("*").single());
}

export async function deleteMeal(id) {
  unwrap(await supabase.from("food_meals").delete().eq("id", id));
}

export async function touchMeal(meal) {
  try {
    unwrap(await supabase.from("food_meals").update({ use_count: (Number(meal.use_count) || 0) + 1 }).eq("id", meal.id));
  } catch { /* frequency ordering isn't worth an error banner */ }
}

// --- lookups through the serverless endpoints ------------------------------

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Request failed (${resp.status})`);
  return json;
}

async function getJson(url) {
  const resp = await fetch(url);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Request failed (${resp.status})`);
  return json;
}

/** Search USDA + Open Food Facts for foods not already in your catalog. */
export async function searchFoodDatabase(query, { signal } = {}) {
  const resp = await fetch(`/api/food-search?q=${encodeURIComponent(query)}`, { signal });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Search failed (${resp.status})`);
  return json;
}

/** Full detail (all known portions) for one external food. */
export async function fetchFoodDetail(source, sourceId) {
  const { food } = await getJson(`/api/food-search?id=${encodeURIComponent(`${source}:${sourceId}`)}`);
  return food;
}

/** Resolve a scanned barcode to a food. Throws with a readable miss message. */
export async function lookupBarcode(barcode) {
  const { food } = await getJson(`/api/food-search?barcode=${encodeURIComponent(barcode)}`);
  return food;
}

/** Send a spoken/typed meal description off to be parsed and resolved. */
export async function parseSpokenMeal(payload) {
  return postJson("/api/food-parse", payload);
}

/**
 * Search the web for a food's nutrition facts to pre-fill the custom-food
 * form. Returns { nutrition, sources, error? } — nutrition is null when
 * nothing credible turned up, which is a normal outcome rather than a
 * failure, so it isn't thrown.
 */
export async function lookupNutrition({ name, brand, serving }) {
  return postJson("/api/food-lookup", { name, brand, serving });
}
