import { LAUNCH, blockWebfonts } from "./seed.mjs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5199";

// ---- in-memory stand-in for the two lab tables ----------------------------
let panels = [];
let results = [];
let nextId = 1;
const uid = () => `id-${nextId++}`;

const PARSED = {
  panel: {
    collected_date: "2026-03-14",
    lab_name: "Quest Diagnostics",
    panel_name: "Lipid Panel",
    source: "pdf",
    file_name: "labs-march.pdf",
    confidence: "high",
    note: "",
  },
  results: [
    { name: "Cholesterol, Total", value: 186, value_text: "", unit: "mg/dL", ref_low: 100, ref_high: 199, ref_text: "100-199", flag: null },
    { name: "LDL Chol Calc (NIH)", value: 128, value_text: "", unit: "mg/dL", ref_low: null, ref_high: 99, ref_text: "<100", flag: "high" },
    { name: "HDL Cholesterol", value: 41, value_text: "", unit: "mg/dL", ref_low: 39, ref_high: null, ref_text: ">39", flag: null },
    { name: "Triglycerides", value: 165, value_text: "", unit: "mg/dL", ref_low: null, ref_high: 149, ref_text: "<150", flag: "high" },
    { name: "Vitamin B-12", value: 512, value_text: "", unit: "pg/mL", ref_low: 232, ref_high: 1245, ref_text: "232-1245", flag: null },
  ],
};

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function main() {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await blockWebfonts(page);
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });

  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split("/rest/v1/")[1];
    const method = req.method();

    if (method === "GET" && table === "lab_panels") return json(route, panels);
    if (method === "GET" && table === "lab_results") return json(route, results);
    if (method === "GET") return json(route, []);

    if (method === "POST" && table === "lab_panels") {
      const row = { ...req.postDataJSON(), id: uid(), created_at: new Date().toISOString() };
      panels.push(row);
      return json(route, row, 201);
    }
    if (method === "POST" && table === "lab_results") {
      const rows = req.postDataJSON().map((r, i) => ({ ...r, id: uid(), sort_order: r.sort_order ?? i }));
      results.push(...rows);
      return json(route, rows, 201);
    }
    if (method === "DELETE") {
      const id = (url.searchParams.get("id") || "").replace("eq.", "");
      panels = panels.filter(p => p.id !== id);
      results = results.filter(r => r.id !== id && r.panel_id !== id);
      return json(route, []);
    }
    if (method === "PATCH") {
      const id = (url.searchParams.get("id") || "").replace("eq.", "");
      const patch = req.postDataJSON();
      results = results.map(r => (r.id === id ? { ...r, ...patch } : r));
      return json(route, results.find(r => r.id === id));
    }
    return json(route, []);
  });

  await page.route("**/api/lab-parse", (route) => json(route, PARSED));

  const check = (label, ok, extra = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
    if (!ok) problems.push(label);
  };

  await page.goto(BASE, { waitUntil: "networkidle" });

  // --- nav scrolls rather than shrinking -----------------------------------
  const bar = page.locator(".tab-bar");
  const nav = await bar.evaluate((el) => {
    const btn = el.querySelector(".tab-btn");
    return {
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
      fontSize: parseFloat(getComputedStyle(btn).fontSize),
      wrap: getComputedStyle(el).flexWrap,
      barRight: el.getBoundingClientRect().right,
      bodyScrollW: document.body.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
  });
  check("nav is horizontally scrollable", nav.overflowX === "auto" && nav.scrollW > nav.clientW,
    `scrollW=${nav.scrollW} clientW=${nav.clientW}`);
  check("nav does not wrap", nav.wrap === "nowrap");
  check("nav text is not shrunk", nav.fontSize >= 15, `${nav.fontSize}px`);
  check("page itself does not scroll sideways", nav.bodyScrollW <= nav.docClientW + 1,
    `body=${nav.bodyScrollW} doc=${nav.docClientW}`);

  const labsTab = page.locator(".tab-btn", { hasText: "Labs" });
  check("Labs tab exists", await labsTab.count() === 1);

  // Scroll it into view the way a user would, then open it.
  await labsTab.scrollIntoViewIfNeeded();
  await labsTab.click();
  await page.waitForSelector(".labs-view", { timeout: 5000 });
  check("Labs tab opens", await page.locator(".labs-empty").count() === 1);

  // Active tab auto-centres after a change.
  const centred = await bar.evaluate((el) => {
    const a = el.querySelector(".tab-btn.active").getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return a.left >= b.left - 2 && a.right <= b.right + 2;
  });
  check("active tab is scrolled into view", centred);

  // --- import a report ------------------------------------------------------
  await page.setInputFiles('.labs-head input[type=file]', {
    name: "labs-march.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake"),
  });
  await page.waitForSelector(".labs-draft-rows", { timeout: 8000 });

  const rowCount = await page.locator(".labs-draft-row").count();
  check("all parsed rows land in the review sheet", rowCount === 5, `${rowCount} rows`);

  const dateVal = await page.locator(".labs-meta-grid input").first().inputValue();
  check("collection date converts to M/D/YY", dateVal === "3/14/26", dateVal);

  const mapped = await page.locator(".labs-draft-mapped").allInnerTexts();
  check("LDL Chol Calc (NIH) maps to LDL cholesterol", mapped[1].includes("LDL cholesterol"), mapped[1]);
  check("Vitamin B-12 maps to Vitamin B12", mapped[4].includes("Vitamin B12"), mapped[4]);

  check("nothing saved before pressing Save", panels.length === 0);

  // How the blood was taken. Every field defaults to unknown and must stay
  // there unless set: most reports print none of it, and a guessed value gets
  // read as fact by every written report afterwards.
  const ctx = page.locator(".labs-draw-ctx");
  check("the review sheet asks how it was drawn", await ctx.count() === 1);
  check("and says it's fine not to know", /leave blank if you don't know/i.test(await ctx.innerText()));
  const fastedDefault = await ctx.locator("select").first().inputValue();
  const infusionDefault = await ctx.locator("select").nth(1).inputValue();
  check("fasted defaults to unknown, not to a guess", fastedDefault === "", `"${fastedDefault}"`);
  check("the infusion relation defaults to unknown too", infusionDefault === "", `"${infusionDefault}"`);

  await ctx.locator("input").fill("~noon");
  await ctx.locator("select").nth(1).selectOption("trough");

  // Untick one row, then save.
  await page.locator(".labs-draft-row").nth(2).locator('input[type=checkbox]').uncheck();
  await page.locator(".labs-draft-actions .btn-primary").click();
  await page.waitForSelector(".labs-panels", { timeout: 5000 });

  check("the draw context is saved with the panel",
    panels[0]?.drawn_at === "~noon" && panels[0]?.infusion_relation === "trough",
    JSON.stringify({ drawn_at: panels[0]?.drawn_at, fasted: panels[0]?.fasted, infusion_relation: panels[0]?.infusion_relation }));
  check("what wasn't set is stored as null rather than an empty guess",
    panels[0]?.fasted === null, String(panels[0]?.fasted));

  check("panel saved", panels.length === 1);
  check("unticked row was skipped", results.length === 4, `${results.length} results`);
  const ldl = results.find(r => r.marker === "ldl");
  check("LDL stored under its canonical marker", !!ldl && ldl.name === "LDL Chol Calc (NIH)");
  check("LDL keeps the lab's own high flag", ldl?.flag === "high");
  const chol = results.find(r => r.marker === "cholesterol_total");
  check("in-range result flagged normal from the range", chol?.flag === "normal", String(chol?.flag));

  // --- the saved panel renders ---------------------------------------------
  await page.waitForSelector(".labs-result-row", { timeout: 5000 });
  const shown = await page.locator(".labs-result-row").count();
  check("saved results render", shown === 4, `${shown} rows`);
  const flagged = await page.locator(".labs-flag-chip").count();
  check("out-of-range chips appear", flagged === 2, `${flagged} chips`);

  // --- trend sheet ----------------------------------------------------------
  await page.locator(".labs-flag-chip").first().click();
  await page.waitForSelector(".labs-trend-chart", { timeout: 5000 });
  // The sheet must be styled by this tab's own stylesheet — FoodTab's is only
  // in the document while the Food tab is mounted.
  const overlay = await page.locator(".labs-sheet-backdrop").evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { pos: cs.position, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  });
  check("trend sheet is a fixed overlay covering the viewport",
    overlay.pos === "fixed" && overlay.w >= overlay.vw - 1 && overlay.h >= overlay.vh - 1,
    `${overlay.pos} ${Math.round(overlay.w)}x${Math.round(overlay.h)} vs ${overlay.vw}x${overlay.vh}`);
  const dots = await page.locator(".labs-trend-chart .recharts-line circle").count();
  check("trend chart draws a point per reading", dots >= 1, `${dots} dots`);
  const rows = await page.locator(".labs-trend-row").count();
  check("trend sheet lists the readings", rows === 1, `${rows} rows`);
  await page.locator(".labs-sheet-head .icon-btn").click();

  // --- by-marker view -------------------------------------------------------
  await page.locator(".labs-view-toggle .toggle-btn", { hasText: "By marker" }).click();
  await page.waitForSelector(".labs-marker-row");
  const markerCount = await page.locator(".labs-marker-row").count();
  check("marker view lists one row per marker", markerCount === 4, `${markerCount}`);
  await page.locator(".labs-marker-search input").fill("ldl");
  check("marker search filters", await page.locator(".labs-marker-row").count() === 1);

  // --- nothing overflows on a phone ----------------------------------------
  await page.locator(".labs-marker-search input").fill("");
  const overflow = await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
  check("labs tab fits the viewport width", overflow <= 1, `${overflow}px over`);

  // Nothing inside the panels may stick out past its own panel either — the
  // page can look fine while a tile is quietly clipped.
  await page.locator(".labs-view-toggle .toggle-btn", { hasText: "By report" }).click();
  await page.waitForSelector(".labs-summary-tile");
  const spill = await page.evaluate(() => {
    let worst = 0;
    for (const panel of document.querySelectorAll(".labs-view .panel")) {
      const pr = panel.getBoundingClientRect();
      for (const child of panel.querySelectorAll("*")) {
        const cr = child.getBoundingClientRect();
        if (cr.width) worst = Math.max(worst, cr.right - pr.right, pr.left - cr.left);
      }
    }
    return Math.round(worst);
  });
  check("nothing overflows its panel", spill <= 1, `${spill}px past the edge`);

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll checks passed.");
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
