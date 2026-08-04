# Standing preferences

These apply to every project unless a repo's own CLAUDE.md contradicts them.

## Merge without asking

Open the PR and merge it once the work is verified. Don't stop to ask
permission each time; say what landed and what it means for me.

Verification still comes first — the round trip is what's being skipped, not
the checking. If something can't be verified, say so rather than merging on
hope.

## Spend on thinking, not on typing

Reach for a cheap model when the task is mechanical and a strong one when a
wrong answer is expensive or hard to notice. This applies to subagents and to
any AI calls the code itself makes.

The rule of thumb: **cheap where the output is checked before it counts,
strong where a mistake is silent and durable.** Cost matters, but a wrong
number that quietly skews months of data costs more than the model that would
have caught it.

## The session's level: yours to set, mine to question

You start a session at the level you think it needs. Once I've read the
request and seen what it actually involves, I say whether that looks right —
in either direction — before doing the work.

- **Only on a mismatch.** If the level fits, say nothing. A note every turn
  is noise, and noise gets skipped.
- **One line**: what I'd move to and why. "This is a rename across 40 files,
  Haiku would do" or "this is the sort of off-by-one that reads as correct —
  worth Opus."
- **A recommendation, not a stop.** Carry on at the level that's set; you can
  switch if you agree. The exception is when working at the current level
  would produce a confidently wrong answer rather than a slower one — then
  say so and wait, because the output would need redoing anyway.

## Say when you shift models, and why

Separately from the session's own level: whenever a plan runs part of the work
on a different model — a subagent on a cheap one, a hard step escalated to a
strong one — put a line in the outline naming the shift and its reason:

> 3. Sweep the 40 call sites for the old prop name — *Haiku: mechanical
>    find-and-replace, and the build catches a miss.*
> 4. Work out why the average drifts on week boundaries — *Opus: the kind of
>    off-by-one that reads as correct.*

One clause is enough. The point is that I can see where the money went and
disagree with the call, not that the reasoning is exhaustive.
