# 0009: Let a cook report say its work is staged but not committed

## Context

About 30% of blocked cook reports come from one cause: a policy refusal stops the cook's
`git commit`. The work itself is finished and passes its checks, but the cook has no way to say
"done, just not committed", so it reports BLOCKED and the item goes round again for nothing. The
next items let a cook report staged work as done and have the pipeline commit it. They need a
shared report key to carry that fact.

## Decision

A cook report may carry `committed: false` in its frontmatter. It means a policy refusal blocked
`git commit` and the packet's files are staged on the item branch; `## Evidence` quotes the
refusal, and the steward commits the files before landing. The key is optional and leaving it
out means true. `brigade-validate` accepts only `true` or `false` (quoted or bare) and fails any
other value with `invalid report committed: <value>`. A done report with `committed: false` must
have the word `refus` (any case) in `## Evidence`, otherwise it fails with
`committed: false needs the refusal quoted in ## Evidence`. The schema text lives in
`skills/brigade/SCHEMAS.md`.

## Use cases

- A normal cook run commits its work and writes no `committed` key, or `committed: true`; the
  report validates exactly as before.
- A cook's commit is refused by policy: it leaves the files staged, sets `committed: false`,
  pastes the refusal into `## Evidence`, and reports done. The steward sees the key and commits
  the staged files before landing.
- A cook sets `committed: false` but forgets to quote the refusal: the validator catches it, so
  nobody lands staged work on an unsupported claim.

## Alternatives rejected

- Keep reporting BLOCKED on a refused commit. That is what happens today, and it throws away
  finished work and spends another attempt on it.
- Put the fact in the report body only. The pipeline would have to parse prose to decide whether
  to commit; a frontmatter key is something a script can read reliably.
- Accept any truthy or falsy word (`no`, `yes`, `0`). Loose values invite typos that silently
  mean the wrong thing; two values are easy to check.

## Consequences

- The cook prompts and the workflow learn to write and act on the key in later items; this change
  only defines it and makes the validator check it.
- Reports written before this change have no `committed` key and validate unchanged.
- The validator cannot prove the files are actually staged; it only makes sure the refusal is
  quoted, so the steward still checks the branch before committing.
