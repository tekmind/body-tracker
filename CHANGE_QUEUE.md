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
- Add alert configuration to the Goal Settings page: let the user set the trigger metric and thresholds for the derail/slipping alert system (currently hardcoded in src/Dashboard.jsx to calories-over-target, 3 weeks = derailed, 2 weeks = slipping — that logic would need to read from these settings instead).

## Done

<!-- Completed items move here with the date, or just get deleted — your call. -->
