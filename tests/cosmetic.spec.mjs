import { chromium } from "playwright";
import { mock, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

for (const [w, h, tag] of [[390, 780, "phone"], [1200, 900, "desktop"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on("pageerror", e => bad.push(`${tag} pageerror: ` + e.message));
  await mock(p);
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
  await p.locator(".tab-btn", { hasText: "Food" }).click();
  await p.waitForSelector(".macro-tile");

  // --- day nav: date and pill scaled up to sit with the weekday -----------
  const nav = await p.locator(".food-day-nav").evaluate((el) => {
    const px = (sel) => parseFloat(getComputedStyle(el.querySelector(sel)).fontSize);
    const box = (sel) => el.querySelector(sel).getBoundingClientRect();
    const dow = box(".food-day-dow"), date = box(".food-day-date"), pill = box(".food-today-pill");
    return {
      dow: px(".food-day-dow"), date: px(".food-day-date"), pill: px(".food-today-pill"),
      // Same line if their vertical spans overlap at all.
      sameLine: date.top < dow.bottom && pill.top < dow.bottom,
    };
  });
  check(`${tag}: the date matches the weekday's size`, nav.date === nav.dow, `${nav.date}px vs ${nav.dow}px`);
  check(`${tag}: the Today pill grew with it`, nav.pill >= 12 && nav.pill < nav.dow,
    `${nav.pill}px (weekday ${nav.dow}px)`);
  check(`${tag}: the day line doesn't wrap`, nav.sameLine);

  // --- week chart: target value sits on top of its dashed line ------------
  const chart = p.locator(".recharts-wrapper").last();
  await chart.scrollIntoViewIfNeeded();
  await p.waitForSelector(".recharts-reference-line text");

  const ref = await p.evaluate(() => {
    const wraps = document.querySelectorAll(".recharts-wrapper");
    const root = wraps[wraps.length - 1];
    const line = root.querySelector(".recharts-reference-line line").getBoundingClientRect();
    const text = root.querySelector(".recharts-reference-line text");
    const t = text.getBoundingClientRect();
    const plot = root.getBoundingClientRect();
    return {
      label: text.textContent,
      above: t.bottom <= line.top + 1,
      clipped: t.top < plot.top || t.right > plot.right,
      // Distance from the end of the text to the far end of the dashed line.
      fromFarEnd: Math.round(line.right - t.right),
      // How far the text's near edge is from the line's far end, as a share of
      // the chart: the end really means the end, not merely off-centre.
      startsAt: Math.round(line.right - t.left),
      plotW: Math.round(plot.width),
    };
  });
  check(`${tag}: the label names the target`, /^target [\d,]+$/.test(ref.label), ref.label);
  check(`${tag}: it sits on top of the dashed line`, ref.above);
  check(`${tag}: it isn't clipped by the chart's edges`, !ref.clipped);
  check(`${tag}: it ends at the far end of the line`, ref.fromFarEnd >= 0 && ref.fromFarEnd <= 10,
    `${ref.fromFarEnd}px from the end`);
  check(`${tag}: and stays well clear of the middle`, ref.startsAt < ref.plotW * 0.5,
    `${ref.startsAt}px back into a ${ref.plotW}px chart`);

  const over = await p.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
  check(`${tag}: nothing overflows sideways`, over <= 1, `${over}px`);
  await p.close();
}

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
