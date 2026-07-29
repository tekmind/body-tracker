# Labs tab — setup

Tracks blood work over time: import the PDFs your lab portal gives you (or a
photo of the printout), and every marker gets a trend line with the reference
range drawn behind it.

Two setup steps, and only the first is required.

## 1. Create the tables (required)

Open the Supabase SQL editor and run [`supabase_labs.sql`](supabase_labs.sql).
It creates two tables and is safe to re-run:

| Table | What's in it |
| --- | --- |
| `lab_panels` | One row per report / blood draw — date, lab, which file it came from |
| `lab_results` | One row per marker on a panel, with the value, unit, and the reference range **that report printed** |

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
- **By marker** — one row per marker with its latest value and the move since
  the previous draw. Search it when you want one number.
- **Trend sheet** — every reading of one marker over time, with the reference
  range shaded behind the line. Out-of-range readings get a filled dot.

The shaded band is the range from your most recent report, since that's the
one that applies now; each row in the list below still shows the range its own
report printed. A one-sided range (`<100`) shades everything on the good side
of the line.

"Out of range" colouring follows the lab's own flag where the report printed
one, and is derived from the range where it didn't. A few markers know which
direction is the good one — high HDL and high eGFR are green, not red.

## Backups

Backup & Restore on the Goal Settings tab covers the key/value blobs (weekly
log, goals, daily log, habits). The lab tables aren't in it, the same way the
food tables and the HealthKit/Withings `daily_metrics` table aren't — use a
Supabase backup for those.
