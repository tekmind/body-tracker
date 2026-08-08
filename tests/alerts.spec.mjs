// The derail/slipping alert reads its trigger metric and thresholds from Goal
// Settings, instead of being hardcoded to calories / 2 weeks / 3 weeks.
import { chromium } from "playwright";
import { goals, habits, blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const day = (n) => { const d = new Date(2026, 6, 29 - n); return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };
// calGoal 1900, stepGoal 10000 in the seeded goal. Each row says whether that
// week was over on calories and/or short on steps.
const weeks = (rows) => rows.map((r, i) => ({
  wk: i, date: day((rows.length - 1 - i) * 7), phase: "Cut",
  aW: 214 - i, aM: 168, aF: 46 - i,
  aCal: r.calOver ? 2100 : 1750, steps: r.stepsShort ? 8000 : 11000, notes: "",
}));

let savedAlerts = null;
async function open(rows, alertSettings) {
  const kvAlerts = alertSettings ? JSON.stringify(alertSettings) : null;
  const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
  await blockWebfonts(p);
  p.on("pageerror", e => bad.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });
  const kv = {
    entries: JSON.stringify(weeks(rows)), phase_goals: JSON.stringify(goals),
    daily_log: "[]", habits_log: JSON.stringify(habits), habits_targets: "{}",
    ...(kvAlerts ? { alert_settings: kvAlerts } : {}),
  };
  await p.route("**/rest/v1/**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const t = url.pathname.split("/rest/v1/")[1];
    const send = (x, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(x) });
    if (req.method() !== "GET") {
      const pl = req.postDataJSON?.(); const row = Array.isArray(pl) ? pl[0] : pl;
      if (t === "kv_store" && row?.key === "alert_settings") { savedAlerts = JSON.parse(row.value); kv.alert_settings = row.value; }
      return send([row || {}], 201);
    }
    if (t === "kv_store") { const k = (url.searchParams.get("key") || "").replace("eq.", ""); return send(kv[k] != null ? { value: kv[k] } : null); }
    return send([]);
  });
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
  await p.waitForSelector(".stat-card");
  return p;
}

const level = async (p) => {
  if (await p.locator(".banner-alert.derailed").count()) return "derailed";
  if (await p.locator(".banner-alert.slipping").count()) return "slipping";
  if (await p.locator(".banner-ontrack").count()) return "ontrack";
  return "none";
};
const bannerText = (p) => p.locator(".banner-alert, .banner-ontrack").first().innerText();

const OVER = { calOver: true }, OK = {}, SHORT = { stepsShort: true };

// --- defaults: amber after one week, red after three ------------------------
let p = await open([OK, OK, OK]);
check("no off weeks, no alert", await level(p) === "ontrack", await level(p));
check("and it counts the on-track run", /3w/.test(await bannerText(p)), await bannerText(p));
await p.close();

p = await open([OK, OK, OVER]);
check("one week over is already the amber warning", await level(p) === "slipping", await level(p));
await p.close();

p = await open([OK, OVER, OVER]);
check("two weeks over is still amber, not yet red", await level(p) === "slipping", await level(p));
await p.close();

p = await open([OVER, OVER, OVER]);
check("three weeks over derails, by default", await level(p) === "derailed", await level(p));
check("the banner counts the weeks", /3w/.test(await bannerText(p)), await bannerText(p));
await p.close();

// --- the stat chips climb the SAME ladder -----------------------------------
// The reported bug: chips went amber after a single week while the settings
// card claimed two. Only their red cut read the setting; the amber one was
// hardcoded to "any run at all" and described nothing.
const chip = async (pg, card) => pg.locator(".stat-card", { hasText: card }).first()
  .locator(".stat-alert-badge")
  .evaluate(el => ({ text: el.textContent.trim(), cls: el.className })).catch(() => null);

p = await open([OK, OK, OVER]);
let c = await chip(p, "Calories");
check("one week over turns the chip amber", /\bwarn\b/.test(c?.cls || ""), JSON.stringify(c));
check("and the chip counts that one week", c?.text === "1w", c?.text);
await p.close();

p = await open([OVER, OVER, OVER]);
c = await chip(p, "Calories");
check("three weeks turns it red", /\bbad\b/.test(c?.cls || ""), JSON.stringify(c));
await p.close();

// Move the amber threshold and the chip has to move with it — that's the whole
// point of the two surfaces sharing one ladder.
p = await open([OK, OK, OVER], { metric: "cal", slipping: 2, derailed: 3 });
c = await chip(p, "Calories");
check("with amber set to 2w, a single off week shows no chip badge", c === null || !/\bwarn\b/.test(c.cls),
  JSON.stringify(c));
check("and it doesn't claim you're on track either", !/\bgood\b/.test(c?.cls || ""), JSON.stringify(c));
check("the banner agrees with the chip", await level(p) === "ontrack", await level(p));
// With a gap between "off this week" and the amber threshold, the on-track
// banner has something to warn about. At amber-after-1 there is no gap.
check("and it says what would trigger one", /triggers a slipping alert/.test(await bannerText(p)), await bannerText(p));
await p.close();

