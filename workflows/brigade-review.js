export const meta = {
  name: 'brigade-review',
  description: 'Reviews a branch, PR, or commit range along named dimensions, scaling depth to tier and available context.',
  phases: [{ title: 'Resolve' }, { title: 'Probe' }, { title: 'Review' }, { title: 'Verify' }, { title: 'Report' }],
}

// Brigade tier policy and artifact schemas, as plain-JS consts.
// The bundler injects this file's text verbatim into Workflow scripts (which can't import).

const HEAVY_ATTEMPTS = ['brigade:brigade-cook-heavy', 'brigade:brigade-cook-heavy']

const BRIGADE_TIERS = {
  'three-star': { attempts: HEAVY_ATTEMPTS, scoutCap: 6, planCheck: 'always', retro: 'every-dish-intensive+every-10-items' },
  'two-star':   { attempts: ['brigade:brigade-cook', 'brigade:brigade-cook', 'brigade:brigade-cook-heavy'], scoutCap: 4, planCheck: 'triggers', retro: 'every-dish' },
  'one-star':   { attempts: ['brigade:brigade-cook', 'brigade:brigade-cook', 'brigade:brigade-cook-heavy'], scoutCap: 2, planCheck: 'never', retro: 'every-3rd-dish' },
}

const MAX_PARALLEL_COOKS = 4

const CIRCUIT_BREAKER = { maxLadderExhausts: 2, maxTotalFails: 4 }

const STEWARD = { agentType: 'general-purpose', effort: 'low' }

// Agent types the scripts dispatch, by role. A config layer can point any role at a
// different agent — that is how a fork or a team-specific agent gets swapped in
// without editing the scripts.
const DEFAULT_AGENTS = {
  scout: 'brigade:brigade-scout',
  cook: 'brigade:brigade-cook',
  cookHeavy: 'brigade:brigade-cook-heavy',
  inspector: 'brigade:brigade-inspector',
  analyst: 'brigade:brigade-analyst',
  design: 'brigade:brigade-design',
  steward: STEWARD.agentType,
}

// Fold the resolved config (from `brigade-config resolve --json`, handed in as
// args.overrides) over the built-in tier policy. Anything absent keeps the default,
// so a partial override is always safe.
function resolvePolicy(tier, overrides) {
  const base = BRIGADE_TIERS[tier] || BRIGADE_TIERS['two-star']
  const o = overrides && overrides.config ? overrides.config : overrides || {}
  const models = o.models || {}
  const agentFor = (role) => models[role] || DEFAULT_AGENTS[role]
  const attempts = (base.attempts || []).map((agentType) => {
    if (agentType === DEFAULT_AGENTS.cookHeavy) return agentFor('cookHeavy')
    if (agentType === DEFAULT_AGENTS.cook) return agentFor('cook')
    return agentType
  })
  const heavyAttempts = HEAVY_ATTEMPTS.map(() => agentFor('cookHeavy'))
  const policy = o.policy || {}
  const breaker = o.circuitBreaker || {}
  return {
    attempts,
    heavyAttempts,
    scoutCap: policy.scoutCap != null ? policy.scoutCap : base.scoutCap,
    planCheck: policy.planCheck != null ? policy.planCheck : base.planCheck,
    retro: policy.retro != null ? policy.retro : base.retro,
    maxParallel: o.maxParallel != null ? o.maxParallel : MAX_PARALLEL_COOKS,
    circuitBreaker: {
      maxLadderExhausts: breaker.maxLadderExhausts != null ? breaker.maxLadderExhausts : CIRCUIT_BREAKER.maxLadderExhausts,
      maxTotalFails: breaker.maxTotalFails != null ? breaker.maxTotalFails : CIRCUIT_BREAKER.maxTotalFails,
    },
    workingMemory: o.workingMemory != null ? o.workingMemory : true,
    agents: {
      scout: agentFor('scout'),
      inspector: agentFor('inspector'),
      analyst: agentFor('analyst'),
      design: agentFor('design'),
      steward: agentFor('steward'),
    },
  }
}

// Log-line badges, keyed by ROLE rather than agentType so the icons stay stable when a
// config layer swaps an agent in. Plain unicode — renders in any terminal, no emoji font.
const BADGE = { planner: '✦', scout: '⌕', cook: '♨', inspector: '✓', analyst: '∴', steward: '⚑', landed: '➤', blocked: '⊘' }
const blog = (role, msg) => log(`${BADGE[role] || '·'} ${msg}`)

// Prompt overrides resolved by `brigade-config prompt <name>` arrive as an ordered
// array of text fragments and are appended to the shipped prompt, in layer order.
function withPromptOverrides(basePrompt, fragments) {
  if (!fragments || !fragments.length) return basePrompt
  return `${basePrompt}\n\nADDITIONAL INSTRUCTIONS (from this operator's brigade configuration — they add to, never remove, the rules above):\n\n${fragments.join('\n\n')}\n`
}

const SCHEMA_BRIEF_RETURN = { type: 'object', required: ['answer', 'confidence', 'briefPath'], properties: { answer: { type: 'string' }, confidence: { enum: ['high', 'medium', 'low'] }, briefPath: { type: 'string' }, notVerified: { type: 'string' } } }

const SCHEMA_COOK_RETURN = { type: 'object', required: ['status', 'attempt', 'branch', 'reportPath', 'filesChanged', 'summary'], properties: { status: { enum: ['done', 'blocked'] }, attempt: { type: 'integer' }, branch: { type: 'string' }, reportPath: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, blockedReason: { type: 'string' } } }

