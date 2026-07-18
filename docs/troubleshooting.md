# Troubleshooting

Start here, always — these cost nothing and answer most questions:

```bash
brigade-status          # where the dish actually stands
brigade-config doctor   # is any config layer broken?
brigade-validate        # do the artifacts conform?
git worktree list       # what is actually checked out
```

## The session ignores brigade entirely

Check the plugin is installed and enabled: `claude plugin list`. If you installed from a
directory marketplace, remember that installs are **cached copies** — after editing the
plugin source you must bump `version` in `.claude-plugin/plugin.json` and run
`claude plugin update brigade@brigade`, or sessions keep running the old copy.

The SessionStart hook is silent in repos with no `.brigade/` directory. That is by design;
run `set up brigade` to initialize the repo.

## A config change had no effect

```bash
brigade-config get <the.key>
```

It prints the value **and the layer that set it**. A later layer is probably overriding
you — repo-local beats team beats global beats defaults. `brigade-config layers` shows
which files exist at all; a typo in a filename means the layer is simply absent, not
broken.

If the file exists but does nothing, run `brigade-config doctor`. Unparseable JSON and
unknown top-level keys are both reported with the file path.

## A prompt override is not being applied

```bash
brigade-config prompts        # is it in the stack at all?
brigade-config prompt cook    # what text actually resolves
```

Common causes: the filename does not match a role name (`cook`, `cookHeavy`, `inspector`,
`scout`, `analyst`, `design`, `steward`, `planner`), the file is missing its `.md`
extension, or it is in `agents/`/`prompts/` under the wrong layer directory.

Overrides are resolved **once** at dish start. Editing an override file mid-run does not
change agents already in flight.

## An item is blocked

`blockedReason` names the cause. Brigade never guesses a missing value, so most blocks are
a question waiting for you: the exact value needed, the options, and a recommendation.
Answer it and re-run execute.

Other causes:

- **steward-create failed** — usually a worktree or branch left over from an earlier run.
  `git worktree list`, then remove the stale one.
- **escalation ladder exhausted** — every rung ran and none passed inspection. The Planner
  fixes this one itself, announced, with a minimal diff, re-inspected before landing.
- **circuit breaker already tripped** — the item never got a cook. Handled by the
  stopped-early path below, not individually.

## The run stopped early

The circuit breaker tripped: repeated inspector FAILs across items, or items exhausting
their ladders. Treat it as evidence that the plan's premises were wrong, not as bad luck.

Do not re-dispatch. Re-derive what is being built, re-scout the premises the packets were
written from, question the decomposition itself, and bring the requirements back into
question if they look suspect. A third attempt against a wrong premise is the most
expensive way to discover it.

If your test suite is genuinely flaky and that is the cause, raise
`circuitBreaker.maxTotalFails` — but fix the suite, because every cook is paying that tax.

## An item says `rework-needed`

The ladder got a PASS but landing failed. `blockedReason` says which:

- **rebase conflict** — resolving it changes the shipped diff, so fix it in the item
  worktree and re-run the Inspector on the resolved state before landing.
- **contamination** — something outside `.brigade/` is modified or untracked in the main
  checkout. The landing refused rather than mixing your work into the delivery branch.
  Clean or stash the main checkout and re-run.
- **branch not contained in delivery** — the branch and worktree are deliberately left in
  place for investigation. Nothing was deleted.

## Merge conflicts between items

That is a decomposition defect, not a git problem: two items in the same wave touched the
same file. Record it in `.brigade/LEARNINGS.md` and sequence that work with a dependency
edge next time. The analyst will pick it up in the retro.

## `brigade-bundle --check` fails

The generated `workflows/brigade-*.js` drifted from `workflows/src/*.js` +
`workflows/config.js`. Run `brigade-bundle` and commit the regenerated output. Never
hand-edit the generated files.

## `brigade-status --json` errors

It needs `jq`. Plain `brigade-status` does not.

## The guard blocked a command I wanted

The PreToolUse guard blocks broad staging (`git add -A`, `git add .`, `git commit -a`,
pathspec tricks, and the same commands smuggled through `env`, `sh -c`, command
substitution, or heredocs) and refuses to stage `.brigade/` at all.

Stage explicit paths instead: `git add src/foo.ts src/foo.test.ts`. The guard fails closed
— if it cannot parse a command, it blocks it — so an unusual but legitimate shell
construction may need to be split into simpler commands.

## Resuming after a crash or a closed session

Say `continue the dish`. State is on disk, so nothing is lost. Items already `done` are
skipped rather than re-cooked.

Where `PLAN.md` and the filesystem disagree, the **filesystem wins** — check
`git worktree list` and the delivery branch, then fix the plan to match reality.
