# Labs tab — setup

Tracks blood work over time: import the PDFs your lab portal gives you (or a
photo of the printout), and every marker gets a trend line with the reference
range drawn behind it.

Two setup steps, and only the first is required.

## 1. Create the tables (required)

Open the Supabase SQL editor and run [`supabase_labs.sql`](supabase_labs.sql).
It creates the tables below and is safe to re-run:

| Table | What's in it |
| --- | --- |
| `lab_panels` | One row per report / blood draw — date, lab, which file it came from |
| `lab_results` | One row per marker on a panel, with the value, unit, and the reference range **that report printed** |
| `lab_pathology` | One row per narrative report — biopsy, histology, or imaging. Prose, not markers |
| `medical_history` | Diagnoses, treatments, surgeries — the context a lab value can't carry |
| `lab_reports` | Written interpretations, one thread per body system |

Until this runs, the Labs tab shows a banner telling you to run it.

The reference range is stored per result rather than per marker on purpose.
Labs disagree with each other and change their ranges over time; a range
copied onto an old result would silently rewrite whether that result was ever
flagged.

## 2. Anthropic API key (reading reports)

**Add a report** takes a PDF or an image and returns the markers printed on
it. It uses the same `ANTHROPIC_API_KEY` the Food tab's voice entry and label
reader already use — if that's set, this works with no further setup.

Without it, the rest of the tab still works and you enter results by hand.

### What it reads

- **PDFs** go up as-is. Portal PDFs are crisp text, and a multi-page one with
  a CBC, a metabolic panel, and a lipid panel is read in a single pass.
- **Photos and screenshots** are downscaled on the device first, to a longer
  edge of 2200px — lab reports are dense small type, and the 1600px the
  nutrition-label reader uses turns a two-column result grid into mush.

Pick several files at once and you review them one at a time; the sheet shows
which file you're on.

### It reads, it doesn't interpret

The prompt is deliberately narrow: report the printed value, the printed unit,
and the printed range; don't convert units, don't compute anything the report
doesn't state, and don't fill in a reference range from memory. When a row's
alignment is genuinely ambiguous — lab reports are multi-column grids with
tall rows — it leaves that result out and says so rather than pairing a value
with the wrong range.

Nothing is saved until you press Save. Every extracted row lands in an
editable list with a tick box, so a misread is fixed (or dropped) before it
becomes history. That matters more here than anywhere else in the app: a wrong
calorie count skews an average, a wrong lab value is a number you might act
on.

### Which model, and what it costs

Runs on **Claude Sonnet 5** by default (`LAB_PARSE_MODEL`) rather than Haiku.
Set `LAB_PARSE_MODEL=claude-opus-5` in the Vercel environment variables and
redeploy if you want the ceiling — no code change.

Roughly **2–5¢ per report**, depending on length. It runs a handful of times a
year, so this is not the place to economise.

## How markers are matched

Labs name the same test differently, and change the wording between draws.
Quest prints `LDL-Cholesterol (calc)`, LabCorp prints `LDL Chol Calc (NIH)`, a
hospital prints `Cholesterol, LDL`. Charted as-is, one marker becomes three
flat lines of one point each.

So each result stores a canonical marker key **alongside** the name the lab
printed. Trends follow the key; the row still shows the wording on the report,
under the display name. The matcher is in
[`src/labMarkers.js`](src/labMarkers.js) — about 70 markers across lipids,
metabolic, thyroid, hormones, vitamins, blood count, liver, kidney, and
inflammation.

A test that matches nothing gets a slug of its own name rather than being
dropped: it still charts against its future selves, it just lands in "Other"
without a tidy display name. The review sheet tells you which rows those are
before you save.

## Reading the tab

- **By report** — each draw, collapsible, results grouped by category with
  out-of-range values in red. Tap any marker name for its trend.
- **By marker** — one row per marker with its latest value, the range the lab
  printed, a bar showing where inside that range the value sits — and how far
  past it when it's outside — and the move since the previous draw. Grouped by
  priority rather than category:
  **Needs attention** (unfavourably out of range now), **Previously flagged**
  (was out of range at some point, is not now), then **In range** — so the
  glance stops at the top. A favourable excursion (high HDL, high eGFR) is
  not "attention"; `isFavorable` decides. Search it when you want one number.
