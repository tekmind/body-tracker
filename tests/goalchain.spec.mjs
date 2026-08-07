// Phases are a chain: extending a goal's duration pushes every later goal out
// by the same amount, the range on screen expands, and the date-driven
// statuses follow. Reported: adding two weeks to a Maintain changed nothing —
// duration only drove roadmap generation, and all the dates stayed put.
import { chromium } from "playwright";
import { entries, habits, blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const mdy = (d) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
const shift = (base, days) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
const today = new Date(); today.setHours(0, 0, 0, 0);

// A Maintain that ran out yesterday-ish, a Cut that took over two days ago,
// and a Gain waiting behind it. Extending the Maintain by two weeks should
// make it active again and slide both later goals out.
const MAINTAIN_START = shift(today, -37); // ~5.3 weeks ago, durationWeeks 5 → ended
const CUT_START = shift(MAINTAIN_START, 5 * 7);
const GAIN_START = shift(CUT_START, 4 * 7);
const GOALS = [
  { date: "3/1/26", phase: "Cut", muscleRate: 0, fatRate: -0.5, stepGoal: 10000, calGoal: 1900,
    proteinGoal: 190, fatGoal: 60, durationWeeks: 20, notes: "" },
  { date: mdy(MAINTAIN_START), phase: "Maintain", muscleRate: 0, fatRate: 0, stepGoal: 10000, calGoal: 2100,
    proteinGoal: 180, fatGoal: 60, calBuffer: 50, durationWeeks: 5, notes: "" },
  { date: mdy(CUT_START), phase: "Cut", muscleRate: 0, fatRate: -0.5, stepGoal: 10000, calGoal: 1800,
    proteinGoal: 190, fatGoal: 60, durationWeeks: 4, notes: "" },
  { date: mdy(GAIN_START), phase: "Gain", muscleRate: 0.25, fatRate: 2.5, stepGoal: 8000, calGoal: 2600,
    proteinGoal: 180, fatGoal: 70, durationWeeks: 8, notes: "" },
];

let savedGoals = null;
const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(GOALS), daily_log: "[]",
  habits_log: JSON.stringify(habits), habits_targets: "{}" };
await p.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const t = url.pathname.split("/rest/v1/")[1];
  const send = (x, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(x) });
  if (req.method() !== "GET") {
    const pl = req.postDataJSON?.(); const row = Array.isArray(pl) ? pl[0] : pl;
    if (t === "kv_store" && row?.key === "phase_goals") { savedGoals = JSON.parse(row.value); kv.phase_goals = row.value; }
    return send([row || {}], 201);
  }
  if (t === "kv_store") { const k = (url.searchParams.get("key") || "").replace("eq.", ""); return send(kv[k] != null ? { value: kv[k] } : null); }
  return send([]);
});

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Goal Settings" }).click();
await p.waitForSelector(".settings-view table tbody tr");

const rowFor = (phase, nth = 0) => p.locator(".settings-view table tbody tr").filter({ hasText: phase }).nth(nth);
const statusOf = async (phase, nth = 0) => (await rowFor(phase, nth).locator(".status-badge").innerText()).trim();

// The starting picture: the newer Cut is active, the Maintain has lapsed.
check("the mid-chain cut starts active", await statusOf("Cut", 0) === "ACTIVE", await statusOf("Cut", 0));
check("the maintain reads past", await statusOf("Maintain") === "PAST", await statusOf("Maintain"));
check("the gain is upcoming", await statusOf("Gain") === "UPCOMING", await statusOf("Gain"));

// Extend the Maintain by two weeks through the pencil form.
await rowFor("Maintain").locator(".icon-btn").first().click();
await p.waitForSelector(".entry-form, .goal-form, .form-grid");
const durField = p.locator("label", { hasText: "Duration (weeks)" }).first().locator("input");
check("the form shows the current duration", await durField.inputValue() === "5", await durField.inputValue());
await durField.fill("7");
await p.locator(".form-actions .btn-primary").click();
await p.waitForTimeout(500);

// The chain slid: both later goals moved out by exactly 14 days.
const g = (phase, date) => savedGoals?.find(x => x.phase === phase && x.date === date);
check("the cut moved out two weeks", !!g("Cut", mdy(shift(CUT_START, 14))),
  JSON.stringify(savedGoals?.map(x => `${x.phase} ${x.date}`)));
check("the gain moved with it", !!g("Gain", mdy(shift(GAIN_START, 14))),
  JSON.stringify(savedGoals?.map(x => `${x.phase} ${x.date}`)));
check("the earlier cut did not move", !!g("Cut", "3/1/26"));
check("and it says what it did", /Moved 2 later goals out by 2 weeks/.test(await p.locator(".goal-shift-note").innerText()),
  await p.locator(".goal-shift-note").innerText());

// Statuses follow the dates: the maintain is active again, the cut is back to
// waiting its turn.
check("the maintain is active again", await statusOf("Maintain") === "ACTIVE", await statusOf("Maintain"));
check("the extended cut is upcoming now", await statusOf("Cut", 0) === "UPCOMING", await statusOf("Cut", 0));

// The maintain's visible range end expanded to the day before the moved cut.
const range = await rowFor("Maintain").locator(".goal-date-range").innerText();
check("its range expanded on screen", range.includes(mdy(shift(CUT_START, 13))), range);

// Shrinking pulls the chain back in — the inverse must work too, or a typo'd
// extension can't be corrected.
await rowFor("Maintain").locator(".icon-btn").first().click();
await p.locator("label", { hasText: "Duration (weeks)" }).first().locator("input").fill("5");
await p.locator(".form-actions .btn-primary").click();
await p.waitForTimeout(500);
check("shrinking restores the original dates",
  !!g("Cut", mdy(CUT_START)) && !!g("Gain", mdy(GAIN_START)),
  JSON.stringify(savedGoals?.map(x => `${x.phase} ${x.date}`)));

// Editing without touching the duration must move nothing.
savedGoals = null;
await rowFor("Maintain").locator(".icon-btn").first().click();
await p.locator("label", { hasText: "Calorie goal" }).first().locator("input").fill("2050");
await p.locator(".form-actions .btn-primary").click();
await p.waitForTimeout(500);
check("an unrelated edit leaves the chain alone",
  !!g("Cut", mdy(CUT_START)) && !!g("Gain", mdy(GAIN_START)),
  JSON.stringify(savedGoals?.map(x => `${x.phase} ${x.date}`)));

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
