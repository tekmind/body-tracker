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

Search hits three databases at once and merges them, because they cover
different ground:

| Source | Good at | Key needed |
| --- | --- | --- |
| **USDA FoodData Central** | Generic whole foods, and — via the Survey (FNDDS) set — everyday prepared foods like "pizza, cheese, thin crust" | Free, required |
| **Nutritionix** | Restaurant menu items and grocery brands, which USDA barely covers | Free tier, optional |
| **Open Food Facts** | Packaged products worldwide, and by far the best barcode coverage | None |

Any of them failing, or having no key, still returns the others' results.

1. Get a key at <https://fdc.nal.usda.gov/api-key-signup.html> (instant, no cost).
2. Add it to your Vercel project as `USDA_API_KEY` (Settings → Environment
   Variables), and to your local `.env` if you run `npm run dev`.
3. Redeploy.

Without the key, search says so in the results and falls back to the other
sources — fine for barcoded packages, poor for generic foods.

### Nutritionix (optional, recommended)

Sign up at <https://developer.nutritionix.com/> and add `NUTRITIONIX_APP_ID`
and `NUTRITIONIX_APP_KEY`. The free tier is **500 requests/day**, which is
generous for one person but is a daily cap rather than a monthly pool. Their
terms require visible attribution wherever their data appears; the search
sheet shows it automatically, and only when one of their results is on screen.

This is what closes most of the gap against a commercial tracker — restaurant
menus are the category USDA has essentially nothing for.

### Why not FatSecret

FatSecret has the largest free food database of the lot, but its OAuth 2.0
requires **IP allowlisting** — you register up to 15 static addresses against
your key and requests from anywhere else are rejected. Vercel's serverless
functions egress from dynamic IPs, so this can't work without standing up a
separate always-on proxy with a static IP. Not worth the infrastructure for a
personal app; revisit if this ever runs somewhere with a fixed address.

## 2b. Barcode scanning

The **Scan** button next to the search box reads a package barcode with the
camera and looks it up against Open Food Facts, then Nutritionix, then USDA's
branded set.

No key and no service needed. Two decoders are used because **no browser on
iOS implements the Barcode Detection API** — Chrome on Android gets the fast
native path, and everything else (including Safari on your iPhone) falls back
to ZXing compiled to JavaScript. ZXing is a ~450KB chunk loaded on demand the
first time you open the scanner, so it never affects normal startup.

## 3. Anthropic API key (voice entry)

The "say what you ate" button sends your sentence to Claude
(`api/food-parse.js`), which splits it into foods and quantities. Add
`ANTHROPIC_API_KEY` to the same Vercel environment-variable screen.

Without it, everything else in the tab works and that one button reports that
it's switched off.

### Photograph the label

The most accurate way to add a food, and the one to reach for when a database
gets a serving wrong: **Photo of label** on the My foods tab (and inside the
custom food form) opens the camera, reads the Nutrition Facts panel, and fills
in the form.

It reads what's printed and doesn't convert or infer — the serving comes back
as the label states it ("1 stick", 32 g), which is exactly what barcode
databases get wrong. When a figure is illegible it says so and leaves the form
blank rather than guessing; retaking the photo costs seconds, a wrong number
repeats for weeks.

Photos are downscaled on the device before upload, so the multi-megabyte
original never leaves your phone — a 4032x3024 camera shot goes up as roughly
440KB. Runs on `FOOD_LABEL_MODEL`, default Claude Sonnet 5.

### Nutrition lookup for custom foods

The same key powers **Search the web** in the custom food form — the option for
when you don't have the package in hand. Type a name (and brand, if it has one)
and Claude searches the web, reads the nutrition label it finds, and fills in
the form.

It fills the form — it never saves. The numbers arrive editable, with the
sources linked and a confidence rating, and the banner says to check them
before saving. That's deliberate: a wrong custom food quietly skews every day
it appears in from then on, so it's worth ten seconds of review.

When nothing credible turns up it says so and leaves the form blank rather
than guessing. A blank form you fill in from the package beats plausible
numbers that are wrong.

This runs on **Claude Sonnet 5** by default (`FOOD_LOOKUP_MODEL`) rather than
Haiku: judging whether a page is a real nutrition label needs more than
extraction. Both it and the label reader only run when you press the button —
unlike parsing, which runs several times a day.

### What the two lookups cost

Counter-intuitively, the photo is the *cheaper* of the two, not the dearer one:

| | Tokens | Search fee | Roughly |
| --- | --- | --- | --- |
| **Photo of label** | ~2,500 image + ~1,000 text | none | **~1c** |
| **Search the web** | several thousand, mostly retrieved pages | $10 per 1,000 searches, and one lookup runs 2-4 | **~4-7c** |

An image looks expensive because it's a photo, but a 1600px downscale is only
about 2,500 tokens — comparable to a single web page, and a web lookup reads
several of them *plus* pays a per-search fee. So the photo wins on both counts:
cheaper, and reading the actual package instead of someone's copy of it.

Both are pennies either way at personal-use volume.

### Which model, and what it costs

Parsing runs on **Claude Haiku 4.5**, the cheapest tier. The task is
schema-constrained extraction — split a sentence into foods, quantities, and
units, and match against a list of ids — which doesn't need a frontier model.
Ballpark **a third of a cent per spoken meal**, so a few dollars a year at
several entries a day.

To change it, set `FOOD_PARSE_MODEL` in the Vercel environment variables (e.g.
`claude-sonnet-5`) and redeploy — no code change. `api/food-parse.js` sends
per-model parameters like `effort` only to the models that accept them, so
switching tiers can't start throwing 400s.

Two things make a cheap model safe here: a `history_id` the model invents that
isn't in the list you sent gets discarded server-side and falls through to a
database search, and every parse lands in a review card with a per-item "wrong
food?" picker and undo-all before you move on.

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
