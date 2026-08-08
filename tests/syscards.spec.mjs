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
  // Bottom 13% of 250–1100: in range, but not the same news as 700.
  row("r4", "p3", "testosterone_total", "TESTOSTERONE, TOTAL", 364, "ng/dL", null, { ref_low: 250, ref_high: 1100 }),
  row("r5", "p3", "glucose", "GLUCOSE", 129, "mg/dL", "high", { ref_low: 65, ref_high: 99 }),
  row("r6", "p3", "vitamin_b12", "VITAMIN B12", 525, "pg/mL"),
  row("r7", "p2", "vitamin_b12", "VITAMIN B12", 269, "pg/mL"),
  row("r8", "p3", "crp", "C-REACTIVE PROTEIN", null, "mg/L", null, { value_text: "<3.0" }),
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
  check("all five pinned systems get a card", await cards.count() === 5, `${await cards.count()}`);

  const text = (i) => cards.nth(i).innerText();
  const all = await Promise.all([0, 1, 2, 3, 4].map(i => text(i)));
  const find = (label) => all.find(t => t.includes(label)) || "";

  // Headlines: the number the owner checks first, not whatever sorts first.
  check("Crohn's card leads with calprotectin", /160/.test(find("Crohn")), find("Crohn").replace(/\n/g, " | "));
  check("Crohn's card shows the rise since remission", /\+141/.test(find("Crohn")), find("Crohn").replace(/\n/g, " | "));
  check("Vitamins card leads with vitamin D", /26\s*ng\/mL/.test(find("Vitamins")), find("Vitamins").replace(/\n/g, " | "));
  check("Hormones card leads with total testosterone", /364/.test(find("Hormones")), find("Hormones").replace(/\n/g, " | "));
  check("Metabolic card leads with glucose", /129/.test(find("Metabolic")), find("Metabolic").replace(/\n/g, " | "));

  // Secondary headline markers ride under the hero number.
  check("B12 rides on the Vitamins card", /525\s*pg\/mL/.test(find("Vitamins")), find("Vitamins").replace(/\n/g, " | "));
  check("B12 shows its move since the last shot", /\+256/.test(find("Vitamins")), find("Vitamins").replace(/\n/g, " | "));

  // Inflammation is its own card, led by CRP even though the value is text.
  check("Inflammation card exists and leads with CRP", /<3\.0/.test(find("Inflammation")), find("Inflammation").replace(/\n/g, " | "));

  // Flag counts come from the same reckoning as the system view.
  check("Vitamins card counts its flagged marker", /1 flagged/.test(find("Vitamins")), find("Vitamins").replace(/\n/g, " | "));
  check("Hormones card has nothing flagged", !/flagged/.test(find("Hormones")), find("Hormones").replace(/\n/g, " | "));

  // A flagged headline is colored as such.
  const dCard = cards.nth(all.findIndex(t => t.includes("Vitamins")));
  check("a low vitamin D reads as out of range", await dCard.locator(".lsc-value.lab-flag-off").count() === 1);

  // The hero's range prints on the card — a number without its range is only
  // half a reading.
  check("the Vitamins card prints vitamin D's range", /range 30 – 100/.test(find("Vitamins")), find("Vitamins").replace(/\n/g, " | "));

  // Trend lines: every card with numeric history draws one, and a marker
  // with reference bounds shades its in-range band.
  const crohnCard = cards.nth(all.findIndex(t => t.includes("Crohn")));
  check("the Crohn's card draws a sparkline", await crohnCard.locator("svg.lw-spark polyline").count() === 1);
  check("the vitamin D sparkline shades its range band",
    await cards.nth(all.findIndex(t => t.includes("Vitamins"))).locator("svg.lw-spark rect.lw-band").count() === 1);
  check("the flagged hero's latest dot reads as out of range",
    await cards.nth(all.findIndex(t => t.includes("Vitamins"))).locator("svg.lw-spark .lw-dot-off").count() === 1);

  // The 80/20 grouping in By marker: what needs eyes sits at the top.
  await page.locator(".labs-view-toggle .toggle-btn", { hasText: "By marker" }).click();
  await page.waitForSelector(".labs-prio-head", { timeout: 5000 });
  const heads = (await page.locator(".labs-prio-head").allInnerTexts()).map(t => t.trim().split("\n")[0]);
  check("Needs attention leads the marker list", /needs attention/i.test(heads[0] || ""), heads.join(" / "));
  const firstSection = page.locator(".labs-prio").first();
  const firstNames = await firstSection.locator(".lmr-name").allInnerTexts();
  check("the flagged markers live in the top section",
    firstNames.some(n => /vitamin d/i.test(n)) && firstNames.some(n => /glucose/i.test(n)), firstNames.join(", "));
  check("marker rows print their range under the value",
    await firstSection.locator(".lmr-range", { hasText: "30 – 100" }).count() === 1);

  // Tap-through: the card opens that area's own screen.
  await cards.nth(all.findIndex(t => t.includes("Crohn"))).click();
  await page.waitForSelector(".labs-zoom-card", { timeout: 5000 });
  check("tapping a card opens that system's screen",
    (await page.locator(".labs-zoom-title").innerText()).includes("Crohn's / IBD"));
  check("the screen lists that system's markers",
    /calprotectin/i.test(await page.locator(".labs-view").innerText()));
  await page.locator(".labs-zoom-head button").click();
  await page.waitForSelector(".labs-syscard", { timeout: 5000 });

  // --- the system's own screen -------------------------------------------
  await page.locator(".labs-syscard", { hasText: "Vitamins" }).click();
  await page.waitForSelector(".labs-zoom-card", { timeout: 5000 });

  const zoom = await page.locator(".labs-view").innerText();
  check("the zoom screen names the system", /Vitamins & nutrition/.test(zoom), zoom.slice(0, 60));
  check("the verdict names what is out of range", /Vitamin D/.test(await page.locator(".labs-zoom-verdict").innerText()));
  check("the verdict reads as a problem", await page.locator(".labs-zoom-verdict-off").count() === 1);

  const zCard = page.locator(".labs-zoom-card", { hasText: "Vitamin D" });
  check("the flagged marker is first", (await page.locator(".labs-zoom-card").first().innerText()).includes("Vitamin D"));
  check("it is badged out of range", (await zCard.innerText()).includes("out of range"));
  check("the scale prints both ends of the range", (await zCard.innerText()).includes("30") && (await zCard.innerText()).includes("100"));
  check("the dot sits on the scale", await zCard.locator(".lzc-dot-off").count() === 1);

  // The point of this screen: explanation the compact rows have no room for.
  check("the marker explains what it is", /What it is\./.test(await zCard.innerText()));
  check("the marker explains what moves it", /What moves it\./.test(await zCard.innerText()));
  check("vitamin D's note mentions absorption", /malabsorption|absorption/i.test(await zCard.innerText()));

  // B12's note should be the ileum one — the notes are per-marker, not generic.
  const b12 = page.locator(".labs-zoom-card", { hasText: "Vitamin B12" });
  check("B12's note is B12's, not boilerplate", /ileum|ileal/i.test(await b12.innerText()), (await b12.innerText()).slice(0, 60));

  check("the screen carries the care-team caveat", /belongs with your care team/.test(zoom));

  // Amber: in range, but hugging the end that isn't the good one. Total
  // testosterone at 364 sits in the bottom 13% of 250–1100.
  await page.locator(".labs-zoom-head button").click();
  await page.waitForSelector(".labs-syscard", { timeout: 5000 });
  await page.locator(".labs-syscard", { hasText: "Hormones" }).click();
  await page.waitForSelector(".labs-zoom-card", { timeout: 5000 });
  const tCard = page.locator(".labs-zoom-card", { hasText: "Testosterone, total" });
  check("a bottom-of-range testosterone is badged near the edge", /low end of range/i.test(await tCard.innerText()), (await tCard.innerText()).slice(0, 70));
  check("its value reads amber, not red", await tCard.locator(".lzc-value.lab-flag-edge").count() === 1);
  check("its scale dot is amber", await tCard.locator(".lzc-dot-edge").count() === 1);
  check("the verdict mentions the near-edge marker", /near the edge/i.test(await page.locator(".labs-zoom-verdict").innerText()));

  // An app-supplied range must never masquerade as the lab's.
  await page.locator(".labs-zoom-head button").click();
  await page.waitForSelector(".labs-syscard", { timeout: 5000 });
  await page.locator(".labs-syscard", { hasText: "Crohn" }).click();
  await page.waitForSelector(".labs-zoom-card", { timeout: 5000 });
  const calpro = page.locator(".labs-zoom-card", { hasText: "calprotectin" });
  check("calprotectin flags against the app range", /out of range/.test(await calpro.innerText()));
  check("the borrowed range is labelled as such", /app reference/i.test(await calpro.innerText()));
  check("it says plainly the range isn't the lab's", /isn't from your lab/i.test(await calpro.innerText()));
  check("the verdict now counts calprotectin",
    /calprotectin/i.test(await page.locator(".labs-zoom-verdict").innerText()));

  await page.locator(".labs-zoom-head button").click();
  await page.waitForSelector(".labs-syscard", { timeout: 5000 });
  check("back returns to the labs overview", await page.locator(".labs-syscard").count() === 5);

  // Phone-width discipline, same rule as the rest of the tab.
  const over = await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
  check("cards don't push the page sideways", over <= 1, `${over}px over`);

  await browser.close();
  for (const p of problems) check(p, false);
  console.log(failed ? `\n${failed} problem(s)` : "\nall good");
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.log("FAIL  spec crashed"); console.error(e); process.exit(1); });
