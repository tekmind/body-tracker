import { chromium } from "playwright";
import { mock, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const p = await b.newPage({ viewport: { width: 390, height: 780 } });
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });
await mock(p);

// The shared mock answers every write with [], which is fine for reads but
// loses the inserted rows — echo them back so the log actually grows.
let nid = 0;
await p.route("**/rest/v1/food_log**", (r) => {
  if (r.request().method() !== "POST") return r.fallback();
  const rows = r.request().postDataJSON().map(row => ({ ...row, id: `new-${nid++}` }));
  return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(rows) });
});

// The parse endpoint: two foods, both matched out of the sent history.
await p.route("**/api/food-parse", (r) => r.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({
    section: "lunch",
    items: [
      { query: "can of tuna", history_id: "f2", quantity: 1, unit: "can", candidates: [], note: "" },
      { query: "cup of rice", history_id: "f1", quantity: 1, unit: "cup", candidates: [], note: "" },
    ],
  }),
}));

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");

// --- collapsed: one button, and nothing else -------------------------------
const trigger = p.locator(".food-ai-trigger");
check("the entry box is a single button", await trigger.count() === 1);
const box = await trigger.boundingBox();
check("collapsed it is one row tall", box.height <= 60, `${Math.round(box.height)}px`);
check("it spans the column", box.width >= 350, `${Math.round(box.width)}px`);

const skin = await trigger.evaluate((el) => {
  const cs = getComputedStyle(el);
  const lbl = getComputedStyle(el.querySelector(".fat-label"));
  const r = el.getBoundingClientRect();
  // How far off-centre everything visible inside the button sits, taken
  // together — the icon counts, so measuring the label alone would lie.
  let lo = Infinity, hi = -Infinity;
  for (const c of el.children) {
    const cr = c.getBoundingClientRect();
    if (!cr.width) continue;
    lo = Math.min(lo, cr.left); hi = Math.max(hi, cr.right);
  }
  return {
    bg: cs.backgroundColor, colour: cs.color, label: lbl.color, justify: cs.justifyContent,
    border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
    skew: Math.round(Math.abs((lo + hi) / 2 - (r.left + r.right) / 2)),
  };
});
check("the button is outlined, not filled", skin.bg === "rgb(255, 255, 255)" && skin.border === "1px rgb(93, 97, 103)",
  `${skin.bg}, border ${skin.border}`);
check("its text is dark", skin.colour === "rgb(22, 24, 29)" && skin.label === "rgb(22, 24, 29)",
  `${skin.colour} / ${skin.label}`);
check("its contents are centred", skin.justify === "center" && skin.skew <= 2, `${skin.justify}, ${skin.skew}px off`);

check("no textarea on the page while collapsed", await p.locator(".food-ai-input").count() === 0);
check("no Add-to-log button while collapsed", await p.locator(".food-ai-actions").count() === 0);
check("no mic panel while collapsed", await p.locator(".mic-btn").count() === 0);

// The point of the change: the first meal now starts inside the first screen.
const firstMeal = await p.locator(".food-section").first().boundingBox();
check("the first meal section is above the fold", firstMeal.y < 780, `starts at y=${Math.round(firstMeal.y)}`);

// And the button sits between the tiles and the first meal, where the panel was.
const lastTile = await p.locator(".macro-tile").last().boundingBox();
check("the button sits under the macro tiles", box.y >= lastTile.y + lastTile.height - 2 && box.y < firstMeal.y,
  `tiles end ${Math.round(lastTile.y + lastTile.height)}, button ${Math.round(box.y)}, meal ${Math.round(firstMeal.y)}`);

// --- tapping it pulls up everything else -----------------------------------
await trigger.click();
await p.waitForSelector(".food-ai-sheet", { timeout: 4000 });
check("tapping opens a sheet", await p.locator(".food-ai-sheet").count() === 1);
check("the textarea comes with it", await p.locator(".food-ai-input").count() === 1);
check("so does Add to log", await p.locator(".food-ai-actions .btn-primary").count() === 1);

