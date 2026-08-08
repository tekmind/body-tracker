// What a written report gets to read.
//
// The endpoint is stateless — it takes text and returns prose — so the brief
// is assembled here, on the client, where the whole lab history already sits
// in memory. Keeping it a pure function means the tests can check what a
// report was actually shown, which matters more than usual: if the brief is
// wrong the report is wrong, and it will be wrong in confident sentences.
//
// Two rules from CLAUDE.md govern the shaping:
//
//   Blank is not zero. A marker with no reading is left out of the brief
//   rather than sent as 0 — `Number(null)` is 0 and passes Number.isFinite,
//   so the filtering happens before any conversion.
//
//   A row keeps its own range. Each reading carries the range its own report
//   printed, not the current one, so a lab that widened its reference band in
//   2023 doesn't silently un-flag a 2019 draw in the narrative.

/** The shapes a history entry comes in, in the order they're worth reading. */
export const HISTORY_KINDS = [
  { key: "condition", label: "Condition", hint: "Crohn's disease, hypothyroidism…" },
  { key: "medication", label: "Medication", hint: "Infliximab 10mg/kg q6w, iron infusions…" },
  { key: "surgery", label: "Surgery / procedure", hint: "Ileocecal resection, colonoscopy…" },
  { key: "allergy", label: "Allergy / intolerance", hint: "Sulfa, lactose…" },
  { key: "family", label: "Family history", hint: "Father — colon cancer at 58…" },
  { key: "note", label: "Other", hint: "Anything else worth knowing" },
];

const KIND_LABEL = new Map(HISTORY_KINDS.map(k => [k.key, k.label]));

const clip = (text, max) => {
  const t = String(text || "").trim();
  return t.length > max ? `${t.slice(0, max)}…[truncated]` : t;
};

/**
 * One line per history entry, grouped by kind.
 *
 * An ended entry keeps its dates and is marked as past rather than dropped:
 * a drug stopped two years ago is part of why this year's numbers look the
 * way they do, and a report that doesn't know it was ever taken can't say so.
 */
export function historyBlock(history) {
  const rows = (history || []).filter(h => h && String(h.label || "").trim());
  if (!rows.length) return "";

  const out = [];
  for (const kind of HISTORY_KINDS) {
    const mine = rows.filter(h => h.kind === kind.key);
    if (!mine.length) continue;
    out.push(`${kind.label}:`);
    for (const h of mine) {
      const bits = [];
      if (h.detail) bits.push(String(h.detail).trim());
      const span = [h.started, h.ended].map(x => String(x || "").trim());
      if (span[0] && span[1]) bits.push(`${span[0]} to ${span[1]}`);
      else if (span[0]) bits.push(`since ${span[0]}`);
      else if (span[1]) bits.push(`until ${span[1]}`);
      if (h.active === false) bits.push("no longer current");
      out.push(`- ${String(h.label).trim()}${bits.length ? ` — ${bits.join("; ")}` : ""}`);
    }
    out.push("");
  }
  // Kinds nobody used don't appear, and neither does a heading for them.
  return out.join("\n").trim();
}

/**
 * How a draw was taken, in words, or "" when nobody recorded it.
 *
 * Silence is the important case. Most historical draws will never carry this,
 * and a reading with no context must read as unknown rather than inheriting
 * an assumption — describing every draw as a trough because most of the
 * recent ones were is precisely the error this field exists to stop.
 */
export function drawContext(panel) {
  if (!panel) return "";
  const bits = [];
  const rel = {
    trough: "trough — drawn immediately before an infliximab infusion",
    after: "drawn after an infliximab infusion, not a trough",
    unrelated: "not timed to the infusion cycle",
  }[panel.infusion_relation];
  if (rel) bits.push(rel);
  if (panel.fasted === "yes") bits.push("fasted");
  else if (panel.fasted === "no") bits.push("not fasted");
  if (String(panel.drawn_at || "").trim()) bits.push(`drawn ${String(panel.drawn_at).trim()}`);
  return bits.join("; ");
}

/** "out of range now" / "near the low end" / … in words the report can quote. */
function attentionWords(row) {
  if (row.attention === "now") return "outside range on the latest draw";
  if (row.attention === "borderline") return `in range but near the ${row.edge === "low" ? "low" : "high"} end`;
  if (row.attention === "past") return "in range now; has been flagged before";
  return "in range";
}

function markerBlock(row, readings) {
  const pts = (readings || []).filter(p => p && (p.value != null || String(p.valueText || "").trim()));
  const head = [`${row.name}${row.unit ? ` (${row.unit})` : ""} — ${attentionWords(row)}`];

  if (row.ref?.text) {
    head.push(
      row.ref.fromLab
        ? `  reference: ${row.ref.text}`
        : `  reference: ${row.ref.text} (NOT from the lab — the report printed none, so the app supplies this one${row.ref.why ? `: ${row.ref.why}` : ""})`
    );
  } else {
    head.push("  reference: none printed");
  }

  // Fasting decides what some numbers mean, and an unrecorded status has to
  // read as unknown rather than as irrelevant. A glucose of 129 is an
  // abnormal fasting result or an unremarkable post-meal one.
  if (row.fastingMatters) {
    const known = pts.filter(p => p.fasted === "yes" || p.fasted === "no").length;
    head.push(
      known === pts.length && pts.length
        ? "  fasting: matters for this marker, and is recorded on every reading below"
        : `  fasting: MATTERS for this marker${known ? `, but is recorded on only ${known} of ${pts.length} readings` : ", and was NOT recorded for these readings"}. Where a reading does not say, it is unknown — do not assume either way, and say so if it limits what you can conclude.`
    );
  }

  if (!pts.length) return head.join("\n");

  head.push("  readings, oldest first:");
  for (const p of pts) {
    const value = p.value != null ? String(p.value) : String(p.valueText || "").trim();
    const bits = [`${p.date || "?"}: ${value}`];
    if (p.unit && p.unit !== row.unit) bits.push(p.unit);
    // How the blood was taken, where it's known. An infliximab level is only
    // interpretable as a trough, and a draw that says nothing must not be
    // assumed to be one — which is exactly the mistake a blanket claim in the
    // medical history invites.
    if (p.context) bits.push(p.context);
    // The range printed alongside *this* reading, which is not always the
    // one above it — labs move their bands, and the story of a marker can
    // hinge on that rather than on the number changing.
    if (p.refText && p.refText !== row.ref?.text) bits.push(`range then ${p.refText}`);
    if (p.flag && p.flag !== "normal") bits.push(`lab flagged ${p.flag}`);
    head.push(`    ${bits.join("  ·  ")}`);
  }
  return head.join("\n");
}

