// Canonical lab markers, shared by the browser and the serverless parser.
//
// The problem this solves: labs name the same test differently, and they
// change the wording between draws. Quest prints "LDL-Cholesterol (calc)",
// LabCorp prints "LDL Chol Calc (NIH)", a hospital prints "Cholesterol, LDL".
// Charted as-is, one marker becomes three flat lines of one point each.
//
// So each result carries a canonical `marker` key alongside the name the lab
// actually printed. Trends follow the key; the row still shows the wording on
// the report. A test that matches nothing gets a slug of its own name — an
// unrecognized marker still charts against its future selves, it just doesn't
// get a tidy display name or a category.

/**
 * key       stable id, stored on every result row
 * name      how the app displays it
 * unit      the unit this marker is usually reported in (display hint only —
 *           the result stores whatever the report printed)
 * category  groups results on screen
 * higher    "good" | "bad" | undefined — which direction is better when the
 *           value sits outside the lab's range. Only set where it's genuinely
 *           one-directional; most markers have a window, not a direction.
 * aliases   extra spellings. The matcher already handles punctuation, case,
 *           and the usual suffixes, so these are for names that don't share
 *           words with the canonical one.
 */
const MARKERS = [
  // --- Lipids --------------------------------------------------------------
  { key: "cholesterol_total", name: "Total cholesterol", unit: "mg/dL", category: "Lipids",
    aliases: ["cholesterol", "cholesterol total", "chol total", "total chol"] },
  { key: "ldl", name: "LDL cholesterol", unit: "mg/dL", category: "Lipids", higher: "bad",
    aliases: ["ldl", "ldl c", "ldl chol", "ldl cholesterol calc", "ldl chol calc nih", "ldl direct"] },
  { key: "hdl", name: "HDL cholesterol", unit: "mg/dL", category: "Lipids", higher: "good",
    aliases: ["hdl", "hdl c", "hdl chol"] },
  { key: "triglycerides", name: "Triglycerides", unit: "mg/dL", category: "Lipids", higher: "bad",
    aliases: ["trig", "trigs"] },
  { key: "non_hdl", name: "Non-HDL cholesterol", unit: "mg/dL", category: "Lipids", higher: "bad",
    aliases: ["non hdl", "non hdl chol"] },
  { key: "vldl", name: "VLDL cholesterol", unit: "mg/dL", category: "Lipids", higher: "bad",
    aliases: ["vldl", "vldl chol cal"] },
  { key: "chol_hdl_ratio", name: "Chol / HDL ratio", unit: "ratio", category: "Lipids", higher: "bad",
    aliases: ["chol hdl ratio", "total chol hdl ratio", "cholesterol hdl ratio", "chol hdlc ratio"] },
  { key: "apob", name: "Apolipoprotein B", unit: "mg/dL", category: "Lipids", higher: "bad",
    aliases: ["apo b", "apob", "apolipoprotein b100"] },
  { key: "lpa", name: "Lipoprotein(a)", unit: "nmol/L", category: "Lipids", higher: "bad",
    aliases: ["lp a", "lipoprotein a"] },

  // --- Metabolic -----------------------------------------------------------
  { key: "glucose", name: "Glucose", unit: "mg/dL", category: "Metabolic",
    aliases: ["glucose fasting", "fasting glucose", "glucose serum"] },
  { key: "hba1c", name: "Hemoglobin A1c", unit: "%", category: "Metabolic", higher: "bad",
    aliases: ["a1c", "hb a1c", "hgb a1c", "glycohemoglobin", "hemoglobin a1c"] },
  { key: "insulin", name: "Insulin", unit: "uIU/mL", category: "Metabolic", higher: "bad",
    aliases: ["insulin fasting", "fasting insulin"] },
  { key: "uric_acid", name: "Uric acid", unit: "mg/dL", category: "Metabolic", higher: "bad" },

  // --- Thyroid -------------------------------------------------------------
  { key: "tsh", name: "TSH", unit: "uIU/mL", category: "Thyroid",
    aliases: ["thyroid stimulating hormone", "thyrotropin"] },
  { key: "t4_free", name: "Free T4", unit: "ng/dL", category: "Thyroid",
    aliases: ["free t4", "t4 free", "free thyroxine", "ft4"] },
  { key: "t3_free", name: "Free T3", unit: "pg/mL", category: "Thyroid",
    aliases: ["free t3", "t3 free", "free triiodothyronine", "ft3"] },
  { key: "t4_total", name: "Total T4", unit: "ug/dL", category: "Thyroid",
    aliases: ["t4 total", "thyroxine total"] },
  { key: "t3_reverse", name: "Reverse T3", unit: "ng/dL", category: "Thyroid",
    aliases: ["reverse t3", "rt3"] },
  { key: "tpo_antibody", name: "TPO antibodies", unit: "IU/mL", category: "Thyroid", higher: "bad",
    aliases: ["thyroid peroxidase ab", "tpo ab", "anti tpo"] },

  // --- Hormones ------------------------------------------------------------
  { key: "testosterone_total", name: "Testosterone, total", unit: "ng/dL", category: "Hormones",
    aliases: ["testosterone", "testosterone total", "total testosterone"] },
  { key: "testosterone_free", name: "Testosterone, free", unit: "pg/mL", category: "Hormones",
    aliases: ["free testosterone", "testosterone free"] },
  { key: "testosterone_bioavailable", name: "Testosterone, bioavailable", unit: "ng/dL", category: "Hormones",
    aliases: ["testosterone bioavailable", "bioavailable testosterone", "testosterone bio"] },
  { key: "shbg", name: "SHBG", unit: "nmol/L", category: "Hormones",
    aliases: ["sex hormone binding globulin"] },
  { key: "estradiol", name: "Estradiol", unit: "pg/mL", category: "Hormones", aliases: ["e2"] },
  { key: "estrogen_total", name: "Estrogens, total", unit: "pg/mL", category: "Hormones",
    aliases: ["estrogens total", "estrogen total", "total estrogens"] },
  { key: "prolactin", name: "Prolactin", unit: "ng/mL", category: "Hormones" },
  { key: "dhea_s", name: "DHEA-S", unit: "ug/dL", category: "Hormones",
    aliases: ["dhea sulfate", "dheas", "dhea s"] },
  { key: "cortisol", name: "Cortisol", unit: "ug/dL", category: "Hormones",
    aliases: ["cortisol am", "cortisol morning"] },
  { key: "psa", name: "PSA", unit: "ng/mL", category: "Hormones", higher: "bad",
    aliases: ["prostate specific antigen", "psa total"] },
  // A free/total PSA panel prints all three. Free is a concentration, % free
  // is a ratio, and the percentage is the one that carries the meaning — they
  // cannot share a line. "pct" is what normalize() turns "%" into.
  { key: "psa_free", name: "PSA, free", unit: "ng/mL", category: "Hormones",
    aliases: ["psa free", "free psa"] },
  { key: "psa_free_pct", name: "PSA, % free", unit: "%", category: "Hormones", higher: "good",
    aliases: ["psa pct free", "pct free psa", "psa free pct"] },
  { key: "igf_1", name: "IGF-1", unit: "ng/mL", category: "Hormones",
    aliases: ["igf 1", "insulin like growth factor"] },
  { key: "lh", name: "LH", unit: "mIU/mL", category: "Hormones", aliases: ["luteinizing hormone"] },
  { key: "fsh", name: "FSH", unit: "mIU/mL", category: "Hormones", aliases: ["follicle stimulating hormone"] },

  // --- Vitamins & minerals -------------------------------------------------
  { key: "vitamin_d", name: "Vitamin D (25-OH)", unit: "ng/mL", category: "Vitamins & minerals",
    aliases: ["vitamin d 25 hydroxy", "25 oh vitamin d", "25 hydroxyvitamin d", "vit d", "vitamin d total"] },
  { key: "vitamin_b12", name: "Vitamin B12", unit: "pg/mL", category: "Vitamins & minerals",
    aliases: ["b12", "cobalamin", "vit b12"] },
  { key: "folate", name: "Folate", unit: "ng/mL", category: "Vitamins & minerals",
    aliases: ["folic acid", "folate serum"] },
  { key: "ferritin", name: "Ferritin", unit: "ng/mL", category: "Vitamins & minerals" },
  { key: "iron", name: "Iron", unit: "ug/dL", category: "Vitamins & minerals",
    aliases: ["iron total", "iron serum"] },
  // "iron binding capacity" without the "total" is required: Quest prints it
  // that way, and without it the name falls back to the 1-token "iron" match
  // and TIBC lands on the same trend line as serum iron.
  { key: "tibc", name: "TIBC", unit: "ug/dL", category: "Vitamins & minerals",
    aliases: ["total iron binding capacity", "iron binding capacity"] },
  { key: "iron_saturation", name: "Iron saturation", unit: "%", category: "Vitamins & minerals",
    aliases: ["transferrin saturation", "iron sat", "iron saturation", "saturation", "percent saturation"] },
  // The rest of the fat- and water-soluble panel. Labs print the vitamin and
  // its chemical name interchangeably ("VITAMIN B3" one draw, "NICOTINIC ACID"
  // the next), which is exactly the renaming that splits one marker into
  // several one-point trends.
  { key: "vitamin_a", name: "Vitamin A", unit: "mcg/dL", category: "Vitamins & minerals",
    aliases: ["retinol", "vitamin a retinol"] },
  { key: "vitamin_b1", name: "Vitamin B1", unit: "nmol/L", category: "Vitamins & minerals",
    aliases: ["thiamine", "thiamin", "vitamin b1 thiamine"] },
  { key: "vitamin_b2", name: "Vitamin B2", unit: "mcg/L", category: "Vitamins & minerals",
    aliases: ["riboflavin", "vitamin b2 riboflavin"] },
  { key: "vitamin_b3", name: "Vitamin B3", unit: "mcg/L", category: "Vitamins & minerals",
    aliases: ["niacin", "nicotinic acid", "vitamin b3 niacin"] },
  { key: "vitamin_b6", name: "Vitamin B6", unit: "mcg/L", category: "Vitamins & minerals",
    aliases: ["pyridoxine", "pyridoxal phosphate", "vitamin b6 pyridoxine"] },
  // Safe despite the "no one-letter aliases" rule above: potassium has no "k"
  // alias, so "Vitamin K" cannot be pulled onto it.
  { key: "vitamin_k", name: "Vitamin K", unit: "ng/mL", category: "Vitamins & minerals",
    aliases: ["phylloquinone", "vitamin k1"] },
  { key: "magnesium", name: "Magnesium", unit: "mg/dL", category: "Vitamins & minerals",
    aliases: ["mag", "magnesium rbc"] },
  { key: "zinc", name: "Zinc", unit: "ug/dL", category: "Vitamins & minerals" },

  // --- Blood count ---------------------------------------------------------
  { key: "wbc", name: "White blood cells", unit: "K/uL", category: "Blood count",
    aliases: ["wbc", "white blood cell count", "leukocytes"] },
  { key: "rbc", name: "Red blood cells", unit: "M/uL", category: "Blood count",
    aliases: ["rbc", "red blood cell count", "erythrocytes"] },
  { key: "hemoglobin", name: "Hemoglobin", unit: "g/dL", category: "Blood count",
    aliases: ["hgb", "hb"] },
  { key: "hematocrit", name: "Hematocrit", unit: "%", category: "Blood count", aliases: ["hct"] },
  { key: "platelets", name: "Platelets", unit: "K/uL", category: "Blood count",
    aliases: ["platelet count", "plt"] },
  { key: "mcv", name: "MCV", unit: "fL", category: "Blood count" },
  { key: "mch", name: "MCH", unit: "pg", category: "Blood count" },
  { key: "mchc", name: "MCHC", unit: "g/dL", category: "Blood count" },
  { key: "rdw", name: "RDW", unit: "%", category: "Blood count" },
  { key: "mpv", name: "MPV", unit: "fL", category: "Blood count",
    aliases: ["mean platelet volume"] },

  // A differential is printed twice: once as a percentage and once as an
  // absolute count. They are different measurements on different scales —
  // 43.2% and 2635 cells/uL — so they must not share a marker key. The
  // absolute forms carry two-token aliases because the matcher takes the
  // longest phrase contained in the name, and a bare "neutrophils" would
  // otherwise win and merge the two onto one trend line.
  { key: "neutrophils", name: "Neutrophils", unit: "%", category: "Blood count",
    aliases: ["neuts"] },
  { key: "neutrophils_abs", name: "Neutrophils (absolute)", unit: "cells/uL", category: "Blood count",
    aliases: ["absolute neutrophils", "neutrophils absolute", "abs neutrophils", "neutrophil count"] },
  { key: "lymphocytes", name: "Lymphocytes", unit: "%", category: "Blood count",
    aliases: ["lymphs"] },
  { key: "lymphocytes_abs", name: "Lymphocytes (absolute)", unit: "cells/uL", category: "Blood count",
    aliases: ["absolute lymphocytes", "lymphocytes absolute", "abs lymphocytes", "lymphocyte count"] },
  { key: "monocytes", name: "Monocytes", unit: "%", category: "Blood count",
    aliases: ["monos"] },
  { key: "monocytes_abs", name: "Monocytes (absolute)", unit: "cells/uL", category: "Blood count",
    aliases: ["absolute monocytes", "monocytes absolute", "abs monocytes", "monocyte count"] },
  { key: "eosinophils", name: "Eosinophils", unit: "%", category: "Blood count",
    aliases: ["eos"] },
  { key: "eosinophils_abs", name: "Eosinophils (absolute)", unit: "cells/uL", category: "Blood count",
    aliases: ["absolute eosinophils", "eosinophils absolute", "abs eosinophils", "eosinophil count"] },
  { key: "basophils", name: "Basophils", unit: "%", category: "Blood count",
    aliases: ["basos"] },
  { key: "basophils_abs", name: "Basophils (absolute)", unit: "cells/uL", category: "Blood count",
    aliases: ["absolute basophils", "basophils absolute", "abs basophils", "basophil count"] },

  // --- Liver ---------------------------------------------------------------
  { key: "alt", name: "ALT", unit: "U/L", category: "Liver", higher: "bad",
    aliases: ["alt sgpt", "sgpt", "alanine aminotransferase"] },
  { key: "ast", name: "AST", unit: "U/L", category: "Liver", higher: "bad",
    aliases: ["ast sgot", "sgot", "aspartate aminotransferase"] },
  { key: "alk_phos", name: "Alkaline phosphatase", unit: "U/L", category: "Liver",
    aliases: ["alk phos", "alp"] },
  { key: "bilirubin_total", name: "Bilirubin, total", unit: "mg/dL", category: "Liver",
    aliases: ["bilirubin", "total bilirubin"] },
  { key: "albumin", name: "Albumin", unit: "g/dL", category: "Liver" },
  { key: "globulin", name: "Globulin", unit: "g/dL", category: "Liver" },
  // Three tokens, so it beats the bare "albumin" match — otherwise a ratio of
  // 1.6 charts against albumin's 4.6 g/dL.
  { key: "albumin_globulin_ratio", name: "Albumin / globulin ratio", unit: "ratio", category: "Liver",
    aliases: ["albumin globulin ratio", "a g ratio"] },
  { key: "protein_total", name: "Total protein", unit: "g/dL", category: "Liver",
    aliases: ["protein total"] },
  { key: "ggt", name: "GGT", unit: "U/L", category: "Liver", higher: "bad",
    aliases: ["gamma gt", "ggtp"] },

  // --- Kidney & electrolytes ----------------------------------------------
  { key: "creatinine", name: "Creatinine", unit: "mg/dL", category: "Kidney & electrolytes",
    aliases: ["creatinine serum"] },
  { key: "egfr", name: "eGFR", unit: "mL/min/1.73", category: "Kidney & electrolytes", higher: "good",
    aliases: ["egfr", "gfr", "gfr estimated", "egfr non afr american", "egfr if nonafricn am"] },
  // Older reports print a race-adjusted pair. The non-African-American value
  // is aliased to eGFR above and continues the main trend; this keeps the
  // African-American variant on its own line rather than interleaving two
  // different calculations from the same draw.
  { key: "egfr_african_american", name: "eGFR (African American)", unit: "mL/min/1.73",
    category: "Kidney & electrolytes", higher: "good",
    aliases: ["egfr african american", "egfr if africn am"] },
  { key: "bun", name: "BUN", unit: "mg/dL", category: "Kidney & electrolytes",
    aliases: ["urea nitrogen", "blood urea nitrogen"] },
  { key: "bun_creatinine_ratio", name: "BUN / creatinine ratio", unit: "ratio", category: "Kidney & electrolytes",
    aliases: ["bun creatinine ratio"] },
  // No "Na" / "K" / "Cl" aliases: a one-letter token matches things it has
  // no business matching — "Vitamin K" is not potassium.
  { key: "sodium", name: "Sodium", unit: "mmol/L", category: "Kidney & electrolytes" },
  { key: "potassium", name: "Potassium", unit: "mmol/L", category: "Kidney & electrolytes" },
  { key: "chloride", name: "Chloride", unit: "mmol/L", category: "Kidney & electrolytes" },
  { key: "co2", name: "CO2", unit: "mmol/L", category: "Kidney & electrolytes",
    aliases: ["carbon dioxide", "bicarbonate"] },
  { key: "calcium", name: "Calcium", unit: "mg/dL", category: "Kidney & electrolytes" },

  // --- Inflammation --------------------------------------------------------
  { key: "crp_hs", name: "hs-CRP", unit: "mg/L", category: "Inflammation", higher: "bad",
    aliases: ["hs crp", "c reactive protein high sensitivity", "cardio crp", "hscrp"] },
  { key: "crp", name: "C-reactive protein", unit: "mg/L", category: "Inflammation", higher: "bad",
    aliases: ["c reactive protein", "crp"] },
  { key: "homocysteine", name: "Homocysteine", unit: "umol/L", category: "Inflammation", higher: "bad" },
  { key: "esr", name: "ESR", unit: "mm/hr", category: "Inflammation", higher: "bad",
    aliases: ["sed rate", "sedimentation rate"] },
];

