// Shared fixtures and Playwright setup for the spec files beside this one.
// See tests/README.md for how to run them.

// This container ships a prebuilt Chromium; anywhere else, let Playwright
// resolve its own. PW_CHROMIUM overrides both.
const PINNED = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
/** Screenshots go to tests/screenshots/, which is gitignored. */
export function shot(name) {
  const dir = new URL("./screenshots/", import.meta.url);
  return new URL(name, dir).pathname;
}

export const LAUNCH = (await import("node:fs")).existsSync(PINNED)
  ? { executablePath: PINNED } : {};

// Shared mock: kv_store blobs for the Dashboard + food tables for the Food tab.
const day = (n) => { const d = new Date(2026, 6, 29 - n); return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };

export const entries = Array.from({ length: 12 }, (_, i) => ({
  wk: 12 - i, date: day((11 - i) * 7), phase: "Cut",
  aW: 214 - i * 1.1, aM: 168 - i * 0.1, aF: 46 - i * 1.0,
  aCal: 1900 + (i % 3) * 120, steps: 9000 + (i % 4) * 700, notes: "",
}));

export const goals = [
  { date: "3/1/26", phase: "Cut", muscleRate: 0, fatRate: -0.5, stepGoal: 10000, calGoal: 1900,
    proteinGoal: 190, fatGoal: 60, calBuffer: 100, proteinBuffer: 20,
    durationWeeks: 24, notes: "Initial cut targets" },
];

export const daily = Array.from({ length: 21 }, (_, i) => ({
  date: day(20 - i), cal: 1850 + (i % 5) * 90, steps: 8600 + (i % 6) * 600,
  weight: 205 - i * 0.15, fatMass: 36 - i * 0.1, muscleMass: 167,
  calSource: i % 4 === 0 ? "food" : "manual",
}));

export const habits = {};

const FOODS = [
  ["Chicken breast, grilled", null, 1, "oz", 28, 47, 8.8, 0, 1],
  ["White rice, cooked", null, 1, "cup", 158, 205, 4.3, 44.5, 0.4],
  ["Tuna, canned in water", "StarKist", 1, "can", 142, 130, 29, 0, 1],
  ["Saltine crackers", null, 1, "cracker", 3, 13, 0.3, 2.2, 0.3],
  ["Beef stick", "Simms", 1, "stick", 32, 100, 10, 0, 6],
  ["Greek yogurt, plain", "Fage", 1, "cup", 227, 146, 25, 8, 0],
  ["Protein shake", "Isopure", 1, "scoop", 32, 110, 25, 1, 0.5],
  ["Banana", null, 1, "medium", 118, 105, 1.3, 27, 0.4],
  ["Almonds", null, 1, "oz", 28, 164, 6, 6.1, 14],
  ["Sourdough bread", null, 1, "slice", 50, 130, 4.5, 25, 1],
];

export const foodItems = FOODS.map((f, i) => ({
  id: `f${i}`, name: f[0], brand: f[1], source: i % 3 ? "custom" : "usda", source_id: i % 3 ? null : `${1000 + i}`,
  serving_qty: f[2], serving_unit: f[3], serving_grams: f[4], alt_servings: [],
  cal: f[5], protein: f[6], carbs: f[7], fat: f[8],
  use_count: 12 - i, last_used_at: `2026-07-2${9 - (i % 9)}T12:00:00Z`,
}));

const LOG = [
  ["breakfast", 5, 1, "cup"], ["breakfast", 6, 1, "scoop"], ["breakfast", 7, 1, "medium"],
  ["lunch", 2, 1, "can"], ["lunch", 1, 1, "cup"], ["lunch", 3, 10, "cracker"],
  ["snack_early", 8, 1, "oz"],
  ["snack_late", 4, 2, "stick"],
  ["dinner", 0, 6, "oz"], ["dinner", 1, 1, "cup"], ["dinner", 9, 1, "slice"],
];

export function foodLog(dates) {
  const rows = [];
  dates.forEach((d, di) => {
    LOG.forEach(([section, idx, qty, unit], i) => {
      const f = foodItems[idx];
      const factor = unit === f.serving_unit ? qty / f.serving_qty : qty;
      rows.push({
        id: `l${di}-${i}`, date: d, section, food_id: f.id, name: f.name, brand: f.brand,
        qty, unit,
        cal: Math.round(f.cal * factor), protein: Math.round(f.protein * factor * 10) / 10,
        carbs: Math.round(f.carbs * factor * 10) / 10, fat: Math.round(f.fat * factor * 10) / 10,
        sort_order: i, created_at: "2026-07-29T12:00:00Z",
      });
    });
  });
  return rows;
}

export const meals = [
  { id: "m1", name: "Usual breakfast", section: "breakfast", items: [], use_count: 6, created_at: "2026-07-01" },
];

/**
 * Google Fonts is unreachable from this sandbox, and `waitUntil: "networkidle"`
 * waits out the whole connection timeout — about 12s per page load, against
 * 2.4s once it's aborted. The font never loaded either way, so every spec has
 * always been measuring the fallback.
 */
export async function blockWebfonts(page) {
  // Answered rather than aborted: an abort makes Chromium log a failed
  // resource, which every spec's console-error guard then reports as a
  // problem. An empty stylesheet is silent and just as fast.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r =>
    r.fulfill({ status: 200, contentType: "text/css", body: "" }));
}

/** Wire every table this app reads onto a Playwright page. */
export async function mock(page, { dates } = {}) {
  await blockWebfonts(page);
  const kv = {
    entries: JSON.stringify(entries),
    phase_goals: JSON.stringify(goals),
    daily_log: JSON.stringify(daily),
    habits_log: JSON.stringify(habits),
    habits_targets: JSON.stringify({}),
  };
  await page.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/rest/v1/")[1];
    const send = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (route.request().method() !== "GET") return send([]);
    if (table === "kv_store") {
      const key = (url.searchParams.get("key") || "").replace("eq.", "");
      return send(kv[key] != null ? { value: kv[key] } : null);
    }
    if (table === "food_items") return send(foodItems);
    if (table === "food_meals") return send(meals);
    if (table === "food_log") {
      const raw = url.searchParams.get("date") || "";
      const list = raw.replace(/^in\.\(/, "").replace(/\)$/, "").split(",").map(s => s.replace(/^"|"$/g, ""));
      return send(foodLog(list.filter(Boolean)));
    }
    if (table === "daily_metrics") return send([]);
    if (table === "lab_panels" || table === "lab_results") return send([]);
    return send([]);
  });
}
