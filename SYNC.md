# Where the numbers come from

Everything on the Daily tab can be typed by hand, and three of the metrics can
also arrive on their own. This is the map of which is which.

| Number | Auto source | How it gets in |
| --- | --- | --- |
| Steps | Apple Health (iPhone, or **WHOOP** — see below) | iOS Shortcut → `daily_metrics.steps` |
| Weight / fat mass | Withings scale → Apple Health | second iOS Shortcut → `daily_metrics` (see below) |
| Lean mass | Nowhere — **inferred**: weight − fat mass | computed in the app; nothing syncs it |
| Calories eaten | The Food tab | written into the daily log directly |

**Lean, not muscle.** The app tracks lean mass (weight minus fat mass), not
Withings' muscle-mass figure — that number never leaves the Withings app, and
lean needs nothing beyond the two values the scale already provides. The
weekly log's whole history was migrated to the same rule
([`supabase_migrate_lean.sql`](supabase_migrate_lean.sql)), so the series is
consistent back to the start; it reads ~6 lb above the old muscle series
(that's bone), with the trends unchanged. `daily_metrics.muscle_mass` and the
daily log's `muscleMass` still exist for old rows; nothing writes them now,
and the weekly pull infers lean whenever a day has weight and fat mass but no
stored value.

All the synced values land in one table, `daily_metrics`, keyed by the app's
`M/D/YY` date string. See
[`supabase_daily_metrics.sql`](supabase_daily_metrics.sql).

**Calories are no longer synced.** The Shortcut used to send Apple Health's
burned-calorie figure as well, but calories now come from the Food tab, so the
Shortcut sends steps only. The `cal` column still exists and old rows keep
their values — nothing reads them for a day the Food tab has covered.

So **a `cal` value appearing on a new row means something else is still
posting one.** Nothing in the browser app writes this table — it only reads
and deletes — and the scale Shortcut writes weight and fat mass only. A stray
`cal` can only have come from a shortcut or automation, so it's worth hunting
down at the source.

**On today, a phantom zero is harmless.** Pacing counts only days *strictly
before* today and always treats today as a day still to plan for, precisely so
a sync that fires before you've eaten can't be read as "today's already
accounted for" (`pacing` in `src/Dashboard.jsx`). The weekly stat-card
averages skip today for the same reason. Logging food overwrites it anyway.

**On a past day it does count**, because past days feed the calories-logged
total that pacing divides up. To clear one, delete that day in the app's Daily
Log — synced rows delete the `daily_metrics` row itself rather than a log
entry.

**What you log by hand always wins — field by field.** A synced value only
fills in a blank you haven't logged, so a day with your own step count keeps
it, and a day where the Food tab has written calories still shows its synced
steps. (The `synced` badge that used to mark those rows is gone — once the
Food tab started filling days in, nearly every row carried one and it stopped
distinguishing anything.)

This used to work per whole row, which had a nasty edge: logging food creates
a calories-only daily-log row, that row hid the synced row for the date, and
the day's steps vanished with it — from the table, the weekly step average and
the streaks alike. Fixed; `mergedDailyEntries` in `src/Dashboard.jsx` is the
merge.

## The weekly log fills itself from the daily one

Adding a week used to mean copying five numbers across by hand. Now the date
is the only thing you type: everything else is read off the Daily log.

| Field | Where it comes from |
| --- | --- |
| Weight, lean, fat mass | The daily entry **on that exact date** (lean inferred if not stored) |
| Calories, steps | The **average of the seven days before it** |

The split is deliberate. Body composition is a reading — it belongs to the
morning it was taken. Calories and steps are behaviours, so what matters is
the week that *produced* that reading, which is the seven days leading up to
it and not the day itself.

Days with nothing logged are skipped rather than counted as zero, so a missed
day doesn't drag the average down — the same rule the stat cards and pacing
follow. The form says which window it used and how many days had data, so an
average built from three days isn't mistaken for one built from seven.

Everything stays editable, and typing over a filled number sticks; the fields
only refill when the date changes, or when you press **Pull again**.

## The Shortcut

It runs on the phone and writes one row per day into `daily_metrics` through
Supabase's REST API. The contract is small:

```http
POST {VITE_SUPABASE_URL}/rest/v1/daily_metrics
apikey: {VITE_SUPABASE_ANON_KEY}
Authorization: Bearer {VITE_SUPABASE_ANON_KEY}
Content-Type: application/json
Prefer: resolution=merge-duplicates

{ "date": "7/31/26", "steps": 12345, "source": "healthkit" }
```

- **`date` must be `M/D/YY` with no leading zeros** — that's the app's format
  and the table's primary key. (The merge is forgiving about spelling now, but
  the key isn't: `07/31/26` and `7/31/26` would be two rows in the table.)
- `Prefer: resolution=merge-duplicates` makes it an upsert, so re-running it
  the same day updates that day rather than failing on the primary key.
- Only the keys you send get written. Leaving `cal` out doesn't erase a `cal`
  already on the row.

### Why it's shaped the way it is

The odd-looking part is the date, and it's deliberate. **WHOOP posts one bulk
step sample per day, at an inconsistent hour** — some days in the evening,
some days the following morning. So the day a sample *belongs to* can't be
read off the clock, and "log yesterday's steps" would be wrong half the time.

The shortcut works backwards from the sample instead:

1. Find step samples from the last 3 days, source WHOOP, latest first,
   **limit 1** — there's only one drop per day, so the latest one is the drop.
2. Sum it (a sum of one sample, which is the day's total).
3. Take its **end date**, subtract **4 hours**, and format that as `M/d/yy`.

The 4 hours is what pulls a drop that landed after midnight back onto the day
it actually describes. Both Format Date actions in the shortcut are set to
Custom / `M/d/yy` — the primary key needs that exact spelling.

Don't "simplify" this to today-or-yesterday arithmetic. It looks redundant
and isn't.

One consequence worth knowing: because it takes a single sample per run, each
run writes exactly one day. If two drops ever land between runs, the older one
is skipped and won't be picked up afterwards — the next run still takes only
the latest. That shows up as a missing day, never a wrong number.

### When it stops posting

**"The network connection was lost" almost certainly isn't the network.** iOS
reports `NSURLErrorNetworkConnectionLost` (-1005) when the connection drops
before the server answers, which includes requests iOS itself refused to send.
A rejected key, a bad row or a schema mismatch all come back as an HTTP status
with a message instead — so this error means the request never landed.

Check these in order; the first two take seconds:

1. **An empty header row.** A blank Key/Text pair left in the headers list
   makes iOS build a malformed request and abandon it. This has bitten once
   already and looks exactly like an outage. Delete the blank row.
2. **Is the project reachable at all?** Open
   `https://<project>.supabase.co/rest/v1/` in Safari on the phone. Getting
   `{"message":"No API key found in request"}` back is the *good* outcome — it
   proves DNS, TLS and routing are fine and the project isn't paused. (Free
   Supabase projects pause after about a week idle, and a paused one drops
   connections rather than answering, which also surfaces as -1005.)
3. **Is it Shortcuts or this request?** A throwaway shortcut of *Get contents
   of* that same URL → *Quick Look* should show the same JSON. If it does,
   Shortcuts' networking is fine and the fault is in this request — bisect it
   by dropping the `Prefer` header, then the body down to `date` alone. If the
   bare GET fails too, it's phone-level: iCloud Private Relay, a VPN or DNS
   profile, or Low Data Mode.

### Making it steps-only

Delete the health action that reads Active Energy (calories) and its variable,
and remove the `"cal"` key from the JSON body. Nothing else changes — not the
URL, not the headers, not the date handling. The app has no opinion about
which keys arrive.

The anon key in the Shortcut is the same public key the browser bundle ships,
so it's no more exposed there than it already is. What guards the table is its
RLS policy, not the key.

## Body composition from the scale

A second Shortcut, beside the steps one. Health Mate writes each weigh-in to
Apple Health; this reads it back out and posts weight and fat mass. Lean is
not sent — the app infers it.

Before building it, check **Health → Sharing → Apps → Health Mate** allows
writing Weight and Body Fat Percentage.

1. **Find Health Samples** → Weight, last 3 days, sorted by End Date, latest
   first, **limit 1**.
2. **Find Health Samples** → Body Fat Percentage, same settings.
3. Fat mass = weight × body fat. **Check the scale of the percentage first**:
   run a throwaway shortcut of *Find Health Samples → Body Fat Percentage →
   Quick Look*. Health returns a percentage (`18.44…`, not `0.1844`), so
   divide by 100 after multiplying. Confirm it rather than assuming — getting
   this wrong is a 100× error, which is why it's step 3 and not a footnote.
4. **Round both numbers to 1 decimal.** Health hands back raw floats —
   `18.44000053405762` for a body fat reading, `152.40000152587891` for a
   weight — and posting those unrounded puts a fifteen-digit number in the
   table and in every average built from it. Round Number → tenths, on the
   weight as well as the computed fat mass.
5. Date = the **weight sample's date**, Format Date → Custom → `M/d/yy` — no
   leading zeros, same as the steps shortcut. Do **not** copy the steps
   shortcut's minus-4-hours trick: that compensates for WHOOP's late bulk
   drop, and a weigh-in is timestamped at the moment you stand on the scale.
6. **Get Contents of URL** → POST, same URL and all four headers as the steps
   shortcut (including `Prefer: resolution=merge-duplicates`), body:

   ```json
   { "date": "8/8/26", "weight": 152.4, "fat_mass": 27.6, "source": "healthkit" }
   ```

Only the keys sent get written, so this merges onto the same day's row as the
steps shortcut without touching `steps` or `cal`. Automate it to run on a
morning schedule, after your usual weigh-in time.

**Name it `Scale Sync`, exactly.** The Daily Log's **Sync scale** button is a
`shortcuts://run-shortcut?name=Scale%20Sync` link, so renaming the shortcut
breaks the button until `SCALE_SHORTCUT_NAME` in `src/Dashboard.jsx` changes
to match. iOS won't let a web page run a Shortcut in the background — the
x-callback "come back when you're done" scheme is Shortcuts-to-Shortcuts
only — so the button hands off and you swipe back; returning to the app
re-reads `daily_metrics` on its own. The button only renders on a touch
device, since the link goes nowhere on a laptop.

## Steps from WHOOP

**WHOOP's API can't do this — Apple Health can.** WHOOP has counted steps in
the app since late 2024, but never exposed them through the developer
platform. The API's daily `cycle` carries `{strain, kilojoule,
average_heart_rate, max_heart_rate}` and that's the lot; there's no step field
on any endpoint, in v1 or v2. So there is nothing to build server-side, and
you shouldn't go looking for a WHOOP steps endpoint again — it isn't there.

What WHOOP does do is **write its step count into Apple Health**, which this
app already reads. That makes the chain:

```
WHOOP strap → WHOOP app → Apple Health → the Shortcut → daily_metrics.steps
```

Two toggles on the phone, no code:

1. **WHOOP app → More/Settings → Integrations → Apple Health.** Turn it on and
   allow steps.
2. **Health app → Steps → Data Sources & Access → drag WHOOP above iPhone.**

Step 2 is the one that actually matters. Apple Health de-duplicates steps
across sources by priority, so with the iPhone still on top you'd keep seeing
the phone's count — the WHOOP data would be sitting in Health, ignored. The
phone and the strap disagree by a fair margin on days the phone stays on a
desk, so it's worth getting the order right rather than assuming the numbers
are close enough to not matter.

Nothing in the app changes: the Shortcut asks Health for a step total and
Health answers with whichever source ranks highest. The app can't tell the
difference, and doesn't need to.

### If WHOOP ever adds steps to the API

Then it's worth revisiting, because a server-side pull doesn't depend on the
phone having run the Shortcut. It would look exactly like the Withings
integration below — same shape, same table.

## Withings

The pattern to copy for any future OAuth source:

| File | Job |
| --- | --- |
| `api/_withings.js` | Shared config, the Supabase admin client, unit and date helpers |
| `api/withings-auth.js` | Redirects to the provider's consent screen |
| `api/withings-callback.js` | Exchanges the code for tokens, stores them in `withings_tokens` |
| `api/withings-sync.js` | Refreshes, fetches the last 3 days, upserts into `daily_metrics` |

Env vars: `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`,
`WITHINGS_REDIRECT_URI` — server-side only, never `VITE_`-prefixed, or they'd
be published into the browser bundle. Connect it once by visiting
`/api/withings-auth`; tokens live in `withings_tokens`
([`supabase_withings_tokens.sql`](supabase_withings_tokens.sql)).

Two details worth knowing if you build another one of these:

- **Withings refresh tokens are single-use**, so the sync rotates the stored
  token on every run rather than tracking access-token expiry.
- The sync **only touches the three body-composition columns** on a row that
  already exists, so a day the Shortcut has already filled in keeps its
  `cal`, `steps` and `source`.

## Backups

Two layers, because they fail differently:

- **Nightly server snapshot.** `vercel.json` runs `/api/backup` every morning
  (11:00 UTC). It copies every `kv_store` blob (parsed) and every table —
  food log, labs, `daily_metrics` — into a `backups` table
  ([`supabase_backups.sql`](supabase_backups.sql)), one row per day, 30 kept.
  "Back up now" on Goal Settings hits the same endpoint on demand, and
  `/api/backup?download=1` returns the whole snapshot as a file. This layer
  protects against the app writing something wrong — which has happened; a
  bad write once replaced the entire daily log — but not against losing the
  Supabase project itself, since the copies live inside it.
- **Export / Import on Goal Settings.** The in-app JSON blob: weekly log,
  goals, daily log, habits, alert settings. Download one occasionally and
  keep it somewhere that isn't Supabase — that's the offsite copy.

Restore shapes for the snapshot rows are written out in
`supabase_backups.sql`. Adding this cron replaced the daily Withings-sync one
in `vercel.json`: that API integration was never configured (registration
stalled at Withings' end), and the plan of record for scale data is Apple
Health plus a second Shortcut — weight and fat mass in, lean mass inferred.
The `api/withings-*.js` files stay as the pattern for any future OAuth
source.