const back = await p.locator(".food-sheet-backdrop").evaluate((el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { pos: cs.position, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
});
check("the sheet is a fixed overlay covering the viewport",
  back.pos === "fixed" && back.w >= back.vw - 1 && back.h >= back.vh - 1,
  `${back.pos} ${Math.round(back.w)}x${Math.round(back.h)}`);

// On a phone it rises from the bottom rather than eating the whole screen.
const sheetBox = await p.locator(".food-ai-sheet").boundingBox();
check("the sheet is only as tall as it needs to be", sheetBox.height < 780 * 0.8, `${Math.round(sheetBox.height)}px of 780`);
check("it is anchored to the bottom", sheetBox.y + sheetBox.height >= 779, `bottom at ${Math.round(sheetBox.y + sheetBox.height)}`);

// Nothing spills sideways.
const spill = await p.evaluate(() => {
  const root = document.querySelector(".food-ai-sheet");
  const rr = root.getBoundingClientRect();
  let w = 0;
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width) w = Math.max(w, r.right - rr.right, rr.left - r.left);
  }
  return Math.round(w);
});
check("nothing spills out of the sheet", spill <= 1, `${spill}px past the edge`);

check("Add to log is disabled with nothing typed",
  await p.locator(".food-ai-actions .btn-primary").isDisabled());

// --- closing puts it back --------------------------------------------------
await p.locator(".food-ai-sheet .icon-btn").click();
await p.waitForSelector(".food-ai-sheet", { state: "detached" });
check("the X closes it", await p.locator(".food-ai-input").count() === 0);

await trigger.click();
await p.waitForSelector(".food-ai-sheet");
await p.locator(".food-sheet-backdrop").click({ position: { x: 195, y: 40 } });
await p.waitForSelector(".food-ai-sheet", { state: "detached" });
check("tapping outside closes it too", await p.locator(".food-ai-input").count() === 0);

// --- the parse flow still works, end to end --------------------------------
const lunchBefore = await p.locator(".food-section").nth(1).locator(".food-row").count();

await trigger.click();
await p.waitForSelector(".food-ai-input");
await p.locator(".food-ai-input").fill("a can of tuna and a cup of white rice");
await p.locator(".food-ai-actions .btn-primary").click();

await p.waitForSelector(".food-review", { timeout: 8000 });
check("the sheet gets out of the way once it has parsed", await p.locator(".food-ai-sheet").count() === 0);
check("the review card lands on the page", await p.locator(".food-review-row").count() === 2,
  `${await p.locator(".food-review-row").count()} rows`);
const head = await p.locator(".food-review-head strong").innerText();
check("it says what went where", head === "Added 2 items to Lunch", head);

const lunchAfter = await p.locator(".food-section").nth(1).locator(".food-row").count();
check("the foods are actually in the meal", lunchAfter === lunchBefore + 2, `${lunchBefore} -> ${lunchAfter}`);

// The review card is a card in its own right now that the panel is gone.
const rev = await p.locator(".food-review").evaluate((el) => {
  const cs = getComputedStyle(el);
  return { r: cs.borderRadius, bg: cs.backgroundColor, bw: cs.borderTopWidth };
});
check("the review card still reads as a card", rev.bw !== "0px" && rev.r !== "0px", JSON.stringify(rev));

// Undo takes them back out.
await p.locator(".food-review-head .btn-ghost").click();
await p.waitForSelector(".food-review", { state: "detached" });
const lunchUndone = await p.locator(".food-section").nth(1).locator(".food-row").count();
check("Undo all removes them again", lunchUndone === lunchBefore, `${lunchUndone} vs ${lunchBefore}`);

