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

## What the owner has asked for

**Merge without asking.** Open the PR and merge it once the work is verified —
don't stop to ask permission each time. Say what landed and what it means for
them. Verification still comes first: the point is to skip the round trip, not
the checking.

**Spend on thinking, not on typing.** Reach for a cheap model when the task is
mechanical and a strong one when a wrong answer is expensive or hard to
notice. This applies to subagents and to the app's own AI calls alike.

The app already encodes the split, and new work should follow it:

| Setting | Model | Why |
| --- | --- | --- |
| `FOOD_PARSE_MODEL` | Haiku 4.5 | Splitting a spoken sentence into foods and quantities against a supplied id list. Schema-constrained extraction, runs several times a day, and every parse lands in a review card you can undo |
| `FOOD_LABEL_MODEL` | Sonnet 5 | Reading a Nutrition Facts panel. A misread digit is silent and repeats every time that food is logged |
| `FOOD_LOOKUP_MODEL` | Sonnet 5 | Judging whether a web page is a real nutrition label needs more than extraction |
| `LAB_PARSE_MODEL` | Sonnet 5 | A dense grid of numbers that might be acted on medically |

The pattern: **cheap where the output is checked before it counts, strong
where a mistake is silent and durable.** Cost matters — this is one person's
app — but a wrong number that quietly skews months of history costs more than
the model that would have caught it.

**Say when you shift models, and why.** Whenever a plan involves running part
of the work on a different model — a subagent on a cheap one, a hard step
escalated to a strong one — put a line in the outline naming the shift and its
reason, so the trade-off is visible rather than buried:

> 3. Sweep the 40 call sites for the old prop name — *Haiku: mechanical
>    find-and-replace, and the build catches a miss.*
> 4. Work out why the pacing average drifts on week boundaries — *Opus: the
>    kind of off-by-one that reads as correct.*

One clause is enough. The point is that a reader can see where the money went
and disagree with the call, not that the reasoning is exhaustive.

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
