// What a written report is allowed to see, and what comes back.
//
// A report is the one thing in this app that gets stored, re-read months
// later, and written on top of by the next one. If the brief is wrong the
// report is wrong — and it will be wrong in confident, plausible sentences
// that nobody re-derives. So these check the brief itself, not the prose.
//
// The failures worth catching here are the quiet ones: a missing reading sent
// as 0, a reading shown against the current reference range instead of the one
// its own report printed, an app-supplied range presented as the lab's, a
// stopped medication dropped from the history. Each of those changes what the
// report concludes without changing anything a person would see on screen.
//
// No browser — these are pure modules, which is the point.

import { buildReportBrief, historyBlock, newPanelsSince, parseMarkdown, parseInline, drawContext } from "../src/labReport.js";
import { splitReport } from "../api/lab-report.js";

let failed = 0;
function check(name, fn) {
  try {
    const bad = fn();
    if (bad) { console.log(`FAIL  ${name}  ${bad}`); failed++; }
    else console.log(`PASS  ${name}`);
  } catch (e) {
    console.log(`FAIL  ${name}  threw: ${e.message}`);
    failed++;
  }
}

const system = { key: "ibd", name: "Crohn's / IBD", blurb: "Bowel inflammation and how treatment is holding." };

const row = (over = {}) => ({
  marker: "calprotectin",
  name: "Fecal calprotectin",
  unit: "mg/kg",
  attention: "now",
  edge: null,
  ref: { lo: null, hi: 50, text: "< 50", fromLab: true, why: "" },
  ...over,
});

const brief = (over = {}) => buildReportBrief({
  system,
  rows: [row()],
  readings: { calprotectin: [{ date: "6/1/24", value: 18.7, unit: "mg/kg" }, { date: "7/24/26", value: 160, unit: "mg/kg" }] },
  today: "8/8/26",
  ...over,
});

// --- blank is not zero -----------------------------------------------------

check("a marker with no reading at all doesn't get a number", () => {
  const t = buildReportBrief({ system, rows: [row()], readings: { calprotectin: [] }, today: "8/8/26" });
  if (/\b0\b/.test(t.split("Fecal calprotectin")[1] || "")) return "a zero appeared under a marker with no readings";
  if (!t.includes("Fecal calprotectin")) return "the marker vanished entirely instead of appearing with no readings";
  return null;
});

check("a null reading is dropped rather than sent as 0", () => {
  const t = buildReportBrief({
    system, rows: [row()], today: "8/8/26",
    readings: { calprotectin: [{ date: "6/1/24", value: null, valueText: "" }, { date: "7/24/26", value: 160 }] },
  });
  if (t.includes("6/1/24")) return "the empty draw was sent as a reading";
  if (!t.includes("7/24/26: 160")) return "the real reading was lost with it";
  return null;
});

check("a text result is kept — 'Negative' is how infection got ruled out", () => {
  const t = buildReportBrief({
    system,
    rows: [row({ marker: "campylobacter", name: "Campylobacter", unit: "", ref: { text: "Negative", fromLab: true } })],
    readings: { campylobacter: [{ date: "7/24/26", value: null, valueText: "Negative" }] },
    today: "8/8/26",
  });
  return t.includes("7/24/26: Negative") ? null : "the negative result never reached the brief";
});

// --- a reading keeps its own range -----------------------------------------

check("a reading printed against a different range says so", () => {
  const t = brief({
    readings: { calprotectin: [
      { date: "6/1/24", value: 40, refText: "< 120" },
      { date: "7/24/26", value: 160, refText: "< 50" },
    ] },
  });
  if (!t.includes("range then < 120")) return "the 2024 reading was shown against today's range, which would make 40 look fine when its own lab called it borderline";
  return null;
});

check("a reading on the current range isn't cluttered with it twice", () => {
  const t = brief({ readings: { calprotectin: [{ date: "7/24/26", value: 160, refText: "< 50" }] } });
  return (t.match(/< 50/g) || []).length === 1 ? null : "the range was repeated on every row";
});

check("the lab's own flag comes through", () => {
  const t = brief({ readings: { calprotectin: [{ date: "7/24/26", value: 160, flag: "high" }] } });
  return t.includes("lab flagged high") ? null : "the report's own H marking was dropped";
});

