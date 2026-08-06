// One-tap add from the recently-eaten list, using the amount last logged.
import { chromium } from "playwright";
import { entries, goals, habits , blockWebfonts, LAUNCH, shot } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

// Three foods: one with a remembered portion, one without, and one whose
// remembered unit the food can no longer convert.
let items = [
  { id: "f1", name: "Beef stick", brand: "Simms", source: "custom", source_id: null,
    serving_qty: 1, serving_unit: "stick", serving_grams: 32, alt_servings: [],
    cal: 100, protein: 10, carbs: 0, fat: 6, use_count: 9, last_used_at: "2026-07-31T12:00:00Z",
    last_qty: 3, last_unit: "stick" },
  { id: "f2", name: "Banana", brand: null, source: "custom", source_id: null,
    serving_qty: 1, serving_unit: "medium", serving_grams: 118, alt_servings: [],
    cal: 105, protein: 1.3, carbs: 27, fat: 0.4, use_count: 5, last_used_at: "2026-07-30T12:00:00Z",
    last_qty: null, last_unit: null },
  { id: "f3", name: "Protein shake", brand: "Isopure", source: "custom", source_id: null,
    serving_qty: 1, serving_unit: "scoop", serving_grams: 32, alt_servings: [],
    cal: 110, protein: 25, carbs: 1, fat: 0.5, use_count: 3, last_used_at: "2026-07-29T12:00:00Z",
    last_qty: 2, last_unit: "furlong" },   // stale: the food can't convert this
];
const inserted = [];
const touched = [];

const p = await b.newPage({ viewport: { width: 390, height: 780 } });
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

  if (req.method() === "POST" && table === "food_log") {
    const rows = req.postDataJSON().map(r => ({ ...r, id: `row-${nid++}` }));
    inserted.push(...rows);
    return send(rows, 201);
  }
  if (req.method() === "PATCH" && table === "food_items") {
    const id = (url.searchParams.get("id") || "").replace("eq.", "");
    const patch = req.postDataJSON();
    touched.push({ id, patch });
    items = items.map(f => (f.id === id ? { ...f, ...patch } : f));
    return send(items.find(f => f.id === id));
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
  body: JSON.stringify({ foods: [], warnings: [], attribution: {} }) }));

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");

const openSheet = async () => {
  await p.locator(".food-section .btn-primary", { hasText: "Food" }).first().click();
  await p.waitForSelector(".food-result-row");
};
const rowFor = (name) => p.locator(".food-result-row").filter({ hasText: name }).first();

await openSheet();

// --- the sheet opens on the list, not the keyboard --------------------------
const focus = await p.evaluate(() => {
  const a = document.activeElement;
  return { tag: a?.tagName, inSearch: !!a?.closest?.(".food-search-box") };
});
check("the search box isn't focused on open", !focus.inSearch, JSON.stringify(focus));
check("nothing else grabs focus either", focus.tag !== "INPUT" && focus.tag !== "TEXTAREA", focus.tag);
// Tapping it must still work, of course.
await p.locator(".food-search-box input").click();
check("tapping the search box focuses it", await p.evaluate(() =>
  !!document.activeElement?.closest?.(".food-search-box")));
await p.locator(".food-search-box input").blur();

// --- the button says what it will log --------------------------------------
check("every recent food gets a one-tap button", await p.locator(".food-quick-add").count() >= 3,
  `${await p.locator(".food-quick-add").count()}`);
const desc = async (name) => (await rowFor(name).locator(".food-result-macros").innerText()).trim();

// The button is a bare circle; the amount lives in the row's description.
const btn = await rowFor("Beef stick").locator(".food-quick-add").evaluate((el) => {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return { text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height),
           radius: cs.borderRadius, label: el.getAttribute("aria-label") };
});
check("the add button carries no text", btn.text === "", JSON.stringify(btn.text));
check("it is a circle", btn.w === btn.h && /50%|9999px|999px/.test(btn.radius), `${btn.w}x${btn.h} r=${btn.radius}`);
check("it is still big enough to tap", btn.w >= 36, `${btn.w}px`);
check("and still names the amount for screen readers", /Add 3 stick of Beef stick/.test(btn.label), btn.label);

