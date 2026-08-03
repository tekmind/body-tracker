import { chromium } from "playwright";
import { entries, daily, goals , blockWebfonts, LAUNCH } from "./seed.mjs";

const P = (id, date) => ({ id, date, lab_name: "Quest Diagnostics", panel_name: "Lipid Panel + CBC", source: "pdf", file_name: `labs-${id}.pdf`, note: null, created_at: `2026-0${id}-01` });
const mk = (id, pid, marker, name, cat, v, unit, lo, hi, txt, flag) => ({
  id, panel_id: pid, marker, name, category: cat, value: v, value_text: null, unit,
  ref_low: lo, ref_high: hi, ref_text: txt, flag, sort_order: 0,
});
const panels = [P("2", "3/14/26"), P("1", "9/12/25")];
const results = [
  mk("a", "2", "cholesterol_total", "Cholesterol, Total", "Lipids", 186, "mg/dL", 100, 199, "100-199", "normal"),
  mk("b", "2", "ldl", "LDL Chol Calc (NIH)", "Lipids", 128, "mg/dL", null, 99, "<100", "high"),
  mk("c", "2", "hdl", "HDL Cholesterol", "Lipids", 41, "mg/dL", 39, null, ">39", "normal"),
  mk("i", "1", "ldl", "LDL-Cholesterol (calc)", "Lipids", 148, "mg/dL", null, 99, "<100", "high"),
];

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const kv = { entries: JSON.stringify(entries), phase_goals: JSON.stringify(goals), daily_log: JSON.stringify(daily), habits_log: "{}", habits_targets: "{}" };

