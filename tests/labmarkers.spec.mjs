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

import { resolveMarker } from "../src/labMarkers.js";

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

console.log(failed ? `\n${failed} problem(s)` : "\nall good");
process.exit(failed ? 1 : 0);