// --- an app range is never passed off as the lab's -------------------------

check("an app-supplied range is labelled as not from the lab", () => {
  const t = brief({ rows: [row({ ref: { lo: null, hi: 50, text: "< 50", fromLab: false, why: "Commonly used cutoff." } })] });
  if (!/NOT from the lab/i.test(t)) return "the app's own cutoff was presented as the lab's reference range";
  if (!t.includes("Commonly used cutoff.")) return "the reason for the app range was left out";
  return null;
});

check("a marker with no range at all says so", () => {
  const t = brief({ rows: [row({ ref: { lo: null, hi: null, text: "", fromLab: true } })] });
  return t.includes("reference: none printed") ? null : "a missing range read as no information at all";
});

// --- state in words --------------------------------------------------------

check("the brief states which markers are out of range and which are near the edge", () => {
  const t = buildReportBrief({
    system, today: "8/8/26", readings: {},
    rows: [
      row({ marker: "crp", name: "CRP", attention: "now" }),
      row({ marker: "b12", name: "Vitamin B12", attention: "borderline", edge: "low" }),
    ],
  });
  if (!/Outside range now: CRP/.test(t)) return "the flagged marker wasn't named up front";
  if (!/Near the edge: Vitamin B12/.test(t)) return "the borderline marker wasn't named up front";
  if (!/near the low end/.test(t)) return "which end of the range B12 is near was lost";
  return null;
});

// --- medical history -------------------------------------------------------

const HISTORY = [
  { kind: "condition", label: "Crohn's disease", detail: "ileal", started: "2011" },
  { kind: "medication", label: "Infliximab", detail: "10mg/kg q6w", started: "2019" },
  { kind: "medication", label: "Azathioprine", started: "2012", ended: "2019", active: false },
  { kind: "surgery", label: "Ileocecal resection", started: "2015" },
];

check("a stopped medication stays in the history, marked as past", () => {
  const t = historyBlock(HISTORY);
  if (!t.includes("Azathioprine")) return "a drug that was stopped disappeared — the report can't explain what changed in 2019 without it";
  if (!/2012 to 2019/.test(t)) return "its dates were lost";
  if (!/no longer current/.test(t)) return "it reads as a current medication";
  return null;
});

check("a current medication isn't marked past", () => {
  const t = historyBlock(HISTORY);
  const line = t.split("\n").find(l => l.includes("Infliximab"));
  if (!/since 2019/.test(line)) return "the start date was lost";
  if (/no longer current/.test(line)) return "an ongoing drug was marked as stopped";
  return null;
});

check("kinds nobody used don't get a heading", () => {
  const t = historyBlock(HISTORY);
  return /Allergy|Family history/.test(t) ? "empty sections were printed" : null;
});

check("an empty history says it's empty rather than going quiet", () => {
  const t = brief({ history: [] });
  if (!/Nothing recorded/i.test(t)) return "a blank history looked the same as one that just wasn't included";
  return null;
});

check("the history reaches the brief when there is one", () => {
  const t = brief({ history: HISTORY });
  return t.includes("Ileocecal resection") ? null : "the surgery never reached the report";
});

// --- how the blood was taken -----------------------------------------------
//
// The same number means different things depending on when it was drawn, and
// most historical draws will never carry this. Silence is the case that
// matters: the first Crohn's report described every draw as a trough because
// a blanket sentence in the medical history said so, and it read as a
// conclusion from the data rather than an assumption handed to it.

check("a draw nobody recorded says nothing rather than something", () => {
  if (drawContext(null) !== "") return "invented context from no panel";
  if (drawContext({}) !== "") return `invented "${drawContext({})}"`;
  return drawContext({ drawn_at: "", fasted: "", infusion_relation: "" }) === "" ? null : "blank fields produced words";
});

check("a trough says it is one, and why that is", () => {
  const t = drawContext({ infusion_relation: "trough" });
  return /trough/.test(t) && /before an infliximab infusion/.test(t) ? null : t;
});

check("a draw after an infusion is explicitly not a trough", () => {
  const t = drawContext({ infusion_relation: "after" });
  return /not a trough/.test(t) ? null : t;
});

