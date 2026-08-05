import { chromium } from "playwright";
import { entries, goals, habits , blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

// 7/29 is synced-only (no daily-log row). 7/28 is a food day: calories in the
// log, steps borrowed from the sync. 7/27 is fully hand-logged.
const METRICS = [
  { date: "7/29/26", cal: null, steps: 12345, weight: null, fat_mass: null, muscle_mass: null },
  { date: "7/28/26", cal: null, steps: 8289, weight: null, fat_mass: null, muscle_mass: null },
];
const DAILY = [
  { date: "7/28/26", cal: 1850, steps: null, weight: null, fatMass: null, muscleMass: null, calSource: "food" },
  { date: "7/27/26", cal: 1900, steps: 7000, weight: 152.4, fatMass: 27.6, muscleMass: 167, calSource: "manual" },
];

let saved = null; // last daily_log blob written back
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
 await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });

const kv = {
  entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals),
  daily_log: JSON.stringify(DAILY), habits_log: JSON.stringify(habits), habits_targets: "{}",
};
await p.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() !== "GET") {
    const payload = req.postDataJSON?.();
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (table === "kv_store" && row?.key === "daily_log") { saved = JSON.parse(row.value); kv.daily_log = row.value; }
    return send([row || {}], 201);
  }
  if (table === "kv_store") {
    const key = (url.searchParams.get("key") || "").replace("eq.", "");
    return send(kv[key] != null ? { value: kv[key] } : null);
  }
  if (table === "daily_metrics") return send(METRICS);
  return send([]);
});

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Daily" }).click();
await p.waitForSelector(".table-wrap table tbody tr");

const rowFor = (date) => p.locator(".table-wrap table tbody tr").filter({ hasText: date }).first();
const cellText = async (date, i) => (await rowFor(date).locator("td").nth(i).innerText()).trim();
const COL = { cal: 1, steps: 2, weight: 3, fatMass: 4, muscleMass: 5 };
const dayIn = (date) => (saved || DAILY).find(r => r.date === date);

async function edit(date, col, text, key = "Enter") {
  await rowFor(date).locator("td").nth(COL[col]).dblclick();
  const input = p.locator(".cell-input");
  await input.waitFor({ timeout: 3000 });
  await input.fill(text);
  await input.press(key);
  await p.waitForTimeout(250);
}

// --- the date column is not a cell ----------------------------------------
check("the date column isn't editable", await rowFor("7/27/26").locator("td").nth(0).evaluate(el => !el.className.includes("cell-edit")));
check("every value column is", await rowFor("7/27/26").locator("td.cell-edit").count() === 5,
  `${await rowFor("7/27/26").locator("td.cell-edit").count()} cells`);

// --- editing a plain hand-logged day ---------------------------------------
await edit("7/27/26", "weight", "151.2");
check("a typed value lands in the table", await cellText("7/27/26", COL.weight) === "151.2", await cellText("7/27/26", COL.weight));
check("and is persisted", dayIn("7/27/26")?.weight === 151.2, JSON.stringify(dayIn("7/27/26")?.weight));
check("without disturbing its neighbours", dayIn("7/27/26")?.fatMass === 27.6 && dayIn("7/27/26")?.steps === 7000);

// --- undo -------------------------------------------------------------------
check("an undo offer appears", await p.locator(".cell-undo").count() === 1);
check("it names what changed", /Weight on 7\/27\/26/.test(await p.locator(".cell-undo span").innerText()),
  await p.locator(".cell-undo span").innerText());
await p.locator(".cell-undo .btn-ghost").click();
await p.waitForTimeout(250);
check("undo puts the old value back", await cellText("7/27/26", COL.weight) === "152.4", await cellText("7/27/26", COL.weight));
check("and persists the rollback", dayIn("7/27/26")?.weight === 152.4);
check("the offer clears once used", await p.locator(".cell-undo").count() === 0);

// --- typing a calorie number claims the day from the Food tab --------------
await edit("7/27/26", "cal", "2000");
check("editing calories marks the day manual", dayIn("7/27/26")?.calSource === "manual", dayIn("7/27/26")?.calSource);

// --- a synced-only day has no log row yet ----------------------------------
check("the synced day starts with no log row", !DAILY.some(r => r.date === "7/29/26"));
await edit("7/29/26", "weight", "150");
check("typing into a synced day starts a log row", dayIn("7/29/26")?.weight === 150, JSON.stringify(dayIn("7/29/26")));
check("its synced steps survive that", await cellText("7/29/26", COL.steps) === "12,345", await cellText("7/29/26", COL.steps));
check("and aren't copied into the log", dayIn("7/29/26")?.steps == null, JSON.stringify(dayIn("7/29/26")?.steps));

