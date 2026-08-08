// The Pathology view.
//
// A biopsy report is prose, not markers, so it lives in its own table and its
// own tab. What matters to a person: the tab only exists when there is
// something in it, the diagnosis is the first thing on screen, and the report
// never turns up in the marker list pretending to be a test with no number.

import { LAUNCH, blockWebfonts } from "./seed.mjs";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5199";

const REPORT = {
  id: "path-1",
  date: "3/10/23",
  report_name: "Gastrointestinal",
  specimen: "A :Colon, Colon, Sigmoid:Biopsy",
  accession: "23-GO-04964",
  lab_name: "FL001 Galloway",
  diagnosis: "- Colonic mucosa with no specific histopathologic abnormalities\n- Negative for dysplasia",
  clinical_history: "Crohn's disease of both small and large intestine",
  gross_description: "Received in formalin and labeled \"Colon, Sigmoid\"",
  microscopic_description: "",
  comments: "Electronically signed by Dr. A. Bovbel",
  raw_text: "…",
  kind: "pathology",
  source: "portal",
  created_at: new Date().toISOString(),
};

// Same table, same columns — a radiologist just calls them different things.
const IMAGING = {
  id: "path-2",
  date: "6/8/22",
  report_name: "XR CHEST 2 VIEW",
  specimen: "Two view chest examination",
  accession: "DOR10481361",
  lab_name: "CLINISANITAS DORAL",
  diagnosis: "No acute cardiopulmonary pathology.",
  clinical_history: "Pneumonia right lower lobe",
  gross_description: "PA and lateral chest radiographs",
  microscopic_description: "The lungs are clear and normally aerated.",
  comments: "Electronically Signed By: Joshua Kellerman, MD",
  raw_text: "…",
  kind: "imaging",
  source: "portal",
  created_at: new Date().toISOString(),
};

const PANEL = { id: "p1", date: "3/14/26", lab_name: "Quest", panel_name: "Lipid Panel", source: "pdf", file_name: "", note: "", created_at: new Date().toISOString() };
const RESULT = { id: "r1", panel_id: "p1", marker: "ldl", name: "LDL Chol", category: "Lipids", value: 128, value_text: "", unit: "mg/dL", ref_low: null, ref_high: 99, ref_text: "<100", flag: "high", sort_order: 0 };

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function openLabs(page, { pathology }) {
  await blockWebfonts(page);
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/rest/v1/")[1];
    if (table === "lab_panels") return json(route, [PANEL]);
    if (table === "lab_results") return json(route, [RESULT]);
    if (table === "lab_pathology") {
      // A missing table is a 404 from PostgREST, which is the normal state
      // until supabase_labs.sql has been re-run.
      if (pathology === null) return json(route, { code: "PGRST205", message: "Could not find the table" }, 404);
      return json(route, pathology);
    }
    return json(route, []);
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const tab = page.locator(".tab-btn", { hasText: "Labs" });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await page.waitForSelector(".labs-view", { timeout: 8000 });
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

async function main() {
  const browser = await chromium.launch(LAUNCH);
  const problems = [];

  // --- with a pathology report ---------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
    page.on("console", m => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
    await openLabs(page, { pathology: [REPORT] });

    const toggle = page.locator(".labs-view-toggle .toggle-btn", { hasText: "Studies" });
    await toggle.waitFor({ timeout: 5000 }).catch(() => {});
    check("a Studies tab appears when there is a report", await toggle.count() === 1);

    await toggle.click();
    const head = page.locator(".labs-panel-head", { hasText: "Gastrointestinal" });
    check("the report is listed by name", await head.count() === 1);
    check("it shows the collection date", (await head.innerText()).includes("3/10/23"), "");

    await head.click();
    await page.waitForSelector(".labs-path-diagnosis", { timeout: 5000 });

    const diagText = await page.locator(".labs-path-diagnosis .labs-path-text").innerText();
    check("the diagnosis is shown", diagText.includes("no specific histopathologic abnormalities"));
    check("both diagnosis bullets survive", diagText.includes("Negative for dysplasia"));

    // Diagnosis first: it is the line you opened the report to read.
    const labels = await page.locator(".labs-path-label").allInnerTexts();
    check("diagnosis comes before the specimen detail", labels[0].toLowerCase() === "diagnosis", labels.join(" / "));

    const body = await page.locator(".labs-panel-body").innerText();
    check("clinical history is shown", body.includes("Crohn's disease"));
    check("gross description is shown", body.includes("Received in formalin"));
    // The report prints the heading with nothing under it; an empty section
    // should be left out rather than rendered as a blank labelled row.
    check("the empty microscopic section is omitted", !labels.some(l => /microscopic/i.test(l)), labels.join(" / "));

    // It is not a marker and must not appear as one.
    await page.locator(".labs-view-toggle .toggle-btn", { hasText: "By marker" }).click();
    const markerNames = await page.locator(".lmr-name").allInnerTexts();
    check("the biopsy is not listed as a marker", !markerNames.some(n => /gastrointestinal|colon/i.test(n)), markerNames.join(", "));
    await page.close();
  }

  // --- an imaging report in the same table ---------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
    await openLabs(page, { pathology: [IMAGING, REPORT] });

    await page.locator(".labs-view-toggle .toggle-btn", { hasText: "Studies" }).click();
    check("both reports are listed", await page.locator(".labs-panel-head").count() === 2);

    const head = page.locator(".labs-panel-head", { hasText: "XR CHEST 2 VIEW" });
    check("the imaging study is labelled imaging", (await head.innerText()).includes("imaging"));
    await head.click();
    await page.waitForSelector(".labs-path-diagnosis", { timeout: 5000 });

    const labels = (await page.locator(".labs-path-label").allInnerTexts()).map(s => s.trim().toLowerCase());
    // A radiologist writes an impression, not a diagnosis, and findings, not
    // a microscopic description. Same columns, different words.
    check("imaging leads with Impression", labels[0] === "impression", labels.join(" / "));
    check("imaging says Findings, not Microscopic description",
      labels.includes("findings") && !labels.some(l => /microscopic/i.test(l)), labels.join(" / "));
    check("imaging says Technique, not Gross description",
      labels.includes("technique") && !labels.some(l => /gross/i.test(l)), labels.join(" / "));
    check("imaging says Exam, not Specimen",
      labels.includes("exam") && !labels.includes("specimen"), labels.join(" / "));

    const body = await page.locator(".labs-panel-body").innerText();
    check("the impression text is shown", body.includes("No acute cardiopulmonary pathology"));
    await page.close();
  }

  // --- with none, and with the table absent --------------------------------
  for (const [label, pathology] of [["there are no reports", []], ["the table does not exist yet", null]]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
    await openLabs(page, { pathology });
    await page.waitForSelector(".labs-view-toggle", { timeout: 5000 });
    const count = await page.locator(".labs-view-toggle .toggle-btn", { hasText: "Studies" }).count();
    check(`no Studies tab when ${label}`, count === 0);
    // The rest of the tab still works — this is the state every existing
    // install is in until the new SQL is run.
    check(`reports still render when ${label}`, await page.locator(".labs-panel-head").count() >= 1);
    await page.close();
  }

  await browser.close();
  for (const p of problems) check(p, false);
  console.log(failed ? `\n${failed} problem(s)` : "\nall good");
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.log("FAIL  spec crashed"); console.error(e); process.exit(1); });
