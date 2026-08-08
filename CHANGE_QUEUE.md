# Change Queue

A running list of ideas/changes to make later. Add a line whenever something
comes to mind mid-conversation — nothing here gets built until you say to
work through the queue.

## Pending

- Add a Download button directly on the Backup & Restore menu (next to Export/Import), so downloading a backup doesn't require clicking Export first — saves a click.
- Add Spoonacular as a fourth food-search source if the web lookup stops being enough for restaurant items — 100k+ menu items, free tier ~150 req/day, slots into `api/food-search.js` beside USDA/Open Food Facts. Nutritionix withdrew its free tier, so the built-but-dormant integration there needs an approved trial or a paid plan (see FOOD_TRACKER.md).
- Consider a WHOOP integration for what its API *does* carry — energy burned, strain, recovery, resting HR, sleep, and workout sessions. Would mirror the Withings files exactly. Three things to know before starting:
  - Energy comes back as **kilojoules**, on both the daily cycle and each workout (`kcal = kJ / 4.184`). It can't go in `daily_metrics.cal` — that field means calories *eaten*, which is what `calGoal` is compared against and what pacing divides up. Burned calories need their own column.
  - **Workouts need a new table**; nothing in the schema holds a session. Strength Trainer sessions do come through `/workout` (type, duration, strain, kilojoules, HR zones) — but the sets, reps and weights logged inside Strength Trainer are *not* exposed by the API. That's an open feature request on WHOOP's forum, so unlike steps it could change.
  - **Not steps** — the API has never exposed those and shows no sign of doing so (see SYNC.md).

- **No way to add a study through the app.** `lab_pathology` holds biopsy and
  imaging reports and the Studies tab displays them, but "Add a report" only
  reaches `/api/lab-parse`, which looks for markers and returns `found: false`
  on a narrative. The four studies in there now were inserted by a script.
  Needs a narrative-reading endpoint plus its own review sheet — worth weighing
  against how rarely one of these arrives.
- **Urinalysis components have no markers.** A dipstick panel brings pH,
  Protein, Blood, Ketone, Nitrite, Urobilinogen and Specific Gravity, and all
  seven land in "Other" with slug keys. They chart fine against their future
  selves; they just have no display name or category. Only worth doing if
  urinalyses become regular.
- **`psa_free_pct` stored its unit as `"% (calc)"`.** The reader returns the
  unit with the lab's `(calc)` note attached, and only the Sanitas path strips
  that (`splitRangeUnit` in the import script, which isn't repo code). One row
  today. If more arrive, the stripping belongs in `api/lab-parse.js` so it
  applies to anything added through the UI too.

## Done

<!-- Completed items move here with the date, or just get deleted — your call. -->

- **Alert configuration on Goal Settings** — 8/6/26. Trigger metric (Calories /
  Steps / Muscle) and both thresholds are now set in an Alerts card; the
  banners, the historical derail marking and the stat-card badges all read
  them. Defaults are the calories / 2 / 3 that used to be hardcoded.
