---
description: Review a branch, PR, or commit range along the configured dimensions (advisory, tier-scaled)
argument-hint: <branch|range|PR> [--tier <star>]
---

Arguments: $ARGUMENTS

Resolve the input ref: the first non-flag argument, else ask. Resolve the tier: an
explicit `--tier <star>` flag wins; otherwise `brigade-config resolve --json`'s
`.config.tier`. Resolve `mainLine`: that same call's `.config.mainBranch`; if unset, fall
back to `git symbolic-ref --short refs/remotes/origin/HEAD` (strip the `origin/` prefix),
then to `main` if even that fails.

Infer the input kind from the ref: contains `..` → `range`; a bare number, `#<number>`, or
a URL ending in a PR/issue number → `pr`; anything else → `branch`. Derive `reviewSlug` by
lowercasing the ref and collapsing every run of characters outside `[a-z0-9]` to a single
`-`, trimmed of leading/trailing `-` (`feature/Foo_Bar` → `feature-foo-bar`, `123` → `123`,
`main..feature/x` → `main-feature-x`).

Build args (may be passed as a JSON string): `{ repoRoot, now, tier, mainLine, reviewSlug,
input: { kind, ref }, boardConfigured, overrides, promptOverrides }` — `overrides` is the
`config` object from `brigade-config resolve --json` (passing the whole resolve output also
works — the script unwraps `.config`), `promptOverrides` is `brigade-config prompts --json`.
`boardConfigured` is true when `.brigade/config.md`'s `## Source` section has a
`database_id` set (a ticket board this review's context probe and board-mirror comment can
use), false otherwise.

Invoke the Workflow tool with `scriptPath` resolved the same way as every other brigade
workflow: prefer `$CLAUDE_PLUGIN_ROOT/workflows/brigade-review.js` when that env is set,
else fall back to skill-base resolution, `<skill-base>/../../workflows/brigade-review.js`.

On return: if `error` is set, the Resolve phase failed before anything else ran — report it
verbatim and stop. Otherwise present, in order: finding counts by severity (`counts`), the
context tier (bare/documented/tracked) and its disclosure line from the written report's
`## Context disclosure` section, the top 3-5 findings by severity, and the report path
(`reportPath`, under `.brigade/reviews/<reviewSlug>/report.md`). Close by reminding the
user these findings are **advisory only** — no PASS/FAIL gate — and are packet-shaped
(files, fix direction, verify hint) so any of them can be dispatched later as a cook packet
through `brigade-execute`, unchanged.
