// Regenerates every app icon from one SVG, so the tab icon, the iOS home
// screen icon and the manifest icons can never drift apart.
//   node tools/make-icons.mjs   (then rebuild favicon.ico if the art changes)
import { chromium } from "playwright";
const S = "./public";  // written straight into the served folder
const GREEN = "#4caf7d";  // --bar-good, the calorie/step bars

// One geometry, rendered at every size. Stroke width is a percentage of the
// canvas, so the check keeps identical weight from 32px to 512px.
const svg = ({ bg, disc = 50, stroke = 9 }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  ${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ""}
  <circle cx="50" cy="50" r="${disc}" fill="${GREEN}"/>
  <path d="M 29 52 L 43 66 L 72 35" fill="none" stroke="#ffffff"
        stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
async function render(name, size, opts) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<style>html,body{margin:0;padding:0;width:${size}px;height:${size}px}</style>${svg(opts)}`);
  await p.screenshot({ path: `${S}/${name}`, omitBackground: !opts.bg });
  await p.close();
}
// Favicon + manifest: transparent corners, so the circle reads as a circle.
await render("favicon-32.png", 32, {});
await render("icon-192.png", 192, {});
await render("icon-512.png", 512, {});
// iOS masks to a squircle and paints transparency black, so this one needs a
// real background — white keeps the green disc reading as a circle.
await render("apple-touch-icon.png", 180, { bg: "#ffffff", disc: 44 });
// Re-run with: node tools/make-icons.mjs
await b.close();
console.log("rendered");