// --- the mic path ----------------------------------------------------------
// Headless Chromium ships no SpeechRecognition, so the browser that has one is
// only reachable through a stub — and it's the whole point of the button.
const m = await b.newPage({ viewport: { width: 390, height: 780 } });
m.on("pageerror", e => bad.push("mic pageerror: " + e.message));
await m.addInitScript(() => {
  window.SpeechRecognition = class {
    start() { window.__started = (window.__started || 0) + 1; window.__sr = this; }
    stop() { window.__stopped = (window.__stopped || 0) + 1; this.onend?.(); }
  };
});
await mock(m);
await m.goto("http://localhost:5199", { waitUntil: "networkidle" });
await m.locator(".tab-btn", { hasText: "Food" }).click();
await m.waitForSelector(".food-ai-trigger");

await m.locator(".food-ai-trigger").click();
await m.waitForSelector(".food-ai-sheet");
check("one tap opens the sheet and starts listening", await m.evaluate(() => window.__started) === 1);
check("the mic shows it is listening", await m.locator(".mic-btn.listening").count() === 1);
const micLabel = await m.locator(".mic-btn").innerText();
check("and says how to stop", /tap to stop/i.test(micLabel), micLabel);

// What the recognizer hears lands in the box.
await m.evaluate(() => {
  window.__sr.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "a can of tuna" }, length: 1 }] });
});
check("speech fills the textarea", (await m.locator(".food-ai-input").inputValue()) === "a can of tuna",
  await m.locator(".food-ai-input").inputValue());
check("Add to log wakes up once there is something to parse",
  !(await m.locator(".food-ai-actions .btn-primary").isDisabled()));

// Tapping the mic again stops it without closing the sheet.
await m.locator(".mic-btn").click();
check("tapping the mic stops it", await m.evaluate(() => window.__stopped) === 1);
check("stopping doesn't close the sheet", await m.locator(".food-ai-sheet").count() === 1);
check("the mic goes back to idle", await m.locator(".mic-btn.listening").count() === 0);

// A mic left running is stopped when the sheet is dismissed.
await m.locator(".mic-btn").click();
check("it can be restarted", await m.evaluate(() => window.__started) === 2);
await m.locator(".food-ai-sheet .icon-btn").click();
await m.waitForSelector(".food-ai-sheet", { state: "detached" });
check("closing the sheet stops the mic", await m.evaluate(() => window.__stopped) === 2);

// --- desktop: the button doesn't grow into a panel -------------------------
const d = await b.newPage({ viewport: { width: 1200, height: 900 } });
d.on("pageerror", e => bad.push("desktop pageerror: " + e.message));
await mock(d);
await d.goto("http://localhost:5199", { waitUntil: "networkidle" });
await d.locator(".tab-btn", { hasText: "Food" }).click();
await d.waitForSelector(".food-ai-trigger");
const dbox = await d.locator(".food-ai-trigger").boundingBox();
check("desktop: still one row", dbox.height <= 60, `${Math.round(dbox.height)}px`);
const hint = await d.locator(".fat-hint").isVisible();
check("desktop: the hint text is kept", hint);
const dskin = await d.locator(".food-ai-trigger").evaluate((el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  let lo = Infinity, hi = -Infinity;
  for (const c of el.children) { const cr = c.getBoundingClientRect(); if (!cr.width) continue; lo = Math.min(lo, cr.left); hi = Math.max(hi, cr.right); }
  return { bg: cs.backgroundColor, colour: cs.color, border: `${cs.borderTopWidth} ${cs.borderTopColor}`, skew: Math.round(Math.abs((lo + hi) / 2 - (r.left + r.right) / 2)) };
});
check("desktop: still outlined with dark text", dskin.bg === "rgb(255, 255, 255)" && dskin.border === "1px rgb(93, 97, 103)" && dskin.colour === "rgb(22, 24, 29)", `${dskin.bg} ${dskin.border} ${dskin.colour}`);
check("desktop: still centred, hint and all", dskin.skew <= 2, `${dskin.skew}px off`);

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