const SCHEMA_VERDICT_RETURN = { type: 'object', required: ['verdict', 'verdictPath', 'trivialOnly', 'findings'], properties: { verdict: { enum: ['PASS', 'FAIL'] }, verdictPath: { type: 'string' }, trivialOnly: { type: 'boolean' }, findings: { type: 'array', items: { type: 'object', required: ['id', 'severity', 'location', 'summary'], properties: { id: { type: 'string' }, severity: { enum: ['blocking', 'high', 'medium', 'low'] }, location: { type: 'string' }, summary: { type: 'string' } } } } } }

const SCHEMA_STEWARD_RETURN = { type: 'object', required: ['ok', 'detail'], properties: { ok: { type: 'boolean' }, detail: { type: 'string' }, landedRange: { type: 'string' }, contamination: { type: 'boolean' } } }

const SCHEMA_REVIEW_RETURN = { type: 'object', required: ['findings', 'contextTier', 'reportPath'], properties: { findings: { type: 'array', items: { type: 'object', required: ['id', 'severity', 'location', 'summary', 'dimension'], properties: { id: { type: 'string' }, severity: { enum: ['blocking', 'high', 'medium', 'low'] }, location: { type: 'string' }, summary: { type: 'string' }, dimension: { type: 'string' }, fix: { type: 'string' }, verify: { type: 'string' } } } }, contextTier: { enum: ['bare', 'documented', 'tracked'] }, reportPath: { type: 'string' } } }

const MD_SCHEMA_BLOCKS = {
  brief: `Producer: scout. Consumers: Planner (packet-writing), Inspector (plan check).

\`\`\`yaml
doc: brief
schema: 1
dish: <dish-slug>
item: <item-slug>
role: scout
model: haiku
created: 2026-07-04T03:10:00Z
question: <the one question, verbatim>
confidence: high                   # high|medium|low
sources:                          # authority: the code itself, nothing else
  - src/auth/session.ts:10-48
  - package.json:12
urls: []                          # only if the question required external docs
\`\`\`

Body sections, in order: \`## Answer\` (2–5 sentences, first), \`## Contracts\` (pasted
signatures with locations), \`## Anchors\` (pasted snippets where changes land),
\`## Conventions\`, \`## Risks\`, \`## Not verified\` (what confidence hinges on).
Budget: ≤ 150 lines. Everything pasted is verbatim from the working tree.`,
  report: `Producer: cook / cook-heavy. Consumers: Planner (triage), Inspector (review).

\`\`\`yaml
doc: report
schema: 1
dish: <dish-slug>
item: <item-slug>
role: cook
model: haiku
created: 2026-07-04T03:10:00Z
status: done                       # done|blocked
attempt: 1                        # 2+ = rework pass
branch: wip/<delivery-slug>/<item-slug>
files_changed:                    # must be ⊆ the packet's file list
  - { path: src/foo.ts, change: <one line> }
commands:                         # every Verify command run, in order
  - bun test src/foo.test.ts
findings_addressed: []            # rework only: finding id → how resolved
ledger: <path|null>               # working-memory ledger, when the dispatch carried one
\`\`\`

Body sections, in order: \`## Summary\` (what changed, why, ≤ 5 lines), \`## Evidence\`
(verbatim tail of each command's output — the verdict line must be visible),
\`## Decisions\` (judgment calls the packet left open), \`## Out of scope\` (noticed, not
touched), and for \`status: blocked\` a \`## Blocked\` section stating exactly what
contradicted the packet. Authority: the working tree and the commands' real output.
Budget: ≤ 120 lines.`,
  ledger: `Cook working memory — one per item at .brigade/dishes/<dish>/state/<item>.md.

\`\`\`yaml
doc: ledger
schema: 1
dish: <dish-slug>
item: <item-slug>
role: cook
model: <model id of the last writer>
created: <ISO8601 first seeding>
attempt: <highest attempt that wrote this ledger>
updated: <ISO8601 stamp of the last write>
\`\`\`

Body sections in order: ## Canon (<= 20 numbered C<n>. units seeded from the packet,
NEVER edited — a wrong Canon unit is a packet defect: report BLOCKED), ## World state
(<= 30 live numbered W<n>. units tagged [RELIABLE] (verified — name the command) or
[PROVISIONAL] (inferred, MAY be reconsidered); supersede by ~~strikethrough~~ plus a
replacement unit "(supersedes Wn)", never delete), ## Archive (optional overflow).
Cadence: read-or-seed before first edit; after every Verify run update World state and
re-read Canon; before commit self-check the diff against Canon; before the report do a
final update, quote the live World state in Evidence, set ledger: in the frontmatter.`,
  verdict: `Producer: inspector. Consumers: Planner (merge/rework decision), Analyst.

\`\`\`yaml
doc: verdict
schema: 1
dish: <dish-slug>
item: <item-slug>
role: inspector
model: haiku
created: 2026-07-04T03:10:00Z
verdict: PASS                      # PASS|FAIL
attempt_reviewed: 1
reran_gate: true                  # false requires a reason in the body
findings:
  - { id: F1, severity: blocking|high|medium|low, location: "src/foo.ts:42",
      summary: <one line> }
trivial_only: false               # true = all findings annotation-only, no redispatch needed
\`\`\`

Body sections, in order: \`## Verdict\` (one line), \`## Findings\` (per finding: what's
wrong, why it matters, concrete fix direction — ids matching frontmatter), \`## Evidence
check\` (what was re-run, verbatim result tail). Authority: the actual diff and the
inspector's own command runs; the cook's report is a claim, not a source.
Budget: ≤ 150 lines.`,
  review_report: `Producer: review workflow (inspector Mode 3 findings, planner-assembled).
Consumers: operator, later finding-to-packet dispatch. Advisory — no PASS/FAIL.

---
doc: review_report
schema: 1
role: inspector
model: haiku
created: 2026-07-04T03:10:00Z
input: { kind: branch, ref: feat/x }        # kind: branch|range|pr; ref: as given
range: <base>..<head>
context_tier: documented                    # bare|documented|tracked
tier: three-star                            # three-star|two-star|one-star
counts: { blocking: 0, high: 0, medium: 0, low: 0 }
findings:
  - { id: F1, dimension: correctness, severity: blocking, location: "src/foo.ts:42",
      summary: <one line>, files: [src/foo.ts], fix: <concrete fix direction>,
      verify_hint: <how to confirm>, confirmed: true }
---

Body sections, in order: \`## Scope\` (what was reviewed, base/head, context tier and
why), \`## Findings\` (grouped by severity within dimension; each finding packet-shaped),
\`## Context disclosure\` (what the review could not see at this context tier —
name the "no requirements source" caveat when it fires), \`## Evidence\` (commands run,
verbatim key output). Budget: ≤ 250 lines. Authority: the diff, the worktree, probe
artifacts; product findings cite the requirements source or carry the no-requirements
caveat.`,
}

