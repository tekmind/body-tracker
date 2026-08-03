// USDA portion parsing across the three datasets, which spell portions
// differently enough that one fallback order can't serve all of them.
import { normalizeUsda } from "/home/user/body-tracker/api/_food.js";

const bad = [];
const check = (l, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${x ? "  " + x : ""}`); if (!ok) bad.push(l); };

const NUTRIENTS = [
  { nutrientId: 1008, value: 117 },  // energy per 100 g
  { nutrientId: 1003, value: 19 },   // protein
  { nutrientId: 1005, value: 1.6 },  // carbs
  { nutrientId: 1004, value: 3.9 },  // fat
];

// --- Survey (FNDDS): measureUnit is "undetermined", modifier is a code ------
const fndds = normalizeUsda({
  fdcId: 1, description: "Ham", dataType: "Survey (FNDDS)", foodNutrients: NUTRIENTS,
  foodPortions: [
    { measureUnit: { name: "undetermined" }, modifier: "10205", portionDescription: "1 slice", gramWeight: 135, amount: 1 },
    { measureUnit: { name: "undetermined" }, modifier: "90000", portionDescription: "1 cup", gramWeight: 140, amount: 1 },
    { measureUnit: { name: "undetermined" }, modifier: "64759", portionDescription: "2 tbsp", gramWeight: 30, amount: 1 },
    { measureUnit: { name: "undetermined" }, modifier: "51000", portionDescription: "Quantity not specified", gramWeight: 100, amount: 1 },
  ],
});
const units = fndds.alt_servings.map(a => a.unit);
console.log("FNDDS units:", JSON.stringify(units));
check("no FNDDS portion code survives as a unit", !units.some(u => /^\d+$/.test(u)), units.join(","));
check("the readable description is used instead", units.includes("slice") && units.includes("cup"), units.join(","));
check('"Quantity not specified" is dropped', !units.some(u => u.includes("not specified")), units.join(","));

const slice = fndds.alt_servings.find(a => a.unit === "slice");
check("a slice keeps its gram weight", slice?.grams === 135, JSON.stringify(slice));
check("and reads as one slice", slice?.label === "1 slice", slice?.label);

// "2 tbsp" weighing 30 g means one tbsp is 15 g — the count in the text is
// the amount, not a multiplier on top of `amount`.
const tbsp = fndds.alt_servings.find(a => a.unit === "tbsp");
check("a multi-count description divides out", tbsp?.grams === 15 && tbsp?.qty === 2, JSON.stringify(tbsp));

// --- Foundation / SR Legacy: measureUnit names the unit ---------------------
const legacy = normalizeUsda({
  fdcId: 2, description: "Rice, white, cooked", dataType: "SR Legacy", foodNutrients: NUTRIENTS,
  foodPortions: [
    { measureUnit: { name: "cup" }, modifier: "cup, diced", gramWeight: 158, amount: 1 },
    { measureUnit: { name: "cup" }, gramWeight: 79, amount: 0.5 },
  ],
});
const cup = legacy.alt_servings.find(a => a.unit === "cup");
check("a named measure unit still wins", cup?.unit === "cup", JSON.stringify(cup));
check("and a fractional amount still divides out", legacy.alt_servings.some(a => a.grams === 158),
  JSON.stringify(legacy.alt_servings.map(a => a.grams)));

// --- Where modifier IS the description (SR Legacy shape) -------------------
const modOnly = normalizeUsda({
  fdcId: 3, description: "Butter", dataType: "SR Legacy", foodNutrients: NUTRIENTS,
  foodPortions: [{ measureUnit: { name: "undetermined" }, modifier: "pat (1in sq, 1/3in high)", gramWeight: 5, amount: 1 }],
});
check("a text modifier is still honoured", modOnly.alt_servings[0]?.unit === "pat",
  JSON.stringify(modOnly.alt_servings[0]));

// --- Search results (foodMeasures) -----------------------------------------
const search = normalizeUsda({
  fdcId: 4, description: "Ham", dataType: "Survey (FNDDS)", foodNutrients: NUTRIENTS,
  foodMeasures: [
    { disseminationText: "1 slice", gramWeight: 135 },
    { disseminationText: "90000", gramWeight: 140 },
    { disseminationText: "undetermined", gramWeight: 50 },
  ],
});
const sUnits = search.alt_servings.map(a => a.unit);
console.log("search units:", JSON.stringify(sUnits));
check("search results reject codes too", !sUnits.some(u => /^\d+$/.test(u)), sUnits.join(","));
check("and keep the readable one", sUnits.includes("slice"), sUnits.join(","));
check("the count comes out of the label", search.alt_servings.find(a => a.unit === "slice")?.grams === 135);

// --- A food with nothing usable ends up with no alternates, not junk -------
const junk = normalizeUsda({
  fdcId: 5, description: "Mystery", dataType: "Survey (FNDDS)", foodNutrients: NUTRIENTS,
  foodPortions: [{ measureUnit: { name: "undetermined" }, modifier: "40016", gramWeight: 90, amount: 1 }],
});
check("an unresolvable portion is dropped rather than shown", junk.alt_servings.length === 0,
  JSON.stringify(junk.alt_servings));
check("the base 100 g serving is untouched", junk.serving_qty === 100 && junk.serving_unit === "g");

// --- foods already cached with codes -----------------------------------------
// The importer fix can't reach rows already in food_items, so the pickers
// have to hide them too.
const { unitOptions, defaultPortion, servingFactor } = await import("/home/user/body-tracker/src/foodMath.js");
const cached = {
  name: "Ham", serving_qty: 100, serving_unit: "g", serving_grams: 100,
  cal: 117, protein: 19, carbs: 1.6, fat: 3.9,
  alt_servings: [
    { label: "1 10205", qty: 1, unit: "10205", grams: 135 },
    { label: "1 90000", qty: 1, unit: "90000", grams: 140 },
    { label: "1 oz", qty: 1, unit: "oz", grams: 28.35 },
  ],
};
const opts = unitOptions(cached);
console.log("cached unit options:", JSON.stringify(opts));
check("a cached code is not offered as a unit", !opts.some(u => /^\d+$/.test(u)), opts.join(","));
check("real units beside it survive", opts.includes("oz") && opts.includes("g"), opts.join(","));
check("and the default portion skips the code", !/^\d+$/.test(defaultPortion(cached).unit),
  JSON.stringify(defaultPortion(cached)));

// A day already logged in one of these units must still convert correctly,
// which is why only the pickers filter and the maths doesn't.
const f = servingFactor(cached, 1, "10205");
check("a row already logged in a code still converts", f.factor === 1.35, JSON.stringify(f));

console.log(bad.length ? `\n${bad.length} problem(s):\n- ` + bad.join("\n- ") : "\nAll checks passed.");
process.exit(bad.length ? 1 : 0);
