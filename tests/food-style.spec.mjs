import { chromium } from "playwright";
import { mock, LAUNCH } from "./seed.mjs";
const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

for (const [w, tag] of [[1200, "desktop"], [390, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  p.on("pageerror", e => bad.push(`${tag} pageerror: ${e.message}`));
  await mock(p);
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });

  // Reference values taken from the Home tab's own cards.
  const home = await p.evaluate(() => {
    const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    const em = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return (parseFloat(s.letterSpacing) / parseFloat(s.fontSize)).toFixed(3);
    };
    return {
      label: { font: cs(".stat-label", "fontFamily"), size: cs(".stat-label", "fontSize"), tt: cs(".stat-label", "textTransform") },
      value: { font: cs(".stat-value", "fontFamily"), ls: em(".stat-value") },
      sub: { font: cs(".stat-sub", "fontFamily"), size: cs(".stat-sub", "fontSize") },
      card: { radius: cs(".stat-card", "borderTopLeftRadius"), bg: cs(".stat-card", "backgroundColor") },
      // Read the rule, not a live element: whether a "good" hero card exists
      // depends on the data, and the colour must match either way.
      tinted: { bg: (() => {
        const probe = document.createElement("div");
        probe.className = "hero-bf good";
        document.querySelector(".dash").appendChild(probe);
        const bg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return bg;
      })() },
    };
  });

  await p.locator(".tab-btn", { hasText: "Food" }).click();
  await p.waitForSelector(".macro-tile", { timeout: 8000 });

  const food = await p.evaluate(() => {
    const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    const em = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return (parseFloat(s.letterSpacing) / parseFloat(s.fontSize)).toFixed(3);
    };
    // Any element that actually RENDERS text in a mono or Grotesk face.
    // Containers inherit mono from base rules on the Home tab too, so an
    // element with no text of its own isn't a mismatch — it draws nothing.
    const stragglers = new Set();
    for (const el of document.querySelectorAll(".food-view *")) {
      const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!ownText) continue;
      const f = getComputedStyle(el).fontFamily;
      if (/Mono|Grotesk/.test(f)) stragglers.add(`${el.className || el.tagName}: ${f.split(",")[0]}`);
    }
    return {
      label: { font: cs(".macro-tile-label", "fontFamily"), size: cs(".macro-tile-label", "fontSize"), tt: cs(".macro-tile-label", "textTransform") },
      value: { font: cs(".macro-tile-value", "fontFamily"), ls: em(".macro-tile-value") },
      sub: { font: cs(".macro-tile-sub", "fontFamily"), size: cs(".macro-tile-sub", "fontSize") },
      card: { radius: cs(".macro-tile", "borderTopLeftRadius"), bg: cs(".macro-tile", "backgroundColor") },
      tinted: { bg: cs(".macro-tile.macro-good", "backgroundColor") },
      tileInPanel: !!document.querySelector(".panel .macro-tile"),
      subs: [...document.querySelectorAll(".macro-tile-sub")].map(e => e.textContent.trim()),
      weekSubs: [...document.querySelectorAll(".week-avg-sub")].map(e => e.textContent.trim()),
      stragglers: [...stragglers],
      overflow: document.body.scrollWidth - document.documentElement.clientWidth,
    };
  });

  check(`${tag}: card label matches Home`, food.label.font === home.label.font && food.label.size === home.label.size && food.label.tt === home.label.tt,
    `${food.label.font.split(",")[0]} ${food.label.size} ${food.label.tt}`);
  check(`${tag}: big number matches Home`, food.value.font === home.value.font && food.value.ls === home.value.ls,
    `${food.value.font.split(",")[0]} ls=${food.value.ls}em vs ${home.value.ls}em`);
  check(`${tag}: sub-line matches Home`, food.sub.font === home.sub.font && food.sub.size === home.sub.size,
    `${food.sub.size}`);
  check(`${tag}: card radius matches Home`, food.card.radius === home.card.radius, food.card.radius);
  check(`${tag}: green tint matches the Home hero card`, food.tinted.bg === home.tinted.bg,
    `${food.tinted.bg} vs ${home.tinted.bg}`);
  check(`${tag}: day cards sit on the page, not inside a panel`, !food.tileInPanel);
  check(`${tag}: no mono or Grotesk left in the Food tab`, food.stragglers.length === 0, food.stragglers.slice(0, 4).join(" | "));
  check(`${tag}: no sideways overflow`, food.overflow <= 1, `${food.overflow}px`);

  if (tag === "desktop") {
    // startsWith, not equality: an amber tile appends its band to the same line.
    const wantSubs = ["93 left", "14.8g to go", "28.1g over", "21.3g left"];
    check("sub-lines read the right way round", food.subs.every((s, i) => s.startsWith(wantSubs[i])), food.subs.join(" | "));
    check("week sub-lines show the delta from target",
      food.weekSubs[0] === "target 1,900 · -93" && food.weekSubs[2] === "target 150g · +28.1g", food.weekSubs.join(" | "));
  }
  await p.close();
}
await b.close();
console.log(bad.length ? "\nproblems:\n- " + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
