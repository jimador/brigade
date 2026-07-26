# Self-improvement (retro → heuristics → brain upgrade)

Read when: an analyst pass is due (the tier's cadence, a 10-item checkpoint at ★★★, or
the user asked), before applying its report, or before a brain-upgrade pass.

A dish is a sprint: one ticket cooked to completion. Retrospectives run on the tier's
cadence (at ★ skipping a dish is the cadence, not an omission), and they compound
through three layers:

**Layer 1 — the retro (cadence set by the tier, mandatory).** The `brigade-analyst`
cadence comes from `TIERS.md`: ★★★ every dish plus every 10 merged items on long dishes;
★★ every dish; ★ every 3rd dish or on request — and whenever the user asks, at any tier.
Never skipped silently at any tier — if you must defer a due pass, say so to the user
explicitly.
Dispatch `brigade-analyst` with: the dish dir path (`PLAN.md`, `briefs/`, `reports/` —
including every FAIL verdict and rework trail), `.brigade/LEARNINGS.md`, and the output
path `.brigade/dishes/<dish-slug>/analyst.md`. It scores the run (rework rate, escalation
use, blocked packets, conflicts, review yield) and returns 1–3 concrete proposals. Apply
what's repo-local yourself by acquiring `repo-global`, re-reading the latest file,
appending to `.brigade/LEARNINGS.md`, and releasing the lease — the fleet's working
memory, re-read at every dish start.

**At ★★★ the end-of-dish retro is intensive** (mid-dish 10-item checkpoints stay
standard). Dispatch the same agent with model override `opus`, say `mode: intensive` in
the prompt, and add the cross-dish inputs: every prior `.brigade/dishes/*/analyst.md`,
the efficiency block from `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-status"`, and the live heuristic set (the configured KB
search command when `kb.enabled`, else `.brigade/LEARNINGS.md` `## Heuristics` and the
committed heuristics file). The intensive report adds a proposal ledger — every past
proposal ruled applied/ignored/dead with proof — cross-dish trend scoring, and up to 5
proposals including researched `tooling` recommendations (a tool, lint rule, CI step, or
hook that would eliminate a recurring failure class). When it lands: apply learnings as
usual, retire ledger-dead proposals (KB amend or heuristics-file status), surface ignored
ones to the user, and treat `tooling` proposals as operator decisions — never
auto-install anything.

**Layer 2 — the heuristic store (accumulates across repos and dishes).** Proposals the
Analyst marks as **generalizable heuristics** — rules about decomposition, packet writing,
model selection, or review that would hold in any repo — are offered to the operator's
knowledge base (KB writes are the operator's call; one yes/no per retro, never automatic).
When `~/.brigade/config.json` has `kb.enabled` and a `kb.cli` on PATH, run that CLI with
the configured ingest/search argument templates (defaults often look like a personal KB
CLI with tags `brigade,heuristic,active`). The stable tags and one-rule-per-note format
are what make Layer 3 possible.

No configured KB CLI? Accumulate them in a `## Heuristics` section of `.brigade/LEARNINGS.md`
instead. Teams sharing brigade should prefer the committed heuristics file
`skills/brigade/policies/heuristics.md` (one rule per entry: rule, evidence, dish ref);
a personal KB is then an operator overlay, never the team's only memory.

**Layer 3 — the brain upgrade (heavy model, periodic).** Every few dishes — or when the
same heuristic keeps recurring in retros — the user runs an upgrade pass; it runs at
three-star by definition (the strongest available model).
This pass is the only thing that edits brigade itself, and it edits the **source, never
the installed copy**:

1. Locate the source: the operator's user memory (`~/.claude/CLAUDE.md`) records the
   brigade source directory; failing that, `claude plugin marketplace list` shows the
   marketplace path, and a legacy copy install has a `PROVENANCE` file next to the SKILL.
   Marketplace installs are **cached copies** — source edits reach sessions only via
   `claude plugin update brigade@brigade` (bump the version in
   `.claude-plugin/plugin.json` first).
2. Gather the evidence base: the full live heuristic set via the configured KB search
   (or `skills/brigade/policies/heuristics.md` + `LEARNINGS.md`), plus recent `analyst.md`
   reports from active repos. Soft-fail optional graph tooling if the KB CLI exposes it.
3. Synthesize: which heuristics have earned a place in the brain (recurring, evidence-
   backed) vs. stay repo-local vs. contradict each other (surface contradictions to the
   user — don't average them). Then edit the source SKILL/agents/templates: tighten the
   granularity bar, sharpen packet/verdict formats, adjust the escalation or heavy-flag
   policy — smallest diff that captures the rule.
4. The user reviews the source diff; roll it out with a version bump +
   `claude plugin update brigade@brigade` (legacy copy installs rerun
   `./install.sh --legacy`). Retire each absorbed heuristic in the KB (or mark
   `status: absorbed` in the committed heuristics file) so it never gets re-proposed.

Never self-edit an installed copy in place, never bulk-import unvetted heuristics into the
brain, and keep the brain small — a heuristic earns its token cost in every future dish
or it stays in the KB.

The Analyst is deliberately tiny and brigade-specific: it reads artifacts the run already
produced, it never touches source code, and its report is information for you and the
user — not instructions that execute themselves.
