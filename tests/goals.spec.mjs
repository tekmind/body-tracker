import { chromium } from "playwright";
import { entries, daily, foodItems, meals, foodLog , blockWebfonts, LAUNCH } from "./seed.mjs";

const GREEN = "rgb(221, 239, 212)", AMBER = "rgb(253, 241, 221)", RED = "rgb(248, 221, 217)", WHITE = "rgb(255, 255, 255)";
const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

// Today's logged totals from the seed: 1807 kcal, 175.2p, 178.1c, 38.7f.
async function open(goal, { pacing = false, day = null } = {}) {
  const p = await b.newPage({ viewport: { width: 1200, height: 950 } });
 await blockWebfonts(p);
  p.on("pageerror", e => bad.push("pageerror: " + e.message));
  const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify([goal]), daily_log: JSON.stringify(daily), habits_log: "{}", habits_targets: "{}" };
  await p.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    const t = url.pathname.split("/rest/v1/")[1];
    const send = (x) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
    if (route.request().method() !== "GET") return send([]);
    if (t === "kv_store") { const k = (url.searchParams.get("key") || "").replace("eq.", ""); return send(kv[k] != null ? { value: kv[k] } : null); }
    if (t === "food_items") return send(foodItems);
    if (t === "food_meals") return send(meals);
    if (t === "food_log") { const raw = url.searchParams.get("date") || ""; return send(foodLog(raw.replace(/^in\.\(/, "").replace(/\)$/, "").split(",").map(x => x.replace(/^"|"$/g, "")).filter(Boolean))); }
    return send([]);
  });
  await p.addInitScript((on) => localStorage.setItem("bt_food_pacing", on ? "1" : "0"), pacing);
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
  await p.locator(".tab-btn", { hasText: "Food" }).click();
  await p.waitForSelector(".macro-tile");
  if (day) { await p.locator(".food-day-nav .icon-btn").first().click(); await p.waitForTimeout(300); }
  return p;
}
const tiles = (p) => p.evaluate(() => [...document.querySelectorAll(".macro-tile")].map(el => ({
  label: el.querySelector(".macro-tile-label").textContent.replace("pace", "").trim(),
  bg: getComputedStyle(el).backgroundColor,
  target: (el.querySelector(".macro-tile-target") || {}).textContent || "",
  sub: el.querySelector(".macro-tile-sub").textContent.trim(),
  paced: !!el.querySelector(".macro-paced-tag"),
})));

const base = { date: "3/1/26", phase: "Cut", muscleRate: 0, fatRate: -0.5, stepGoal: 10000, durationWeeks: 24 };

// --- carbs are derived, not stored ----------------------------------------
let p = await open({ ...base, calGoal: 1900, proteinGoal: 190, fatGoal: 60, carbGoal: 999 });
let t = await tiles(p);
check("carbs target is derived, ignoring any stored carbGoal", t[2].target === "/ 150g", t[2].target);
check("protein target is the number set", t[1].target === "/ 190g", t[1].target);
await p.close();

// --- Maintain: amber sits above the goal, never below it -------------------
// 1807 logged, buffer 100 -> amber runs goal..goal+100. Coming in under the
// goal is green: it's the thing you wanted, not something to warn about.
for (const [calGoal, want, why] of [
  [1900, GREEN, "93 under the goal"],
  [1807, GREEN, "exactly on the goal"],
  [1806, AMBER, "one over the goal"],
  [1750, AMBER, "57 over, inside the 1,750-1,850 band"],
  [1707, AMBER, "exactly 100 over, on the far edge"],
  [1706, RED, "101 over is past the band"],
]) {
  p = await open({ ...base, phase: "Maintain", calGoal, proteinGoal: 100, fatGoal: 50, calBuffer: 100 });
  t = await tiles(p);
  check(`maintain @ ${calGoal}: ${why}`, t[0].bg === want, t[0].bg);
  await p.close();
}