// --- a borrowed value can be overridden but not blanked --------------------
check("the food day borrows its steps", await cellText("7/28/26", COL.steps) === "8,289");
await edit("7/28/26", "steps", "");
check("blanking a borrowed number is refused", await p.locator(".banner-error").count() >= 1);
check("with a reason", /HealthKit sync/.test(await p.locator(".banner-error").first().innerText()),
  await p.locator(".banner-error").first().innerText());
check("the editor stays open on a refusal", await p.locator(".cell-input").count() === 1);
await p.keyboard.press("Escape");
await p.waitForTimeout(150);
check("and the number stays put", await cellText("7/28/26", COL.steps) === "8,289", await cellText("7/28/26", COL.steps));
await edit("7/28/26", "steps", "9000");
check("overriding it does work", dayIn("7/28/26")?.steps === 9000, JSON.stringify(dayIn("7/28/26")?.steps));

// --- blanking your own value ------------------------------------------------
await edit("7/27/26", "fatMass", "");
check("emptying your own cell blanks the day", dayIn("7/27/26")?.fatMass === null, JSON.stringify(dayIn("7/27/26")?.fatMass));
check("and it shows as blank, not zero", await cellText("7/27/26", COL.fatMass) === "–", await cellText("7/27/26", COL.fatMass));

// --- a real zero is not the same as blank ----------------------------------
await edit("7/27/26", "fatMass", "0");
check("a typed zero is kept as zero", dayIn("7/27/26")?.fatMass === 0, JSON.stringify(dayIn("7/27/26")?.fatMass));
check("and renders as 0", await cellText("7/27/26", COL.fatMass) === "0", await cellText("7/27/26", COL.fatMass));

