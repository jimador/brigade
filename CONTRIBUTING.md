# Contributing

Brigade is markdown and dependency-free scripts. There is no build system to install and
no package to publish — but there are a few rules that keep it working.

## Layout

```
skills/brigade/     the planner's brain, schemas, tier policy, source adapters, templates
skills/groom/       the board-grooming session
agents/             one file per subagent role
commands/           slash commands (thin wrappers over the scripts/ helpers)
output-styles/      opt-in Planner output style (users pick it in /config; never forced)
settings.json       plugin defaults — currently just the subagent status line
monitors/           background coord watch (starts on brigade skill invoke)
CONNECTORS.md       connector categories brigade binds to (~~tickets, ~~kb)
scripts/            brigade-status, brigade-config, brigade-validate, brigade-bundle,
                    brigade-coord, brigade-subagent-line
hooks/              SessionStart state injection, PreToolUse git guard
workflows/src/      hand-edited Workflow script sources
workflows/config.js policy consts + config merging, spliced into all three scripts
workflows/*.js      GENERATED — never hand-edit
docs/               the documentation set
test/regression.sh  operational regressions
```

## The one build step

Workflow scripts cannot import at runtime, so `scripts/brigade-bundle` splices
`workflows/config.js` verbatim into each script at the `//@BRIGADE_CONFIG@` marker.

Edit `workflows/src/*.js` or `workflows/config.js`, then:

```bash
scripts/brigade-bundle          # regenerate
scripts/brigade-bundle --check  # fail if committed output is stale
```

Commit the regenerated output. `--check` is part of the verification gate, so drift fails
the build.

## Verification gate

Run all of this before calling a change done:

```bash
for f in install.sh scripts/brigade-status hooks/*.sh; do bash -n "$f" || exit 1; done
node --check scripts/brigade-validate
node --check scripts/brigade-config
node --check scripts/brigade-bundle
node --check scripts/brigade-coord
node --check scripts/brigade-subagent-line
node --check scripts/brigade-onboard
node --check scripts/brigade-risk
node --check scripts/brigade-eval
node --check workflows/config.js
for f in workflows/src/*.js workflows/brigade-*.js; do node --check "$f" || exit 1; done
scripts/brigade-bundle --check
python3 -c "import json; [json.load(open(f)) for f in ['.claude-plugin/plugin.json','.claude-plugin/marketplace.json','hooks/hooks.json','settings.json','monitors/monitors.json']]"
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
./test/regression.sh
```

**Eval tier (opt-in).** `scripts/brigade-eval` runs prompt evals against skill and agent
surfaces; it needs `ANTHROPIC_API_KEY` and Node 18+. Run `node scripts/brigade-eval` to try
it — with no key set it skips cleanly (exit 0). Results land in `.brigade/evals/` and are
never committed. A full sweep is operator-invoked, not part of the per-commit gate.

`claude plugin validate` is the only check that reads the manifests and every skill,
command, and agent the way the runtime does. It is how a command whose frontmatter fails
to parse — and therefore loads with its description silently dropped — gets caught. Don't
use `--strict` here: the repo's own `CLAUDE.md` draws an intentional warning (it is
contributor instructions, not shipped context), and `--strict` turns that into an error.

There is no unit-test framework. `test/regression.sh` covers the behaviors that have
broken before: `brigade-status` parsing of both inline and block-style plan items,
`brigade-config` layer precedence and prompt stacking, cross-runtime lease contention and
handoff, and the git guard's block/allow policy including the smuggling paths (`env`,
`sh -c`, command substitution, heredocs).

**A bug that got past the gate gets a regression test in the same change.** That is the
only way this file stays honest.

## Changing tier policy

Tier policy lives in two places that must agree: `skills/brigade/TIERS.md` (the human
reference) and `workflows/config.js` (what the scripts actually run). Change both in the
same commit, then re-bundle.

## Changing artifact schemas

`skills/brigade/SCHEMAS.md` is the registry, `scripts/brigade-validate` enforces it, and
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
