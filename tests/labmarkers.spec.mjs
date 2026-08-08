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

import { resolveMarker, systemsFor } from "../src/labMarkers.js";

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

console.log(failed ? `\n${failed} problem(s)` : "\nall good");
process.exit(failed ? 1 : 0);