for (const [w, tag] of [[1200, "desktop"], [390, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
 await blockWebfonts(p);
  p.on("pageerror", e => bad.push(`${tag} pageerror: ${e.message}`));
  await p.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url());
    const t = url.pathname.split("/rest/v1/")[1];
    const send = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (route.request().method() !== "GET") return send([]);
    if (t === "kv_store") { const k = (url.searchParams.get("key") || "").replace("eq.", ""); return send(kv[k] != null ? { value: kv[k] } : null); }
    if (t === "lab_panels") return send(panels);
    if (t === "lab_results") return send(results);
    return send([]);
  });
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });

  const probe = (cls) => `(() => { const el = document.createElement("div"); el.className = ${JSON.stringify(cls)}; document.querySelector(".dash").appendChild(el); const s = getComputedStyle(el); const out = { bg: s.backgroundColor }; el.remove(); return out; })()`;

  const home = await p.evaluate(() => {
    const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    const em = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return (parseFloat(s.letterSpacing) / parseFloat(s.fontSize)).toFixed(3); };
    const tint = (cls) => { const el = document.createElement("div"); el.className = cls; document.querySelector(".dash").appendChild(el); const bg = getComputedStyle(el).backgroundColor; el.remove(); return bg; };
    return {
      labelFont: cs(".stat-label", "fontFamily"), labelSize: cs(".stat-label", "fontSize"), labelCase: cs(".stat-label", "textTransform"),
      valueFont: cs(".stat-value", "fontFamily"), valueLs: em(".stat-value"),
      subFont: cs(".stat-sub", "fontFamily"), subSize: cs(".stat-sub", "fontSize"),
      cardRadius: cs(".stat-card", "borderTopLeftRadius"), cardBg: cs(".stat-card", "backgroundColor"),
      tintGood: tint("hero-bf good"), tintBad: tint("hero-bf bad"),
    };
  });

  await p.locator(".tab-btn", { hasText: "Labs" }).click();
  await p.waitForSelector(".labs-summary-tile");

  const labs = await p.evaluate(() => {
    const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    const em = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return (parseFloat(s.letterSpacing) / parseFloat(s.fontSize)).toFixed(3); };
    const stragglers = new Set();
    for (const el of document.querySelectorAll(".labs-view *")) {
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const f = getComputedStyle(el).fontFamily;
      if (/Mono|Grotesk/.test(f)) stragglers.add(`${el.className || el.tagName}: ${f.split(",")[0]}`);
    }
    const tint = (cls) => { const el = document.createElement("div"); el.className = cls; document.querySelector(".labs-view").appendChild(el); const bg = getComputedStyle(el).backgroundColor; el.remove(); return bg; };
    return {
      labelFont: cs(".labs-summary-label", "fontFamily"), labelSize: cs(".labs-summary-label", "fontSize"), labelCase: cs(".labs-summary-label", "textTransform"),
      valueFont: cs(".labs-summary-value", "fontFamily"), valueLs: em(".labs-summary-value"),
      subFont: cs(".labs-summary-sub", "fontFamily"), subSize: cs(".labs-summary-sub", "fontSize"),
      cardRadius: cs(".labs-summary-tile", "borderTopLeftRadius"), cardBg: cs(".labs-summary-tile", "backgroundColor"),
      tintGood: tint("labs-summary-tile labs-tile-ok"), tintBad: tint("labs-summary-tile labs-tile-off"),
      inPanel: !!document.querySelector(".panel .labs-summary-tile"),
      stragglers: [...stragglers],
      overflow: document.body.scrollWidth - document.documentElement.clientWidth,
    };
  });

  check(`${tag}: card label matches Home`, labs.labelFont === home.labelFont && labs.labelSize === home.labelSize && labs.labelCase === home.labelCase,
    `${labs.labelFont.split(",")[0]} ${labs.labelSize} ${labs.labelCase}`);
  check(`${tag}: big number matches Home`, labs.valueFont === home.valueFont && labs.valueLs === home.valueLs,
    `${labs.valueFont.split(",")[0]} ls=${labs.valueLs}em`);
  check(`${tag}: sub-line matches Home`, labs.subFont === home.subFont && labs.subSize === home.subSize, labs.subSize);
  check(`${tag}: card radius + background match Home`, labs.cardRadius === home.cardRadius && labs.cardBg === home.cardBg,
    `${labs.cardRadius} ${labs.cardBg}`);
  check(`${tag}: tints match the Home hero cards`, labs.tintGood === home.tintGood && labs.tintBad === home.tintBad,
    `${labs.tintGood} / ${labs.tintBad}`);
  check(`${tag}: summary cards sit on the page, not inside a panel`, !labs.inPanel);
  check(`${tag}: no mono or Grotesk left in the Labs tab`, labs.stragglers.length === 0, labs.stragglers.slice(0, 4).join(" | "));
  check(`${tag}: no sideways overflow`, labs.overflow <= 1, `${labs.overflow}px`);

  // Result values and flag chips share the Food tab's status colours.
  const colours = await p.evaluate(() => {
    const off = document.querySelector(".lrr-value.lab-flag-off");
    const chip = document.querySelector(".labs-flag-chip");
    return { value: off ? getComputedStyle(off).color : null, chipBg: chip ? getComputedStyle(chip).backgroundColor : null };
  });
  check(`${tag}: out-of-range value uses the shared red`, colours.value === "rgb(165, 52, 42)", colours.value);
  check(`${tag}: flag chip uses the shared red tint`, colours.chipBg === "rgb(248, 221, 217)", colours.chipBg);

  // Sheets must not spill either.
  await p.locator(".labs-flag-chip").first().click();
  await p.waitForSelector(".labs-trend-chart");
  const sheetSpill = await p.evaluate(() => {
    const root = document.querySelector(".labs-sheet");
    const rr = root.getBoundingClientRect();
    let worst = 0;
    for (const el of root.querySelectorAll("*")) { const r = el.getBoundingClientRect(); if (r.width) worst = Math.max(worst, r.right - rr.right, rr.left - r.left); }
    return Math.round(worst);
  });
  check(`${tag}: trend sheet does not spill`, sheetSpill <= 1, `${sheetSpill}px`);

  await p.close();
}
await b.close();
console.log(bad.length ? "\nproblems:\n- " + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