check("a draw not timed to the cycle says so", () => {
  return /not timed to the infusion/.test(drawContext({ infusion_relation: "unrelated" })) ? null : drawContext({ infusion_relation: "unrelated" });
});

check("fasted and not-fasted are different statements, and neither is the default", () => {
  if (!/\bfasted\b/.test(drawContext({ fasted: "yes" }))) return "fasted was lost";
  if (!/not fasted/.test(drawContext({ fasted: "no" }))) return "not-fasted was lost";
  return drawContext({ fasted: "" }) === "" ? null : "unknown fasting produced a claim";
});

check("everything known about one draw reads as one clause", () => {
  const t = drawContext({ infusion_relation: "trough", fasted: "no", drawn_at: "~noon" });
  return /trough/.test(t) && /not fasted/.test(t) && /drawn ~noon/.test(t) ? null : t;
});

check("the context reaches the reading it belongs to", () => {
  const t = brief({ readings: { calprotectin: [
    { date: "3/9/23", value: 18.7 },
    { date: "8/3/26", value: 160, context: "trough — drawn immediately before an infliximab infusion" },
  ] } });
  const lines = t.split("\n");
  const older = lines.find(l => l.includes("3/9/23"));
  const newer = lines.find(l => l.includes("8/3/26"));
  if (!/trough/.test(newer)) return "the trough draw wasn't labelled";
  // The one that must not happen: context bleeding onto a draw that has none.
  if (/trough/.test(older)) return "an unlabelled draw inherited the next one's context";
  return null;
});

// --- studies ---------------------------------------------------------------

check("a biopsy's diagnosis reaches the brief, labelled for its kind", () => {
  const t = brief({
    studies: [
      { date: "6/14/24", report_name: "Gastrointestinal", kind: "pathology", diagnosis: "Chronic active colitis", comments: "Consistent with IBD" },
      { date: "6/30/24", report_name: "MRI enterography", kind: "imaging", diagnosis: "Mild terminal ileal wall thickening" },
    ],
  });
  if (!/Diagnosis: Chronic active colitis/.test(t)) return "the biopsy diagnosis was lost";
  if (!/Impression: Mild terminal ileal/.test(t)) return "imaging was labelled as pathology, or dropped";
  if (!/Consistent with IBD/.test(t)) return "the pathologist's comment was dropped";
  return null;
});

// --- the thread ------------------------------------------------------------

check("with no previous report, every source counts as new", () => {
  const got = newPanelsSince(null, ["a", "b"]);
  return got.length === 2 ? null : `expected both, got ${JSON.stringify(got)}`;
});

check("a report that saw everything leaves nothing new to say", () => {
  const got = newPanelsSince({ covered_panel_ids: ["a", "b"] }, ["a", "b"]);
  return got.length === 0 ? null : `expected nothing new, got ${JSON.stringify(got)}`;
});

check("a draw the last report never saw is what makes an update worth writing", () => {
  const got = newPanelsSince({ covered_panel_ids: ["a"] }, ["a", "b"]);
  return got.length === 1 && got[0] === "b" ? null : `expected just b, got ${JSON.stringify(got)}`;
});

check("a report with no covered list doesn't swallow the new draws", () => {
  const got = newPanelsSince({}, ["a", "b"]);
  return got.length === 2 ? null : `expected both, got ${JSON.stringify(got)}`;
});

check("the previous report is included, and told it's the older view", () => {
  const t = brief({ previous: { body: "# Earlier\n\nCalprotectin was quiet.", created_at: "2025-01-02T00:00:00Z", latest_panel_date: "1/1/25" } });
  if (!t.includes("Calprotectin was quiet.")) return "the previous report wasn't shown, so an update can't say what changed";
  if (!/the data above is right/.test(t)) return "nothing told the model which version wins where they disagree";
  return null;
});

// --- what comes back -------------------------------------------------------

const REPORT = `# Crohn's / IBD — August 2026

Calprotectin has climbed from 18.7 to 160 while CRP stayed normal, which points at mucosal activity your blood work isn't showing.

## What changed

- Calprotectin: 18.7 → 160
- CRP: unchanged`;

check("the title comes off the top of the report", () => {
  const r = splitReport(REPORT, "fallback");
  return r.title === "Crohn's / IBD — August 2026" ? null : `got "${r.title}"`;
});

