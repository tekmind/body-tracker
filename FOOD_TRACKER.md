# Food tab — setup

The Food tab tracks calories, protein, carbs, and fat per meal section, with a
"say what you ate" button that parses a spoken sentence into log entries.

Three one-time setup steps. Steps 2 and 3 are optional in the sense that the
tab still runs without them, but you'll want both.

## 1. Create the tables (required)

Open the Supabase SQL editor and run [`supabase_food.sql`](supabase_food.sql).
It creates three tables and is safe to re-run:

| Table | What's in it |
| --- | --- |
| `food_items` | Every food you've used — your own entries plus anything imported from USDA / Open Food Facts, cached after first use |
| `food_meals` | Saved custom meals ("usual breakfast") you can drop into a section in one tap |
| `food_log` | One row per food eaten, with the macros **snapshotted** onto the row so fixing a food's nutrition later never rewrites last month's days |

Until this runs, the Food tab shows a banner telling you to run it.

## 2. USDA FoodData Central key (food search)

Search hits two databases: **USDA FoodData Central** for generic whole foods
("white rice", "chicken breast") and **Open Food Facts** for packaged products.
Open Food Facts needs no key; USDA needs a free one.

1. Get a key at <https://fdc.nal.usda.gov/api-key-signup.html> (instant, no cost).
2. Add it to your Vercel project as `USDA_API_KEY` (Settings → Environment
   Variables), and to your local `.env` if you run `npm run dev`.
3. Redeploy.

Without the key, search silently falls back to Open Food Facts alone and says
so in the results — fine for barcoded packages, poor for generic foods.

## 3. Anthropic API key (voice entry)

The "say what you ate" button sends your sentence to Claude
(`api/food-parse.js`), which splits it into foods and quantities. Add
`ANTHROPIC_API_KEY` to the same Vercel environment-variable screen.

Without it, everything else in the tab works and that one button reports that
it's switched off.

## How things fit together

- **Speech** is captured in the browser with the Web Speech API — Safari and
  Chrome both support it, including on iOS, so no audio ever leaves the device.
  Only the transcribed text is sent. Browsers without it just show the textbox.
- **Matching order** is history first, database second, as asked: your recent
  foods are sent along with the transcript so Claude can match against them by
  id, then anything unmatched gets looked up in USDA / Open Food Facts.
  Everything imported is cached into `food_items`, so the second time you eat
  something it's a local match.
- **The review card** after each voice entry shows what matched, where each
  food came from, a per-item "Wrong food?" picker, and an Undo-all button.
- **Serving math** lives in `src/foodMath.js` and is shared by the browser and
  the serverless functions. Foods store macros for one base serving plus the
  portions the source knew about, which is what makes "4 oz of white rice" and
  "10 saltine crackers" convert correctly. When a unit doesn't line up with
  anything the food knows, the amount is counted as servings and flagged in the
  UI rather than silently guessed.

## Targets

Protein / carb / fat targets sit next to the calorie and step goals on the
**Goal Settings** tab, per phase, and inherit from the previous goal when left
blank — same as the existing fields. The day tiles and the weekly bar chart
compare against whichever goal was in force on that date.

## Calories flow into the Daily tab

Logging food writes that day's calorie total into the Daily log, so pacing,
streaks, and the derail alerts keep working with no double entry. A number you
typed by hand on the Daily tab is never overwritten — the Food tab shows both
and offers a one-tap swap instead.

## Backups

Backup & Restore on the Goal Settings tab covers the key/value blobs (weekly
log, goals, daily log, habits). The food tables aren't in it, the same way the
HealthKit/Withings `daily_metrics` table isn't — use a Supabase backup for
those.
