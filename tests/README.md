# Tests

```
npm test              # everything, ~3.5 minutes
npm test goals cells  # only specs whose name starts with these
```

The runner starts a dev server if one isn't already listening on 5199, and
reuses yours if it is.

## What these are

Plain scripts. Each one drives a real browser with Playwright, prints
`PASS`/`FAIL` lines, and exits non-zero if anything failed. There's no
framework to learn — open any spec and read it top to bottom.

Every network call is mocked in the spec itself or via `seed.mjs`, so nothing
touches the live Supabase project and no API keys are needed. The dev server
gets placeholder `VITE_SUPABASE_*` values because Vite won't boot without
them.

## Writing one

Assert what a person would notice: what a number reads, what colour a tile is,
whether one tap logs the right amount, whether the page scrolls sideways on a
phone. Checking that a function was called proves nothing about an app whose
whole job is showing correct numbers.

Several genuine bugs came out of tests written this way — a weekly average
dividing by 7 instead of 6, a food's portion silently logging as whole
servings, steps vanishing from any day with food logged. In each case the code
read as obviously correct.

Two conventions worth keeping:

- **Call `blockWebfonts(page)` on every page you open** if you're not using
  `mock()`, which does it for you. Google Fonts is unreachable from this
  container and `waitUntil: "networkidle"` otherwise waits out the full
  timeout — about 14s per page load against 2.4s.
- **Guard against console errors and page errors**, pushing them into the same
  failure list as your assertions. That's how the `attribution.map` crash was
  caught; nothing was asserting about it.

## Files

| | |
| --- | --- |
| `run.mjs` | The runner: starts the server, runs each spec, summarises |
| `seed.mjs` | Shared fixtures, the Supabase mock, `blockWebfonts`, browser launch options |
| `*.spec.mjs` | One per area — `goals`, `cells`, `quickadd`, `labs`, and so on |

`PW_CHROMIUM` overrides the browser binary; without it, the prebuilt Chromium
in this container is used when present and Playwright's own resolution
otherwise.