- **Pinned system cards** — under the summary tiles, one stat card per pinned
  system (Crohn's / IBD, Inflammation, Hormones, Vitamins, Metabolic). The
  first `headline` marker with data is the hero number — calprotectin, CRP,
  total testosterone, vitamin D, glucose — and the next couple ride beneath it
  as compact rows (B12 under vitamin D, free T under total). Tapping a card
  opens that system expanded. Each card draws a position bar rather than a
  trend line — at this size "where in the range am I" is the thing worth two
  seconds, and the full trend is one tap away. Which systems are pinned and
  what they lead with is data on the `SYSTEMS` entries (`pinned`, `headline`),
  not layout code.
- **By system** — the same markers regrouped by body system (Crohn's / IBD,
  Inflammation, Hormones, …) with each system's flagged count and its
  narrative studies. A marker appears in every system it informs. Inside a
  system, flagged markers sort to the top.
- **Studies** — biopsy, histology and imaging reports, newest first. Only
  appears when there is at least one.
- **Reports** — on each system's own screen: a written interpretation of that
  area, kept as a thread. See *Written reports* below.
- **Trend sheet** — every reading of one marker over time, with the reference
  range shaded behind the line. Out-of-range readings get a filled dot.

The shaded band is the range from your most recent report, since that's the
one that applies now; each row in the list below still shows the range its own
report printed. A one-sided range (`<100`) shades everything on the good side
of the line.

"Out of range" colouring follows the lab's own flag where the report printed
one, and is derived from the range where it didn't. A few markers know which
direction is the good one — high HDL and high eGFR are green, not red.

## Narrative reports — pathology and imaging

A biopsy report has no markers. It's a diagnosis, a description of what the
specimen looked like, and what the pathologist saw down the microscope — there
is no value, unit, or reference range to put on a trend line. Forcing one into
`lab_results` would mean inventing a marker for prose, and it would sit in the
marker list forever as a test that never has a number. An imaging report is the
same shape: a narrative with the conclusion at the top.

So they live in `lab_pathology` and share one view. The conclusion is rendered
first and set apart, because it's the line you opened the report to read; the
rest follows in labelled sections, and a section the report left empty is
omitted rather than shown as a blank row. `raw_text` keeps the report verbatim
whatever happens, so a heading the parser doesn't recognise costs formatting
rather than content.

The columns are shared, but a radiologist and a pathologist don't call them the
same things, so `kind` decides the labels:

| Column | `kind = 'pathology'` | `kind = 'imaging'` |
| --- | --- | --- |
| `diagnosis` | Diagnosis | Impression |
| `specimen` | Specimen | Exam |
| `gross_description` | Gross description | Technique |
| `microscopic_description` | Microscopic description | Findings |

The tab is hidden until there's something in it, and the rest of the Labs tab
works normally if `lab_pathology` hasn't been created yet — the fetch treats a
missing table as "nothing to show" rather than an error.

One thing to know when reading imaging from a portal: the PDF is sometimes only
the cover sheet, with no radiologist's report inside it at all. Those are stored
with whatever the provider's own note says and a comment saying so, rather than
filed as though the report were there.

## One system's own screen

Tapping a pinned card — or "Open …" on a system row — leaves the lists behind
for a screen about one area of the body. It leads with a plain verdict ("2
markers are outside range right now — …"), then a card per marker: the value,
a scale showing where inside the lab's range it sits, and the note.

No inline trend line on these cards. One was tried and pulled: squeezed into a
card's width a sparkline stretches its own slopes and puts the newest reading
half off the edge, so it draws a shape the readings never had. The scale
answers "where in the range am I", and **Full trend** on each card opens the
real chart with a real axis.

### The scale grows to hold the reading

Drawn only to the range, every out-of-range value pins to the same end of the
bar: a calprotectin of 51 and one of 160 looked identical, and how far past the
bound you are is the only thing that bar exists to say. So the axis stretches
to the reading — 0 to 160, not 0 to 50 — and the bound it ran past is marked
where it falls, because otherwise the colour change is unexplained.

The colours are the same three states the rest of the tab uses, so a bar can't
disagree with the badge above it: green in range, amber across the borderline
window (`borderlineFor`'s outer fifth), red outside. Drifting toward a bound is
gradual, so green and amber blend into each other — the closer you sit to the
cutoff, the warmer the bar already is. Crossing it is not gradual, so the red
starts hard at exactly the number the lab set. Direction is honoured: nearing
the good end of a higher-is-better marker isn't amber, and passing it isn't
red.

They are deliberately pale. Twenty of these run down a system's screen, and the
verdict is the number and the dot — the bar is context, not an alarm.

When a bound label lands on top of an axis label, the bound wins. An extended
axis ends at the reading, which is already in large type at the top of the
card; the bound is the number you can't get anywhere else.

`gaugeScale` in [`src/labMarkers.js`](src/labMarkers.js) returns the geometry
and the zone *levels*, not colours — the same bar is drawn on the chips, the
marker rows, and here, and it stays one idea rather than three.

The notes are the point. `MARKER_NOTES` in
[`src/labMarkers.js`](src/labMarkers.js) gives each marker a **what it is** and
a **what moves it**, in the language you'd want as the patient rather than as
the clinician — why B12 is the one that fails with ileal Crohn's, why ferritin
reads falsely reassuring during a flare, why an afternoon testosterone draw
isn't comparable to a morning one.

They are deliberately **general**. Nothing in them reads this person's values,
and nothing says what to do about a particular number: that depends on
symptoms, treatment and history, so it belongs in a conversation, not baked
into the app where it would look permanent and authoritative. The screen says
so at the bottom. A family of near-identical tests — the twelve organisms on a
stool pathogen panel — shares one note through `NOTE_PATTERNS` rather than
twelve copies. A marker with no note simply shows none; an absent explanation
beats a vague one.

## Amber: in range, near the edge

"In range" is a cliff, and a lab's range is a population rather than a target.
B12 at 269 against 200–1100 is inside the range and in the bottom 8% of it,
which is not the same news as 600. `borderlineFor` flags the outer fifth of
the band — but only the end that is actually the bad one. High HDL and high
eGFR are the good direction, so nearing that edge earns nothing; a marker with
no declared direction has a window, and both edges count.

That gives four states, and they order the lists: **out of range now** →
**near the edge** (amber) → **was flagged once** → **fine**. Borderline
outranks a historic flag deliberately — a number drifting toward the edge
today is more actionable than one that recovered years ago.

## Ranges the report didn't print

The rule everywhere else is that a range comes from the report that printed
it, and it still holds: a lab's own range always wins, and nothing here is
written to `lab_results`. But a handful of markers arrive bare, and the
alternative is a number the app can never call.

Calprotectin is why `APP_REFERENCES` exists. It is the most important marker
in this data and the portal prints it with no range at all, so 18.7 and 160
read as an unremarkable line, reached no flag, and counted toward no system's
badge. `effectiveRange` supplies a fallback **only** where the report gave
none, and every use of one is labelled on screen — an "app reference" chip on
the marker and a note saying plainly that the range isn't from the lab and
where it came from.

## Body systems

Categories answer "what kind of test is this"; systems answer "what part of my
body is this about" — which is the level the owner actually reasons at when
asking how a disease, a deficiency, or a therapy is going.

The map lives in `SYSTEMS` in [`src/labMarkers.js`](src/labMarkers.js) and is
deliberately many-to-many: ferritin is an iron store, an acute-phase reactant,
and an IBD-monitoring number all at once, and hiding any of those readings
would mislead. Each system lists exact marker keys, plus regex `patterns` so
families of slugs land correctly no matter what a lab calls them — any
`hepatitis_*` serology joins Screening, any `vitamin_*` joins Vitamins, and a
stool pathogen joins Crohn's / IBD (they're how infection gets excluded when
calprotectin moves). A system can also claim narrative studies: the colon
biopsy sits in the IBD card, imaging in Screening.

The IBD monitoring set has canonical markers of its own — `calprotectin`,
`elastase`, `infliximab_level`, `infliximab_ab` — because two labs already
print those four names six different ways, and a renamed slug would split the
single trend that matters most in this app.

## Two measurements, one name

Some panels print the same word twice for different things, and the marker
matcher takes the longest phrase contained in a name — so the shorter member of
a pair will swallow the longer one unless the longer one has an alias of its
own. A CBC prints `NEUTROPHILS` at 43.2 % and `ABSOLUTE NEUTROPHILS` at 2635
cells/µL. A metabolic panel prints `ALBUMIN` and `ALBUMIN/GLOBULIN RATIO`. An
iron panel prints `IRON, TOTAL` and `IRON BINDING CAPACITY`.

Collapsed onto one key, the two land on a single trend line at wildly different
scales, and the reference band — which comes from the most recent report —
makes every reading of the other kind look catastrophically out of range.
[`tests/labmarkers.spec.mjs`](tests/labmarkers.spec.mjs) pins each pair apart,
and pins the reverse case too: a lab renaming the same test between draws must
still land on one line.

Two details in the matcher exist only because of this:

- **`%` survives normalization as the token `pct`.** Stripped as punctuation,
  `PSA, % FREE` and `PSA, FREE` become the same word set — a percentage and a
  ng/mL concentration that nothing downstream could tell apart.
- **A name made only of noise words keeps its raw text as the key.** A
  urinalysis prints a row called just `Blood`, which normalizes to nothing;
  falling through to a single `unknown` would put `Blood`, `Protein` and `pH`
  on one line.

## Written reports

Every system's screen carries a **Reports** card above the markers, because
the written read is what you came for and the numbers are what it was written
from. The button writes a full interpretation of that system: every reading of
every marker in it, the narrative studies it claims, and your medical history.

Reports are a **thread**, not a pile of snapshots. Each one is stored whole, so
any of them can be read on its own years later — but a report written after new
blood work is handed the previous one and asked to say what changed. The card
knows which draws the last report saw (`covered_panel_ids`), so it can tell you
there are two new result sets to account for, or that there is nothing new and
writing another would give you a second opinion rather than an update. In that
case the button goes quiet — a green button pushing the action the line under
it argues against reads as a recommendation, and it isn't one.

### It interprets

This is the one endpoint in the app that is asked to reason rather than
transcribe, and that is deliberate: the owner asked for the reading, not a
restatement of numbers already on the screen. So a report says what it thinks
is going on, how confident it is, and what would change its mind.

Two things the prompt is strict about, because they're what would make a report
worse rather than merely more cautious:

- **Every claim is grounded in the brief.** A marker never drawn, a missing
  date, a blank treatment history — the report says what's missing and what it
  costs, instead of assuming a plausible value.
- **What the data shows and what's inferred from it stay apart.** Both belong
  in the report; confusing them does not.

Each report is stored with the model that wrote it and the date, and the screen
prints both underneath. That's provenance, not a hedge: this is generated prose
about someone's health that will be re-read months later, and which model wrote
it and when is part of reading it.

### The brief

Assembled on the client in [`src/labReport.js`](src/labReport.js) — the
endpoint is stateless, and the whole lab history is already in memory there.
Being a pure function is the point: `tests/labreport.spec.mjs` can check what a
report was actually shown, which matters more here than usual, because a wrong
brief produces a wrong report in confident sentences nobody re-derives.

The two rules from [`CLAUDE.md`](CLAUDE.md) both bite:

- **Blank is not zero.** A marker with no reading is left out rather than sent
  as 0. Text results are *not* blank, though — "Negative" on a stool pathogen
  panel is how infection got ruled out, and a brief built only from numbers
  would leave that out of the reasoning entirely.
- **A row keeps its own range.** Each reading carries the range its own report
  printed. A lab that widened its band in 2023 must not silently un-flag a 2019
  draw in the narrative, and a range the *app* supplies is labelled as such so
  it can't be cited as the lab's.

### Which model, and what it costs

Runs on **Claude Fable 5** (`LAB_REPORT_MODEL`) — the reasoning tier, several
times the price of the readers. This is the one place in the app where a wrong
answer is both durable and consequential: a report is stored, re-read, and the
next one is written on top of it. It runs a handful of times a year per system.

`LAB_REPORT_EFFORT` defaults to `medium`. Vercel stops the function at 60
seconds whatever the model is still doing, and Fable 5's turns get long at
higher effort — `medium` lands inside that window on a system of ~20 markers.
Set `LAB_REPORT_EFFORT=high` if your plan allows a longer `maxDuration` and
you'd rather have the ceiling; `low` if reports are timing out.

Two things to know about this model specifically: it requires 30-day data
retention (an org set to zero retention gets a 400 on every request), and its
safety classifiers can decline a request outright. A report about your own
bowel disease is not what those are for, but the request opts into the
server-side fallback anyway, so a false positive produces a report rather than
a feature that looks broken.

## Medical history

Reached from **History** in the tab header, or from the Reports card on any
system screen. Calprotectin at 160 means one thing on anti-TNF therapy and
another off it; a low B12 reads differently after an ileal resection. None of
that is in `lab_results`, so a report written from the numbers alone is written
blind — this is the difference between a report that reasons about your results
and one that only describes them.

Structured enough for a report to reason with (a condition is not a medication
is not a surgery) and loose enough to actually get written: dates are free text
because "2019", "childhood" and "3/2021" are all real answers, and everything
but the label is optional.

An entry that has ended keeps its dates and is marked past rather than deleted.
A drug you stopped two years ago is part of why this year looks the way it
does, and a report that doesn't know you were ever on it can't say so.

It isn't a fifth view toggle. History gets written rarely and is read by the
reports rather than by you, so it sits behind a button instead of taking a
permanent slot on a phone-width row.

## Backups

Backup & Restore on the Goal Settings tab covers the key/value blobs (weekly
log, goals, daily log, habits). The lab tables aren't in it, the same way the
food tables and the HealthKit/Withings `daily_metrics` table aren't — use a
Supabase backup for those.