// The eight lenses a code review can look through. Each `lens` is the instruction an
// inspector gets for that dimension — what to examine and what evidence a finding needs.
const REVIEW_DIMENSIONS = [
  { id: 'correctness', title: 'Correctness', lens: "Does the code do what it claims, including edge cases and error paths? Trace the actual control flow against the packet's acceptance criteria (or, absent one, the PR/commit intent) and flag any place behavior diverges from that, naming the specific input or state that triggers it." },
  { id: 'tests', title: 'Tests', lens: 'Do the tests exercise the real behavior, not just the happy path, and would they actually fail if the logic broke? Flag missing coverage for the edge cases and error paths the change introduces, assertions on implementation details instead of behavior, and tests that would pass whether or not the fix works.' },
  { id: 'architecture', title: 'Architecture', lens: "Does this change fit the existing module boundaries and data flow, or does it bolt on a shortcut that will make the next change harder? Look at where the logic lives relative to its callers and dependencies, and flag layering violations or responsibilities placed in the wrong module, naming the module that should own it instead." },
  { id: 'maintainability', title: 'Maintainability', lens: "Will the next person who reads this code understand it without archaeology? Flag naming that misleads, control flow that's harder to follow than it needs to be, and missing context a future editor would need — cite the specific line, not a general impression." },
  { id: 'reuse', title: 'Reuse', lens: "Before accepting any hand-rolled logic, prove the negative: search the app code and the frameworks/libraries already in use for an existing equivalent — a utility, a library function, a pattern used elsewhere in this repo — that the change should have used instead. A finding here needs the search that was run and what it turned up, not a guess that 'this probably exists somewhere.'" },
  { id: 'duplication', title: 'Duplication', lens: 'Compare the diff against the rest of the repo for near-identical logic introduced instead of reused — this is a spot check against files the diff obviously touches or extends, not an exhaustive repo-wide scan. Flag copy-pasted blocks with only superficial variable renames, and name the other location.' },
  { id: 'security', title: 'Security', lens: "Does this change introduce or widen an attack surface — unvalidated input, an authz gap, a secret handled unsafely, an injection vector? Trace the specific path an attacker would take and name the concrete exploit, not a generic 'this could be a security issue.'" },
  { id: 'product', title: 'Product', lens: "With a requirements source (ticket, spec, or a PR description carrying explicit acceptance criteria), review the change against those criteria and flag any left unmet or silently reinterpreted. Without a requirements source, review against the PR/commit's stated intent instead, and open the report with the caveat 'no requirements source' so the reader knows the bar was inferred, not given." },
]

// Per-tier review depth, mirroring TIERS.md's code-review-depth row (D1). `dispatch`
// picks how dimensions are batched into inspector calls; `groups` is the batching for
// 'grouped'/'merged' (unused, but present, for 'per-dimension'); `product` gates whether
// the product lens runs; `verify` sets which severities get a refute-framed second pass
// and how many independent votes; `probe` sets how much context-gathering runs first.
const REVIEW_POLICY = {
  'three-star': {
    dispatch: 'per-dimension',
    groups: [['correctness'], ['tests'], ['architecture'], ['maintainability'], ['reuse'], ['duplication'], ['security'], ['product']],
    product: 'always',
    verify: { severities: ['blocking', 'high'], votes: 2 },
    probe: 'full',
  },
  'two-star': {
    dispatch: 'grouped',
    groups: [['correctness', 'tests'], ['architecture', 'maintainability'], ['reuse', 'duplication'], ['security']],
    product: 'with-source',
    verify: { severities: ['blocking'], votes: 1 },
    probe: 'docs+ticket',
  },
  'one-star': {
    dispatch: 'merged',
    groups: [['correctness', 'tests', 'architecture', 'maintainability', 'reuse', 'duplication', 'security']],
    product: 'with-source',
    verify: { severities: [], votes: 0 },
    probe: 'docs',
  },
}

// Fold a config layer's `review.dimensions` overrides (merge-by-id, like contextSources)
// over the built-in REVIEW_DIMENSIONS. Later entries override fields on a matching id;
// `enabled: false` drops that dimension from the resolved set; an id not in the
// built-in set is appended as a custom dimension. Accepts either the wrapped
// `resolve --json` envelope or a bare config object, same tolerance as resolvePolicy.
function resolveReviewDimensions(overrides) {
  const o = overrides && overrides.config ? overrides.config : overrides || {}
  const patches = (o.review && o.review.dimensions) || []
  const order = REVIEW_DIMENSIONS.map((d) => d.id)
  const byId = new Map(REVIEW_DIMENSIONS.map((d) => [d.id, { ...d }]))
  for (const patch of patches) {
    if (!patch || !patch.id) continue
    if (patch.enabled === false) {
      byId.delete(patch.id)
      continue
    }
    const { enabled, ...fields } = patch
    byId.set(patch.id, { ...(byId.get(patch.id) || {}), ...fields })
    if (!order.includes(patch.id)) order.push(patch.id)
  }
  return order.filter((id) => byId.has(id)).map((id) => byId.get(id))
}
// The harness sometimes hands us args as a JSON string instead of an object — normalize once, up front.
const A = typeof args === 'string' ? JSON.parse(args) : args