// --- the calorie band flips with the phase --------------------------------
// 1807 logged, goal 1800, buffer 50.
for (const [phase, value, want, why] of [
  ["Cut", 1800, AMBER, "7 over on a cut is inside the 1,800-1,850 band"],
  ["Cut", 1750, RED, "57 over is past it"],
  ["Cut", 1900, GREEN, "under the goal on a cut is green"],
  ["Gain", 1850, AMBER, "43 short on a gain is inside the 1,800-1,850 band"],
  ["Gain", 1900, RED, "93 short is wider than the 50 band"],
  ["Gain", 1800, GREEN, "over the goal on a gain is green"],
  ["Gain", 2000, RED, "193 short is past the band"],
  ["Maintain", 1800, AMBER, "7 over on maintenance is inside the 1,800-1,850 band"],
  ["Maintain", 1900, GREEN, "under the goal on maintenance is green, same as a cut"],
  ["Maintain", 1750, RED, "57 over is past the band"],
]) {
  p = await open({ ...base, phase, calGoal: value, proteinGoal: 100, fatGoal: 50, calBuffer: 50 });
  t = await tiles(p);
  check(`${phase} @ ${value}: ${why}`, t[0].bg === want, t[0].bg);
  await p.close();
}

// Carbs follow the calorie band, or a gain day contradicts itself.
p = await open({ ...base, phase: "Gain", calGoal: 2600, proteinGoal: 100, fatGoal: 50, calBuffer: 50 });
t = await tiles(p);
check("gain: under on calories is red", t[0].bg === RED, t[0].bg);
check("gain: under on carbs is red too, not green", t[2].bg === RED, `${t[2].target} ${t[2].bg}`);
await p.close();

// --- protein buffer: amber sits below the goal, in every phase ------------
for (const phase of ["Cut", "Gain", "Maintain"]) {
  p = await open({ ...base, phase, calGoal: 2400, proteinGoal: 190, fatGoal: 60, proteinBuffer: 20 });
  t = await tiles(p);
  check(`${phase}: protein still amber at 175 of 190`, t[1].bg === AMBER, t[1].bg);
  await p.close();
}

// 175.2 logged, buffer 20.
for (const [proteinGoal, want, why] of [
  [170, GREEN, "goal reached"],
  [190, AMBER, "inside 170-190"],
  [196, RED, "under the amber floor of 176"],
  [175, GREEN, "exactly on the goal"],
]) {
  p = await open({ ...base, calGoal: 2400, proteinGoal, fatGoal: 60, proteinBuffer: 20 });
  t = await tiles(p);
  check(`protein ${proteinGoal}g: ${why}`, t[1].bg === want, t[1].bg);
  await p.close();
}

// --- no buffer keeps the old two-state behaviour ---------------------------
p = await open({ ...base, calGoal: 1800, proteinGoal: 190, fatGoal: 60 });
t = await tiles(p);
check("no calorie buffer -> straight to red when over", t[0].bg === RED, t[0].bg);
check("fat has no buffer yet -> stays two-state green", t[3].bg === GREEN, t[3].bg);
await p.close();

// --- pacing ---------------------------------------------------------------
p = await open({ ...base, calGoal: 1900, proteinGoal: 190, fatGoal: 60 }, { pacing: true });
const paced = await tiles(p);
const note = await p.locator(".food-pace-note").innerText().catch(() => "");
const pacedCal = Number((paced[0].target.match(/[\d,]+/) || ["0"])[0].replace(/,/g, ""));
// Not "!== the flat goal": on the first day of a fresh week with nothing
// logged, the paced number legitimately equals it. The badge and note below
// are what prove pacing is driving the tile.
check("pacing drives the calorie target", pacedCal > 0 && paced[0].paced === true, `${paced[0].target}`);
check("pacing leaves protein alone", paced[1].target === "/ 190g", paced[1].target);
check("pacing leaves fat alone", paced[3].target === "/ 60g", paced[3].target);
const expectCarbs = Math.max(0, Math.round((pacedCal - 190 * 4 - 60 * 9) / 4));
check("carbs follow the paced calorie number", paced[2].target === `/ ${expectCarbs}g`, `${paced[2].target} vs / ${expectCarbs}g`);
check("only calories and carbs are badged as paced", paced.map(x => x.paced).join(",") === "true,false,true,false", paced.map(x => x.paced).join(","));
check("a note explains the paced number", /Pacing:/.test(note), note.slice(0, 80));
// The seed's paced budget lands at exactly protein+fat, so carbs derive to 0 —
// a real target of zero, not a missing one.
if (expectCarbs === 0) {
  check("a zero carb budget says so rather than 'no target set'", paced[2].sub !== "no target set", paced[2].sub);
  check("and the pacing note explains the squeeze", /nothing left for carbs/.test(note), note.slice(-70));
}
await p.close();

