# Brigade plugin source

This repo is the source for the Claude Code plugin `brigade@brigade`. It is installed at
user scope from a local `directory` marketplace pointing here.

Marketplace installs are **cached copies**. After editing anything the plugin ships
(skills, agents, hooks, commands, workflows, bin scripts): bump `version` in
`.claude-plugin/plugin.json`, then run `claude plugin update brigade@brigade`. Until you
do, sessions keep running the old cached version — the most common reason a change appears
to do nothing.

`workflows/brigade-*.js` are generated. Edit `workflows/src/*.js` or `workflows/config.js`
and run `bin/brigade-bundle`; `--check` fails the gate if the committed output is stale.

Run the full verification gate before calling a change done — see
[CONTRIBUTING.md](CONTRIBUTING.md). A bug that got past the gate gets a regression test in
`test/regression.sh` in the same change.

Process heuristics from dish retros live in a knowledge base when one is configured in
`~/.brigade/config.json` (`kb.enabled` + `kb.cli`); a brain-upgrade pass absorbs them into
the skill and agent text and retires each absorbed note. Without a KB they accumulate in
`.brigade/LEARNINGS.md`, and teams can commit them to
`skills/brigade/policies/heuristics.md`.

**No real data in any file.** No real names, handles, repos, orgs, emails, absolute home
paths, or tokens — in prompts, docs, examples, or fixtures. Use neutral placeholders
(`alex`, `acme`, `/path/to/repo`, `<your-handle>`). Prompt text travels to every session
in every repo.
