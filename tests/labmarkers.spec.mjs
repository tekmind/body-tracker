// Marker matching — the rule that keeps two different measurements off one
// trend line.
//
// A CBC prints its differential twice: once as a percentage and once as an
// absolute count. A metabolic panel prints albumin and the albumin/globulin
// ratio. An iron panel prints serum iron and the binding capacity. Each pair
// shares a word, and the matcher takes the longest phrase contained in the
// name — so the shorter member of the pair will swallow the longer one unless
// the longer one has an alias of its own.
//
// What a person would notice when this breaks: opening the Neutrophils trend
// and seeing 43.2 and 2635 plotted on the same line, with every percentage
// reading drawn far below a reference band that belongs to the absolute count.
//
// No browser here — this is a pure module, and the whole point is that it can
// be checked without one.

import { resolveMarker, systemsFor, borderlineFor, effectiveRange, gaugeScale } from "../src/labMarkers.js";

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

/** Every pair that appears together on one real report and must stay apart. */
const MUST_DIFFER = [
  ["NEUTROPHILS", "ABSOLUTE NEUTROPHILS"],
  ["LYMPHOCYTES", "ABSOLUTE LYMPHOCYTES"],
  ["MONOCYTES", "ABSOLUTE MONOCYTES"],
  ["EOSINOPHILS", "ABSOLUTE EOSINOPHILS"],
  ["BASOPHILS", "ABSOLUTE BASOPHILS"],
  ["IRON, TOTAL", "IRON BINDING CAPACITY"],
  ["ALBUMIN", "ALBUMIN/GLOBULIN RATIO"],
  ["ALBUMIN", "GLOBULIN"],
  ["CREATININE", "BUN/CREATININE RATIO"],
  ["EGFR", "eGFR AFRICAN AMERICAN"],
  // A free/total PSA panel prints all three on one report.
  ["PSA, TOTAL", "PSA, FREE"],
  ["PSA, TOTAL", "PSA, % FREE"],
  // The one that needs "%" to survive normalization: without it these two
  // become the same word set, and a ng/mL concentration shares a line with a
  // percentage.
  ["PSA, FREE", "PSA, % FREE"],
  ["TESTOSTERONE, TOTAL, MS", "TESTOSTERONE,BIOAVAILABLE"],
  ["TESTOSTERONE, FREE", "TESTOSTERONE,BIOAVAILABLE"],
  ["TESTOSTERONE, TOTAL, MS", "TESTOSTERONE, FREE"],
];

for (const [a, b] of MUST_DIFFER) {
  check(`"${a}" and "${b}" chart separately`, () => {
    const ka = resolveMarker(a).key, kb = resolveMarker(b).key;
    return ka === kb ? `both resolved to "${ka}"` : null;
  });
}

// The reverse mistake: a lab renaming the same test between draws must still
// land on one line, or a marker becomes several flat one-point trends.
const MUST_MATCH = [
  ["ABSOLUTE NEUTROPHILS", "neutrophils absolute"],
  ["ABSOLUTE LYMPHOCYTES", "Lymphocytes, Absolute"],
  ["IRON BINDING CAPACITY", "Total Iron Binding Capacity"],
  ["% SATURATION", "Transferrin Saturation"],
  ["eGFR NON-AFR. AMERICAN", "EGFR"],
];

for (const [a, b] of MUST_MATCH) {
  check(`"${a}" and "${b}" share a trend`, () => {
    const ka = resolveMarker(a).key, kb = resolveMarker(b).key;
    return ka !== kb ? `"${ka}" vs "${kb}"` : null;
  });
}

// Recognised markers get a tidy display name and a real category; the CBC
// differential should not sit in "Other" while its siblings are in Blood count.
const MUST_BE_KNOWN = [
  ["MONOCYTES", "Blood count"],
  ["EOSINOPHILS", "Blood count"],
  ["BASOPHILS", "Blood count"],
  ["MPV", "Blood count"],
  ["ABSOLUTE MONOCYTES", "Blood count"],
  ["GLOBULIN", "Liver"],
  ["ALBUMIN/GLOBULIN RATIO", "Liver"],
  ["IRON BINDING CAPACITY", "Vitamins & minerals"],
  ["% SATURATION", "Vitamins & minerals"],
];