check("the description shows the amount last logged", (await desc("Beef stick")).startsWith("300 kcal / 3 stick"),
  await desc("Beef stick"));
check("with macros scaled to it, not to one serving", /30p 0c 18f/.test(await desc("Beef stick")),
  await desc("Beef stick"));
check("a food never logged shows its own portion", (await desc("Banana")).startsWith("105 kcal / 1 medium"),
  await desc("Banana"));
check("a remembered unit the food can't convert is ignored",
  (await desc("Protein shake")).startsWith("110 kcal / 1 scoop"), await desc("Protein shake"));

// --- one tap logs it and stays on the list ----------------------------------
const orderBefore = await p.$$eval(".food-result-row .food-result-name", els => els.map(e => e.textContent.trim()));
await rowFor("Beef stick").locator(".food-quick-add").click();
await p.waitForSelector(".food-added-note", { timeout: 6000 });
check("one tap logs it with no quantity step", inserted.length === 1, `${inserted.length} rows`);
check("at the remembered amount", inserted[0]?.qty === 3 && inserted[0]?.unit === "stick",
  `${inserted[0]?.qty} ${inserted[0]?.unit}`);
check("with macros scaled to it", inserted[0]?.cal === 300, `${inserted[0]?.cal} kcal`);
check("the sheet STAYS OPEN", await p.locator(".food-sheet").count() === 1);
const note1 = (await p.locator(".food-added-note").innerText()).trim();
check("it confirms what went in", /1 added/.test(note1) && /3 stick Beef stick/.test(note1), note1);
check("and names the meal", new RegExp("to Breakfast").test(note1), note1);

// The list must not reshuffle under your finger between taps.
const orderAfter = await p.$$eval(".food-result-row .food-result-name", els => els.map(e => e.textContent.trim()));
check("the list keeps its order", JSON.stringify(orderAfter) === JSON.stringify(orderBefore),
  `${JSON.stringify(orderBefore)} -> ${JSON.stringify(orderAfter)}`);

// Add a second and a third without leaving.
await rowFor("Banana").locator(".food-quick-add").click();
await p.waitForTimeout(500);
await rowFor("Protein shake").locator(".food-quick-add").click();
await p.waitForTimeout(500);
check("three foods added in one visit", inserted.length === 3, `${inserted.length}`);
const note3 = (await p.locator(".food-added-note").innerText()).trim();
check("the running list names all three", /3 added/.test(note3) && /Banana/.test(note3) && /Protein shake/.test(note3), note3);
check("still open after three", await p.locator(".food-sheet").count() === 1);
await p.locator(".food-sheet-head .icon-btn").click();
await p.waitForSelector(".food-sheet", { state: "detached", timeout: 6000 });
check("closing is still up to you", await p.locator(".food-sheet").count() === 0);
const row = p.locator(".food-section").first().locator(".food-row").filter({ hasText: "Beef stick" });
check("and it lands in the meal", await row.count() === 1);
check("all three land in the meal",
  await p.locator(".food-section").first().locator(".food-row").count() === 3,
  `${await p.locator(".food-section").first().locator(".food-row").count()}`);

// --- the row still opens the editor ----------------------------------------
await openSheet();
check("a fresh sheet starts with a clean slate", await p.locator(".food-added-note").count() === 0);
await rowFor("Beef stick").locator(".food-result").click();
await p.waitForSelector(".food-pick");
const qty = await p.locator(".food-pick-qty input").first().inputValue();
check("tapping the row opens the quantity step", await p.locator(".food-pick").count() === 1);
check("pre-filled with the remembered amount", qty === "3", qty);
const unitSel = await p.locator(".food-pick-qty select").first().inputValue();
check("and the remembered unit", unitSel === "stick", unitSel);

