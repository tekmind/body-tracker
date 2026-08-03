import { chromium } from "playwright";
import { mock, LAUNCH } from "./seed.mjs";
const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
p.on("pageerror", e => bad.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts.googleapis/.test(m.text())) bad.push("console: " + m.text()); });
await mock(p);
await p.route("**/api/food-search**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ foods: [], warnings: [], attribution: {} }) }));
await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Food" }).click();
await p.waitForSelector(".macro-tile");

const spill = async (label) => {
  const worst = await p.evaluate(() => {
    let w = 0;
    const root = document.querySelector(".food-sheet") || document.querySelector(".food-view");
    const rr = root.getBoundingClientRect();
    for (const el of root.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width) w = Math.max(w, r.right - rr.right, rr.left - r.left);
    }
    return Math.round(w);
  });
  check(label, worst <= 1, `${worst}px past the edge`);
};

await spill("day view: nothing spills");

// Open the add-food sheet from the first section.
await p.locator(".food-section .btn-primary", { hasText: "Food" }).first().click();
await p.waitForSelector(".food-sheet");
await spill("search sheet: nothing spills");

// My foods list.
await p.locator(".food-sheet-tabs .toggle-btn", { hasText: "My foods" }).click();
await p.waitForSelector(".mine-row");
check("my-foods list renders", await p.locator(".mine-row").count() === 10);
await spill("my foods: nothing spills");

// A picked food's quantity screen.
await p.locator(".mine-pick").first().click();
await p.waitForSelector(".food-pick");
await spill("picked food: nothing spills");
const pickLabel = await p.locator(".food-pick-qty label").first().evaluate(el => {
  const s = getComputedStyle(el);
  return `${s.fontFamily.split(",")[0]} ${s.fontSize} ${s.textTransform}`;
});
check("picked-food field labels are sentence-case Inter", pickLabel === 'Inter 13.2px none', pickLabel);

// Custom food form.
await p.locator(".food-sheet-head .icon-btn").click();
await p.locator(".food-section .btn-primary", { hasText: "Food" }).first().click();
await p.waitForSelector(".food-sheet");
await p.locator(".food-sheet-tabs .toggle-btn", { hasText: "My foods" }).click();
await p.locator(".mine-head .btn-ghost", { hasText: "Add by hand" }).click();
await p.waitForSelector(".food-custom-grid");
await spill("custom food form: nothing spills");

// Weekly averages panel.
await p.locator(".food-sheet-head .icon-btn").click();
await p.locator(".week-avg-tile").first().waitFor();
check("week tiles are bordered boxes, not shadowed cards", await p.locator(".week-avg-tile").first().evaluate(el => {
  const s = getComputedStyle(el);
  return s.boxShadow === "none" && s.borderTopLeftRadius === "14px";
}));

await p.close();
await b.close();
console.log(bad.length ? "\nproblems:\n- " + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
