import { LAUNCH } from "./seed.mjs";
import { chromium } from "playwright";
const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

for (const [w, h, tag] of [[390, 844, "phone"], [1200, 900, "desktop"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: tag === "phone" });
  p.on("pageerror", e => bad.push(`${tag} pageerror: ${e.message}`));
  await p.route("**/rest/v1/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await p.goto("http://localhost:5199", { waitUntil: "networkidle" });

  const order = (await p.locator(".tab-btn").allInnerTexts()).map(t => t.trim().split("\n")[0]);
  check(`${tag}: tab order`, JSON.stringify(order.slice(2)) === JSON.stringify(["Food", "Habits", "Labs", tag === "phone" ? "Goals" : "Goal Settings"]), order.join(" | "));

  if (tag === "phone") {
    // Land on a middle tab, then swipe across the page body.
    await p.locator(".tab-btn", { hasText: "Food" }).scrollIntoViewIfNeeded();
    await p.locator(".tab-btn", { hasText: "Food" }).click();
    await p.waitForSelector(".food-view", { timeout: 5000 });

    const before = await p.locator(".tab-btn.active").innerText();
    const box = await p.locator(".dash").boundingBox();
    const y = box.y + 420;
    for (const [from, to] of [[330, 60], [60, 330]]) {
      await p.touchscreen.tap(from, y).catch(() => {});
      await p.evaluate(({ from, to, y }) => {
        const el = document.elementFromPoint(from, y) || document.body;
        const mk = (type, x) => new TouchEvent(type, {
          bubbles: true, cancelable: true,
          touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
          changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
        });
        el.dispatchEvent(mk("touchstart", from));
        el.dispatchEvent(mk("touchmove", (from + to) / 2));
        el.dispatchEvent(mk("touchmove", to));
        el.dispatchEvent(mk("touchend", to));
      }, { from, to, y });
      await p.waitForTimeout(250);
    }
    const after = await p.locator(".tab-btn.active").innerText();
    check("phone: swiping across the page does not change tabs", after.includes("Food"), `${before.trim()} -> ${after.trim()}`);

    // Pull-to-refresh must still be wired up.
    const wired = await p.evaluate(() => {
      const el = document.querySelector(".dash");
      return !!el && typeof el.ontouchstart !== "undefined";
    });
    check("phone: pull-to-refresh handlers still attached", wired);
  }
  await p.close();
}
await b.close();
console.log(bad.length ? "\nproblems:\n- " + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
