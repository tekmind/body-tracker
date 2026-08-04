// Making a food of your own: the Web button on the search row, and what the
// "Save & add" button actually logs.
//
// The bug this was written for: a food whose serving is "12 oz" logged as
// 1 oz — a twelfth of the calories — because the amount box counts servings
// but the unit sent alongside it was the serving's own unit.
import { chromium } from "playwright";
import { entries, goals, habits, blockWebfonts, LAUNCH, shot } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const items = [];
const created = [];
const inserted = [];

const p = await b.newPage({ viewport: { width: 900, height: 800 } });
await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });

const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals),
  daily_log: "[]", habits_log: JSON.stringify(habits), habits_targets: "{}" };
let nid = 0;

await p.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (req.method() === "POST" && table === "food_items") {
    const row = { ...req.postDataJSON(), id: `f-new-${nid++}`, use_count: 0, last_used_at: null };
    created.push(row);
    items.push(row);
    // createCustomFood ends in .single(), so PostgREST answers with the object
    // itself. Returning a one-element array here sends the app down the
    // import-an-external-food path instead and the spec proves nothing.
    return send(row, 201);
  }
  if (req.method() === "POST" && table === "food_log") {
    const rows = req.postDataJSON().map(r => ({ ...r, id: `row-${nid++}` }));
    inserted.push(...rows);
    return send(rows, 201);
  }
  // touchFood's recency bump. It reads the row back, so answering with a bare
  // {} puts an id-less food in the catalog and React starts warning about
  // duplicate keys — a mock artefact that looks exactly like an app bug.
  if (req.method() === "PATCH" && table === "food_items") {
    const id = (url.searchParams.get("id") || "").replace("eq.", "");
    const i = items.findIndex(f => f.id === id);
    if (i >= 0) items[i] = { ...items[i], ...req.postDataJSON() };
    return send(items[i] || { id });
  }
  if (req.method() !== "GET") return send([{}], 201);
  if (table === "kv_store") {
    const key = (url.searchParams.get("key") || "").replace("eq.", "");
    return send(kv[key] != null ? { value: kv[key] } : null);
  }
  if (table === "food_items") return send(items);
  return send([]);
});
await p.route("**/api/food-search**", (r) => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ foods: [], warnings: [], attribution: [] }) }));

// What a web lookup for a canned drink comes back with: a serving that is
// twelve of its own unit.
let lookups = 0;
await p.route("**/api/food-lookup**", (r) => {
  lookups++;
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    nutrition: { name: "Hazy IPA", brand: "Goose Island", serving_qty: 12, serving_unit: "oz",
      serving_grams: null, cal: 180, protein: 2, carbs: 14, fat: 0, confidence: "high",
      note: "Per 12 fl oz can." },
    sources: [{ title: "gooseisland.com", url: "https://example.invalid/ipa" }],
  }) });
});

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");

const openSheet = async () => {
  await p.locator(".food-section .btn-primary", { hasText: "Food" }).first().click();
  await p.waitForSelector(".food-sheet");
};
const field = (label) => p.locator(".food-custom-grid label")
  .filter({ hasText: new RegExp(`^${label}`) }).locator("input");

// --- the Web button on the search row ---------------------------------------
await openSheet();
const web = p.locator(".food-search-row .scan-btn", { hasText: "Web" });
check("the search row offers a Web button beside Scan", await web.count() === 1);
check("it's disabled until there's something to look up", await web.isDisabled());

await p.locator(".food-search-box input").fill("hazy ipa");
await p.waitForTimeout(900);
check("and enabled once you've typed", !(await web.isDisabled()));
check("the empty state offers the same thing",
  await p.locator(".food-section-empty button", { hasText: "Search the web for it" }).count() === 1);

await web.click();
await p.waitForSelector(".food-custom-grid");
check("tapping it starts the lookup", lookups === 1, `${lookups} lookups`);
await p.waitForSelector(".lookup-result");
check("what you typed becomes the food's name — no retyping",
  (await field("Name").inputValue()).length > 0, await field("Name").inputValue());
check("the serving comes back as the label states it",
  await field("Serving size").inputValue() === "12" && await field("Serving unit").inputValue() === "oz",
  `${await field("Serving size").inputValue()} ${await field("Serving unit").inputValue()}`);
check("with the calories for that serving", await field("Calories").inputValue() === "180",
  await field("Calories").inputValue());
check("backing out returns you to the search, not somewhere else",
  /Back to search/.test(await p.locator(".food-custom .btn-ghost").first().innerText()));

// --- saving it logs the whole serving ---------------------------------------
await p.locator(".food-custom .form-actions .btn-primary", { hasText: "Save & add" }).click();
await p.waitForSelector(".food-sheet", { state: "detached", timeout: 6000 });

check("the food keeps the serving you confirmed", created[0]?.serving_qty === 12 && created[0]?.serving_unit === "oz",
  `${created[0]?.serving_qty} ${created[0]?.serving_unit}`);
check("and one of them is what gets logged — not one ounce of it",
  inserted[0]?.qty === 12 && inserted[0]?.unit === "oz", `${inserted[0]?.qty} ${inserted[0]?.unit}`);
check("so the calories are the whole can", inserted[0]?.cal === 180, `${inserted[0]?.cal} kcal`);
check("and the macros match it", inserted[0]?.protein === 2 && inserted[0]?.carbs === 14,
  `${inserted[0]?.protein}p ${inserted[0]?.carbs}c`);

const row = p.locator(".food-section").first().locator(".food-row").filter({ hasText: "Hazy IPA" });
check("the meal shows it at that amount", /12 oz/.test(await row.innerText()), (await row.innerText()).replace(/\n/g, " · "));

// --- a one-unit serving still behaves, and the amount box still counts -------
await openSheet();
await p.locator(".food-sheet-tabs .toggle-btn", { hasText: "My foods" }).click();
await p.locator(".mine-head button", { hasText: "Add by hand" }).click();
await p.waitForSelector(".food-custom-grid");
await field("Name").fill("Protein shake");
await field("Serving size").fill("1");
await field("Serving unit").fill("scoop");
await field("Calories").fill("110");
await field("Protein \\(g\\)").fill("25");
await field("How many now").fill("2");
await p.locator(".food-custom .form-actions .btn-primary", { hasText: "Save & add" }).click();
await p.waitForSelector(".food-sheet", { state: "detached", timeout: 6000 });

const last = inserted[inserted.length - 1];
check("a serving that's one of its own unit is unchanged", last?.qty === 2 && last?.unit === "scoop",
  `${last?.qty} ${last?.unit}`);
check("two of them is two servings' calories", last?.cal === 220, `${last?.cal} kcal`);

await p.locator(".food-section").first().screenshot({ path: shot("customfood-900.png") });

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
