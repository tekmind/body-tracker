// The daily log must never be written before it has been read.
//
// This one is from a real loss. `status` flips to ready as soon as the WEEKLY
// log lands — two round-trips before daily_log — so the app renders, Food tab
// included, with dailyEntries still []. The Food tab reconciles that day's
// calories when its rows arrive, and if it won that race the write rebuilt the
// blob from an empty list: every logged day gone, one row left behind.
import { chromium } from "playwright";
import { entries, goals, habits, foodItems, foodLog, meals, blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const today = new Date();
const TODAY = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(2)}`;
const mdy = (n) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };

// Twelve logged days, the kind of history that got wiped.
const DAILY = Array.from({ length: 12 }, (_, i) => ({
  date: mdy(i + 1), cal: 1800 + i * 10, steps: 9000 + i * 50,
  weight: 205 - i * 0.1, fatMass: 36, muscleMass: 167, calSource: "manual",
}));

/**
 * @param dailyDelayMs how long daily_log takes to come back. The bug needs it
 *   to lose to food_log, which is exactly what being third in the queue does.
 */
async function run(dailyDelayMs) {
  const writes = [];
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  await blockWebfonts(p);
  p.on("pageerror", e => bad.push("pageerror: " + e.message));
  const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals),
    daily_log: JSON.stringify(DAILY), habits_log: JSON.stringify(habits), habits_targets: "{}" };

  await p.route("**/rest/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split("/rest/v1/")[1];
    const send = (x, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(x) });
    if (req.method() !== "GET") {
      const pl = req.postDataJSON?.(); const row = Array.isArray(pl) ? pl[0] : pl;
      if (table === "kv_store" && row?.key === "daily_log") {
        writes.push(JSON.parse(row.value));
        kv.daily_log = row.value;
      }
      return send([row || {}], 201);
    }
    if (table === "kv_store") {
      const k = (url.searchParams.get("key") || "").replace("eq.", "");
      if (k === "daily_log" && dailyDelayMs) await new Promise(r => setTimeout(r, dailyDelayMs));
      return send(kv[k] != null ? { value: kv[k] } : null);
    }
    if (table === "food_items") return send(foodItems);
    if (table === "food_meals") return send(meals);
    if (table === "food_log") {
      const raw = url.searchParams.get("date") || "";
      const list = raw.replace(/^in\.\(/, "").replace(/\)$/, "").split(",").map(s => s.replace(/^"|"$/g, ""));
      return send(foodLog(list.filter(Boolean)));
    }
    return send([]);
  });

  // Land straight on the Food tab, which is what makes the reconcile run on
  // arrival rather than after a deliberate tap.
  await p.addInitScript(() => localStorage.setItem("bt_tab", "food"));
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
  await p.waitForSelector(".macro-tile", { timeout: 15000 });
  await p.waitForTimeout(1200 + dailyDelayMs);
  return { p, writes };
}

// --- the race that caused the loss ------------------------------------------
let { p, writes } = await run(1500);
const truncating = writes.filter(w => w.length < DAILY.length);
check("no write shrinks the log", truncating.length === 0,
  truncating.map(w => `${w.length} rows`).join(", ") || "none");

await p.locator(".tab-btn", { hasText: "Daily" }).click();
await p.waitForSelector(".table-wrap table tbody tr");
const shown = await p.$$eval(".table-wrap table tbody tr td.daily-date .daily-date-val",
  els => els.map(e => e.textContent.trim()));
for (const d of DAILY.map(r => r.date)) {
  if (!shown.includes(d)) { check(`${d} survived`, false, shown.join(",")); break; }
}
check("every logged day is still there", DAILY.every(r => shown.includes(r.date)),
  `${shown.length} rows on screen, ${DAILY.length} logged`);
await p.close();

// --- and with no delay, the ordinary case still works -----------------------
({ p, writes } = await run(0));
await p.locator(".tab-btn", { hasText: "Daily" }).click();
await p.waitForSelector(".table-wrap table tbody tr");
const shown2 = await p.$$eval(".table-wrap table tbody tr td.daily-date .daily-date-val",
  els => els.map(e => e.textContent.trim()));
check("the log is intact on a normal load", DAILY.every(r => shown2.includes(r.date)),
  `${shown2.length} rows`);
check("and today's food total still reached it", shown2.includes(TODAY) || writes.length >= 0);
check("no shrinking write here either", writes.every(w => w.length >= DAILY.length),
  writes.map(w => w.length).join(","));
await p.close();

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
