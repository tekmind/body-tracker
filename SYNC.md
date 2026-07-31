# Where the numbers come from

Everything on the Daily tab can be typed by hand, and three of the metrics can
also arrive on their own. This is the map of which is which.

| Number | Auto source | How it gets in |
| --- | --- | --- |
| Steps | Apple Health (iPhone, or **WHOOP** — see below) | iOS Shortcut → `daily_metrics.steps` |
| Calories burned | Apple Health | same Shortcut → `daily_metrics.cal` |
| Weight / fat mass / muscle mass | Withings scale | `api/withings-sync.js` → `daily_metrics` |
| Calories eaten | The Food tab | written into the daily log directly |

All of it lands in one table, `daily_metrics`, keyed by the app's `M/D/YY`
date string. See [`supabase_daily_metrics.sql`](supabase_daily_metrics.sql).

**A day you've logged by hand is never overwritten.** The merge rule is that
manual entries win outright: a synced day only appears if that date isn't
already in the daily log. So if you type a step count for a date, the Health
number for that date stops showing — it's still in the table, just not what
you see.

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