function studyBlock(study) {
  const parts = [`${study.date || "?"} — ${study.report_name || study.kind || "study"}${study.specimen ? ` (${study.specimen})` : ""}`];
  const add = (label, text, max) => {
    const t = clip(text, max);
    if (t) parts.push(`  ${label}: ${t}`);
  };
  add(study.kind === "imaging" ? "Impression" : "Diagnosis", study.diagnosis, 1500);
  add("Clinical history", study.clinical_history, 600);
  add(study.kind === "imaging" ? "Findings" : "Microscopic", study.microscopic_description, 900);
  add("Comments", study.comments, 900);
  return parts.join("\n");
}

/**
 * Everything the model is shown, as one block of text.
 *
 * `readings` is keyed by marker and oldest-first — the same series the trend
 * chart draws, so the report and the chart cannot disagree about what was
 * measured when.
 */
export function buildReportBrief({ system, rows = [], readings = {}, studies = [], history = [], previous = null, today = "" }) {
  const parts = [];

  parts.push(`# Body system: ${system?.name || "Labs"}`);
  if (system?.blurb) parts.push(system.blurb);
  if (today) parts.push(`Today's date: ${today}`);

  const hist = historyBlock(history);
  parts.push("\n## Medical history\n" + (hist || "(Nothing recorded. Say plainly that the history is empty and that it limits what can be concluded.)"));

  const flagged = rows.filter(r => r.attention === "now").map(r => r.name);
  const edging = rows.filter(r => r.attention === "borderline").map(r => r.name);
  parts.push(
    "\n## Markers\n" +
    `${rows.length} marker${rows.length === 1 ? "" : "s"} in this system. ` +
    `${flagged.length ? `Outside range now: ${flagged.join(", ")}. ` : "None outside range on the latest draw. "}` +
    `${edging.length ? `Near the edge: ${edging.join(", ")}.` : ""}`
  );
  for (const row of rows) parts.push("\n" + markerBlock(row, readings[row.marker]));

  if (studies.length) {
    parts.push("\n## Studies\n" + studies.map(studyBlock).join("\n\n"));
  }

  if (previous?.body) {
    parts.push(
      `\n## The previous report in this thread\n` +
      `Written ${previous.created_at ? String(previous.created_at).slice(0, 10) : "earlier"}` +
      `${previous.latest_panel_date ? `, covering draws up to ${previous.latest_panel_date}` : ""}. ` +
      `Everything above is current as of today, so where the two disagree, the data above is right and the report below is what was thought at the time.\n\n` +
      clip(previous.body, 14000)
    );
  }

  return parts.join("\n");
}

// --- rendering what comes back ---------------------------------------------
//
// The report arrives as markdown and has to be readable on a phone. A parser
// rather than a library because the vocabulary is tiny — headings, paragraphs,
// lists, bold, emphasis, code — and because a report is generated text going
// straight onto the screen, so nothing here builds HTML from it.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*(?!\s)[^*]+\*|(?<![_\w])_(?!\s)[^_]+_)/g;

/** One line of markdown -> styled runs. Unmatched punctuation stays literal. */
export function parseInline(line) {
  const spans = [];
  let at = 0;
  for (const m of String(line || "").matchAll(INLINE)) {
    if (m.index > at) spans.push({ text: line.slice(at, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) spans.push({ text: tok.slice(2, -2), bold: true });
    else if (tok.startsWith("`")) spans.push({ text: tok.slice(1, -1), code: true });
    else spans.push({ text: tok.slice(1, -1), em: true });
    at = m.index + tok.length;
  }
  if (at < line.length) spans.push({ text: line.slice(at) });
  return spans.length ? spans : [{ text: String(line || "") }];
}

/**
 * Markdown -> blocks. Consecutive list lines join into one list so they get
 * one set of bullets rather than one list per line.
 */
export function parseMarkdown(text) {
  const blocks = [];
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "para", spans: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      blocks.push({ type: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flushList(); list = { type: "list", ordered, items: [] }; }
      list.items.push(parseInline((bullet || numbered)[1]));
      continue;
    }

    flushList();
    para.push(line.replace(/^>\s?/, ""));
  }
  flushPara();
  flushList();
  return blocks;
}

/**
 * Which draws in this system the last report never saw.
 *
 * This is what turns "generate a report" into a thread: with nothing new
 * there is nothing to append, and offering to rewrite the same report from
 * the same numbers would produce a second opinion rather than an update.
 */
export function newPanelsSince(previous, panelIds) {
  if (!previous) return panelIds.slice();
  const seen = new Set(Array.isArray(previous.covered_panel_ids) ? previous.covered_panel_ids : []);
  return panelIds.filter(id => !seen.has(id));
}
