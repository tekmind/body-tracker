// The Backup & Restore panel's server-snapshot half: status, Back up now, and
// the honest message when the backups table doesn't exist yet.
import { chromium } from "playwright";
import { mock, LAUNCH } from "./seed.mjs";

const b = await chromium.launch(LAUNCH);
const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const status = (p) => p.locator(".backup-status").innerText();

// --- a snapshot exists ------------------------------------------------------
let p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
p.on("pageerror", e => bad.push("pageerror: " + e.message));
await mock(p);

let backupRows = [{ day: "2026-08-06", taken_at: "2026-08-06T11:00:00Z" }];
let apiHits = [];
await p.route("**/rest/v1/backups**", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(backupRows) }));
await p.route("**/api/backup**", (route) => {
  apiHits.push(route.request().method());
  backupRows = [{ day: "2026-08-07", taken_at: "2026-08-07T13:00:00Z" }];
  return route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, day: "2026-08-07", sections: { kv_store: 6, food_log: 132, daily_metrics: 40 } }) });
});

await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Goal Settings" }).click();
await p.waitForSelector(".backup-status");

check("the panel says when the last snapshot ran", /Last server backup: 8\/6\/26/.test(await status(p)), await status(p));
check("and what it covers", /food log, labs and synced days/.test(await status(p)));

// --- Back up now ------------------------------------------------------------
await p.locator("button", { hasText: "Back up now" }).click();
await p.waitForTimeout(600);
check("the button actually calls the endpoint", apiHits.length === 1 && apiHits[0] === "POST", apiHits.join(","));
const msg = await p.locator(".panel", { hasText: "Backup & Restore" }).first()
  .locator(".form-note").last().innerText();
check("the result names the day and the section counts", /8\/7\/26/.test(msg) && /food_log 132/.test(msg), msg);
check("the status line refreshes to the new snapshot", /Last server backup: 8\/7\/26/.test(await status(p)), await status(p));

const dl = await p.locator("a", { hasText: "Download all" }).getAttribute("href");
check("Download all points at the endpoint's file mode", dl === "/api/backup?download=1", dl);
await p.close();

// --- the table isn't set up yet ---------------------------------------------
p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
p.on("pageerror", e => bad.push("pageerror: " + e.message));
await mock(p);
await p.route("**/rest/v1/backups**", (route) =>
  route.fulfill({ status: 404, contentType: "application/json",
    body: JSON.stringify({ message: 'relation "public.backups" does not exist' }) }));
await p.goto("http://localhost:5199", { waitUntil: "networkidle" });
await p.locator(".tab-btn", { hasText: "Goal Settings" }).click();
await p.waitForSelector(".backup-status");
check("a missing table says how to set it up", /supabase_backups\.sql/.test(await status(p)), await status(p));

// A failed run must say so, not pretend.
await p.route("**/api/backup**", (route) =>
  route.fulfill({ status: 500, contentType: "application/json",
    body: JSON.stringify({ ok: false, error: "The backups table isn't set up — run supabase_backups.sql in the Supabase SQL editor." }) }));
await p.locator("button", { hasText: "Back up now" }).click();
await p.waitForTimeout(600);
const failMsg = await p.locator(".panel", { hasText: "Backup & Restore" }).first()
  .locator(".form-note").last().innerText();
check("a failed backup reports the reason", /failed: .*supabase_backups\.sql/.test(failMsg), failMsg);
await p.close();

await b.close();
console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
