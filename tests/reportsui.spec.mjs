// Reports and medical history, on screen.
//
// The brief and the parser are checked without a browser in
// tests/labreport.spec.mjs. What that can't catch is everything between the
// data and the eye: a report card that never renders, markdown that reaches
// the page as literal asterisks, an "update" offered when nothing new came in,
// or a history entry that saves and then isn't there.
//
// Both of the last two bugs in this file were invisible to the build and to
// every unit check — one was a comment inside a JSX conditional, one was a
// mangled template literal — so these read the rendered DOM.

import { LAUNCH, blockWebfonts } from "./seed.mjs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5199";

const PANELS = [
  { id: "p1", date: "4/6/26", lab_name: "QDx", panel_name: "GI Panel", source: "portal", created_at: "2026-04-06T00:00:00Z" },
  { id: "p2", date: "3/9/23", lab_name: "QDx", panel_name: "Stool Panel", source: "portal", created_at: "2023-03-09T00:00:00Z" },
];

const row = (id, panel_id, marker, name, value, unit, flag = null, extra = {}) => ({
  id, panel_id, marker, name, category: "Other", value, value_text: "", unit,
  ref_low: null, ref_high: null, ref_text: "", flag, sort_order: 0, ...extra,
});

const RESULTS = [
  row("r1", "p1", "calprotectin", "Calprotectin, Stool", 160, "mg/kg"),
  row("r2", "p2", "calprotectin", "Calprotectin, Stool", 18.7, "mg/kg"),
  row("r3", "p1", "crp", "C-REACTIVE PROTEIN", 2.1, "mg/L", null, { ref_low: 0, ref_high: 5 }),
];

const HISTORY = [
  { id: "h1", kind: "condition", label: "Crohn's disease", detail: "ileal", started: "2011", ended: null, active: true, sort_order: 0 },
  { id: "h2", kind: "medication", label: "Azathioprine", detail: null, started: "2012", ended: "2019", active: false, sort_order: 1 },
];

const BODY = `# Crohn's / IBD — August 2026

Calprotectin has climbed from **18.7 to 160** while CRP stayed normal.

## What changed

- Calprotectin rose eightfold
- CRP did not move`;

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

