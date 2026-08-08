// What the reader hands back before anything is saved.
//
// Quest prints how a number was derived next to its unit — "mg/dL (calc)", or
// a bare "(calc)" where there is no unit at all. That is a note about method,
// not a unit, and left in place it labels every chart axis and every row as
// though "(calc)" were the thing being measured.
//
// The reference range has a nastier version of the same problem: when the
// report gives no range for a calculated value, the unit can arrive alone in
// brackets — "(mg/dL (calc))". The app prints ref_text verbatim, so that shows
// up on screen as this marker's reference range, which the report never gave.
//
// No browser and no API call — these are pure functions.

import { cleanUnit, cleanRefText } from "../api/lab-parse.js";

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
}

// --- units -----------------------------------------------------------------
check("a real unit is left alone", cleanUnit("mg/dL"), "mg/dL");
check("percent is left alone", cleanUnit("%"), "%");
check("a (calc) note is dropped from the unit", cleanUnit("mg/dL (calc)"), "mg/dL");
check("percent keeps its sign when (calc) goes", cleanUnit("% (calc)"), "%");
check("a unit that is only a (calc) note becomes empty", cleanUnit("(calc)"), "");
check("the spelled-out form goes too", cleanUnit("g/dL (calculated)"), "g/dL");
check("an empty unit stays empty", cleanUnit(""), "");
check("null is handled", cleanUnit(null), "");
// A parenthesised suffix that ISN'T a method note is part of the unit.
check("a meaningful parenthetical is kept", cleanUnit("mIU/mL (3rd gen)"), "mIU/mL (3rd gen)");
check("units with slashes and dots survive", cleanUnit("mL/min/1.73m2"), "mL/min/1.73m2");

// --- reference ranges ------------------------------------------------------
check("a numeric range is kept", cleanRefText("70-99"), "70-99");
check("a one-sided range is kept", cleanRefText("<5.7"), "<5.7");
check("a qualitative range is kept", cleanRefText("NEGATIVE"), "NEGATIVE");
check("NON-REACTIVE is a real range", cleanRefText("NON-REACTIVE"), "NON-REACTIVE");
check("wording is kept", cleanRefText("Not Estab."), "Not Estab.");
// The bug: a bracketed unit standing in for a range that was never printed.
check("a bracketed unit is not a range", cleanRefText("(ng/mL)"), "");
check("a bracketed unit with a note is not a range", cleanRefText("(mg/dL (calc))"), "");
check("a bare (calc) is not a range", cleanRefText("(calc)"), "");
// ...but a bracketed range that HAS numbers is still a range.
check("a bracketed numeric range survives", cleanRefText("(70-99)"), "(70-99)");
check("empty stays empty", cleanRefText(""), "");
check("null is handled", cleanRefText(null), "");

console.log(failed ? `\n${failed} problem(s)` : "\nall good");
process.exit(failed ? 1 : 0);
