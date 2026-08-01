# Change Queue

A running list of ideas/changes to make later. Add a line whenever something
comes to mind mid-conversation — nothing here gets built until you say to
work through the queue.

## Pending

- Add a Download button directly on the Backup & Restore menu (next to Export/Import), so downloading a backup doesn't require clicking Export first — saves a click.
- Add Spoonacular as a fourth food-search source if the web lookup stops being enough for restaurant items — 100k+ menu items, free tier ~150 req/day, slots into `api/food-search.js` beside USDA/Open Food Facts. Nutritionix withdrew its free tier, so the built-but-dormant integration there needs an approved trial or a paid plan (see FOOD_TRACKER.md).
- Consider a WHOOP integration for what its API *does* carry — calories burned (`kilojoule` converts straight to `daily_metrics.cal`), strain, recovery, resting HR, sleep. Not steps; the API has never exposed those (see SYNC.md). Would mirror the Withings files exactly.
- Add alert configuration to the Goal Settings page: let the user set the trigger metric and thresholds for the derail/slipping alert system (currently hardcoded in src/Dashboard.jsx to calories-over-target, 3 weeks = derailed, 2 weeks = slipping — that logic would need to read from these settings instead).

## Done

<!-- Completed items move here with the date, or just get deleted — your call. -->
