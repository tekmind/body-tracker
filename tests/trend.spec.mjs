import { LAUNCH } from "./seed.mjs";
import { chromium } from "playwright";
const BASE = "http://localhost:5199";

// Two draws, six months apart, LDL improving.
const P = (id, date) => ({ id, date, lab_name: "Quest", panel_name: "Lipid Panel", source: "pdf", file_name: `${id}.pdf`, note: null, created_at: `2026-0${id}-01T00:00:00Z` });
const R = (id, panel_id, value) => ({
  id, panel_id, marker: "ldl", name: "LDL Chol Calc (NIH)", category: "Lipids",
  value, value_text: null, unit: "mg/dL", ref_low: null, ref_high: 99, ref_text: "<100",
  flag: value > 99 ? "high" : "normal", sort_order: 0,
});
let panels = [P("1", "9/12/25"), P("2", "3/14/26")];
let results = [R("r1", "1", 148), R("r2", "2", 96)];

const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const bad = [];
page.on("pageerror", e => bad.push("pageerror: " + e.message));
await page.route("**/rest/v1/**", r => {
  const t = new URL(r.request().url()).pathname.split("/rest/v1/")[1];
  return json(r, t === "lab_panels" ? panels : t === "lab_results" ? results : []);
});
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator(".tab-btn", { hasText: "Labs" }).click();
await page.waitForSelector(".labs-view");

const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

check("newest draw is listed first", (await page.locator(".labs-panel-date").first().innerText()) === "3/14/26");
check("latest draw is the one summarised", (await page.locator(".labs-summary-value").first().innerText()) === "3/14/26");
check("latest LDL is in range, so no flag chips", await page.locator(".labs-flag-chip").count() === 0);

await page.locator(".labs-view-toggle .toggle-btn", { hasText: "By marker" }).click();
await page.waitForSelector(".labs-marker-row");
check("two draws collapse to one marker row", await page.locator(".labs-marker-row").count() === 1);
const delta = await page.locator(".lmr-delta").innerText();
check("delta is latest minus previous", delta === "-52", delta);

await page.locator(".labs-marker-row").click();
await page.waitForSelector(".labs-trend-chart");
const dots = await page.locator(".labs-trend-chart .recharts-line circle").count();
check("both readings plot", dots === 2, `${dots}`);
const order = await page.locator(".ltr-date").allInnerTexts();
check("trend list is newest first", order[0] === "3/14/26" && order[1] === "9/12/25", order.join(", "));
const xs = await page.locator(".labs-trend-chart .recharts-xAxis .recharts-cartesian-axis-tick-value tspan").allTextContents();
check("chart x-axis runs oldest to newest", xs[0] === "9/12/25", xs.join(", "));
const band = await page.locator(".labs-trend-chart .recharts-reference-area").count();
check("one-sided range still draws a band", band === 1, `${band}`);
const legend = await page.locator(".labs-trend-legend").innerText();
check("legend quotes the range the report printed", legend.includes("<100"), legend);

await browser.close();
console.log(bad.length ? "\nproblems:\n- " + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
