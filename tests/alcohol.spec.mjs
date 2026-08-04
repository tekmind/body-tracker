// Alcohol counted as carbs.
//
// A beer logs its full calories but almost no macros — ethanol is 7 kcal/g
// and belongs to none of the three. Left alone, a day reads 2,155 of a 2,100
// calorie goal in red while every macro tile sits green, and nothing on
// screen says where the difference went.
import { chromium } from "playwright";
import { entries, goals, habits, blockWebfonts, LAUNCH, shot } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

// The goal these run against: 2,100 kcal, 150p, 50f — so carbs are
// (2100 - 600 - 450) / 4 = 262.5, shown as 263.
const GOALS = [{ ...goals[0], phase: "Maintain", calGoal: 2100, proteinGoal: 150, fatGoal: 50, calBuffer: null }];

const today = new Date();
const mdy = (d) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
const dayBefore = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return mdy(d); };
const BEER_DAY = dayBefore(1);
const FOOD_DAY = dayBefore(2);

const item = (id, name, cal, p, c, f) => ({
  id, name, brand: null, source: "custom", source_id: null,
  serving_qty: 1, serving_unit: "serving", serving_grams: null, alt_servings: [],
  cal, protein: p, carbs: c, fat: f, use_count: 1, last_used_at: null,
});
// Every food but the beer reconciles exactly — 4/4/9 against its own
// calories — so the only gap in either day is the ethanol, and the spec isn't
// quietly measuring fixture rounding.
const items = [
  item("f-beer", "Jai Alai IPA", 675, 0, 36, 0),        // 144 kcal of macros, 531 of ethanol
  item("f-meal", "Chicken and rice", 588, 60, 60, 12),
  item("f-eggs", "Eggs and toast", 496, 30, 40, 24),
  item("f-pasta", "Pasta", 385, 15, 70, 5),
];
const logged = (date, food, sort) => ({
  id: `${date}-${sort}`, date, section: "dinner", food_id: food.id, name: food.name, brand: null,
  qty: 1, unit: "serving", cal: food.cal, protein: food.protein, carbs: food.carbs, fat: food.fat,
  sort_order: sort, created_at: "2026-07-29T12:00:00Z",
});
// Beer day: 2,144 kcal logged (105p / 206c / 41f), of which only 1,613 is in
// the macros. The same day without the beer is 1,469 and reconciles exactly.
const log = [
  logged(BEER_DAY, items[0], 0), logged(BEER_DAY, items[1], 1),
  logged(BEER_DAY, items[2], 2), logged(BEER_DAY, items[3], 3),
  logged(FOOD_DAY, items[1], 0), logged(FOOD_DAY, items[2], 1), logged(FOOD_DAY, items[3], 2),
];

const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });

const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(GOALS),
  daily_log: "[]", habits_log: JSON.stringify(habits), habits_targets: "{}" };

await p.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() !== "GET") return send([{}]);
  if (table === "kv_store") {
    const key = (url.searchParams.get("key") || "").replace("eq.", "");
    return send(kv[key] != null ? { value: kv[key] } : null);
  }
  if (table === "food_items") return send(items);
  if (table === "food_log") {
    // The app asks for one week at a time and merges what comes back, so a
    // mock that ignores the date filter hands it the same rows repeatedly —
    // duplicate React keys and a dinner three times the size it should be.
    const raw = url.searchParams.get("date") || "";
    const wanted = raw.replace(/^in\.\(/, "").replace(/\)$/, "").split(",").map(s => s.replace(/^"|"$/g, ""));
    return send(log.filter(r => wanted.includes(r.date)));
  }
  return send([]);
});
await p.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");

const tile = (label) => p.locator(".macro-tile").filter({ hasText: new RegExp(`^${label}`) });
const read = async (label) => (await tile(label).innerText()).replace(/\n/g, " | ");
const isRed = async (label) => /macro-bad/.test(await tile(label).getAttribute("class"));
const goTo = async (date) => {
  for (let i = 0; i < 10; i++) {
    if ((await p.locator(".food-day-label").innerText()).includes(date)) return;
    await p.locator('[title="Previous day"]').click();
    await p.waitForTimeout(250);
  }
  throw new Error("never reached " + date);
};

// --- a day with beer in it ---------------------------------------------------
await goTo(BEER_DAY);
check("the day is over on calories", await isRed("Calories"), await read("Calories"));
check("carbs count the drink and go over too", await isRed("Carbs"), await read("Carbs"));
// 206 logged carbs + 531 kcal of ethanol / 4 = 338.75 -> 338.8
check("with the ethanol turned into grams", /338\.8g\/ 263g/.test(await read("Carbs")), await read("Carbs"));
check("and the tile says where they came from", /132\.8g of it from alcohol/.test(await read("Carbs")),
  await read("Carbs"));
check("the other tiles are untouched by it", /105g\/ 150g/.test(await read("Protein")) && /41g\/ 50g/.test(await read("Fat")),
  `${await read("Protein")} // ${await read("Fat")}`);

// The point of the whole thing: the four tiles now add up to the calorie total.
const macroCal = 105 * 4 + 338.8 * 4 + 41 * 9;
check("the macros now account for the day's calories", Math.abs(macroCal - 2144) < 2, `${macroCal} vs 2144`);

// The per-meal lines keep the foods' own numbers — they're a breakdown of what
// you ate, not a budget.
const dinner = await p.locator(".food-section").filter({ hasText: "Dinner" }).first().innerText();
check("the meal line still shows the beer's real carbs", /206c/.test(dinner.replace(/\n/g, " ")),
  dinner.split("\n")[0]);

await p.locator(".macro-grid").screenshot({ path: shot("alcohol-tiles.png") });

// --- a day without ----------------------------------------------------------
await goTo(FOOD_DAY);
check("a day with no drink says nothing about alcohol",
  await p.locator(".macro-tile-note").count() === 0, await read("Carbs"));
check("and its carbs are just its carbs", /170g\/ 263g/.test(await read("Carbs")), await read("Carbs"));
check("still green", !(await isRed("Carbs")), await read("Carbs"));

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
