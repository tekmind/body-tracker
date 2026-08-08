// The pinned system stat cards at the top of the Labs tab.
//
// Each card leads with its system's headline marker — calprotectin for
// Crohn's, vitamin D for vitamins, total testosterone for hormones, glucose
// for metabolic — because that is the number the owner checks first. What a
// person would notice if this broke: a card showing some other marker's
// value, a flagged count that doesn't match the system view, or a tap that
// doesn't land on the expanded system.

import { LAUNCH, blockWebfonts } from "./seed.mjs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5199";

const PANELS = [
  { id: "p1", date: "4/6/26", lab_name: "QDx", panel_name: "GI Panel", source: "portal", file_name: "", note: "", created_at: "2026-04-06T00:00:00Z" },
  { id: "p2", date: "3/9/23", lab_name: "QDx", panel_name: "Stool Panel", source: "portal", file_name: "", note: "", created_at: "2023-03-09T00:00:00Z" },
  { id: "p3", date: "5/7/26", lab_name: "Quest", panel_name: "CMP", source: "pdf", file_name: "", note: "", created_at: "2026-05-07T00:00:00Z" },
];

const row = (id, panel_id, marker, name, value, unit, flag = null, extra = {}) => ({
  id, panel_id, marker, name, category: "Other", value, value_text: "", unit,
  ref_low: null, ref_high: null, ref_text: "", flag, sort_order: 0, ...extra,
});

const RESULTS = [
  row("r1", "p1", "calprotectin", "Calprotectin, Stool", 160, "mg/kg"),
  row("r2", "p2", "calprotectin", "Calprotectin, Stool", 18.7, "mg/kg"),
  row("r3", "p3", "vitamin_d", "VITAMIN D,25-OH", 26, "ng/mL", "low", { ref_low: 30, ref_high: 100 }),
  row("r4", "p3", "testosterone_total", "TESTOSTERONE, TOTAL", 364, "ng/dL"),
  row("r5", "p3", "glucose", "GLUCOSE", 129, "mg/dL", "high", { ref_low: 65, ref_high: 99 }),
];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

async function main() {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await blockWebfonts(page);
  const problems = [];
  page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));

  await page.route("**/rest/v1/**", async (route) => {
    const table = new URL(route.request().url()).pathname.split("/rest/v1/")[1];
    if (table === "lab_panels") return json(route, PANELS);
    if (table === "lab_results") return json(route, RESULTS);
    return json(route, []);
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const tab = page.locator(".tab-btn", { hasText: "Labs" });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await page.waitForSelector(".labs-syscards", { timeout: 8000 });

  const cards = page.locator(".labs-syscard");
  check("all four pinned systems get a card", await cards.count() === 4, `${await cards.count()}`);

  const text = (i) => cards.nth(i).innerText();
  const all = await Promise.all([0, 1, 2, 3].map(i => text(i)));
  const find = (label) => all.find(t => t.includes(label)) || "";

  // Headlines: the number the owner checks first, not whatever sorts first.
  check("Crohn's card leads with calprotectin", /160/.test(find("Crohn")), find("Crohn").replace(/\n/g, " | "));
  check("Crohn's card shows the rise since remission", /\+141/.test(find("Crohn")), find("Crohn").replace(/\n/g, " | "));
  check("Vitamins card leads with vitamin D", /26\s*ng\/mL/.test(find("Vitamins")), find("Vitamins").replace(/\n/g, " | "));
  check("Hormones card leads with total testosterone", /364/.test(find("Hormones")), find("Hormones").replace(/\n/g, " | "));
  check("Metabolic card leads with glucose", /129/.test(find("Metabolic")), find("Metabolic").replace(/\n/g, " | "));

  // Flag counts come from the same reckoning as the system view.
  check("Vitamins card counts its flagged marker", /1 flagged/.test(find("Vitamins")), find("Vitamins").replace(/\n/g, " | "));
  check("Hormones card has nothing flagged", !/flagged/.test(find("Hormones")), find("Hormones").replace(/\n/g, " | "));

  // A flagged headline is colored as such.
  const dCard = cards.nth(all.findIndex(t => t.includes("Vitamins")));
  check("a low vitamin D reads as out of range", await dCard.locator(".lsc-value.lab-flag-off").count() === 1);

  // Tap-through: the card is a shortcut to its expanded system.
  await cards.nth(all.findIndex(t => t.includes("Crohn"))).click();
  await page.waitForSelector(".labs-panel-head", { timeout: 5000 });
  const openHead = page.locator(".labs-panel-head", { hasText: "Crohn's / IBD" });
  check("tapping opens the systems view on that system", await openHead.count() === 1);
  const body = await page.locator(".labs-panel-body").innerText();
  check("the tapped system is expanded", body.includes("Calprotectin") || body.includes("calprotectin"), body.slice(0, 80));

  // Phone-width discipline, same rule as the rest of the tab.
  const over = await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
  check("cards don't push the page sideways", over <= 1, `${over}px over`);

  await browser.close();
  for (const p of problems) check(p, false);
  console.log(failed ? `\n${failed} problem(s)` : "\nall good");
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.log("FAIL  spec crashed"); console.error(e); process.exit(1); });