// --- pacing on a day that isn't today -------------------------------------
p = await open({ ...base, calGoal: 1900, proteinGoal: 190, fatGoal: 60 }, { pacing: true, day: "yesterday" });
const past = await tiles(p);
check("a past day ignores pacing and uses the flat goal", past[0].target === "/ 1,900", past[0].target);
const offNote = await p.locator(".food-pace-note-off").innerText();
check("and says why", /only applies to today/.test(offNote), offNote);
const disabled = await p.locator(".food-pace-toggle .toggle-btn", { hasText: "Pacing" }).isDisabled();
check("the Pacing button is disabled off today", disabled);
await p.close();

// --- Goal Settings ---------------------------------------------------------
p = await b.newPage({ viewport: { width: 1200, height: 950 } });
p.on("pageerror", e => bad.push("pageerror: " + e.message));
const kv2 = { entries: JSON.stringify(entries), phase_goals: JSON.stringify([{ ...base, calGoal: 2100, proteinGoal: 150, fatGoal: 60, calBuffer: 100, proteinBuffer: 20 }]), daily_log: JSON.stringify(daily), habits_log: "{}", habits_targets: "{}" };
await p.route("**/rest/v1/**", (route) => {
  const url = new URL(route.request().url());
  const t2 = url.pathname.split("/rest/v1/")[1];
  const send = (x) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
  if (route.request().method() !== "GET") return send([]);
  if (t2 === "kv_store") { const k = (url.searchParams.get("key") || "").replace("eq.", ""); return send(kv2[k] != null ? { value: kv2[k] } : null); }
  return send([]);
});
await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: /Goal|Goals/ }).click();
await p.waitForSelector(".table-wrap table");
const carbCell = await p.locator("tbody tr").first().locator("td").nth(8).innerText();
check("goals table shows derived carbs", carbCell === "240g", carbCell);
const calCell = await p.locator("tbody tr").first().locator("td").nth(6).innerText();
check("goals table shows which way a cut's buffer leans", calCell.includes("+100"), calCell.replace("\n", " "));

await p.locator(".panel .btn-primary.sm").first().click();
await p.waitForSelector(".goal-macro-note");
const gnote = await p.locator(".goal-macro-note").innerText();
check("goal form spells out derived carbs", /Carbs: 240g\/day/.test(gnote), gnote.split("\n")[0].slice(0, 70));
check("goal form spells out the cut band above the goal", /On a cut/.test(gnote) && /2,100 – 2,200/.test(gnote), gnote.split("\n").pop().slice(0, 110));
check("goal form says protein ignores the phase", /same in every phase/.test(gnote) && /130 – 150/.test(gnote), gnote.split("\n").pop().slice(-90));
check("the carb goal input is gone", await p.locator(".goal-grid label", { hasText: "Carb goal" }).count() === 0);
check("buffer inputs are present", await p.locator(".goal-grid label", { hasText: "alert buffer" }).count() === 2);

// Over-allocated protein+fat is called out rather than silently clamping.
await p.locator(".goal-grid label", { hasText: "Protein goal" }).locator("input").fill("400");
await p.waitForTimeout(150);
const warn = await p.locator(".goal-macro-note").innerText();
check("over-allocated split is flagged", /already past/.test(warn) && await p.locator(".goal-macro-note-warn").count() === 1, warn.slice(0, 90));
await p.close();

await b.close();
console.log(bad.length ? "\nproblems:\n- " + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