for (const [name, category] of MUST_BE_KNOWN) {
  check(`"${name}" is recognised as ${category}`, () => {
    const m = resolveMarker(name);
    if (!m.known) return `fell through to "Other" as "${m.key}"`;
    return m.category === category ? null : `category was "${m.category}"`;
  });
}

// An unknown test still charts against its future selves rather than vanishing.
check("an unrecognised test keeps a stable key of its own", () => {
  const a = resolveMarker("Norovirus GI/GII");
  const b = resolveMarker("norovirus gi/gii");
  if (a.known) return `unexpectedly matched "${a.key}"`;
  if (a.key !== b.key) return `unstable key: "${a.key}" vs "${b.key}"`;
  return a.category === "Other" ? null : `category was "${a.category}"`;
});

// A urinalysis prints rows named entirely of words the matcher treats as
// noise. They normalize to nothing, and collapsing them all onto one
// "unknown" key would put pH, Protein and Blood on a single trend line.
check("tests named only of noise words keep separate keys", () => {
  const keys = ["Blood", "Serum", "Plasma"].map(n => resolveMarker(n).key);
  if (new Set(keys).size !== keys.length) return `collapsed together: ${keys.join(", ")}`;
  return keys.includes("unknown") ? `one fell through to "unknown": ${keys.join(", ")}` : null;
});

check("a genuinely empty name is still 'unknown'", () => {
  const m = resolveMarker("");
  return m.key === "unknown" ? null : `got "${m.key}"`;
});

// Vitamins get renamed between draws more than most: the panel prints
// "VITAMIN B3" one time and "NICOTINIC ACID" the next.
for (const [a, b] of [
  ["VITAMIN B3", "NICOTINIC ACID"],
  ["VITAMIN A (RETINOL)", "Retinol"],
  ["VITAMIN B1 (THIAMINE), BLOOD, LC/MS/MS", "Thiamine"],
  ["VITAMIN B2 (RIBOFLAVIN)", "Riboflavin"],
  ["CHOL/HDLC RATIO", "Cholesterol/HDL Ratio"],
]) {
  check(`"${a}" and "${b}" share a trend`, () => {
    const ka = resolveMarker(a).key, kb = resolveMarker(b).key;
    return ka !== kb ? `"${ka}" vs "${kb}"` : null;
  });
}

// B1 must not be pulled onto B12 by the digit-gluing in normalize().
check("vitamin B1 and B12 are different markers", () => {
  const a = resolveMarker("VITAMIN B1"), b = resolveMarker("VITAMIN B12");
  return a.key === b.key ? `both "${a.key}"` : null;
});

check("Vitamin K is not potassium", () => {
  const k = resolveMarker("VITAMIN K");
  return k.key === "potassium" ? "matched potassium" : (k.known ? null : `fell through as "${k.key}"`);
});

// A urine dipstick prints analytes named identically to serum tests. "Glucose"
// on a dipstick is a Neg/Pos strip result; "GLUCOSE" on a CMP is 129 mg/dL.
// The panel name is what tells them apart — same name, different sample,
// different marker.
const UA = "Urinalysis Dipstick (Waived)";
for (const [name, urineKey, serumName, serumPanel, serumKey] of [
  ["Glucose", "urine_glucose", "GLUCOSE", "COMPREHENSIVE METABOLIC PANEL", "glucose"],
  ["Bilirubin", "urine_bilirubin", "BILIRUBIN, TOTAL", "COMPREHENSIVE METABOLIC PANEL", "bilirubin_total"],
  ["Leukocytes", "urine_leukocytes", "WHITE BLOOD CELL COUNT", "CBC (INCLUDES DIFF/PLT)", "wbc"],
  ["Protein", "urine_protein", "PROTEIN, TOTAL", "COMPREHENSIVE METABOLIC PANEL", "protein_total"],
]) {
  check(`"${name}" is a urine marker on a dipstick, not ${serumKey}`, () => {
    const u = resolveMarker(name, UA);
    if (u.key !== urineKey) return `got "${u.key}"`;
    if (u.category !== "Urinalysis") return `category "${u.category}"`;
    const s = resolveMarker(serumName, serumPanel);
    return s.key === serumKey ? null : `serum resolved to "${s.key}"`;
  });
}

