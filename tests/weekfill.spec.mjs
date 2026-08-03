// Adding a weekly entry: set the date, everything else comes off the Daily log.
import { chromium } from "playwright";
import { entries, goals, habits , blockWebfonts, LAUNCH, shot } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

// Target date 7/31/26. The seven days before it are 7/24 – 7/30.
// 7/23 and 7/31 sit outside that window and must not be averaged in.
const DAILY = [
  { date: "7/23/26", cal: 9999, steps: 99999, weight: 200, fatMass: 50, muscleMass: 100 }, // too old
  { date: "7/24/26", cal: 1000, steps: 1000, weight: null, fatMass: null, muscleMass: null },
  { date: "7/25/26", cal: 2000, steps: 2000, weight: null, fatMass: null, muscleMass: null },
  { date: "7/26/26", cal: 3000, steps: 3000, weight: null, fatMass: null, muscleMass: null },
  { date: "7/27/26", cal: null, steps: null, weight: null, fatMass: null, muscleMass: null }, // logged nothing
  { date: "7/28/26", cal: 4000, steps: 4000, weight: null, fatMass: null, muscleMass: null },
  { date: "7/29/26", cal: 5000, steps: null, weight: null, fatMass: null, muscleMass: null }, // cal only
  { date: "7/30/26", cal: 6000, steps: 6000, weight: null, fatMass: null, muscleMass: null },
  // The reading day itself: body numbers come from here, and its cal/steps
  // must NOT be averaged in.
  { date: "7/31/26", cal: 1111, steps: 11111, weight: 152.4, fatMass: 27.6, muscleMass: 167 },
];
// cal over 7/24-7/30: 1000+2000+3000+4000+5000+6000 = 21000 / 6 days = 3500
// steps over the same: 1000+2000+3000+4000+6000 = 16000 / 5 days = 3200

const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
 await blockWebfonts(p);
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });

const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals),
  daily_log: JSON.stringify(DAILY), habits_log: JSON.stringify(habits), habits_targets: "{}" };
await p.route("**/rest/v1/**", (route) => {
  const url = new URL(route.request().url());
  const table = url.pathname.split("/rest/v1/")[1];
  const send = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (route.request().method() !== "GET") return send([{}]);
  if (table === "kv_store") {
    const key = (url.searchParams.get("key") || "").replace("eq.", "");
    return send(kv[key] != null ? { value: kv[key] } : null);
  }
  return send([]);
});

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.waitForSelector(".dash");

// The weekly log is added from the "+" on a roadmap row, which pre-dates the
// form — so it should open already filled.
await p.locator(".fill-btn").first().click();
await p.waitForSelector(".entry-form");
check("opening a roadmap week fills it straight away", await p.locator(".pull-note").count() === 1);

const field = async (label) => p.locator(".entry-form label", { hasText: label }).first().locator("input").inputValue();
const setDate = async (v) => {
  const input = p.locator(".entry-form label", { hasText: "Date" }).first().locator("input");
  await input.fill(v);
  await p.waitForTimeout(400);
};

await setDate("7/31/26");
check("changing the date re-pulls", await p.locator(".pull-note").count() === 1);

// --- body composition comes from the day itself -----------------------------
check("weight is read off that day", await field("Weight (actual)") === "152.4", await field("Weight (actual)"));
check("muscle is read off that day", await field("Muscle (actual)") === "167", await field("Muscle (actual)"));
check("fat mass is read off that day", await field("Fat mass (actual)") === "27.6", await field("Fat mass (actual)"));

// --- calories and steps average the seven days BEFORE it --------------------
check("calories average the previous seven days", await field("Calories (actual)") === "3500",
  `${await field("Calories (actual)")} (expected 3500)`);
check("steps average the previous seven days", await field("Steps") === "3200",
  `${await field("Steps")} (expected 3200)`);

const note = await p.locator(".pull-note").innerText();
console.log("note:", JSON.stringify(note));
check("the window is stated as seven days", /7 days 7\/24\/26 – 7\/30\/26/.test(note), note.slice(0, 130));
check("and the divisor is given as a count out of those seven",
  /calories from 6 of them/.test(note) && /steps from 5 of them/.test(note), note);
check("so the seven can't be misread as six", /divisor is the number of days that had a figure/.test(note));

// --- a date with no daily entry leaves the body numbers alone ---------------
await setDate("8/7/26");
check("a date with no reading says so", /No daily entry for/.test(await p.locator(".pull-note").innerText()),
  (await p.locator(".pull-note").innerText()).slice(0, 90));
check("and doesn't blank what was already filled", await field("Weight (actual)") === "152.4",
  await field("Weight (actual)"));

// --- a date with nothing behind it at all -----------------------------------
await setDate("1/9/27");
const far = await p.locator(".pull-note").innerText();
check("a week with nothing behind it says that too", /Nothing logged in the seven days before/.test(far),
  far.slice(0, 100));

// --- typing over a filled value isn't undone --------------------------------
await setDate("7/31/26");
const calInput = p.locator(".entry-form label", { hasText: "Calories (actual)" }).first().locator("input");
await calInput.fill("2750");
await p.waitForTimeout(400);
check("a value you typed stays typed", await field("Calories (actual)") === "2750", await field("Calories (actual)"));

// --- and re-pulling on demand puts the log's number back --------------------
await p.locator(".pull-note .btn-ghost").click();
await p.waitForTimeout(300);
check("Pull again restores it from the log", await field("Calories (actual)") === "3500", await field("Calories (actual)"));

await p.locator(".entry-form").screenshot({ path: shot("weekfill.png") });
await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
