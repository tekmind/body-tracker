// The alert banners' severity colouring.
//
// Slipping is a warning, derailed is a verdict. They were styled identically,
// so one off week shouted exactly as loudly as a month of them and the
// escalation carried no information at all.
//
// What a person notices when this breaks isn't the banner — it's the bits
// inside it. The week pill and the "drifting further" line carry their own
// red, and the recovery chips a translucent black that reads grey over amber,
// so an amber banner can still be full of red and look like two severities at
// once.
//
// These assert computed colour rather than the presence of a rule, because
// this file overrides itself: a later ".dash "-prefixed block outranks the
// obvious rule, and setting it in the obvious place alone looks correct and
// does nothing.

import { LAUNCH, blockWebfonts } from "./seed.mjs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5199";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

/** Rough hue test — is this colour in the amber/brown family, or the red one? */
function parse(rgb) {
  const m = String(rgb || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}
const isAmber = (rgb) => { const c = parse(rgb); return !!c && c.r > c.g && c.g > c.b && (c.r - c.g) < (c.g - c.b) * 3; };
const isRed = (rgb) => { const c = parse(rgb); return !!c && c.r > c.g * 1.8 && c.r > c.b * 1.8; };

async function main() {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await blockWebfonts(page);
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dash", { timeout: 8000 });

  // Render both banners with the innards that carry their own colour, and
  // read what the cascade actually resolves to.
  const shades = await page.evaluate(() => {
    const host = document.querySelector(".dash") || document.body;
    const build = (cls) => {
      const d = document.createElement("div");
      d.className = "banner-alert " + cls;
      d.innerHTML =
        '<div class="banner-alert-text"><strong>Calories</strong>' +
        '<span class="notif-weeks">1w</span>' +
        '<div class="recovery"><div class="rec-trend rec-bad"><span>Drifting further</span></div>' +
        '<div class="rec-plan"><span class="rec-plan-label">Get back to your Maintain:</span>' +
        '<span class="rec-chip">2,100 kcal/day</span></div></div></div>';
      host.appendChild(d);
      const at = (sel, prop) => {
        const el = d.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null;
      };
      const out = {
        banner: getComputedStyle(d).backgroundColor,
        weeksBg: at(".notif-weeks", "backgroundColor"),
        driftColor: at(".rec-trend.rec-bad", "color"),
        chipBg: at(".rec-chip", "backgroundColor"),
      };
      d.remove();
      return out;
    };
    return { slipping: build("slipping"), derailed: build("derailed") };
  });

  const s = shades.slipping, d = shades.derailed;

  check("the slipping banner is amber", isAmber(s.banner), s.banner);
  check("its week pill is amber, not red", isAmber(s.weeksBg) && !isRed(s.weeksBg), s.weeksBg);
  check("its drifting line is not red", !isRed(s.driftColor), s.driftColor);
  // Grey here is a translucent black over amber — the chip has to be tinted.
  check("its recovery chips are amber, not grey", isAmber(s.chipBg), s.chipBg);

  // The whole point of two levels is that they look different.
  check("the derailed banner is still red", isRed(d.banner) || parse(d.banner).r > parse(d.banner).b, d.banner);
  check("its week pill is still red", isRed(d.weeksBg), d.weeksBg);
  check("the two levels don't look identical", s.banner !== d.banner && s.weeksBg !== d.weeksBg,
    `${s.banner} vs ${d.banner}`);

  // Size is the other half of the escalation: slipping inherited the derailed
  // banner's type and height, so one off week filled the screen.
  const sizes = await page.evaluate(() => {
    const host = document.querySelector(".dash") || document.body;
    const build = (cls) => {
      const d = document.createElement("div");
      d.className = "banner-alert " + cls;
      d.innerHTML = '<div class="banner-alert-text"><strong>Calories — you\'re slipping.</strong> Calories have been over target for 1 week straight.</div>';
      host.appendChild(d);
      const out = {
        h: Math.round(d.getBoundingClientRect().height),
        fs: parseFloat(getComputedStyle(d).fontSize),
        strong: parseFloat(getComputedStyle(d.querySelector("strong")).fontSize),
      };
      d.remove();
      return out;
    };
    return { slipping: build("slipping"), derailed: build("derailed") };
  });
  check("the slipping headline is smaller than the derailed one",
    sizes.slipping.strong < sizes.derailed.strong, `${sizes.slipping.strong} vs ${sizes.derailed.strong}`);
  check("the slipping banner takes less height for the same words",
    sizes.slipping.h < sizes.derailed.h, `${sizes.slipping.h}px vs ${sizes.derailed.h}px`);

  await browser.close();
  console.log(failed ? `\n${failed} problem(s)` : "\nall good");
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.log("FAIL  spec crashed"); console.error(e); process.exit(1); });
