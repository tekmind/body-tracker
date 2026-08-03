// Reproduce: edit an existing food using a photo of its label, then look for
// it again in My foods and in Search.
import { chromium } from "playwright";
import { entries, goals, habits, foodItems , blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

// The food as it would have arrived from Open Food Facts: has a source_id.
const SWISS = {
  id: "swiss1", name: "Swiss Cheese Slices", brand: "Great Value",
  source: "off", source_id: "0078742000000",
  serving_qty: 1, serving_unit: "slice", serving_grams: 22, alt_servings: [],
  cal: 80, protein: 6, carbs: 0, fat: 6,
  use_count: 3, last_used_at: "2026-07-30T12:00:00Z",
};
let items = [SWISS, ...foodItems];
const patches = [];

const p = await b.newPage({ viewport: { width: 390, height: 780 } });
 await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });

const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals),
  daily_log: "[]", habits_log: JSON.stringify(habits), habits_targets: "{}" };

await p.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (req.method() === "PATCH" && table === "food_items") {
    const id = (url.searchParams.get("id") || "").replace("eq.", "");
    const patch = req.postDataJSON();
    patches.push({ id, patch });
    items = items.map(f => (f.id === id ? { ...f, ...patch } : f));
    return send(items.find(f => f.id === id));
  }
  if (req.method() !== "GET") return send([{}], 201);
  if (table === "kv_store") {
    const key = (url.searchParams.get("key") || "").replace("eq.", "");
    return send(kv[key] != null ? { value: kv[key] } : null);
  }
  if (table === "food_items") return send(items);
  if (table === "food_meals" || table === "food_log" || table === "daily_metrics") return send([]);
  return send([]);
});

// What the label reader gives back for the package in hand.
await p.route("**/api/food-label", (r) => r.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ nutrition: {
    // What actually happened: the package prints a variant of the name.
    name: "Sliced Swiss", brand: "Great Value",
    serving_qty: 1, serving_unit: "slice", serving_grams: 21,
    cal: 70, protein: 5, carbs: 1, fat: 5,
    confidence: "high", note: "", servings_per_container: 12,
  } }),
}));
await p.route("**/api/food-search**", (r) => r.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ foods: [], warnings: [], attribution: {} }),
}));

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");
await p.locator(".food-section .btn-primary", { hasText: "Food" }).first().click();
await p.locator(".food-sheet-tabs .toggle-btn", { hasText: "My foods" }).click();
await p.waitForSelector(".mine-row");

const named = async () => p.$$eval(".mine-row", rows => rows.map(r => r.textContent));
check("the food is in My foods to begin with", (await named()).some(t => /Swiss Cheese Slices/.test(t)));

// Edit it, then read the label from inside the edit form.
const row = p.locator(".mine-row").filter({ hasText: "Swiss Cheese Slices" }).first();
await row.locator(".icon-btn").first().click();
await p.waitForSelector(".food-custom-grid");
check("the edit form opened on that food", await p.locator(".form-actions .btn-primary").innerText() === "Save changes",
  await p.locator(".form-actions .btn-primary").innerText());

// A real 1x1 JPEG: fileToScaledJpeg decodes before upload, so a fake buffer
// fails silently and the form is never filled — which looks like a pass.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
await p.setInputFiles('input[type=file][accept="image/*"]', {
  name: "label.jpg", mimeType: "image/jpeg", buffer: JPEG,
});
await p.waitForSelector(".lookup-note, .form-error", { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(600);
const readErr = await p.locator(".food-custom-panel .form-error, .lookup-card .form-error").count().catch(() => 0);
check("the label was read without error", readErr === 0);

check("it is still an edit, not a new food",
  (await p.locator(".form-actions .btn-primary").innerText()).includes("Save changes"),
  await p.locator(".form-actions .btn-primary").innerText());
const nameVal = await p.locator(".food-custom-grid input").first().inputValue();
check("the name survives the label read", nameVal === "Swiss Cheese Slices", JSON.stringify(nameVal));

// It shouldn't hide the disagreement — just refuse to act on it unasked.
check("the name it read is surfaced", await p.locator(".lookup-rename").count() === 1);
check("and it says which name that was", /Sliced Swiss/.test(await p.locator(".lookup-rename").innerText()),
  await p.locator(".lookup-rename").innerText());

await p.locator(".form-actions .btn-primary").click();
await p.waitForTimeout(600);

console.log("PATCH sent:", JSON.stringify(patches, null, 1));
check("exactly one update was sent", patches.length === 1, `${patches.length}`);
check("it kept the name", patches[0]?.patch?.name === "Swiss Cheese Slices", JSON.stringify(patches[0]?.patch?.name));
check("it took the label's calories", patches[0]?.patch?.cal === 70, JSON.stringify(patches[0]?.patch?.cal));

// The thing the user reported.
await p.waitForSelector(".mine-row");
const after = await named();
console.log("My foods after:", JSON.stringify(after.filter(t => /Swiss|Cheese/.test(t))));
check("the food is STILL in My foods", after.some(t => /Swiss Cheese Slices/.test(t)), after.length + " rows");

await p.locator(".mine-filter input").fill("swiss");
await p.waitForTimeout(300);
check("and is findable by filtering for swiss", await p.locator(".mine-row").count() >= 1,
  `${await p.locator(".mine-row").count()} rows`);
await p.locator(".mine-filter input").fill("");

// Where does it sit in the order? Recents are sorted by last_used_at.
const first = (await named())[0];
console.log("top of My foods:", JSON.stringify(first?.slice(0, 60)));
check("its recency wasn't wiped by the edit", patches[0]?.patch?.last_used_at === undefined,
  JSON.stringify(patches[0]?.patch?.last_used_at));
check("nor its use count", patches[0]?.patch?.use_count === undefined,
  JSON.stringify(patches[0]?.patch?.use_count));

// --- taking the label's name is still one tap away --------------------------
const row2 = p.locator(".mine-row").filter({ hasText: "Swiss Cheese Slices" }).first();
await row2.locator(".icon-btn").first().click();
await p.waitForSelector(".food-custom-grid");
await p.setInputFiles('input[type=file][accept="image/*"]', { name: "l.jpg", mimeType: "image/jpeg", buffer: JPEG });
await p.waitForSelector(".lookup-rename", { timeout: 8000 });
await p.locator(".lookup-rename button").click();
await p.waitForTimeout(200);
check("Use it adopts the label's name", await p.locator(".food-custom-grid input").first().inputValue() === "Sliced Swiss",
  await p.locator(".food-custom-grid input").first().inputValue());
check("and the offer clears once taken", await p.locator(".lookup-rename").count() === 0);
await p.locator(".form-actions .btn-primary").click();
await p.waitForTimeout(500);
check("that rename is saved when asked for", patches[1]?.patch?.name === "Sliced Swiss",
  JSON.stringify(patches[1]?.patch?.name));

// --- creating a new food from a label still takes its name -----------------
await p.locator(".food-sheet-tabs .toggle-btn", { hasText: "My foods" }).click();
await p.waitForSelector(".mine-head");
await p.locator(".mine-head .btn-primary", { hasText: "Photo of label" }).click();
await p.setInputFiles('input[type=file][accept="image/*"]', { name: "l.jpg", mimeType: "image/jpeg", buffer: JPEG });
await p.waitForTimeout(1500);
check("a brand-new food does take the label's name",
  await p.locator(".food-custom-grid input").first().inputValue() === "Sliced Swiss",
  await p.locator(".food-custom-grid input").first().inputValue());
check("with nothing to second-guess", await p.locator(".lookup-rename").count() === 0);

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
