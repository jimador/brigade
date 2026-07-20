export const meta = {
  name: 'brigade-research',
  description: 'Fans research questions out to scouts in parallel and collects their structured briefs.',
  phases: [{ title: 'Scout' }],
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
}
// The harness sometimes hands us args as a JSON string instead of an object — normalize once, up front.
const A = typeof args === 'string' ? JSON.parse(args) : args

// Everything below runs inside a single async IIFE (rather than top-level await) so this file
// stays valid under a plain CommonJS-style syntax check as well as the Workflow runtime.
return (async () => {
  phase('Scout')

  // Tier policy first, then the operator's config layers folded over it.
  const POLICY = resolvePolicy(A.tier, A.overrides)

  // Never dispatch more scouts than the resolved policy allows. Anything beyond the cap
  // is dropped, but we log exactly what got dropped so it isn't a silent decomposition gap.
  const cap = POLICY.scoutCap
  const allQuestions = A.questions || []
  const kept = allQuestions.slice(0, cap)
  const droppedQuestions = allQuestions.slice(cap)

  if (droppedQuestions.length > 0) {
    blog('scout', `Scout cap (${cap}) for tier '${A.tier}' reached — dropping ${droppedQuestions.length} question(s): ${droppedQuestions.map((q) => `#${q.n} (${q.topic})`).join(', ')}`)
  }

  // One scout per kept question, run in parallel. Each scout gets everything it needs to work
  // standalone — it never sees the planning conversation that produced the question.
  function scoutPrompt(q) {
    const briefPath = `${A.dishDir}/briefs/${q.n}-${q.topic}.md`
    return `You are a brigade scout. Answer exactly one research question and write your brief to disk — don't just return the answer inline.

Repo root: ${A.repoRoot}

Question: ${q.question}

Why this question is being asked: ${q.why}

Web sources allowed: ${q.allowWeb ? 'yes' : 'no'}

Write your brief to: ${briefPath}
Use this timestamp for the brief's \`created:\` field: ${A.now}

Brief schema and body sections:

${MD_SCHEMA_BLOCKS.brief}

Budget: the brief body must be ≤ 150 lines.`
  }

  // Text the operator's config layers add to every scout dispatch.
  const scoutExtras = (A.promptOverrides || {}).scout

  const results = await parallel(
    kept.map((q) => async () => agent(withPromptOverrides(scoutPrompt(q), scoutExtras), {
      label: `scout:${q.topic}`,
      phase: 'Scout',
      schema: SCHEMA_BRIEF_RETURN,
      agentType: POLICY.agents.scout,
    })),
  )

  // A thunk error or a schema-skipped/dead agent both resolve to null here — either way it's a failed
  // scout, not a crash. Filter those out of the briefs and count them so the caller can see the gap.
  const briefs = []
  let failed = 0
  for (const [i, r] of results.entries()) {
    const q = kept[i]
    if (r) {
      briefs.push({
        n: q.n,
        topic: q.topic,
        answer: r.answer,
        confidence: r.confidence,
        briefPath: r.briefPath,
        notVerified: r.notVerified,
      })
    } else {
      failed += 1
      blog('scout', `Scout for #${q.n} (${q.topic}) returned no result — counted as failed.`)
    }
  }

  return { briefs, dropped: droppedQuestions.length, failed }
})()
// GENERATED by bin/brigade-bundle from workflows/src/brigade-research.js — edit the source, then re-run bin/brigade-bundle
