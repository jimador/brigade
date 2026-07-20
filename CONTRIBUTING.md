# Contributing

Brigade is markdown and dependency-free scripts. There is no build system to install and
no package to publish — but there are a few rules that keep it working.

## Layout

```
skills/brigade/     the planner's brain, schemas, tier policy, source adapters, templates
skills/groom/       the board-grooming session
agents/             one file per subagent role
commands/           slash commands (thin wrappers over the bin/ scripts)
bin/                brigade-status, brigade-config, brigade-validate, brigade-bundle
hooks/              SessionStart state injection, PreToolUse git guard
workflows/src/      hand-edited Workflow script sources
workflows/config.js policy consts + config merging, spliced into all three scripts
workflows/*.js      GENERATED — never hand-edit
docs/               the documentation set
test/regression.sh  operational regressions
```

## The one build step

Workflow scripts cannot import at runtime, so `bin/brigade-bundle` splices
`workflows/config.js` verbatim into each script at the `//@BRIGADE_CONFIG@` marker.

Edit `workflows/src/*.js` or `workflows/config.js`, then:

```bash
bin/brigade-bundle          # regenerate
bin/brigade-bundle --check  # fail if committed output is stale
```

Commit the regenerated output. `--check` is part of the verification gate, so drift fails
the build.

## Verification gate

Run all of this before calling a change done:

```bash
for f in install.sh bin/brigade-status hooks/*.sh; do bash -n "$f" || exit 1; done
node --check bin/brigade-validate
node --check bin/brigade-config
node --check bin/brigade-bundle
node --check workflows/config.js
for f in workflows/src/*.js workflows/brigade-*.js; do node --check "$f" || exit 1; done
bin/brigade-bundle --check
python3 -c "import json; [json.load(open(f)) for f in ['.claude-plugin/plugin.json','.claude-plugin/marketplace.json','hooks/hooks.json']]"
./test/regression.sh
```

There is no unit-test framework. `test/regression.sh` covers the behaviors that have
broken before: `brigade-status` parsing of both inline and block-style plan items,
`brigade-config` layer precedence and prompt stacking, and the git guard's block/allow
policy including the smuggling paths (`env`, `sh -c`, command substitution, heredocs).

**A bug that got past the gate gets a regression test in the same change.** That is the
only way this file stays honest.

## Changing tier policy

Tier policy lives in two places that must agree: `skills/brigade/TIERS.md` (the human
reference) and `workflows/config.js` (what the scripts actually run). Change both in the
same commit, then re-bundle.

## Changing artifact schemas

`skills/brigade/SCHEMAS.md` is the registry, `bin/brigade-validate` enforces it, and
`workflows/config.js` carries the blocks pasted into subagent prompts. All three move
together.

## Style

Scripts are dependency-free and BSD/macOS compatible — no `jq` requirement in any code
path that must work without it, no GNU-only flags. Node scripts use only the standard
library.

Docs and prompts are terse and imperative. Say what the thing does and what breaks if you
get it wrong. No filler, no hedging, no restating the obvious.

Never use "mise" or "mise en place" vocabulary — the `mise` dev-tool manager owns that
word, and colliding vocabulary between installed tools confuses sessions.

## Releasing

Marketplace installs are **cached copies**. After changing anything the plugin ships:

1. Bump `version` in `.claude-plugin/plugin.json`.
2. `claude plugin update brigade@brigade`.

Until you do, sessions keep running the old cached version — which is the single most
common way a change appears to do nothing.

## No real data anywhere

No real names, handles, repos, orgs, emails, paths, or tokens in any file — prompts,
docs, examples, or test fixtures. Use neutral placeholders (`alex`, `acme`,
`/path/to/repo`, `<your-handle>`). Prompts are shipped text; anything in them travels to
every session in every repo.
