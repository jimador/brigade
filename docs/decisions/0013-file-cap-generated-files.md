# 0013: Leave landed items and generated files out of the file-cap warnings

## Context

`brigade-validate` warns when a plan item lists more than 4 files (W1) and when 3 or more open
items list the same file (W2), both under rule D13. In practice the warnings were mostly noise.
Every item that touches a workflow lists the three bundled `workflows/brigade-*.js` files, which
`scripts/brigade-bundle` rewrites and nobody edits by hand, so each of those items tripped W1 and
the bundles formed a W2 chain. W1 also fired on items already marked `done`, where nobody can
split anything any more.

## Decision

- W1 skips items whose status is `done`. W2 already did.
- W1 and W2 leave out files that git marks generated: any path whose `linguist-generated`
  attribute is `set` or `true`. The validator asks git once per plan, with
  `git check-attr -z linguist-generated -- <paths>` run from the plan's repo, and the W1 count
  and message use only the files that are left. The message text itself does not change.
- When git is missing, the plan sits outside a work tree, or the lookup fails for any other
  reason, nothing counts as generated. The warnings then behave as they did before, and the
  lookup never fails the validator.
- The repo's new `.gitattributes` marks `workflows/brigade-*.js linguist-generated=true`, and
  nothing else.

## Use cases

- An item edits `workflows/src/execute.js` and its test and lists the three bundles. It counts
  as two files and does not warn.
- A plan has five workflow items. The bundles no longer show up as a W2 chain, but a source file
  three of them share still does.
- A landed item with six files stays quiet on every later validation of the plan.
- Someone validates a plan copied into a scratch folder with no git. The warnings come out
  exactly as they did before this change.

## Alternatives rejected

- A hard-coded list of generated paths in the validator. It would only know this repo's
  bundles; the git attribute lets any repo using brigade say what is generated, and GitHub
  already reads it to fold those files out of diffs.
- Skipping files by pattern, such as anything under `dist/` or ending in `.min.js`. Guessing
  from names misses real generated files and hides hand-written ones.
- Dropping W1 for done items but leaving generated files in. That removes only half the noise:
  every open workflow item would still warn.

## Consequences

- The warnings that remain point at items someone can still split.
- An extra `git` process runs once per plan validation. It is cheap, and its failure is ignored.
- A file is only left out if `.gitattributes` says so. A repo that generates files without
  marking them gets the old warnings until it adds the attribute.
- If any listed path makes `git check-attr` fail as a whole, for example a path outside the
  repo, nothing in that plan counts as generated for that run.