// Names that normalize to nothing ("Blood" is a noise word) still match on a
// urine panel, and panel context must not leak into blood panels.
check("\"Blood\" on a dipstick is urine_blood", () => {
  const m = resolveMarker("Blood", UA);
  return m.key === "urine_blood" ? null : `got "${m.key}"`;
});
check("panel context changes nothing on a blood panel", () => {
  const m = resolveMarker("HEMOGLOBIN", "CBC (INCLUDES DIFF/PLT)");
  return m.key === "hemoglobin" ? null : `got "${m.key}"`;
});
check("no panel context keeps the old behavior", () => {
  const m = resolveMarker("Glucose");
  return m.key === "glucose" ? null : `got "${m.key}"`;
});

// Body systems: a marker belongs to every system it informs, not just one.
const sys = (k) => systemsFor(k).map(s => s.key).sort().join(",");
check("ferritin is iron AND inflammation AND IBD", () => {
  const got = sys("ferritin");
  for (const want of ["ibd", "inflammation", "vitamins"]) if (!got.includes(want)) return `missing ${want}: ${got}`;
  return null;
});
check("calprotectin sits in IBD and inflammation", () => {
  const got = sys("calprotectin");
  return got.includes("ibd") && got.includes("inflammation") ? null : got;
});
check("a hepatitis slug pattern-matches into screening", () =>
  sys("hepatitis_b_surface_ab_immunity_qn").includes("screening") ? null : sys("hepatitis_b_surface_ab_immunity_qn"));
check("a GI pathogen slug pattern-matches into IBD", () =>
  sys("giardia_lamblia").includes("ibd") ? null : sys("giardia_lamblia"));
check("urine markers land in screening", () =>
  sys("urine_glucose").includes("screening") ? null : sys("urine_glucose"));
check("a future vitamin joins vitamins by pattern", () =>
  sys("vitamin_e").includes("vitamins") ? null : sys("vitamin_e"));
check("an unrelated slug belongs to no system", () => {
  const got = systemsFor("some_unknown_test");
  return got.length === 0 ? null : got.map(s => s.key).join(",");
});
// Labs rename the same test between draws; both spellings must land on the
// canonical key so the IBD monitoring trends read as one line each.
check("both labs' infliximab levels share a key", () => {
  const a = resolveMarker("INFLIXIMAB LEVEL, IBD").key;
  const b = resolveMarker("Serum infliximab (IFX) concentration").key;
  return a === b && a === "infliximab_level" ? null : `${a} vs ${b}`;
});
check("calprotectin is canonical, not a slug", () => {
  const m = resolveMarker("Calprotectin, Stool - QDx");
  return m.key === "calprotectin" && m.known ? null : m.key;
});

// --- borderline: in range, but hugging the end that isn't the good one -----
// B12 at 269 against 200–1100 is "in range" and in the bottom 8% of it, which
// is not the same news as 600.
check("a value near the bottom of its range is borderline low", () =>
  borderlineFor("vitamin_b12", 269, 200, 1100) === "low" ? null : String(borderlineFor("vitamin_b12", 269, 200, 1100)));
check("a value mid-range is not borderline", () =>
  borderlineFor("vitamin_b12", 650, 200, 1100) === null ? null : "flagged mid-range");
check("out of range is not borderline — it's already flagged", () =>
  borderlineFor("vitamin_b12", 150, 200, 1100) === null ? null : "borderline swallowed an out-of-range value");
