// The Daily tab's calorie number for a day the Food tab has entries for must
// be what the Food tab adds up to.
//
// Reported: 8/5 read 1,200 on the Daily tab while the Food tab totalled 2,488.
// Something had put a number on that row — a stray automation posting Active
// Energy, or a form saved without being changed — and the sync deferred to it
// because it wasn't stamped calSource "food". The number on display was the
// wrong one, and it stayed wrong until a food was added or deleted on that day.
import { chromium } from "playwright";
import { entries, goals, habits, foodItems, foodLog, meals, blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const today = new Date();
const mdy = (d) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
const TODAY = mdy(today);
const NO_FOOD = mdy(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 40));

// What the seeded food log adds up to for one day — the number the Daily tab
// has to end up showing.
const FOOD_CAL = foodLog([TODAY]).reduce((s, r) => s + r.cal, 0);

// TODAY carries a calorie figure nobody typed, with no calSource at all — the
// shape a row left by an older build or a stray automation has.
// NO_FOOD is a day with a hand-typed number and nothing logged against it.
const DAILY = [
  { date: TODAY, cal: 1200, steps: 9000, weight: null, fatMass: null, muscleMass: null },
  { date: NO_FOOD, cal: 2350, steps: 8000, weight: null, fatMass: null, muscleMass: null, calSource: "manual" },
];

let saved = null;
const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });

const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals),
  daily_log: JSON.stringify(DAILY), habits_log: JSON.stringify(habits), habits_targets: "{}" };
await p.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (x, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(x) });
  if (req.method() !== "GET") {
    const pl = req.postDataJSON?.(); const row = Array.isArray(pl) ? pl[0] : pl;
    if (table === "kv_store" && row?.key === "daily_log") { saved = JSON.parse(row.value); kv.daily_log = row.value; }
    return send([row || {}], 201);
  }
  if (table === "kv_store") { const k = (url.searchParams.get("key") || "").replace("eq.", ""); return send(kv[k] != null ? { value: kv[k] } : null); }
  if (table === "food_items") return send(foodItems);
  if (table === "food_meals") return send(meals);
  if (table === "food_log") {
    const raw = url.searchParams.get("date") || "";
    const list = raw.replace(/^in\.\(/, "").replace(/\)$/, "").split(",").map(s => s.replace(/^"|"$/g, ""));
    return send(foodLog(list.filter(Boolean)));
  }
  return send([]);
});

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });

// Opening the Food tab is enough — no food has to be added or removed.
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");
const shown = (await p.locator(".macro-tile").first().innerText()).replace(/[^\d]/g, "");
check("the Food tab totals the day", Number(shown.slice(0, 4)) === FOOD_CAL,
  `tile ${shown.slice(0, 4)} vs ${FOOD_CAL}`);
await p.waitForTimeout(600);

await p.locator(".tab-btn", { hasText: "Daily" }).click();
await p.waitForSelector(".table-wrap table tbody tr");

const rowFor = (d) => p.locator(".table-wrap table tbody tr").filter({ hasText: d }).first();
const calOf = async (d) => (await rowFor(d).locator("td").nth(1).innerText()).trim();
const dayIn = (d) => (saved || DAILY).find(r => r.date === d);

const todayCal = await calOf(TODAY);
check("the day reads the food total", todayCal === FOOD_CAL.toLocaleString(), `${todayCal} (expected ${FOOD_CAL.toLocaleString()})`);
check("and 1,200 is gone", todayCal !== "1,200", todayCal);
check("it was persisted, not just displayed", dayIn(TODAY)?.cal === FOOD_CAL, JSON.stringify(dayIn(TODAY)?.cal));
check("and is marked as the Food tab's", dayIn(TODAY)?.calSource === "food", dayIn(TODAY)?.calSource);
check("without disturbing that day's steps", dayIn(TODAY)?.steps === 9000, JSON.stringify(dayIn(TODAY)?.steps));

// The other half of the rule: a day with nothing logged is an empty day, not a
// correction. It must not blank a number typed for a day you ate out.
check("a day with no food logged keeps its typed number", await calOf(NO_FOOD) === "2,350", await calOf(NO_FOOD));
check("and it stays in the log", dayIn(NO_FOOD)?.cal === 2350, JSON.stringify(dayIn(NO_FOOD)?.cal));
check("still marked as hand-typed", dayIn(NO_FOOD)?.calSource === "manual", dayIn(NO_FOOD)?.calSource);

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
