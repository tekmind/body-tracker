# Where the numbers come from

Everything on the Daily tab can be typed by hand, and three of the metrics can
also arrive on their own. This is the map of which is which.

| Number | Auto source | How it gets in |
| --- | --- | --- |
| Steps | Apple Health (iPhone, or **WHOOP** — see below) | iOS Shortcut → `daily_metrics.steps` |
| Weight / fat mass / muscle mass | Withings scale | `api/withings-sync.js` → `daily_metrics` |
| Calories eaten | The Food tab | written into the daily log directly |

All the synced values land in one table, `daily_metrics`, keyed by the app's
`M/D/YY` date string. See
[`supabase_daily_metrics.sql`](supabase_daily_metrics.sql).

**Calories are no longer synced.** The Shortcut used to send Apple Health's
burned-calorie figure as well, but calories now come from the Food tab, so the
Shortcut sends steps only. The `cal` column still exists and old rows keep
their values — nothing reads them for a day the Food tab has covered.

**What you log by hand always wins — field by field.** A synced value only
fills in a blank you haven't logged, so a day with your own step count keeps
it, and a day where the Food tab has written calories still shows its synced
steps. Rows carrying anything borrowed from Health are marked `synced` in the
Daily Log table.

This used to work per whole row, which had a nasty edge: logging food creates
a calories-only daily-log row, that row hid the synced row for the date, and
the day's steps vanished with it — from the table, the weekly step average and
the streaks alike. Fixed; `mergedDailyEntries` in `src/Dashboard.jsx` is the
merge.

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

**To cut it down to steps only:** delete the health action that reads Active
Energy (calories) and its variable, and remove the `"cal"` key from the JSON
body. Nothing else needs to change — not the URL, not the headers, not the
date handling. The app has no opinion about which keys arrive.

The anon key in the Shortcut is the same public key the browser bundle ships,
so it's no more exposed there than it already is. What guards the table is its
RLS policy, not the key.

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

Backup & Restore on the Goal Settings tab covers the key/value blobs — weekly
log, goals, daily log, habits. It does **not** cover `daily_metrics` or the
food and lab tables. Use a Supabase backup for those.