check("the summary is the opening paragraph, not a heading or a bullet", () => {
  const r = splitReport(REPORT, "fallback");
  if (!r.summary.startsWith("Calprotectin has climbed")) return `got "${r.summary}"`;
  if (/What changed|→/.test(r.summary)) return "the summary ran into the sections below it";
  return null;
});

check("the body keeps the whole report, title included", () => {
  const r = splitReport(REPORT, "fallback");
  return r.body.includes("# Crohn's") && r.body.includes("CRP: unchanged") ? null : "the body was trimmed";
});

check("a report with no title still gets one rather than showing blank", () => {
  const r = splitReport("Just some prose about the numbers.", "Crohn's / IBD report");
  if (r.title !== "Crohn's / IBD report") return `got "${r.title}"`;
  if (r.summary !== "Just some prose about the numbers.") return `summary was "${r.summary}"`;
  return null;
});

check("a runaway opening paragraph is cut for the list, not for the report", () => {
  const long = `# T\n\n${"word ".repeat(200)}`;
  const r = splitReport(long, "T");
  if (r.summary.length > 400) return `summary is ${r.summary.length} chars`;
  if (r.body.length < 900) return "the body was cut too";
  return null;
});

check("an empty response doesn't produce a report with a blank title", () => {
  const r = splitReport("", "Hormones report");
  return r.title === "Hormones report" ? null : `got "${r.title}"`;
});

// --- rendering it ----------------------------------------------------------

check("bold, emphasis and code survive as styled runs", () => {
  const spans = parseInline("**Calprotectin** is *up*, see `ref_low`");
  const bold = spans.find(s => s.bold), em = spans.find(s => s.em), code = spans.find(s => s.code);
  if (bold?.text !== "Calprotectin") return "bold was lost";
  if (em?.text !== "up") return "emphasis was lost";
  if (code?.text !== "ref_low") return "code was lost";
  if (spans.some(s => /[*`]/.test(s.text))) return "the markers were left in the visible text";
  return null;
});

check("a lone asterisk isn't eaten", () => {
  const spans = parseInline("2 * 3 = 6");
  return spans.map(s => s.text).join("") === "2 * 3 = 6" ? null : "arithmetic got styled";
});

check("consecutive bullets become one list, not one list each", () => {
  const blocks = parseMarkdown("- a\n- b\n- c");
  const lists = blocks.filter(b => b.type === "list");
  if (lists.length !== 1) return `got ${lists.length} lists`;
  return lists[0].items.length === 3 ? null : `got ${lists[0].items.length} items`;
});

check("a numbered list stays numbered and doesn't merge with bullets", () => {
  const blocks = parseMarkdown("1. first\n2. second\n\n- bullet");
  const lists = blocks.filter(b => b.type === "list");
  if (lists.length !== 2) return `got ${lists.length} lists`;
  return lists[0].ordered && !lists[1].ordered ? null : "list kinds got mixed up";
});

check("headings keep their level so sections nest visibly", () => {
  const blocks = parseMarkdown("# Top\n\n## Section\n\n### Sub");
  const levels = blocks.filter(b => b.type === "heading").map(b => b.level);
  return String(levels) === "1,2,3" ? null : `got ${levels}`;
});

check("a paragraph broken across source lines renders as one paragraph", () => {
  const blocks = parseMarkdown("Calprotectin is up\nand CRP is not.");
  const paras = blocks.filter(b => b.type === "para");
  if (paras.length !== 1) return `got ${paras.length} paragraphs`;
  return paras[0].spans.map(s => s.text).join("").includes("up and CRP") ? null : "the lines were joined without a space";
});

check("markup in the report stays text — nothing here builds HTML", () => {
  const blocks = parseMarkdown('<img src=x onerror="alert(1)"> and **real bold**');
  if (blocks.some(b => b.type !== "para" && b.type !== "heading" && b.type !== "list")) return "the parser invented a block type";
  const text = blocks[0].spans.map(s => s.text).join("");
  if (!text.includes("<img src=x")) return "the tag was silently dropped rather than shown";
  if (!blocks[0].spans.some(s => s.bold)) return "real formatting stopped working";
  return null;
});

console.log(failed ? `\n${failed} problem(s)` : "\nall good");
process.exit(failed ? 1 : 0);