async function openCrohns(page, { reports = [], history = HISTORY } = {}) {
  const saved = [];
  let briefSeen = null;
  let modeSeen = null;

  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request();
    const table = new URL(req.url()).pathname.split("/rest/v1/")[1];
    if (req.method() === "POST") {
      const sent = JSON.parse(req.postData() || "{}");
      const made = { id: `new${saved.length}`, created_at: new Date().toISOString(), ...sent };
      saved.push({ table, body: sent });
      return json(route, made);
    }
    if (req.method() !== "GET") return json(route, []);
    if (table === "lab_panels") return json(route, PANELS);
    if (table === "lab_results") return json(route, RESULTS);
    if (table === "lab_reports") return json(route, reports);
    if (table === "medical_history") return json(route, history);
    return json(route, []);
  });

  await page.route("**/api/lab-report", async (route) => {
    const sent = JSON.parse(route.request().postData() || "{}");
    briefSeen = sent.brief;
    modeSeen = sent.mode;
    return json(route, { title: "Crohn's / IBD — August 2026", summary: "Calprotectin has climbed.", body: BODY, model: "claude-fable-5", effort: "medium" });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const tab = page.locator(".tab-btn", { hasText: "Labs" });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await page.waitForSelector(".labs-syscards", { timeout: 8000 });
  await page.locator(".labs-syscard", { hasText: "Crohn" }).click();
  await page.waitForSelector(".labs-reports", { timeout: 8000 });

  return { saved, brief: () => briefSeen, mode: () => modeSeen };
}

async function main() {
  const browser = await chromium.launch(LAUNCH);
  const problems = [];

  // ---- a system with no report yet ----------------------------------------
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await blockWebfonts(page);
  page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
  const ctx = await openCrohns(page);

  const card = page.locator(".labs-reports");
  check("the system's screen carries a Reports card", await card.count() === 1);
  const cardText = await card.innerText();
  check("with no report yet, the button offers to write one", /Write a report/.test(cardText), cardText.replace(/\n/g, " | "));
  check("it says what a report costs in time", /about a minute/i.test(cardText));
  check("the medical history is reachable from the same card", /Medical history/.test(cardText), cardText.replace(/\n/g, " | "));
  check("the history count is real, not a placeholder", /2 entries/.test(cardText), cardText.replace(/\n/g, " | "));

  // The card is above the marker cards: the written read is what you came for.
  const order = await page.evaluate(() => {
    const c = document.querySelector(".labs-reports"), m = document.querySelector(".labs-zoom-card");
    return c && m ? c.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING ? "before" : "after" : "missing";
  });
  check("it sits above the marker cards", order === "before", order);

  // ---- writing one --------------------------------------------------------
  await page.locator(".labs-reports button", { hasText: "Write a report" }).click();
  await page.waitForSelector(".labs-report", { timeout: 8000 });

  check("the first report is asked for as a first report", ctx.mode() === "first", String(ctx.mode()));

  const brief = ctx.brief() || "";
  check("the brief carries every reading, not just the latest", /3\/9\/23: 18\.7/.test(brief) && /4\/6\/26: 160/.test(brief),
    brief.slice(0, 0));
  check("the brief carries the medical history", /Crohn's disease/.test(brief) && /Azathioprine/.test(brief));
  check("a drug stopped in 2019 is still in the brief", /no longer current/.test(brief));

  const report = page.locator(".labs-report");
  const reportText = await report.innerText();
  check("the report renders", await report.count() === 1);
  check("markdown is rendered, not shown raw", !/\*\*|^#\s/m.test(reportText), reportText.slice(0, 120).replace(/\n/g, " | "));
  check("bold reaches the page as bold", await report.locator("strong", { hasText: "18.7 to 160" }).count() === 1);
  check("a section heading is a heading element", await report.locator("h3", { hasText: "What changed" }).count() === 1);
  check("the bullets are a list", await report.locator("ul li").count() === 2, String(await report.locator("ul li").count()));

  // Provenance: which model wrote it and when, since this gets re-read later.
  const foot = await page.locator(".labs-zoom-foot").innerText();
  check("the report says which model wrote it", /claude-fable-5/.test(foot), foot.replace(/\n/g, " | "));
  check("the report says the decisions stay with the care team", /care team/.test(foot));

  // What actually got stored.
  const stored = ctx.saved.find(s => s.table === "lab_reports")?.body || {};
  check("the whole report body is saved, not just the summary", String(stored.body || "").includes("CRP did not move"));
  check("the system it belongs to is saved", stored.system_key === "ibd", String(stored.system_key));
  check("the draws it read are recorded so the next one knows what's new",
    Array.isArray(stored.covered_panel_ids) && stored.covered_panel_ids.includes("p1") && stored.covered_panel_ids.includes("p2"),
    JSON.stringify(stored.covered_panel_ids));
  check("the model is recorded with it", stored.model === "claude-fable-5", String(stored.model));

  await page.close();

  // ---- a system whose report already covers everything --------------------
  const page2 = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await blockWebfonts(page2);
  page2.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
  await openCrohns(page2, {
    reports: [{
      id: "rep1", system_key: "ibd", system_name: "Crohn's / IBD", title: "Earlier read",
      summary: "Calprotectin was quiet.", body: BODY, model: "claude-fable-5", effort: "medium",
      covered_panel_ids: ["p1", "p2"], latest_panel_date: "4/6/26", marker_count: 2,
      prev_report_id: null, created_at: "2026-05-01T00:00:00Z",
    }],
  });

  const card2 = await page2.locator(".labs-reports").innerText();
  check("with nothing new it says so rather than inviting a rewrite",
    /Nothing new since the last report/.test(card2), card2.replace(/\n/g, " | "));
  check("and the button stops pushing for one", /Write another/.test(card2) && !/Update report/.test(card2), card2.replace(/\n/g, " | "));
  // A green button inviting the action the line beneath it argues against
  // reads as a recommendation, and it isn't one.
  const emphasis = await page2.locator(".labs-reports-head button").getAttribute("class");
  check("it isn't styled as the thing to do", /btn-ghost/.test(emphasis || ""), String(emphasis));
  check("the existing report is listed with its summary",
    /Earlier read/.test(card2) && /Calprotectin was quiet/.test(card2), card2.replace(/\n/g, " | "));

  // ---- a draw the last report never saw -----------------------------------
  await page2.close();
  const page3 = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await blockWebfonts(page3);
  page3.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
  const ctx3 = await openCrohns(page3, {
    reports: [{
      id: "rep1", system_key: "ibd", system_name: "Crohn's / IBD", title: "Earlier read",
      summary: "Calprotectin was quiet.", body: BODY, model: "claude-fable-5",
      covered_panel_ids: ["p2"], latest_panel_date: "3/9/23", marker_count: 2,
      prev_report_id: null, created_at: "2024-05-01T00:00:00Z",
    }],
  });

  const card3 = await page3.locator(".labs-reports").innerText();
  check("a draw the last report missed is counted as new",
    /1 new result set since the last report/.test(card3), card3.replace(/\n/g, " | "));

  await page3.locator(".labs-reports button", { hasText: "Update report" }).click();
  await page3.waitForSelector(".labs-report", { timeout: 8000 });
  check("an update is asked for as an update", ctx3.mode() === "update", String(ctx3.mode()));
  check("the previous report is handed over so it can say what changed",
    /previous report in this thread/i.test(ctx3.brief() || ""));
  const stored3 = ctx3.saved.find(s => s.table === "lab_reports")?.body || {};
  check("the new report links back to the one before it", stored3.prev_report_id === "rep1", String(stored3.prev_report_id));

  await page3.close();

  // ---- medical history ----------------------------------------------------
  const page4 = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await blockWebfonts(page4);
  page4.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
  const ctx4 = await openCrohns(page4);
  await page4.locator(".labs-reports button", { hasText: "Medical history" }).click();
  await page4.waitForSelector(".labs-hist-group", { timeout: 8000 });

  const histText = await page4.locator(".labs-view").innerText();
  check("existing history is grouped by kind", /Condition/.test(histText) && /Medication/.test(histText), histText.replace(/\n/g, " | ").slice(0, 200));
  // The badge is uppercased by CSS, so innerText reads "PAST".
  check("a stopped medication is shown as past rather than current", /Azathioprine/.test(histText) && /\bpast\b/i.test(histText));
  check("its dates read as a span", /2012 to 2019/.test(histText));
  check("an ongoing condition reads as ongoing", /since 2011/.test(histText));

  await page4.locator("button", { hasText: "Add an entry" }).click();
  await page4.waitForSelector(".labs-hist-edit", { timeout: 4000 });
  await page4.selectOption(".labs-hist-edit select", "medication");
  await page4.locator(".labs-field-wide input").first().fill("Infliximab");
  await page4.locator(".labs-field input").nth(2).fill("2019");
  await page4.locator(".labs-hist-edit button", { hasText: "Save" }).click();
  await page4.waitForTimeout(400);

  const newEntry = ctx4.saved.find(s => s.table === "medical_history")?.body || {};
  check("a new entry saves what was typed", newEntry.label === "Infliximab", JSON.stringify(newEntry));
  check("its kind is saved", newEntry.kind === "medication", String(newEntry.kind));
  check("its start date is saved", newEntry.started === "2019", String(newEntry.started));
  check("an entry with no end date is current", newEntry.active === true && newEntry.ended === null, JSON.stringify(newEntry));

  await page4.close();

  check("nothing threw while rendering any of it", problems.length === 0, problems.join(" | "));

  await browser.close();
  console.log(failed ? `\n${failed} problem(s)` : "\nall good");
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.log("FAIL  spec crashed"); console.error(e); process.exit(1); });