// Text an operator's config layers add to every inspector dispatch (Review + Verify).
const PROMPT_EXTRAS = A.promptOverrides || {}

// Everything below runs inside a single async IIFE (rather than top-level await) so this file
// stays valid under a plain CommonJS-style syntax check as well as the Workflow runtime.
return (async () => {
  phase('Resolve')

  // Tier policy first, then the operator's config layers folded over it.
  const POLICY = resolvePolicy(A.tier, A.overrides)

  // Every review checks out its own throwaway worktree, kept in its own directory so it can
  // never collide with (or get torn down alongside) whatever cook/inspect worktrees this
  // dish's own pipeline happens to have in flight at the same time.
  const worktreePath = `${A.repoRoot}/.brigade/review/${A.reviewSlug}`

  // Pull the PR number out of whatever the caller handed us — a bare number, a "#123", or a
  // full PR URL all resolve to the same digits.
  function prNumberFromRef(ref) {
    const s = String(ref).trim()
    const m = s.match(/(\d+)\/?$/)
    return m ? m[1] : s.replace(/^#/, '')
  }

  const prNumber = A.input.kind === 'pr' ? prNumberFromRef(A.input.ref) : null
  const prReviewRef = prNumber ? `review/pr-${prNumber}` : null
  const remote = 'origin'

  // Schema-forced return for the Resolve steward call. `ok`/`error` carry the D2 pr
  // fail-fast case; the rest is the {base, head, range, worktreePath, prTitle, prBody}
  // shape the packet asks for.
  const SCHEMA_RESOLVE_RETURN = {
    type: 'object',
    required: ['ok'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      range: { type: 'string' },
      worktreePath: { type: 'string' },
      prTitle: { type: 'string' },
      prBody: { type: 'string' },
    },
  }

  function worktreeStep(checkoutRef) {
    return `Then check out the review worktree (a detached checkout is fine — no branch needed):
  git -C ${A.repoRoot} worktree add ${worktreePath} ${checkoutRef}
Set worktreePath to "${worktreePath}" in your return — every exit path from this review
depends on that exact path to clean up after itself later.`
  }

  function resolvePrompt() {
    const input = A.input
    if (input.kind === 'branch') {
      return `You are the Steward resolving a 'branch' review input for an automated code review.

Run exactly:
  git -C ${A.repoRoot} merge-base ${A.mainLine} ${input.ref}

If that command fails (bad ref, no common ancestor), stop and return ok: false with the
literal error in your 'error' field — do not guess a base.

Otherwise its stdout (a commit SHA) is 'base'. 'head' is the ref you were given verbatim:
"${input.ref}". Set range to "<base>..<head>" using the resolved base SHA.

${worktreeStep(input.ref)}

Return per the resolve schema: ok: true, base, head, range, worktreePath. Leave prTitle
and prBody unset — this input has no PR metadata.`
    }
    if (input.kind === 'range') {
      const parts = String(input.ref).split('..')
      const a = parts[0]
      const b = parts[1]
      return `You are the Steward resolving a 'range' review input "${input.ref}" for an
automated code review.

Verify BOTH endpoints resolve before doing anything else. Run:
  git -C ${A.repoRoot} rev-parse ${a}
  git -C ${A.repoRoot} rev-parse ${b}

If EITHER fails, stop and return ok: false with an 'error' naming exactly which endpoint
("${a}" or "${b}") failed to resolve.

Otherwise base = "${a}", head = "${b}", range = "${input.ref}".

${worktreeStep(b)}

Return per the resolve schema: ok: true, base, head, range, worktreePath. Leave prTitle
and prBody unset — this input has no PR metadata.`
    }
    // pr
    return `You are the Steward resolving a 'pr' review input (PR #${prNumber}, given to you
as "${input.ref}") for an automated code review.

Run, in order, and STOP at the first failure — do not retry, do not guess:
  gh pr view ${prNumber} --json number,title,body,headRefName,baseRefName
  git -C ${A.repoRoot} fetch ${remote} pull/${prNumber}/head:${prReviewRef}

If gh is missing, unauthenticated, the PR doesn't exist, there's no "${remote}" remote, or
either command fails for any other reason: return ok: false immediately, and set 'error' to
a decision-ready message naming the equivalent invocation the caller can retry with instead
— for example: "gh unavailable for PR #${prNumber} — retry with input {kind: 'branch',
ref: '<the PR's head branch name>'} once you have it, or {kind: 'range',
ref: '<base-sha>..<head-sha>'}." Do not attempt the worktree step if either command failed.

On success, run:
  git -C ${A.repoRoot} merge-base <baseRefName from the gh JSON above> ${prReviewRef}
That output is 'base'. head = "${prReviewRef}" (the ref you just fetched). range =
"<base>..<head>". prTitle = the JSON's "title" field. prBody = the JSON's "body" field
(empty string if null) — these feed the review's product dimension as its intent source.

${worktreeStep(prReviewRef)}

Return per the resolve schema: ok: true, base, head, range, worktreePath, prTitle, prBody.`
  }

  function cleanupPrompt() {
    return `You are the Steward cleaning up ONE finished code review. Run, best-effort —
report what happened for each step rather than stopping at the first failure:
  git -C ${A.repoRoot} worktree remove ${worktreePath} --force
${prReviewRef ? `  git -C ${A.repoRoot} branch -D ${prReviewRef}\n` : ''}
Either command failing because there was nothing to remove (the review never got that far
before hitting an error) is expected, not a problem — note it in 'detail' and still return
ok: true. Only a real failure (permission denied, worktree locked, etc.) on something that
DID exist should return ok: false.

You never touch any file or ref outside what's listed above. Return the result per the
steward schema.`
  }

  async function cleanupWorktree() {
    const result = await agent(cleanupPrompt(), {
      label: 'steward-cleanup',
      phase: 'Resolve',
      schema: SCHEMA_STEWARD_RETURN,
      agentType: POLICY.agents.steward,
      effort: STEWARD.effort,
    })
    if (!result || !result.ok) {
      blog('inspector', `Review worktree cleanup for ${A.reviewSlug} may have left state behind: ${result ? result.detail : 'no result from steward'}`)
    }
  }

  // ---- Probe: classify how much context this repo offers, and build a digest of it ----
  //
  // Three tiers, each a strict promotion over the last: 'bare' (nothing found) ->
  // 'documented' (repo docs exist) -> 'tracked' (a real ticket was found). Every source
  // here soft-fails — a missing board, a missing KB CLI, or a steward dispatch that
  // returns nothing all just mean "skip this source," never a thrown error.
  //
  // These schemas are scoped to this phase (mirroring SCHEMA_RESOLVE_RETURN's precedent
  // in Resolve) rather than added to config.js's shared SCHEMA_* set — nothing else needs
  // to validate against them.
  const SCHEMA_DOCS_PROBE_RETURN = { type: 'object', required: ['found', 'digest'], properties: { found: { type: 'array', items: { type: 'string' } }, digest: { type: 'string' } } }
  const SCHEMA_TICKET_PROBE_RETURN = { type: 'object', required: ['found', 'digest'], properties: { found: { type: 'boolean' }, digest: { type: 'string' } } }
  const SCHEMA_KB_PROBE_RETURN = { type: 'object', required: ['found', 'digest'], properties: { found: { type: 'boolean' }, digest: { type: 'string' } } }
  const SCHEMA_CONTEXT_SCOUT_RETURN = { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } }

  // Fixed, generic questions the dimension reviews benefit from having answered up front.
  // Capped at 2 per the 'full' tier's probe budget (D1).
  const CONTEXT_SCOUT_QUESTIONS = [
    'What is the test convention in this repo — framework, file layout, and how tests are run?',
    "What are this repo's core module boundaries — where business logic lives versus infrastructure/glue code?",
  ]

  function docsProbePrompt() {
    return `You are the Steward probing a repo for review-relevant documentation. Working
directory: ${worktreePath}.

Check whether each of these exists (relative to that directory): CLAUDE.md, AGENTS.md,
README* (repo root), CONTRIBUTING* (repo root), docs/**/*.md, and any path matching
*adr*/** anywhere in the tree (case-insensitive). Use ls/find — don't guess.

For whichever exist, read the ones most likely to hold review-relevant conventions
(coding style, testing conventions, architecture rules, PR expectations) — CLAUDE.md and
CONTRIBUTING* first — and extract at most 40 lines total, condensed rather than pasted
in full.

Return: found (the relative paths that exist, [] if none), digest (a markdown string,
<= 40 lines, the extracted conventions — empty string if nothing exists or nothing
review-relevant was found).`
  }

  function ticketProbePrompt(resolveResult) {
    const head = (resolveResult && resolveResult.head) || A.input.ref
    const prHint = resolveResult && resolveResult.prTitle
      ? `\n\nThis review also has a PR title/body to check for a ticket reference:\nTitle: ${resolveResult.prTitle}\nBody: ${resolveResult.prBody || ''}`
      : ''
    return `You are the Steward trying to locate a tracked ticket for an automated code
review. Working directory: ${A.repoRoot} (board wiring is repo-level state, not part of
the reviewed worktree).

Read .brigade/config.md for board wiring (source type, board id, identity). If it's
missing or unreadable, return found: false immediately — do not guess at a source.

Otherwise derive a ticket candidate from the branch/ref name "${head}"${prHint} (ticket
ids are typically embedded as a token in the branch name, e.g. between slashes or
dashes). If you find a plausible candidate, read its title, body, acceptance criteria,
and Activity thread using that source's adapter conventions
(skills/brigade/sources/<source>.md, or skills/brigade/sources/TEMPLATE.md for the
four-operation contract if a source-specific doc doesn't exist).

Soft-fail absolutely: no board wiring, no plausible candidate, or an unreadable ticket
all mean return found: false with a one-line reason in 'digest' — never throw, never
block the review over this.

Return: found (boolean), digest (markdown, <= 40 lines: ticket id/title, key acceptance
criteria, relevant Activity — empty string when found is false).`
  }

  function kbProbePrompt(cfg) {
    return `You are the Steward checking for live process heuristics for an automated
code review. Configured kb.cli: "${cfg.kb.cli}"; search_args: ${JSON.stringify(cfg.kb.search_args || [])}.

First confirm the CLI is actually on PATH (e.g. \`command -v ${cfg.kb.cli}\`). If it
isn't, or the search command fails for any reason, soft-fail: return found: false, no
error — this is expected on machines without the CLI installed.

Otherwise run it with exactly the configured search_args and summarize the most
review-relevant heuristics it returns, condensed to <= 20 lines.

Return: found (boolean), digest (markdown, <= 20 lines — empty string when found is
false).`
  }

  function contextScoutPrompt(question) {
    return `You are a brigade scout answering one question to help an automated code
review adapt to this repo's conventions. Working directory: ${worktreePath}.

Question: ${question}

Answer directly in <= 15 lines of plain markdown — no separate brief file needed, just
return the answer.`
  }

  // Markdown string, hard-capped at ~max lines (the packet's ~120-line digest budget).
  function capLines(text, max) {
    const lines = text.split('\n')
    return lines.length <= max ? text : `${lines.slice(0, max).join('\n')}\n...(truncated)`
  }

  async function probePhase(resolveResult) {
    const level = POLICY.probe // 'full' | 'docs+ticket' | 'docs'
    const sections = []
    let contextTier = 'bare'

    // Docs probe: every probe level runs this one.
    const docsResult = await agent(docsProbePrompt(), {
      label: 'probe-docs',
      phase: 'Probe',
      schema: SCHEMA_DOCS_PROBE_RETURN,
      agentType: POLICY.agents.steward,
      effort: STEWARD.effort,
    })
    if (docsResult && docsResult.found && docsResult.found.length > 0) {
      contextTier = 'documented'
      if (docsResult.digest) sections.push(`## Docs\n\nFound: ${docsResult.found.join(', ')}\n\n${docsResult.digest}`)
    } else {
      blog('inspector', 'Probe: no repo docs found — context tier stays bare unless a ticket is found.')
    }

    // Ticket probe: docs+ticket and full, and only when a board is actually configured.
    if ((level === 'docs+ticket' || level === 'full') && A.boardConfigured) {
      const ticketResult = await agent(ticketProbePrompt(resolveResult), {
        label: 'probe-ticket',
        phase: 'Probe',
        schema: SCHEMA_TICKET_PROBE_RETURN,
        agentType: POLICY.agents.steward,
        effort: STEWARD.effort,
      })
      if (ticketResult && ticketResult.found) {
        contextTier = 'tracked'
        if (ticketResult.digest) sections.push(`## Ticket\n\n${ticketResult.digest}`)
      } else {
        blog('inspector', `Probe: no tracked ticket found (${ticketResult ? ticketResult.digest || 'no reason given' : 'steward returned no result'}) — staying at the docs tier.`)
      }
    }

    // KB + context scouts: full tier only.
    if (level === 'full') {
      const cfg = A.overrides && A.overrides.config ? A.overrides.config : A.overrides || {}
      if (cfg.kb && cfg.kb.enabled && cfg.kb.cli) {
        const kbResult = await agent(kbProbePrompt(cfg), {
          label: 'probe-kb',
          phase: 'Probe',
          schema: SCHEMA_KB_PROBE_RETURN,
          agentType: POLICY.agents.steward,
          effort: STEWARD.effort,
        })
        if (kbResult && kbResult.found && kbResult.digest) sections.push(`## KB heuristics\n\n${kbResult.digest}`)
      }

      const scoutResults = await parallel(
        CONTEXT_SCOUT_QUESTIONS.map((q) => async () => agent(contextScoutPrompt(q), {
          label: `probe-scout:${q.slice(0, 24)}`,
          phase: 'Probe',
          schema: SCHEMA_CONTEXT_SCOUT_RETURN,
          agentType: POLICY.agents.scout,
        })),
      )
      for (const [i, r] of scoutResults.entries()) {
        if (r && r.answer) sections.push(`## Context: ${CONTEXT_SCOUT_QUESTIONS[i]}\n\n${r.answer}`)
      }
    }

    const digestPath = `${A.repoRoot}/.brigade/reviews/${A.reviewSlug}/context.md`
    const body = sections.length
      ? sections.join('\n\n')
      : 'No documentation, ticket, KB heuristics, or context-scout answers were available for this review.'
    const digest = capLines(`# Review context — ${A.reviewSlug}\n\nContext tier: ${contextTier}\n\n${body}`, 120)

    const writeResult = await agent(
      `You are the Steward writing a finished context digest to disk — do not change a
single character of the content below, just write it verbatim.

Write exactly this content to ${digestPath} (create parent directories as needed):

---BEGIN CONTENT---
${digest}
---END CONTENT---

Return the steward result: ok, detail.`,
      { label: 'probe-write-digest', phase: 'Probe', schema: SCHEMA_STEWARD_RETURN, agentType: POLICY.agents.steward, effort: STEWARD.effort },
    )
    if (!writeResult || !writeResult.ok) {
      blog('inspector', `Probe: failed to write context digest to ${digestPath}: ${writeResult ? writeResult.detail : 'no result from steward'}`)
    }

    return { contextTier, digest, digestPath }
  }

  // ---- Review: dispatch dimension lenses per REVIEW_POLICY[tier].dispatch (D1) ----
  //
  // Dispatch shape only ever branches on POLICY.dispatch/POLICY.groups/POLICY.product —
  // never on A.tier directly, so a config layer that retunes REVIEW_POLICY (or the
  // dimension set, via resolveReviewDimensions) is honored without touching this file.

  // Schema forced on each Review dispatch: just the `findings` slice of the shared
  // SCHEMA_REVIEW_RETURN (config.js) — a single dispatch never knows the whole
  // review's contextTier or reportPath, only the findings its lens(es) turned up.
  const SCHEMA_REVIEW_FINDINGS_RETURN = { type: 'object', required: ['findings'], properties: { findings: SCHEMA_REVIEW_RETURN.properties.findings } }

  const SCHEMA_VERIFY_VOTE_RETURN = { type: 'object', required: ['refuted'], properties: { refuted: { type: 'boolean' }, note: { type: 'string' } } }

  // Batch non-product dimensions into dispatch groups per POLICY.dispatch:
  //   'per-dimension' -> one dispatch per resolved dimension (custom/added dimensions
  //     fall out of this for free, since it just maps over whatever resolveReviewDimensions
  //     returned).
  //   'merged'        -> a single dispatch carrying every resolved dimension's lens.
  //   'grouped'       -> POLICY.groups' id lists, filtered down to dimensions still
  //     active after config overrides; any dimension a config layer added that isn't
  //     named in any built-in group gets its own extra group rather than being dropped.
  function buildDispatchGroups(nonProductDims, dispatch, policyGroups) {
    if (dispatch === 'per-dimension') return nonProductDims.map((d) => [d])
    if (dispatch === 'merged') return nonProductDims.length ? [nonProductDims] : []

    const byId = new Map(nonProductDims.map((d) => [d.id, d]))
    const mentioned = new Set()
    const groups = []
    for (const idList of policyGroups) {
      const objs = []
      for (const id of idList) {
        if (id === 'product' || !byId.has(id)) continue
        mentioned.add(id)
        objs.push(byId.get(id))
      }
      if (objs.length) groups.push(objs)
    }
    for (const d of nonProductDims) {
      if (!mentioned.has(d.id)) groups.push([d])
    }
    return groups
  }

  // D1's product gating: 'always' runs unconditionally (three-star), 'with-source'
  // only when a requirements source actually exists (tracked ticket or a non-empty PR
  // body), 'never' never runs.
  function productShouldRun(policyProduct, contextTier, prBody) {
    if (policyProduct === 'always') return true
    if (policyProduct === 'with-source') return contextTier === 'tracked' || !!(prBody && prBody.trim())
    return false
  }

  // The no-requirements caveat only fires for 'always' tiers reviewing without a real
  // source — 'with-source' tiers never dispatch product without one, so they never need it.
  function productCaveatNeeded(policyProduct, contextTier, prBody) {
    return policyProduct === 'always' && contextTier !== 'tracked' && !(prBody && prBody.trim())
  }

  function mode3Prompt(dimsGroup, range, digest, productCaveat) {
    const lensBlock = dimsGroup
      .map((d) => `### ${d.title} (dimension id: "${d.id}")\n\n${d.lens}`)
      .join('\n\n')
    const caveatBlock = productCaveat
      ? `\nNo requirements source was found for this review (no tracked ticket, no PR body). Open your product-dimension findings with an explicit "no requirements source" note — you are reviewing against the PR/commit's stated intent instead of a spec, and the reader needs to know the bar was inferred, not given.\n`
      : ''
    return `You are the Inspector running Mode 3 (standalone diff review — advisory, no
packet, no PASS/FAIL) for an automated code review.

Worktree (read-only — never write, never run a command that writes): ${worktreePath}
Range: ${range}

Read the full diff first, every changed file, not a sample:
  git -C ${worktreePath} diff ${range}

Context digest gathered for this review (docs, ticket text, KB heuristics) — use it
for intent where the diff alone is ambiguous, but it is not a substitute for reading
the actual diff:

${digest}

Review against ${dimsGroup.length > 1 ? 'EACH of the following dimension lenses' : 'this dimension lens'} — hunt only what it covers:

${lensBlock}
${caveatBlock}
Report findings, not a verdict. Each finding: id (short string, unique within your
return), severity (blocking|high|medium|low), location ("file:line"), summary (one
line), dimension (the exact dimension id above that produced it — never a group
label), fix (a concrete fix direction phrased as acceptance criteria, e.g. "X must
do Y"), verify (how a cook would confirm the fix landed). Specific and falsifiable —
no "consider improving". Return findings: [] if a lens turns up nothing.

Return per the schema you were given: { findings: [...] }.`
  }

  const SEVERITY_RANK = { blocking: 4, high: 3, medium: 2, low: 1 }

  // Merge findings that land on the same location: keep the highest severity's
  // summary/fix/verify, union the dimension list into one comma-joined string.
  function dedupFindings(findings) {
    const byLocation = new Map()
    const order = []
    for (const f of findings) {
      if (!f || !f.location) continue
      const existing = byLocation.get(f.location)
      if (!existing) {
        byLocation.set(f.location, { ...f })
        order.push(f.location)
        continue
      }
      const merged = { ...existing }
      if ((SEVERITY_RANK[f.severity] || 0) > (SEVERITY_RANK[existing.severity] || 0)) {
        merged.severity = f.severity
        merged.summary = f.summary
        merged.fix = f.fix
        merged.verify = f.verify
      }
      const dims = new Set(String(existing.dimension || '').split(',').map((s) => s.trim()).filter(Boolean))
      if (f.dimension) dims.add(f.dimension)
      merged.dimension = Array.from(dims).join(', ')
      byLocation.set(f.location, merged)
    }
    return order.map((loc) => byLocation.get(loc))
  }

  async function reviewPhase(resolveResult, probeResult) {
    // Always go through resolveReviewDimensions(A.overrides) here, never read the
    // built-in REVIEW_DIMENSIONS array directly — a config layer may retune a lens,
    // disable a dimension, or add a custom one (config.js's B2 foldin), and only the
    // resolver folds that in.
    const dimensions = resolveReviewDimensions(A.overrides)
    const nonProductDims = dimensions.filter((d) => d.id !== 'product')
    const productDim = dimensions.find((d) => d.id === 'product')

    const groups = buildDispatchGroups(nonProductDims, POLICY.dispatch, POLICY.groups)

    const runProduct = !!productDim && productShouldRun(POLICY.product, probeResult.contextTier, resolveResult.prBody)
    const caveatNeeded = runProduct && productCaveatNeeded(POLICY.product, probeResult.contextTier, resolveResult.prBody)

    if (runProduct) {
      // 'merged' folds product's lens into the same single dispatch (B1 foldin);
      // per-dimension/grouped give it its own dispatch (D1's conditional 5th group).
      if (POLICY.dispatch === 'merged' && groups.length) {
        groups[groups.length - 1] = [...groups[groups.length - 1], productDim]
      } else {
        groups.push([productDim])
      }
    }

    if (!groups.length) {
      blog('inspector', 'Review: no active dimensions to dispatch (all disabled by config).')
      return { findings: [] }
    }

    const dispatchResults = await parallel(
      groups.map((group) => async () => agent(
        withPromptOverrides(
          mode3Prompt(group, resolveResult.range, probeResult.digest, caveatNeeded && group.some((d) => d.id === 'product')),
          PROMPT_EXTRAS.inspector,
        ),
        {
          label: `review:${group.map((d) => d.id).join('+')}`,
          phase: 'Review',
          schema: SCHEMA_REVIEW_FINDINGS_RETURN,
          agentType: POLICY.agents.inspector,
        },
      )),
    )

    const rawFindings = []
    for (const [i, r] of dispatchResults.entries()) {
      if (r && r.findings) rawFindings.push(...r.findings)
      else blog('inspector', `Review dispatch for [${groups[i].map((d) => d.id).join('+')}] returned no result — treated as zero findings.`)
    }

    return { findings: dedupFindings(rawFindings) }
  }

  // ---- Verify: adversarial refute pass per REVIEW_POLICY[tier].verify (D1) ----
  //
  // Every eligible finding gets `votes` independent inspectors trying to REFUTE it —
  // default refuted when the evidence doesn't hold. A finding dies only when every
  // vote refutes it; surviving with at least one (but not all) refute is reported
  // 'unconfirmed' (confirmed: false) rather than dropped or silently trusted.
  function refutePrompt(finding, range) {
    return `You are the Inspector running a Verify pass on ONE finding from an
automated code review (Mode 3 continuation — still advisory, no packet). Your job
is to try to REFUTE this finding against the actual worktree. Default to refuted
when the evidence does not hold up — only return refuted: false when you
independently confirm the defect is real.

Worktree (read-only): ${worktreePath}
Range: ${range}

Finding to check:
  id: ${finding.id}
  dimension: ${finding.dimension}
  severity: ${finding.severity}
  location: ${finding.location}
  summary: ${finding.summary}
  fix: ${finding.fix || '(none provided)'}

Read the actual code at that location in the worktree — not just the summary
above — and decide whether the described defect genuinely holds. Return refuted
(boolean) and a one-line note explaining your call.`
  }

  async function verifyPhase(reviewResult, resolveResult) {
    const { severities, votes } = POLICY.verify
    const findings = reviewResult.findings || []

    if (votes === 0 || !severities.length) {
      blog('inspector', `Verify: this tier's policy runs no refute pass (votes: ${votes}) — all findings stay unconfirmed.`)
      return { findings: findings.map((f) => ({ ...f, confirmed: null })) }
    }

    const eligible = findings.filter((f) => severities.includes(f.severity))
    const ineligible = findings.filter((f) => !severities.includes(f.severity))

    const tasks = []
    for (const f of eligible) {
      for (let v = 0; v < votes; v += 1) tasks.push({ finding: f, voteIndex: v })
    }

    const voteResults = await parallel(
      tasks.map((t) => async () => agent(
        withPromptOverrides(refutePrompt(t.finding, resolveResult.range), PROMPT_EXTRAS.inspector),
        {
          label: `verify:${t.finding.id}:${t.voteIndex + 1}`,
          phase: 'Verify',
          schema: SCHEMA_VERIFY_VOTE_RETURN,
          agentType: POLICY.agents.inspector,
        },
      )),
    )

    const refuteFlagsById = new Map()
    tasks.forEach((t, i) => {
      const r = voteResults[i]
      if (!r) blog('inspector', `Verify: vote ${t.voteIndex + 1} for finding ${t.finding.id} returned no result — treated as non-refuting.`)
      const list = refuteFlagsById.get(t.finding.id) || []
      list.push(!!(r && r.refuted))
      refuteFlagsById.set(t.finding.id, list)
    })

    const survivors = []
    for (const f of eligible) {
      const flags = refuteFlagsById.get(f.id) || []
      const refuteCount = flags.filter(Boolean).length
      if (refuteCount >= votes) {
        blog('inspector', `Verify: finding ${f.id} refuted by all ${votes} vote(s) — dropped.`)
        continue
      }
      survivors.push({ ...f, confirmed: refuteCount === 0 })
    }

    return { findings: [...survivors, ...ineligible.map((f) => ({ ...f, confirmed: null }))] }
  }

  async function reportPhase(verifyResult, probeResult) {
    blog('inspector', 'Report stub: review_report assembly is not implemented yet.')
    return { findings: verifyResult.findings, contextTier: probeResult.contextTier, reportPath: null }
  }

  try {
    const resolveResult = await agent(
      withPromptOverrides(resolvePrompt(), (A.promptOverrides || {}).steward),
      {
        label: 'steward-resolve',
        phase: 'Resolve',
        schema: SCHEMA_RESOLVE_RETURN,
        agentType: POLICY.agents.steward,
        effort: STEWARD.effort,
      },
    )

    if (!resolveResult || !resolveResult.ok) {
      const message = resolveResult ? resolveResult.error : 'steward-resolve returned no result'
      blog('inspector', `Resolve failed for ${A.input.kind} input "${A.input.ref}": ${message}`)
      return { findings: [], contextTier: 'bare', reportPath: null, error: message }
    }

    phase('Probe')
    const probeResult = await probePhase(resolveResult)
    phase('Review')
    const reviewResult = await reviewPhase(resolveResult, probeResult)
    phase('Verify')
    const verifyResult = await verifyPhase(reviewResult, resolveResult)
    phase('Report')
    return await reportPhase(verifyResult, probeResult)
  } finally {
    await cleanupWorktree()
  }
})()
// GENERATED by bin/brigade-bundle from workflows/src/brigade-review.js — edit the source, then re-run bin/brigade-bundle
