import { chromium } from "playwright";
import { mock, LAUNCH, shot } from "./seed.mjs";
const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x="") => { console.log(`${ok?"PASS":"FAIL"}  ${l}${x?"  "+x:""}`); if(!ok) bad.push(l); };

// 280 covers Display Zoom on the smallest phones still running iOS.
for (const w of [280, 320, 360, 390, 430, 640, 768, 1200]) {
  const p = await b.newPage({ viewport: { width: w, height: 800 } });
  p.on("pageerror", e => bad.push(`${w}: ` + e.message));
  await mock(p);
  // A two-digit month and day is the widest the date ever gets.
  await p.addInitScript(() => {
    const R = Date;
    class D extends R { constructor(...a) { super(...(a.length ? a : [2026, 11, 31, 9, 0, 0])); } static now() { return new R(2026, 11, 31, 9, 0, 0).getTime(); } }
    globalThis.Date = D;
  });
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
  await p.waitForSelector(".title");
  const m = await p.evaluate(() => {
    const t = document.querySelector(".title");
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const meta = document.querySelector(".header-meta").getBoundingClientRect();
    return {
      fs: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      lines: Math.round(r.height / lh),
      right: Math.round(r.right), metaLeft: Math.round(meta.left),
      // Scoped to the header: the page has a separate, pre-existing overflow
      // at <=320px from the chart's toggle row, which the title can't fix.
      headerOver: Math.round(document.querySelector(".header").getBoundingClientRect().right
                             - document.documentElement.clientWidth),
      text: t.textContent,
    };
  });
  check(`${w}px: title stays on one line`, m.lines === 1, `${m.lines} lines at ${m.fs}px`);
  check(`${w}px: it doesn't run into the date`, m.right <= m.metaLeft, `title ends ${m.right}, date starts ${m.metaLeft}`);
  check(`${w}px: the header doesn't overflow`, m.headerOver <= 1, `${m.headerOver}px`);
  check(`${w}px: the name is intact`, m.text.trim() === "Health Tracker", m.text);
  if (w === 390) await p.locator(".header-top").screenshot({ path: shot("title-390.png") });
  if (w === 320) await p.locator(".header-top").screenshot({ path: shot("title-320.png") });
  await p.close();
}
await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
