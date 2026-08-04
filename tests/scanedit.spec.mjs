// Scanning a barcode, then correcting the name it comes back with.
//
// Barcode databases name things the way the manufacturer registered them —
// "GOOSE ISLAND BEER CO., HAZY BEER HUG IPA, HAZY" — which is not what you'd
// search for a week later. The quantity step lets you fix it before it's
// saved; picking a food off a list does not, because that name is already
// the one you filed it under.
import { chromium } from "playwright";
import { entries, goals, habits, foodItems, blockWebfonts, LAUNCH, shot } from "./seed.mjs";

const b = await chromium.launch({
  ...LAUNCH,
  // getUserMedia has to resolve or the scanner never gets past "Starting
  // camera…" and the decoder is never wired up.
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const items = [...foodItems];
const created = [];
const inserted = [];

const p = await b.newPage({ viewport: { width: 900, height: 800 } });
await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });

// A fake decoder: the scanner prefers the native BarcodeDetector when the
// browser has one, so providing it is the whole of "a barcode was seen".
await p.addInitScript(() => {
  window.BarcodeDetector = class {
    async detect() { return [{ rawValue: "0083783375213" }]; }
  };
});

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
    return send(row, 201);   // .single(), so the object itself
  }
  if (req.method() === "POST" && table === "food_log") {
    const rows = req.postDataJSON().map(r => ({ ...r, id: `row-${nid++}` }));
    inserted.push(...rows);
    return send(rows, 201);
  }
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
  if (table === "food_items") {
    // importExternalFood looks for an existing copy by source + source_id
    // through .maybeSingle(), so the filter has to be honoured — answering
    // with the whole list makes it think the food is already saved.
    const sourceId = (url.searchParams.get("source_id") || "").replace("eq.", "");
    if (sourceId) return send(items.filter(f => String(f.source_id) === sourceId)[0] || null);
    return send(items);
  }
  return send([]);
});
await p.route("**/api/food-search**", (route) => {
  const url = new URL(route.request().url());
  const send = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (url.searchParams.get("barcode")) {
    return send({ food: {
      name: "GOOSE ISLAND BEER CO., HAZY BEER HUG IPA, HAZY", brand: "Goose Island Beer Co.",
      source: "off", source_id: "0083783375213",
      // The shape parseServingText() in api/_food.js actually produces for
      // "355 ml (12 fl oz)": a serving with a gram weight, never a mass unit
      // standing in as the serving's own unit.
      serving_qty: 1, serving_unit: "serving", serving_grams: 355, alt_servings: [],
      cal: 180, protein: 2, carbs: 14, fat: 0,
    } });
  }
  return send({ foods: [], warnings: [], attribution: [] });
});

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");

const openSheet = async () => {
  await p.locator(".food-section .btn-primary", { hasText: "Food" }).first().click();
  await p.waitForSelector(".food-sheet");
};
const field = (label) => p.locator(".food-pick-edit label").filter({ hasText: new RegExp(`^${label}`) }).locator("input");

// --- picking off a list leaves the name alone -------------------------------
await openSheet();
await p.locator(".food-result").first().click();
await p.waitForSelector(".food-pick");
check("a food picked off the list isn't renameable here", await p.locator(".food-pick-edit").count() === 0);
check("it just shows what it's called", await p.locator(".food-pick-name").count() === 1);
await p.locator(".food-pick .btn-ghost", { hasText: "Back" }).click();

// --- a scan opens the same step, with the name editable ---------------------
await p.locator(".food-search-row .scan-btn", { hasText: "Scan" }).click();
await p.waitForSelector(".food-pick", { timeout: 15000 });
check("the scanner hands off into the quantity step", await p.locator(".food-pick").count() === 1);
check("and the name is editable there", await p.locator(".food-pick-edit").count() === 1);
check("pre-filled with what the barcode came back with",
  /HAZY BEER HUG/.test(await field("Name").inputValue()), await field("Name").inputValue());
check("brand too", await field("Brand").inputValue() === "Goose Island Beer Co.",
  await field("Brand").inputValue());
check("the serving it found is still there", /180 kcal/.test(await p.locator(".food-pick-serving").innerText()),
  await p.locator(".food-pick-serving").innerText());

await p.locator(".food-sheet").screenshot({ path: shot("scanedit-900.png") });

// --- what you type is what gets saved ---------------------------------------
await field("Name").fill("Hazy Beer Hug");
await field("Brand").fill("Goose Island");
await p.locator(".food-pick .btn-primary", { hasText: "Add to" }).click();
await p.waitForSelector(".food-sheet", { state: "detached", timeout: 6000 });

check("the food is saved under the name you typed", created[0]?.name === "Hazy Beer Hug", created[0]?.name);
check("with the brand you typed", created[0]?.brand === "Goose Island", created[0]?.brand);
check("the log row reads the same", inserted[0]?.name === "Hazy Beer Hug", inserted[0]?.name);
check("and the barcode's nutrition survived the rename", inserted[0]?.cal === 180, `${inserted[0]?.cal} kcal`);
check("logged at the serving the barcode declared", inserted[0]?.qty === 1 && inserted[0]?.unit === "serving",
  `${inserted[0]?.qty} ${inserted[0]?.unit}`);

const row = p.locator(".food-section").first().locator(".food-row").filter({ hasText: "Hazy Beer Hug" });
check("and that's what the meal shows", await row.count() === 1);

// --- clearing the name keeps the barcode's, rather than saving nothing ------
await openSheet();
await p.locator(".food-search-row .scan-btn", { hasText: "Scan" }).click();
await p.waitForSelector(".food-pick", { timeout: 15000 });
await field("Name").fill("");
await field("Brand").fill("");
await p.locator(".food-pick .btn-primary", { hasText: "Add to" }).click();
await p.waitForSelector(".food-sheet", { state: "detached", timeout: 6000 });

const last = inserted[inserted.length - 1];
check("a blank name falls back to the barcode's, never empty", /HAZY BEER HUG/.test(last?.name || ""), last?.name);
check("a blank brand does clear, though", last?.brand === null, JSON.stringify(last?.brand));

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
