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

## Say when you shift models, and why

Whenever a plan runs part of the work on a different model — a subagent on a
cheap one, a hard step escalated to a strong one — put a line in the outline
naming the shift and its reason:

> 3. Sweep the 40 call sites for the old prop name — *Haiku: mechanical
>    find-and-replace, and the build catches a miss.*
> 4. Work out why the average drifts on week boundaries — *Opus: the kind of
>    off-by-one that reads as correct.*

One clause is enough. The point is that I can see where the money went and
disagree with the call, not that the reasoning is exhaustive.
