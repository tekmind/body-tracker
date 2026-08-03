// The Calories stat card should carry a green on-track badge, matching the
// green streak pill the alert banner shows for the same run of weeks.
import { chromium } from "playwright";
import { goals, habits , blockWebfonts, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const day = (n) => { const d = new Date(2026, 6, 29 - n); return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`; };
// calGoal in the seed is 1900. Build weeks that are under target, then a run
// that goes over, so both halves of the badge can be exercised.
const weeksWith = (cals, o = {}) => cals.map((c, i) => ({
  wk: i, date: day((cals.length - 1 - i) * 7), phase: "Cut",
  aW: 214 - i, aM: o.muscle ? 168 - i * 2 : 168, aF: 46 - i, aCal: c,
  steps: o.steps ?? 11000, notes: "",
}));

async function open(cals, o = {}) {
  const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
 await blockWebfonts(p);
  p.on("pageerror", e => bad.push("pageerror: " + e.message));
  const kv = { entries: JSON.stringify(weeksWith(cals, o)), phase_goals: JSON.stringify(goals),
    daily_log: "[]", habits_log: JSON.stringify(habits), habits_targets: "{}" };
  await p.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    const t = url.pathname.split("/rest/v1/")[1];
    const send = (x) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
    if (route.request().method() !== "GET") return send([{}]);
    if (t === "kv_store") { const k = (url.searchParams.get("key")||"").replace("eq.",""); return send(kv[k]!=null?{value:kv[k]}:null); }
    return send([]);
  });
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
  await p.waitForSelector(".stat-card");
  return p;
}
const calCard = (p) => p.locator(".stat-card", { hasText: "Calories" }).first();
const pillOf = async (p) => calCard(p).locator(".stat-sub span").first().evaluate((el) => ({
  text: el.textContent.trim(), bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color,
})).catch(() => null);
const badgeOf = async (p) => calCard(p).locator(".stat-alert-badge").evaluate((el) => ({
  text: el.textContent.trim(), cls: el.className, bg: getComputedStyle(el).backgroundColor,
  title: el.getAttribute("title"),
})).catch(() => null);

// --- three weeks at or under target -----------------------------------------
let p = await open([1700, 1750, 1800]);
let bdg = await badgeOf(p);
console.log("under target:", JSON.stringify(bdg));
check("an on-track run gets a badge", !!bdg);
check("it is the green one", /\bgood\b/.test(bdg?.cls || ""), bdg?.cls);
check("green means the app's good colour", bdg?.bg === "rgb(54, 135, 39)", bdg?.bg);
check("it counts the weeks", bdg?.text === "3w", bdg?.text);
check("and says what it means", /On track 3 weeks in a row/.test(bdg?.title || ""), bdg?.title);

// It should agree with the alert banner's own on-track pill.
const bannerPill = await p.locator(".ontrack-pill").first().innerText().catch(() => null);
check("it matches the alert banner's pill", bannerPill === null || bannerPill === bdg?.text, `card ${bdg?.text} vs banner ${bannerPill}`);
// The delta pill takes the card's verdict, so a green card has no red pill.
let pill = await pillOf(p);
console.log("pill (on track):", JSON.stringify(pill));
check("the delta pill is green when the card is", pill?.bg === "rgb(221, 239, 212)", JSON.stringify(pill));
await p.close();

// --- one week on track, after a bad run -------------------------------------
p = await open([2400, 2400, 1700]);
bdg = await badgeOf(p);
console.log("one good week:", JSON.stringify(bdg));
check("a single week back on track still shows green", /\bgood\b/.test(bdg?.cls || ""), bdg?.cls);
check("counting just that week", bdg?.text === "1w", bdg?.text);
check("and reads as one week, not \"1 weeks\"", /On track 1 week in a row/.test(bdg?.title || ""), bdg?.title);
await p.close();

// --- over target: the warning badges still win ------------------------------
p = await open([1700, 2400, 2400]);
bdg = await badgeOf(p);
console.log("two over:", JSON.stringify(bdg));
check("two weeks over target is amber, not green", /\bwarn\b/.test(bdg?.cls || ""), bdg?.cls);
check("and counts the misses", bdg?.text === "2w", bdg?.text);
pill = await pillOf(p);
console.log("pill (warn):", JSON.stringify(pill));
check("the pill goes amber with the card", pill?.bg === "rgb(253, 241, 221)", JSON.stringify(pill));
await p.close();

p = await open([2400, 2400, 2400]);
bdg = await badgeOf(p);
console.log("three over:", JSON.stringify(bdg));
check("three weeks over target is red", /\bbad\b/.test(bdg?.cls || ""), bdg?.cls);
pill = await pillOf(p);
console.log("pill (bad):", JSON.stringify(pill));
check("and so does the pill", pill?.bg === "rgb(248, 221, 217)", JSON.stringify(pill));
await p.close();

// --- badge width and alert spacing hold at two digits ------------------------
// Twelve weeks over target: a 12w streak on calories and steps, an 11w on
// muscle, and 1w green ones elsewhere — every badge width in one screen.
p = await open(Array.from({ length: 12 }, () => 2400), { steps: 3000, muscle: true });
const widths = await p.$$eval(".stat-alert-badge", els => els.map(e => ({
  text: e.textContent.trim(), w: Math.round(e.getBoundingClientRect().width),
})));
console.log("badge widths:", JSON.stringify(widths));
const uniq = [...new Set(widths.map(x => x.w))];
check("a two-digit streak actually appears", widths.some(x => /^\d\dw$/.test(x.text)),
  widths.map(x => x.text).join(","));
check("every badge is the same width", uniq.length === 1, JSON.stringify(uniq));
check("and none is squeezed", uniq[0] >= 46, `${uniq[0]}px`);

const gaps = await p.evaluate(() => {
  const banner = document.querySelector(".banner-alert, .banner-ontrack");
  const stack = document.querySelector(".notif-stack");
  if (!banner || !stack) return null;
  const rows = [...stack.querySelectorAll(".notif-row")];
  return {
    under: Math.round(stack.getBoundingClientRect().top - banner.getBoundingClientRect().bottom),
    between: rows.length >= 2
      ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom) : null,
  };
});
console.log("alert gaps:", JSON.stringify(gaps));
check("the alerts are evenly spaced", gaps && gaps.between != null && gaps.under === gaps.between,
  JSON.stringify(gaps));

// The streak pills inside the banners follow the same rule as the card badges.
const pills = await p.$$eval(".notif-weeks", els => els.map(e => ({
  text: e.textContent.trim(), w: Math.round(e.getBoundingClientRect().width) })));
console.log("banner pills:", JSON.stringify(pills));
const pw = [...new Set(pills.map(x => x.w))];
check("the banners show a two-digit streak too", pills.some(x => /^\d\dw$/.test(x.text)),
  pills.map(x => x.text).join(","));
check("mixed streaks, one pill width", pw.length === 1, JSON.stringify(pills));
check("and wide enough for three characters", pw[0] >= 40, `${pw[0]}px`);
await p.close();

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
