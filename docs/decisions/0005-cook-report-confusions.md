# 0005: Let cook reports list what read two ways in the packet

## Context

The retro analyst judges packet quality after the fact, from rework counts, review findings
and diffs. That is guesswork: a packet can pass review on the first try even though the cook
had to pick between two readings of a step, and the analyst never learns the step was unclear.
The cook is the only one who knows that first-hand, at the moment it happens, and today the
report has no place to say so.

## Decision

A cook report may end with an optional `## Confusions` section: one line per part of the
packet that read two ways, naming the part and what the cook assumed. The section is left out
when nothing was unclear. `brigade-validate` caps it at 8 non-empty lines and fails a longer one
with `report "## Confusions" has <n> non-empty lines; budget is 8`. The schema text lives in
`skills/brigade/SCHEMAS.md` and, word for word, in the `report` template in `workflows/config.js`.

## Use cases

- A clear packet: the cook writes no `## Confusions` section, and the report validates exactly
  as it did before.
- An ambiguous packet: the cook writes one line per ambiguity, for example "Step 3, 'the
  helper': assumed `sectionLines`, not a new function". The analyst reads those lines as direct
  evidence of which packet parts need sharper wording.

## Alternatives rejected

- A required section. Cooks would fill it with "none" or invented doubts to satisfy the check,
  and the real signal would drown in filler.
- A frontmatter list. A YAML list item is too terse to name both the unclear part and the
  assumption the cook made, and long strings in frontmatter are awkward to write and read.

## Consequences

- The cook, heavy cook and analyst prompts are taught to write and read the section in later
  items; this change only defines it and makes the validator cap it.
- Reports written before this change have no `## Confusions` section and validate unchanged.