// Direction matters: nearing the good end earns nothing.
check("high HDL is not a warning", () =>
  borderlineFor("hdl", 95, 40, 100) === null ? null : "warned on the good end");
check("low HDL still is", () =>
  borderlineFor("hdl", 45, 40, 100) === "low" ? null : String(borderlineFor("hdl", 45, 40, 100)));
check("high LDL is a warning", () =>
  borderlineFor("ldl", 95, 0, 100) === "high" ? null : String(borderlineFor("ldl", 95, 0, 100)));
check("low LDL is not", () =>
  borderlineFor("ldl", 5, 0, 100) === null ? null : "warned on the good end");
// A one-sided range has no interior, so proximity is meaningless.
check("a one-sided range yields no borderline", () =>
  borderlineFor("crp", 7, null, 8) === null ? null : "invented a position");

// --- app reference ranges, used only where the report gave none ------------
check("the lab's own range always wins", () => {
  const r = effectiveRange("calprotectin", { ref_low: 10, ref_high: 90, ref_text: "10-90" });
  return r.fromLab && r.lo === 10 && r.hi === 90 ? null : JSON.stringify(r);
});
check("calprotectin gets an app range when the report gave none", () => {
  const r = effectiveRange("calprotectin", { ref_low: null, ref_high: null, ref_text: "" });
  if (r.fromLab) return "claimed to be from the lab";
  return r.hi === 50 && r.why ? null : JSON.stringify(r);
});
check("a marker with no app range stays rangeless", () => {
  const r = effectiveRange("some_unknown_test", { ref_low: null, ref_high: null, ref_text: "" });
  return r.lo === null && r.hi === null && r.fromLab ? null : JSON.stringify(r);
});

// --- the position bar's own axis ------------------------------------------
//
// Drawn only to the range, every out-of-range reading pins to the same end of
// the bar. A calprotectin of 51 and one of 160 drew an identical picture, and
// how far past the bound you are is the only thing that bar existed to say.

const near = (a, b, tol = 0.001) => Math.abs(a - b) < tol;
const levelAt = (g, x) => (g.zones.find(z => x >= z.from && x <= z.to) || {}).level;

check("a reading past the bound stretches the axis to reach it", () => {
  const g = gaugeScale("calprotectin", 160, null, 50);
  if (g.min !== 0) return `min ${g.min}`;
  if (g.max !== 160) return `max ${g.max} — the bar still stops at the bound`;
  return near(g.pos, 1) ? null : `pos ${g.pos}`;
});

check("51 and 160 no longer draw the same bar", () => {
  const a = gaugeScale("calprotectin", 51, null, 50);
  const b = gaugeScale("calprotectin", 160, null, 50);
  if (a.max === b.max) return "both axes still end in the same place";
  // Where normal ended is what separates them: nearly the whole bar vs a third.
  if (!(a.marks[0].at > 0.9)) return `barely-over mark at ${a.marks[0].at}`;
  if (!(b.marks[0].at < 0.4)) return `far-over mark at ${b.marks[0].at}`;
  return null;
});

check("the bound the axis ran past is marked at its own position", () => {
  const g = gaugeScale("calprotectin", 160, null, 50);
  if (g.marks.length !== 1) return `${g.marks.length} marks`;
  if (g.marks[0].value !== 50) return `marked ${g.marks[0].value}`;
  return near(g.marks[0].at, 50 / 160) ? null : `at ${g.marks[0].at}`;
});

check("past the bound is red, and it turns red exactly at the bound", () => {
  const g = gaugeScale("calprotectin", 160, null, 50);
  if (levelAt(g, 0.4) !== "off") return `beyond the bound reads ${levelAt(g, 0.4)}`;
  const off = g.zones.find(z => z.level === "off");
  return near(off.from, 50 / 160) ? null : `the red starts at ${off.from}, not the bound`;
});

