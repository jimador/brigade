# AGENTS.md — the brigade plugin repo

Repo-level facts for any coding agent working on Brigade. Markdown is the product: skills and
agent files are prompts that run in every session that installs the plugin, so treat their
wording with the care you would give production code.

## Layout and build

- This repo is the source of the Claude Code plugin `brigade@brigade`; the layout and the one
  build step are described in `CONTRIBUTING.md`.
- `workflows/brigade-*.js` are generated from `workflows/src/*.js` and `workflows/config.js` by
  `scripts/brigade-bundle`. Never hand-edit the generated files; `scripts/brigade-bundle --check`
  fails the gate when they drift.
- Pairs that change together, in the same commit: tier policy in `skills/brigade/TIERS.md` and
  `workflows/config.js`; artifact schemas in `skills/brigade/SCHEMAS.md` and
  `scripts/brigade-validate`.
- Scripts stay dependency-free and BSD/macOS compatible: no `jq` requirement in a code path that
  must work without it, no GNU-only flags; Node scripts use only the standard library.

## Verification

Run the full gate in `CONTRIBUTING.md` § Verification gate before calling a change done. A bug
that got past the gate gets a regression test in `test/regression.sh` in the same change.

## Prompt surfaces

- Every `skills/*/SKILL.md` stays under 500 lines. `skills/brigade/SKILL.md` is a router: standing
  rules and the dish checklist live there, phase detail lives in its companions (`DECOMPOSE.md`,
  `EXECUTE.md`, `HANDOFF.md`, `COORDINATION.md`, `CONFIG.md`), and `test/regression.sh` enforces
  the size, reference, and description budgets.
- Skill and agent descriptions say what the surface does and when to use it, in third person and
  double-quoted; the body carries the detail and states what "done" means.
- Rule ids `P1–P7` and `D1–D7` in `skills/brigade/DECOMPOSE.md` are cited by retros and plan
  checks: amend under the existing id, never renumber.
- Terse, imperative prose: what the thing does and what breaks if you get it wrong.
- No real data anywhere — no real names, handles, repos, orgs, emails, absolute home paths, or
  tokens in prompts, docs, examples, or fixtures. Use `alex`, `acme`, `/path/to/repo`,
  `<your-handle>`.
- Never use "mise" / "mise en place" vocabulary — the `mise` dev-tool manager owns it.

## Brigade configuration (brigade cooking itself)

- Source `local` (`skills/brigade/sources/local.md`), board under `.brigade/board/`, identity
  status mapping, custom fields `kind` (`feature|bug|chore|docs|research|contract`) and `worker`
  (cook roster name, set at dispatch).
- Verification gate for cooks: `claude plugin validate .claude-plugin/plugin.json` and
  `./test/regression.sh`, plus the syntax and bundle checks in `CONTRIBUTING.md`.
- Never commit `.brigade/` (it is listed in `.git/info/exclude`). Design swag never claims a
  ticket or sets `worker`.
