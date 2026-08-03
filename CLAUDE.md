# Working on this app

A personal body/health tracker: React 18 + Vite, Supabase for storage, Vercel
serverless functions under `api/`. One user, one phone. Most decisions follow
from that — it's phone-first, and correctness of the numbers matters more than
almost anything else.

## Where the documentation lives

Read the one that covers what you're touching. They're written to be read, not
skimmed, and they explain *why* rather than restating the code.

| File | Covers |
| --- | --- |
| [`SYNC.md`](SYNC.md) | Where each daily number comes from: the iOS Shortcut, WHOOP steps via Apple Health, Withings, and how the weekly log fills itself |
| [`FOOD_TRACKER.md`](FOOD_TRACKER.md) | The Food tab end to end — API keys, the food databases, voice entry, label photos, one-tap add, what the AI calls cost |
| [`LABS.md`](LABS.md) | The Labs tab and lab-report parsing |
| [`CHANGE_QUEUE.md`](CHANGE_QUEUE.md) | Ideas parked for later. Nothing here gets built unless asked |

## Conventions

- **Work on `claude/calorie-tracker-feature-2vd0z4`**, never commit to `main`.
- **Verify before merging.** Run the affected specs, and add checks for what
  you changed. Several real bugs this suite caught were in code that looked
  obviously right.
- **`main` is squash-merged**, so after a merge the branch's commits are gone
  by hash even though their content landed. Re-base with
  `git checkout -B <branch> origin/main` and cherry-pick anything genuinely
  unmerged — check `git diff origin/main HEAD --stat` before assuming.
- **Server-side keys must never take a `VITE_` prefix** — that publishes them
  into the browser bundle. Only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` are meant to be public.
- **`.env.local` is for local test runs only.** It's gitignored; delete it
  before committing anyway.

## Two rules the maths depends on

These come up constantly and breaking them corrupts numbers silently.

**Blank is not zero.** A day with nothing logged is excluded from averages and
streaks rather than counted as 0. `Number(null)` is `0` and passes
`Number.isFinite`, so filter *before* converting — that exact slip shipped a
weekly average of 3,000 where the answer was 3,500.

**A logged row keeps its own macros.** `food_log` snapshots them at write
time, so correcting a food's nutrition never rewrites last month. Anything
that reads those rows must not recompute from the current `food_items` row.

## Tests

```
npm test              # everything (~2-3 min)
npm test goals cells  # just those specs
```

The runner starts a dev server if one isn't already up. Specs are plain
scripts that print `PASS`/`FAIL` and exit non-zero — no framework. Every
network call is mocked in `tests/seed.mjs`, so nothing touches the real
Supabase project.

Write assertions about behaviour a person would notice: what a number reads,
what colour a tile is, whether a tap logs the right amount. Checking that a
function was called proves nothing here.

## This container's quirks

- **The proxy blocks a lot.** `whoop.com`, `supabase.co`, `nutritionix.com`,
  `api.nal.usda.gov` all 403 at the CONNECT. You cannot test against the real
  Supabase project or call the food APIs from here — that's why everything is
  mocked, and why claims about third-party APIs get researched rather than
  tried.
- **Google Fonts is unreachable**, and `waitUntil: "networkidle"` waits out the
  full timeout — 14.6s per page load against 2.4s once aborted. `blockWebfonts`
  in `tests/seed.mjs` handles it; any new spec that rolls its own routes needs
  to call it too.
- **Chromium** is prebuilt at `/opt/pw-browsers/…`; `tests/seed.mjs` falls back
  to Playwright's own resolution elsewhere, or `PW_CHROMIUM` to override.
- **No Supabase credentials.** Schema changes are SQL the user runs themselves
  — write it into the relevant `supabase_*.sql`, make it re-runnable, and say
  so plainly rather than pretending it's applied.