export const MARKER_CATEGORIES = [
  "Lipids", "Metabolic", "Thyroid", "Hormones", "Vitamins & minerals",
  "Blood count", "Liver", "Kidney & electrolytes", "Inflammation", "Other",
];

/** Words labs sprinkle on test names that carry no identity. */
const NOISE = new Set([
  "serum", "plasma", "blood", "level", "levels", "test", "calc", "calculated",
  "calculation", "direct", "measured", "quant", "quantitative", "w", "with",
  "reflex", "panel", "profile", "screen", "s", "p", "sr", "the", "and",
]);

/** Lowercase, strip punctuation and noise words, collapse whitespace. */
function normalize(s) {
  const words = String(s || "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")       // typographic dashes
    // "%" has to survive as a token. Stripped as punctuation, "PSA, % FREE"
    // and "PSA, FREE" become the same word set — a percentage and a ng/mL
    // concentration the matcher then cannot tell apart.
    .replace(/%/g, " pct ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(w => w && !NOISE.has(w));

  // "vitamin b 12" -> "vitamin b12". Labs punctuate these inconsistently
  // ("B-12", "B 12", "B12") and a split token would never match a joined one.
  // Both the input and the aliases go through here, so they can't disagree.
  const glued = [];
  for (const w of words) {
    if (/^\d+$/.test(w) && glued.length && !/\d$/.test(glued[glued.length - 1])) {
      glued[glued.length - 1] += w;
    } else {
      glued.push(w);
    }
  }
  return glued.join(" ").trim();
}

/** "LDL-Cholesterol (calc)" -> "ldl_cholesterol" — the fallback key. */
export function slugify(s) {
  const base = normalize(s).replace(/\s+/g, "_");
  if (base) return base;
  // A name made entirely of noise words normalizes to nothing — a urinalysis
  // prints a row called just "Blood". Falling through to a single "unknown"
  // key would put every such test on one trend line, so keep the raw name.
  const raw = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return raw || "unknown";
}

// Built once: every spelling we know, pointing at its marker.
const BY_PHRASE = new Map();
const PHRASES = [];
for (const m of MARKERS) {
  const phrases = [m.key.replace(/_/g, " "), m.name, ...(m.aliases || [])];
  for (const p of phrases) {
    const n = normalize(p);
    if (!n) continue;
    // First writer wins, so a marker's own name beats a later marker's alias.
    if (!BY_PHRASE.has(n)) BY_PHRASE.set(n, m);
    PHRASES.push({ marker: m, tokens: n.split(" ") });
  }
}

const BY_KEY = new Map(MARKERS.map(m => [m.key, m]));

/**
 * Resolve a lab's wording to a canonical marker.
 *
 * Falls back to a slug of the name rather than dropping the result: an
 * unrecognized test still charts against its future selves, and lands in
 * "Other" instead of vanishing.
 */
export function resolveMarker(rawName) {
  const n = normalize(rawName);
  // Not "unknown": slugify keeps the raw name when a test is named entirely of
  // noise words, so two such tests don't end up sharing one trend line.
  if (!n) return { key: slugify(rawName), name: String(rawName || "Unnamed").trim() || "Unnamed", category: "Other", known: false };

  const exact = BY_PHRASE.get(n);
  if (exact) return { key: exact.key, name: exact.name, category: exact.category, known: true };

  // Otherwise: the most specific spelling wholly contained in the name wins.
  // Word ORDER can't be the tiebreak — labs write both "LDL Cholesterol" and
  // "Cholesterol, LDL" — so it's the longest matching phrase that decides,
  // which is what stops the second one from stopping at "Cholesterol".
  const tokens = new Set(n.split(" "));
  let best = null, bestLen = 0, bestExtra = Infinity;
  for (const ph of PHRASES) {
    if (ph.tokens.length > tokens.size) continue;
    if (!ph.tokens.every(t => tokens.has(t))) continue;
    const extra = tokens.size - ph.tokens.length;
    if (ph.tokens.length > bestLen || (ph.tokens.length === bestLen && extra < bestExtra)) {
      best = ph.marker; bestLen = ph.tokens.length; bestExtra = extra;
    }
  }
  if (best) return { key: best.key, name: best.name, category: best.category, known: true };

  return { key: slugify(rawName), name: String(rawName).trim(), category: "Other", known: false };
}

export function markerInfo(key) {
  return BY_KEY.get(key) || null;
}

export function markerDisplayName(key, fallback) {
  return BY_KEY.get(key)?.name || fallback || key;
}

export function markerCategory(key) {
  return BY_KEY.get(key)?.category || "Other";
}

/**
 * Where a value sits against the lab's own range.
 *
 * The lab's printed range wins over anything we could infer — it's the range
 * that applied to that draw, on that instrument. Returns null when the report
 * gave no numeric range, which is common for ratios and calculated values.
 */
export function flagFor(value, refLow, refHigh) {
  if (value == null || !Number.isFinite(value)) return null;
  const lo = Number.isFinite(refLow) ? refLow : null;
  const hi = Number.isFinite(refHigh) ? refHigh : null;
  if (lo == null && hi == null) return null;
  if (lo != null && value < lo) return "low";
  if (hi != null && value > hi) return "high";
  return "normal";
}

/** Is an out-of-range direction the good one? Used only for colour. */
export function isFavorable(markerKey, flag) {
  const dir = BY_KEY.get(markerKey)?.higher;
  if (!dir || !flag || flag === "normal") return false;
  return (dir === "good" && flag === "high") || (dir === "bad" && flag === "low");
}

/** Category order, then alphabetical inside it — a stable on-screen order. */
export function sortResults(results) {
  const rank = (c) => {
    const i = MARKER_CATEGORIES.indexOf(c || "Other");
    return i < 0 ? MARKER_CATEGORIES.length : i;
  };
  return [...results].sort((a, b) => {
    const d = rank(a.category) - rank(b.category);
    if (d) return d;
    if (a.sort_order !== b.sort_order) return (a.sort_order || 0) - (b.sort_order || 0);
    return String(a.name).localeCompare(String(b.name));
  });
}

/** Round for display without pretending to a precision the lab didn't print. */
export function fmtValue(v) {
  if (v == null || !Number.isFinite(Number(v))) return "–";
  const n = Number(v);
  if (Math.abs(n) >= 100) return String(Math.round(n));
  if (Math.abs(n) >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

/** "70 – 99", "< 5", "> 40", or "" when there are no numeric bounds. */
export function fmtBounds(refLow, refHigh) {
  const lo = Number.isFinite(refLow) ? refLow : null;
  const hi = Number.isFinite(refHigh) ? refHigh : null;
  if (lo != null && hi != null) return `${fmtValue(lo)} – ${fmtValue(hi)}`;
  if (hi != null) return `< ${fmtValue(hi)}`;
  if (lo != null) return `> ${fmtValue(lo)}`;
  return "";
}

/**
 * The range to show next to a result.
 *
 * The report's own wording wins when there is any: a one-sided range read as
 * "<100" and stored as an upper bound of 99 would otherwise be displayed back
 * as "< 99", which is a number the report never printed. The bounds are what
 * the flag and the trend band are computed from; this is only for reading.
 */
export function fmtRange(refLow, refHigh, refText) {
  const printed = String(refText || "").trim();
  if (printed) return printed;
  return fmtBounds(refLow, refHigh);
}

export { MARKERS };
