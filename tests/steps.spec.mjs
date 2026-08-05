// Does a Food-tab calorie row hide that day's synced steps?
// This is the shape the Shortcut is about to be cut down to: steps only,
// with calories arriving from the Food tab instead.
import { chromium } from "playwright";
import { entries, goals, habits , blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

// Three days, all with steps in daily_metrics the way a steps-only Shortcut
// would write them. Only the middle one has food logged.
const METRICS = [
  { date: "7/28/26", cal: null, steps: 11200, weight: null, fat_mass: null, muscle_mass: null },
  { date: "7/29/26", cal: null, steps: 12345, weight: null, fat_mass: null, muscle_mass: null },
  { date: "7/30/26", cal: null, steps: 9800, weight: null, fat_mass: null, muscle_mass: null },
  // A day you also typed a step count for by hand — yours must win.
  { date: "7/27/26", cal: null, steps: 7000, weight: null, fat_mass: null, muscle_mass: null },
  // Same day as the manual 7/26/26 row below, spelt with leading zeros.
  { date: "07/26/26", cal: null, steps: 8400, weight: null, fat_mass: null, muscle_mass: null },
];

// Today, so one row always carries the "this block" marker whenever the spec
// is run — the date column has to line up with and without it.
const today = new Date();
const TODAY = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(2)}`;

// 7/29 has a daily-log row written by the Food tab: calories, no steps.
const DAILY = [
  { date: TODAY, cal: 1900, steps: 9000, weight: null, fatMass: null, muscleMass: null, calSource: "manual" },
  { date: "7/29/26", cal: 1850, steps: null, weight: null, fatMass: null, muscleMass: null, calSource: "food" },
  { date: "7/27/26", cal: 1900, steps: 15000, weight: null, fatMass: null, muscleMass: null, calSource: "manual" },
  { date: "7/26/26", cal: 1700, steps: null, weight: null, fatMass: null, muscleMass: null, calSource: "manual" },
];

const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
 await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));

const kv = {
  entries: JSON.stringify(entries),
  phase_goals: JSON.stringify(goals),
  daily_log: JSON.stringify(DAILY),
  habits_log: JSON.stringify(habits),
  habits_targets: JSON.stringify({}),
};
await p.route("**/rest/v1/**", (route) => {
  const url = new URL(route.request().url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (route.request().method() !== "GET") return send([]);
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

const rows = await p.$$eval(".table-wrap table tbody tr", (trs) => trs.map((tr) => {
  const td = tr.querySelectorAll("td");
  return { date: td[0].textContent.trim(), cal: td[1].textContent.trim(), steps: td[2].textContent.trim() };
}));
const row = (d) => rows.find(r => r.date.startsWith(d));

console.log(rows.map(r => `${r.date} | cal ${r.cal} | steps ${r.steps}`).join("\n"));

check("a day with no food logged shows its synced steps", row("7/28/26")?.steps === "11,200", row("7/28/26")?.steps);
check("a day with no food logged shows its synced steps (2)", row("7/30/26")?.steps === "9,800", row("7/30/26")?.steps);
check("the food-logged day keeps its calories", row("7/29/26")?.cal === "1,850", row("7/29/26")?.cal);
check("the food-logged day ALSO shows its synced steps", row("7/29/26")?.steps === "12,345", row("7/29/26")?.steps);

// Filling blanks must not become overwriting.
check("a step count you typed beats the synced one", row("7/27/26")?.steps === "15,000", row("7/27/26")?.steps);
check("and so do your calories", row("7/27/26")?.cal === "1,900", row("7/27/26")?.cal);

// "7/26/26" and "07/26/26" are the same day, so one row, with the steps filled.
const jul26 = rows.filter(r => /7\/26\/26/.test(r.date));
check("a differently-spelt date is one row, not two", jul26.length === 1, `${jul26.length} rows`);
check("and it picks up the synced steps", jul26[0]?.steps === "8,400", jul26[0]?.steps);

// The synced badge is gone: the numbers are the point, and every row carried
// one once food logging started filling days in.
check("no row advertises itself as synced", await p.locator(".synced-tag").count() === 0);

// With the badge gone the dates have to line up on their own, so a row that
// carries the "this block" marker starts at the same x as one that doesn't.
const dateLefts = await p.$$eval(".table-wrap table tbody tr td.daily-date .daily-date-val",
  (els) => els.map(el => Math.round(el.getBoundingClientRect().left)));
check("every date starts at the same x", new Set(dateLefts).size === 1, dateLefts.join(","));
const marked = await p.locator("td.daily-date .this-block-tag").count();
check("today's row still carries the block marker", marked >= 1, `${marked} marked`);
const gap = await p.$$eval("td.daily-date", (tds) => {
  const td = tds.find(t => t.querySelector(".this-block-tag"));
  if (!td) return null;
  const cell = td.getBoundingClientRect(), tag = td.querySelector(".this-block-tag").getBoundingClientRect();
  const val = td.querySelector(".daily-date-val").getBoundingClientRect();
  return {
    afterDate: Math.round(tag.left - val.right), width: Math.round(cell.width),
    offCentre: Math.round((tag.top + tag.bottom) / 2 - (cell.top + cell.bottom) / 2),
  };
});
check("the block marker follows the date", gap && gap.afterDate >= 0 && gap.afterDate <= 12,
  gap ? `${gap.afterDate}px after the date` : "no marked row");
check("and sits on the date's line", Math.abs(gap?.offCentre ?? 99) <= 1, `${gap?.offCentre}px off`);

// The step average and streaks read the same merged list, so a hidden day
// silently drags them too.
await p.locator(".tab-btn", { hasText: "Home" }).click();
await p.waitForSelector(".stat-card");
const stepCard = await p.locator(".stat-card", { hasText: "Steps" }).first().innerText().catch(() => "");
console.log("Steps stat card:", JSON.stringify(stepCard));

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
