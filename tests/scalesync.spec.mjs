// The Daily Log's "Sync scale" button: it hands off to the Shortcuts app, and
// coming back re-reads daily_metrics so the new row appears without a manual
// refresh. iOS won't let a page run a Shortcut in the background, so a
// deep-link plus a return-visibility refresh is the whole mechanism.
import { chromium } from "playwright";
import { entries, goals, habits, blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const today = new Date();
const TODAY = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(2)}`;

// daily_metrics starts empty and gains a row mid-test, standing in for the
// shortcut having posted a weigh-in while the app was backgrounded.
let metrics = [];
let metricsFetches = 0;

async function open({ touch }) {
  const ctx = await b.newContext(touch
    ? { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  await blockWebfonts(p);
  p.on("pageerror", e => bad.push("pageerror: " + e.message));
  const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals),
    daily_log: "[]", habits_log: JSON.stringify(habits), habits_targets: "{}" };
  await p.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    const t = url.pathname.split("/rest/v1/")[1];
    const send = (x) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
    if (route.request().method() !== "GET") return send([{}]);
    if (t === "kv_store") { const k = (url.searchParams.get("key") || "").replace("eq.", ""); return send(kv[k] != null ? { value: kv[k] } : null); }
    if (t === "daily_metrics") { metricsFetches++; return send(metrics); }
    return send([]);
  });
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
  await p.locator(".tab-btn", { hasText: "Daily" }).click();
  await p.waitForSelector(".table-wrap table");
  return p;
}

// --- phone: the button is there and deep-links --------------------------------
let p = await open({ touch: true });
const btn = p.locator(".panel-head-actions .sync-scale-btn");
check("the phone gets a Sync scale button", await btn.count() === 1);
const href = await btn.getAttribute("href");
check("it opens the Shortcuts app", (href || "").startsWith("shortcuts://run-shortcut"), href);
check("naming the scale shortcut", (href || "").includes("name=Scale%20Sync"), href);

// --- returning to the app re-reads, and the new row shows ---------------------
metrics = [{ date: TODAY, cal: null, steps: null, weight: 152.4, fat_mass: 27.6, muscle_mass: null }];
const before = metricsFetches;
// Press it, but stop the browser actually following shortcuts:// — capture
// phase, so React's own handler still runs and arms the return-refresh.
await p.evaluate(() => {
  const a = document.querySelector(".sync-scale-btn");
  a.addEventListener("click", e => e.preventDefault(), { capture: true, once: true });
  a.click();
});
await p.waitForTimeout(150);
await p.evaluate(() => {
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await p.waitForTimeout(600);
check("coming back re-reads the synced days", metricsFetches > before, `${before} -> ${metricsFetches}`);
check("and says it looked", /Checked for new readings/.test(await p.locator(".sync-note").innerText()),
  await p.locator(".sync-note").innerText());

const row = p.locator(".table-wrap table tbody tr").filter({ hasText: TODAY }).first();
check("the weigh-in appears without a manual refresh", await row.count() === 1);
const cells = await row.locator("td").allInnerTexts();
check("with weight and fat mass from the shortcut", cells[3].trim() === "152.4" && cells[4].trim() === "27.6",
  cells.slice(3, 6).join(" | "));
check("and lean derived from them", cells[5].trim() === "124.8", cells[5]);
await p.context().close();

// --- desktop doesn't offer it -------------------------------------------------
// A shortcuts:// link goes nowhere on a laptop; a button that can't work is
// worse than no button.
p = await open({ touch: false });
check("no Sync scale button on desktop",
  await p.locator(".panel-head-actions .sync-scale-btn").count() === 0);
await p.context().close();

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