// Change it, add, and the new amount is what gets remembered.
await p.locator(".food-pick-qty input").first().fill("5");
await p.locator(".food-pick .btn-primary", { hasText: "Add to" }).click();
await p.waitForSelector(".food-sheet", { state: "detached", timeout: 6000 });
check("editing before adding works", inserted[3]?.qty === 5, `${inserted[3]?.qty}`);
check("the quantity step still closes on Add", await p.locator(".food-sheet").count() === 0);

const patch = touched.filter(t => t.id === "f1").pop();
check("the new amount is remembered for next time", patch?.patch?.last_qty === 5 && patch?.patch?.last_unit === "stick",
  JSON.stringify(patch?.patch));
check("and recency is still bumped alongside it", patch?.patch?.use_count > 0 && !!patch?.patch?.last_used_at);

await openSheet();
check("the row now describes the amount just used",
  (await rowFor("Beef stick").locator(".food-result-macros").innerText()).trim().startsWith("500 kcal / 5 stick"),
  await rowFor("Beef stick").locator(".food-result-macros").innerText());

// --- nothing overflows on a phone -------------------------------------------
const spill = await p.evaluate(() => {
  const root = document.querySelector(".food-sheet");
  const rr = root.getBoundingClientRect();
  let w = 0;
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width) w = Math.max(w, r.right - rr.right, rr.left - r.left);
  }
  return Math.round(w);
});
check("the row fits the sheet on a phone", spill <= 1, `${spill}px past the edge`);
await p.locator(".food-sheet").screenshot({ path: shot("quickadd-390.png") });

// --- database results don't get a one-tap add -------------------------------
await p.locator(".food-search-box input").fill("chicken");
await p.waitForTimeout(900);
const dbAdds = await p.locator(".food-result-group", { hasText: "Food database" }).locator(".food-quick-add").count();
check("a food you've never eaten has nothing to remember", dbAdds === 0, `${dbAdds}`);

// --- clearing the search box ------------------------------------------------
const searchBox = p.locator(".food-search-row .food-search-box");
check("the clear button is there once you've typed", await searchBox.locator(".food-search-clear").count() === 1);
await searchBox.locator(".food-search-clear").click();
await p.waitForTimeout(300);
check("it empties the box", await p.locator(".food-search-row .food-search-box input").inputValue() === "",
  await p.locator(".food-search-row .food-search-box input").inputValue());
check("and takes itself away when there's nothing to clear",
  await searchBox.locator(".food-search-clear").count() === 0);
// You clear a search to type another one — the caret has to stay put, or the
// phone's keyboard drops and it's two extra taps.
check("the caret stays in the box",
  await p.evaluate(() => document.activeElement?.tagName === "INPUT"),
  await p.evaluate(() => document.activeElement?.tagName));

await p.locator(".food-sheet-head .icon-btn").click();
await p.waitForSelector(".food-sheet", { state: "detached", timeout: 6000 });

// --- the save tick on a quantity edit reads green ---------------------------
const beef = p.locator(".food-section").first().locator(".food-row").filter({ hasText: "Beef stick" }).first();
await beef.locator(".food-row-actions .icon-btn").first().click();
await p.waitForSelector(".food-row-edit");
const btns = await p.locator(".food-row-edit .icon-btn").evaluateAll(els => els.map(el => ({
  cls: el.className, border: getComputedStyle(el).borderColor, color: getComputedStyle(el).color,
})));
const save = btns.find(x => x.cls.includes("food-row-save"));
const cancel = btns.find(x => x.cls.includes("food-row-cancel"));
check("the save tick is outlined green", save?.border === "rgb(54, 135, 39)", JSON.stringify(save));
check("and its tick is green too", save?.color === "rgb(54, 135, 39)", save?.color);
check("the cancel × is outlined red", cancel?.border === "rgb(199, 58, 47)", JSON.stringify(cancel));
check("and its × is red too", cancel?.color === "rgb(199, 58, 47)", cancel?.color);
check("so keep and discard don't read alike", cancel?.border !== save?.border);

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