// --- rubbish is refused -----------------------------------------------------
const before = dayIn("7/27/26")?.steps;
await edit("7/27/26", "steps", "abc");
check("non-numbers are refused", dayIn("7/27/26")?.steps === before, `${before} -> ${dayIn("7/27/26")?.steps}`);
check("the editor stays open to fix it", await p.locator(".cell-input").count() === 1);
check("and says why", /isn't a number/.test(await p.locator(".banner-error").first().innerText()));
await p.keyboard.press("Escape");
check("Escape backs out", await p.locator(".cell-input").count() === 0);

// --- Tab walks the row, then wraps to the next --------------------------------
await rowFor("7/27/26").locator("td").nth(COL.cal).dblclick();
await p.locator(".cell-input").waitFor();
await p.locator(".cell-input").press("Tab");
await p.waitForTimeout(200);
let at = await p.locator(".cell-input").evaluate(el => el.getAttribute("aria-label"));
check("Tab moves to the next column", at === "Steps on 7/27/26", at);
await p.locator(".cell-input").press("Shift+Tab");
await p.waitForTimeout(200);
at = await p.locator(".cell-input").evaluate(el => el.getAttribute("aria-label"));
check("Shift+Tab moves back", at === "Calories on 7/27/26", at);

await p.keyboard.press("Escape");

// Walking off the end of a row lands on the next row down. 7/29 is the top
// row, so there is one; off the last row it closes instead.
await rowFor("7/29/26").locator("td").nth(COL.muscleMass).dblclick();
await p.locator(".cell-input").waitFor();
await p.locator(".cell-input").press("Tab");
await p.waitForTimeout(250);
at = await p.locator(".cell-input").evaluate(el => el.getAttribute("aria-label"));
check("Tab off the row's end wraps to the row below", at === "Calories on 7/28/26", at);
await p.keyboard.press("Escape");

const last = await p.locator(".table-wrap table tbody tr").last().locator("td").nth(0).innerText();
await rowFor(last.trim().split(/\s/)[0]).locator("td").nth(COL.muscleMass).dblclick();
await p.locator(".cell-input").waitFor();
await p.locator(".cell-input").press("Tab");
await p.waitForTimeout(250);
check("Tab off the very last cell just closes the editor", await p.locator(".cell-input").count() === 0);

// --- clicking away commits ----------------------------------------------------
await rowFor("7/27/26").locator("td").nth(COL.muscleMass).dblclick();
await p.locator(".cell-input").waitFor();
await p.locator(".cell-input").fill("168.5");
await p.locator(".panel-title").first().click();
await p.waitForTimeout(300);
check("clicking away saves rather than discarding", dayIn("7/27/26")?.muscleMass === 168.5, JSON.stringify(dayIn("7/27/26")?.muscleMass));

// --- opening an editor doesn't move the table around -------------------------
const widths = () => p.$$eval(".table-wrap table thead th", ths => ths.map(t => Math.round(t.getBoundingClientRect().width)));
const numberLefts = () => p.$$eval(".table-wrap table tbody tr td.cell-edit",
  tds => tds.map(t => Math.round(t.getBoundingClientRect().left)));
const wBefore = await widths(), xBefore = await numberLefts();
await rowFor("7/27/26").locator("td").nth(COL.muscleMass).dblclick();
await p.locator(".cell-input").waitFor();
check("editing a cell doesn't resize its column", JSON.stringify(await widths()) === JSON.stringify(wBefore),
  `${wBefore.join("/")} → ${(await widths()).join("/")}`);
check("and doesn't shift the other cells sideways", JSON.stringify(await numberLefts()) === JSON.stringify(xBefore));

// --- with an editor open, one click is enough to move to another cell --------
await rowFor("7/27/26").locator("td").nth(COL.weight).click();
await p.waitForTimeout(250);
at = await p.locator(".cell-input").evaluate(el => el.getAttribute("aria-label"));
check("a single click moves the editor while one is open", at === "Weight on 7/27/26", at);
check("only one editor is open at a time", await p.locator(".cell-input").count() === 1);
check("and the cell it moved to is focused, ready to type",
  await p.evaluate(() => document.activeElement?.className.includes("cell-input")));
await p.locator(".cell-input").press("Escape");
await p.waitForTimeout(150);

// Back to needing the double-click once nothing is being edited — otherwise
// every stray tap on the table opens something.
await rowFor("7/27/26").locator("td").nth(COL.cal).click();
await p.waitForTimeout(200);
check("a single click on its own still does nothing", await p.locator(".cell-input").count() === 0);

// A refused value keeps the editor where it is; the click that caused the
// refusal must not carry you off it and lose the error.
await rowFor("7/27/26").locator("td").nth(COL.cal).dblclick();
await p.locator(".cell-input").waitFor();
await p.locator(".cell-input").fill("abc");
await rowFor("7/27/26").locator("td").nth(COL.steps).click();
await p.waitForTimeout(250);
at = await p.locator(".cell-input").evaluate(el => el.getAttribute("aria-label"));
check("a refused edit holds the editor in place", at === "Calories on 7/27/26", at);
check("and the complaint is still on screen", /isn't a number/.test(await p.locator(".banner-error").first().innerText()));
await p.keyboard.press("Escape");

// --- touch: one tap, because iOS spends double-tap on zoom -------------------
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
const m = await ctx.newPage();
m.on("pageerror", e => bad.push("touch pageerror: " + e.message));
await m.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (req.method() !== "GET") return send([{}], 201);
  if (table === "kv_store") {
    const key = (url.searchParams.get("key") || "").replace("eq.", "");
    return send(kv[key] != null ? { value: kv[key] } : null);
  }
  if (table === "daily_metrics") return send(METRICS);
  return send([]);
});
await m.goto("http://localhost:5199", { waitUntil: "networkidle" });
await m.locator(".tab-btn", { hasText: "Daily" }).click();
await m.waitForSelector(".table-wrap table tbody tr");

check("touch: the hint says tap, not double-click", /^Tap a number/.test((await m.locator(".table-hint").innerText()).trim()),
  (await m.locator(".table-hint").innerText()).slice(0, 40));

await m.locator(".table-wrap table tbody tr").filter({ hasText: "7/27/26" }).first().locator("td").nth(COL.weight).tap();
check("touch: one tap opens the editor", await m.locator(".cell-input").count() === 1);
const kb = await m.locator(".cell-input").getAttribute("inputmode");
check("touch: weight gets the decimal keypad", kb === "decimal", kb);
await m.locator(".cell-input").press("Escape");

await m.locator(".table-wrap table tbody tr").filter({ hasText: "7/27/26" }).first().locator("td").nth(COL.cal).tap();
check("touch: calories gets the plain number pad", await m.locator(".cell-input").getAttribute("inputmode") === "numeric");
await m.locator(".cell-input").press("Escape");

const spill = await m.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
check("touch: the page still doesn't scroll sideways", spill <= 1, `${spill}px`);

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
