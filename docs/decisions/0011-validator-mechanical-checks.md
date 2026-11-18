# 0011: Let the validator do the checks a reviewer does by rote

## Context

Reviewers spend model time on things a script can see. In a sample of 42 verdicts, 31 carried
the model name from the schema example instead of the model that wrote them. Findings about weak
tests hold steady at about 30 a month, and acceptance fails often come down to missing evidence:
a report says the test went red first but never says what was changed to make it red. Plans also
keep producing items that list far more files than the packet bar allows, or three items queued
on the same file, which D13 already says should be one slice.

## Decision

`brigade-validate` gains five checks. Four are warnings, which never change the exit code; one is
a problem, which does.

- A plan item listing more than 4 files warns
  `item <slug> lists <n> files; the packet bar is 1-3 plus its own test (D13)`.
- A file listed by 3 or more items that are not done warns
  `<file> is listed by <n> items (<slugs>); make them one slice or split the file (D13)`.
- On a report, verdict, plan check, brief or analyst report, `model: haiku` with any role other
  than `cook`, or the literal `<model>`, warns
  `model "<value>" looks like the schema placeholder; write the model that produced this file`.
- A report whose `## Evidence` says `red` as a word or anything starting `falsif` (any case), and
  has no line starting `mutation:`, warns `report claims a red run but names no mutation: line`.
  A `mutation:` line inside a fenced block counts, and a `## ` line inside a fence does not end
  the section.
- A verdict that repeats a finding id fails with `duplicate finding id: <id>`.

Plan items are read through the shared plan parser, so inline and block-style items are counted
the same way.

## Use cases

- A planner writes an item with nine files. The validator warns before any cook is dispatched,
  and the planner splits it or explains why it can't be split.
- Three open items all edit one workflow file. The warning names the file and the three items, so
  the planner can fold them into one slice.
- An inspector copies the schema example and leaves `model: haiku`. The warning tells it to write
  its real model, which keeps fleet stats honest.
- A cook writes "red before the fix" with no `mutation:` line. The warning asks it to name what it
  broke, so the inspector can repeat the red run instead of taking it on trust.
- A verdict lists `F1` twice. The validator fails it, since dispositions and rework both key on
  finding ids and a duplicate makes one of them unreachable.

## Alternatives rejected

- Keep these in the reviewer prompts. That is what happens today, and the numbers above show
  reviewers miss them or spend tokens finding them.
- Make the file cap and chain checks problems. Some plans have a good reason for a wide item, and
  older plans would start failing; a warning surfaces the issue without blocking work.
- Warn on `model: haiku` everywhere. Haiku is a real cook model, so a cook report that says it is
  usually telling the truth.
- Look for `mutation:` anywhere in the report. The claim is made in Evidence, so the proof belongs
  there too.

## Consequences

- Existing dishes see new warnings on old plans and briefs but no new failures, except a verdict
  that already repeats a finding id.
- The schema text and agent prompts do not mention `mutation:` lines yet; a later change can teach
  cooks to write them. Until then the warning is the only prompt.
- The red-run check works on words, so a report can avoid it by phrasing. It is a nudge, not a
  proof that a mutation was made.