check("approaching the bound is amber before it, not at it", () => {
  const g = gaugeScale("calprotectin", 160, null, 50);
  if (levelAt(g, 0.05) !== "ok") return `the low end reads ${levelAt(g, 0.05)}`;
  // The app's borderline window is the outer fifth: 40–50 of a 0–50 range.
  return levelAt(g, 45 / 160) === "edge" ? null : `45 reads ${levelAt(g, 45 / 160)}`;
});

check("an in-range reading leaves the axis as the range, with nothing to mark", () => {
  const g = gaugeScale("ferritin", 200, 30, 400);
  if (g.min !== 30 || g.max !== 400) return `axis ${g.min}–${g.max}`;
  if (g.marks.length) return "marked a bound that is already the end of the bar";
  return g.extended ? "claimed to be extended" : null;
});

check("a reading under the range stretches the axis downward", () => {
  const g = gaugeScale("vitamin_d", 26, 30, 100);
  if (g.min !== 26 || g.max !== 100) return `axis ${g.min}–${g.max}`;
  if (!near(g.pos, 0)) return `pos ${g.pos}`;
  if (g.marks[0]?.value !== 30) return "the low bound wasn't marked";
  return levelAt(g, 0.01) === "off" ? null : `below the range reads ${levelAt(g, 0.01)}`;
});

check("zero on a one-sided range is an axis, not a bound to mark", () => {
  const g = gaugeScale("calprotectin", 160, null, 50);
  if (g.marks.some(m => m.value === 0)) return "marked zero as if the lab had set it";
  return null;
});

// Direction: the same rule borderlineFor and isFavorable already follow, so a
// bar can't call a marker amber where the badge above it says nothing.
check("nearing the good end of a higher-is-better marker isn't amber", () => {
  const g = gaugeScale("egfr", 100, 60, 120);
  return levelAt(g, 0.95) === "ok" ? null : `the top reads ${levelAt(g, 0.95)}`;
});

check("passing the good end isn't red either", () => {
  const g = gaugeScale("egfr", 150, 60, 120);
  return levelAt(g, 0.95) === "ok" ? null : `above range reads ${levelAt(g, 0.95)}`;
});

check("the low end of a lower-is-better marker isn't amber", () => {
  const g = gaugeScale("ldl", 80, 50, 130);
  return levelAt(g, 0.02) === "ok" ? null : `the bottom reads ${levelAt(g, 0.02)}`;
});

check("a marker with no declared direction is amber at both edges", () => {
  const g = gaugeScale("some_unknown_marker", 50, 0, 100);
  if (levelAt(g, 0.02) !== "edge") return `bottom reads ${levelAt(g, 0.02)}`;
  return levelAt(g, 0.98) === "edge" ? null : `top reads ${levelAt(g, 0.98)}`;
});

check("the zones tile the whole bar with no gaps or overlaps", () => {
  for (const g of [
    gaugeScale("calprotectin", 160, null, 50),
    gaugeScale("vitamin_d", 26, 30, 100),
    gaugeScale("ferritin", 200, 30, 400),
    gaugeScale("egfr", 150, 60, 120),
  ]) {
    if (!near(g.zones[0].from, 0)) return `starts at ${g.zones[0].from}`;
    if (!near(g.zones[g.zones.length - 1].to, 1)) return `ends at ${g.zones[g.zones.length - 1].to}`;
    for (let i = 1; i < g.zones.length; i++) {
      if (!near(g.zones[i].from, g.zones[i - 1].to)) return `gap at zone ${i}`;
      if (g.zones[i].level === g.zones[i - 1].level) return "two adjacent zones share a level";
    }
  }
  return null;
});

check("a marker with no usable range still gets no bar", () => {
  if (gaugeScale("folate", 80, 40, null) !== null) return "drew a bar with no ceiling to scale against";
  return gaugeScale("calprotectin", null, null, 50) === null ? null : "drew a bar for a non-number";
});

console.log(failed ? `\n${failed} problem(s)` : "\nall good");
process.exit(failed ? 1 : 0);