// --- the thresholds move it -------------------------------------------------
p = await open([OK, OVER, OVER], { metric: "cal", slipping: 3, derailed: 4 });
check("a later amber threshold holds the alert back", await level(p) === "ontrack", await level(p));
await p.close();

p = await open([OK, OVER, OVER], { metric: "cal", slipping: 1, derailed: 2 });
check("an earlier derail threshold brings it forward", await level(p) === "derailed", await level(p));
await p.close();

// A run only counts as derailed history once it reaches the threshold, and
// then the whole run is marked — including the weeks before it.
p = await open([OVER, OVER, OVER], { metric: "cal", slipping: 1, derailed: 4 });
check("a run shorter than the threshold isn't marked in history",
  await p.locator("tr.row-derail-hist").count() === 0,
  `${await p.locator("tr.row-derail-hist").count()} rows`);
await p.close();

// --- the trigger metric switches --------------------------------------------
p = await open([SHORT, SHORT, SHORT], { metric: "steps", slipping: 2, derailed: 3 });
check("watching steps derails on steps", await level(p) === "derailed", await level(p));
const stepsBanner = await bannerText(p);
check("and the banner names steps, not calories", /Steps/.test(stepsBanner) && !/Calories/.test(stepsBanner), stepsBanner);
check("it reads as under goal", /under goal/.test(stepsBanner), stepsBanner);
// The watched metric isn't also listed in the notification stack below.
const notifMetrics = await p.$$eval(".notif-row .notif-metric", els => els.map(e => e.textContent.trim()));
check("steps isn't reported twice", !notifMetrics.includes("Steps"), notifMetrics.join(","));
await p.close();

// Calories, meanwhile, becomes an ordinary watchlist row when it isn't watched.
p = await open([OVER, OVER, OVER], { metric: "steps", slipping: 2, derailed: 3 });
check("calories drops to the watchlist when steps is watched",
  (await p.$$eval(".notif-row .notif-metric", els => els.map(e => e.textContent.trim()))).includes("Calories"),
  (await p.$$eval(".notif-row .notif-metric", els => els.map(e => e.textContent.trim()))).join(","));
check("and no calorie derail banner fires", await level(p) !== "derailed", await level(p));
await p.close();

// --- the settings page drives it --------------------------------------------
p = await open([OK, OVER, OVER]);
check("it starts slipping", await level(p) === "slipping", await level(p));
await p.locator(".tab-btn", { hasText: "Goal Settings" }).click();
await p.waitForSelector(".alert-settings");

const stepper = (label) => p.locator(".alert-setting-row", { hasText: label }).first();
check("the watched metric shows as selected",
  await stepper("Banner watches").locator(".toggle-btn.active").innerText() === "Calories",
  await stepper("Banner watches").locator(".toggle-btn.active").innerText());
check("amber shows its current value", await stepper("Amber after").locator(".habit-target-val").innerText() === "1w",
  await stepper("Amber after").locator(".habit-target-val").innerText());
check("red shows its current value", await stepper("Red after").locator(".habit-target-val").innerText() === "3w",
  await stepper("Red after").locator(".habit-target-val").innerText());

// Pull the derail threshold down to 2 and the same data should now be a derail.
await stepper("Red after").locator(".habit-step-btn").first().click();
await p.waitForTimeout(250);
check("the stepper moves", await stepper("Red after").locator(".habit-target-val").innerText() === "2w",
  await stepper("Red after").locator(".habit-target-val").innerText());
check("and it's saved", savedAlerts?.derailed === 2, JSON.stringify(savedAlerts));
await p.locator(".tab-btn", { hasText: "Home" }).click();
await p.waitForSelector(".stat-card");
check("the same weeks now read as derailed", await level(p) === "derailed", await level(p));

// Slipping can't overtake derailed — the early warning would never fire.
await p.locator(".tab-btn", { hasText: "Goal Settings" }).click();
await p.waitForSelector(".alert-settings");
await stepper("Amber after").locator(".habit-step-btn").last().click();
await p.waitForTimeout(250);
check("raising slipping past derailed pushes derailed up with it",
  savedAlerts?.derailed >= savedAlerts?.slipping, JSON.stringify(savedAlerts));

// And switching the metric persists too.
await stepper("Banner watches").locator(".toggle-btn", { hasText: "Lean" }).click();
await p.waitForTimeout(250);
check("the metric is saved", savedAlerts?.metric === "muscle", JSON.stringify(savedAlerts));

// A backup that didn't carry these would quietly reset them on restore.
// Exact: "Download export" sits beside it and a substring match takes both.
await p.locator(".panel", { hasText: "Backup & Restore" }).first().locator(".btn-ghost", { hasText: /^Export$/ }).click();
await p.waitForSelector(".backup-ta");
const blob = JSON.parse(await p.locator(".backup-ta").inputValue());
check("the backup carries the alert settings", blob.alerts?.metric === "muscle", JSON.stringify(blob.alerts));
check("including both thresholds", blob.alerts?.slipping > 0 && blob.alerts?.derailed >= blob.alerts?.slipping,
  JSON.stringify(blob.alerts));

const spill = await p.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
check("the settings page doesn't scroll sideways", spill <= 1, `${spill}px`);
await p.close();

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
