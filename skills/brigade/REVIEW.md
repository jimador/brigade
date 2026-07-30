# Reviewing code (`brigade-review` Workflow script)

Read when: the user asks for a standalone review (`/brigade:review`) or wants review
findings cooked (`/brigade:review-dispatch`). Not needed for the in-pipeline Inspector
gate — that runs inside `brigade-execute`.

**What it is.** An advisory, tier-scaled standalone code review over a branch, PR, or
commit range, invoked via `/brigade:review` — it runs outside the cook/inspect/land
pipeline, on demand. It's the same Mode 3 (standalone diff review) contract an Inspector
already uses when reviewing outside a packet: findings, never a PASS/FAIL verdict. It
never posts to a pull request; the only write besides its own report is a plain-language
ticket comment when a tracked ticket was found, and only ever to that ticket.

Before creating the review worktree or report, acquire coordination key
`review-<review-slug>` as `claude`; release it after report assembly and cleanup. This
prevents a concurrent Codex review of the same input from colliding on shared paths.

**Invocation.** Resolve `scriptPath` the same two-path rule as research/execute: prefer
`$CLAUDE_PLUGIN_ROOT/workflows/brigade-review.js` when that env is set, else
`<skill-base>/../../workflows/brigade-review.js`. Build args (may arrive as a JSON
string): `{ repoRoot, now, tier, mainLine, reviewSlug, input: { kind, ref },
boardConfigured, overrides, promptOverrides }` — `overrides` is the `config` object from
`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config" resolve --json` (passing the whole resolve output also works — the script
unwraps `.config`), `promptOverrides` is `"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-config" prompts --json`. `boardConfigured`
is true when `.brigade/config.md`'s `## Source` section has a `database_id` set, false
otherwise.

**Input contract (D2).** `branch` and `range` inputs resolve locally — `git merge-base
<mainLine> <head>` for a branch, both endpoints checked with `git rev-parse` for a range —
no `gh` needed. A `pr` input (a bare number, `#123`, or a URL) requires an authenticated
`gh` and a remote: `gh pr view --json number,title,body,headRefName,baseRefName` plus
`git fetch <remote> pull/<n>/head:<review-ref>`; the PR's title/body feed the product
dimension as its intent source. `gh` missing/unauthenticated, or either command failing
for any other reason, fails fast with a decision-ready message naming the equivalent
branch/range invocation to retry with — never a guess. There is no raw-diff-file input:
the context probe and every dimension review need a real checkout. Review worktrees live
at `.brigade/review/<slug>` — deliberately not under `.brigade/worktrees/` (that location
is execute's; review runs independently of the item DAG) — checked out and torn down by
the script itself on every exit path.

**Risk escalation.** Before building the invocation args, run
`"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-risk" --json` over the resolved input's changed
files: `--range <mainLine>...<ref>` for `branch` (git's triple-dot already diffs since
merge-base, no separate resolution step needed) or `--range <ref>` for `range`. A `pr`
input has no local ref yet here — the D2 fetch happens later, inside the Workflow's
Resolve phase — so pass `--files` populated from `gh pr diff --name-only <n>` instead.
When `escalate` is `true`, bump `tier` one level (one-star → two-star → three-star,
capped at three-star) before it's passed as the existing `tier` arg — no new arg key.
Record `risk_escalated: true` and the matching `categories` in the report's context
line. Add-only: never overridden downward; the operator's `--tier` may always ask deeper.

**Per-tier depth (D1).** Eight dimensions, id-keyed (`correctness`, `tests`,
`architecture`, `maintainability`, `reuse`, `duplication`, `security`, `product`),
configurable via the `review.dimensions` config key (merged by `id`, like
`contextSources` — see [configuration.md](../../docs/configuration.md)):

| | ★★★ | ★★ | ★ |
| --- | --- | --- | --- |
| dispatches | 8 — one per dimension | 4 groups: correctness+tests, architecture+maintainability, reuse+duplication, security; product as conditional 5th | 1 merged pass |
| product dimension | always; degrades to PR/commit intent with explicit "no requirements source" caveat | only when a requirements source exists | only when a requirements source exists (folded into the merged pass) |
| verify pass | every blocking+high finding, 2 independent refute-framed verifiers; finding dies if both refute, reported "unconfirmed" if one refutes | blocking findings, 1 verifier | none; findings labeled unverified |
| context probe | docs + ticket + KB + ≤2 context scouts | docs + ticket | docs only |

**Return shape.** On success: `{ reportPath, contextTier, counts, findings, unconfirmed,
dropped }` — `contextTier` is `bare`/`documented`/`tracked` (what context the review
actually had); `counts` is findings by severity; `findings` are the survivors, each
packet-shaped (id, severity, location, summary, dimension, fix, verify); `unconfirmed` is
the subset a refute vote couldn't kill outright but also couldn't confirm; `dropped` is
what a full refute pass killed. On a Resolve failure: `{ findings: [], contextTier: 'bare',
reportPath: null, error }` — present `error` verbatim and stop.

**Follow-up.** Findings are already packet-shaped, so `/brigade:review-dispatch
<review-slug|report-path> [finding-id...]` turns selected ones into a cooked mini-dish.
Selection is explicit (arguments or an `AskUserQuestion` multi-select — no bulk mode); any
finding whose `confirmed` isn't `true` gets a premise re-check against current main before
it's trusted. Surviving findings become `.brigade/dishes/review-fixes-<slug>/PLAN.md`, one
item per finding, with no second planning pass since the findings already did the
decomposition — then it runs through `brigade-execute` (Phases 3–5) like any other dish.
