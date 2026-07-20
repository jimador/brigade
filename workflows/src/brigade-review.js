export const meta = {
  name: 'brigade-review',
  description: 'Reviews a branch, PR, or commit range along named dimensions, scaling depth to tier and available context.',
  phases: [{ title: 'Resolve' }, { title: 'Probe' }, { title: 'Review' }, { title: 'Verify' }, { title: 'Report' }],
}

//@BRIGADE_CONFIG@
// The harness sometimes hands us args as a JSON string instead of an object — normalize once, up front.
const A = typeof args === 'string' ? JSON.parse(args) : args

// Text an operator's config layers add to every inspector dispatch (Review + Verify).
const PROMPT_EXTRAS = A.promptOverrides || {}

// ---- Report assembly (pure, top-level — extractable via
// `new Function(src + '; return buildReviewReportMarkdown')()`, the same pattern
// test/regression.sh already uses on config.js's pure functions) so a cook or test can
// exercise it directly against a synthetic findings fixture, without spinning up an agent. ----

const REPORT_SEVERITY_RANK = { blocking: 4, high: 3, medium: 2, low: 1 }

// A finding's free-text fields travel through YAML flow-mapping as JSON-style quoted
// strings — valid YAML, and it sidesteps colons/quotes in a summary breaking the parse.
function yamlQuote(value) {
  return JSON.stringify(String(value == null ? '' : value))
}

function findingFrontmatterLine(f) {
  const file = f.location ? String(f.location).split(':')[0] : ''
  const confirmed = f.confirmed === true ? 'true' : f.confirmed === false ? 'false' : 'null'
  return `  - { id: ${f.id}, dimension: ${yamlQuote(f.dimension)}, severity: ${f.severity}, location: ${yamlQuote(f.location)}, summary: ${yamlQuote(f.summary)}, files: [${file}], fix: ${yamlQuote(f.fix || '')}, verify_hint: ${yamlQuote(f.verify || '')}, confirmed: ${confirmed} }`
}

function reportCounts(findings) {
  const counts = { blocking: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) if (counts[f.severity] != null) counts[f.severity] += 1
  return counts
}

// Groups by dimension (a finding can carry more than one, comma-joined, after Review's
// dedup) in first-seen order, severity descending within each group — "grouped by
// severity within dimension" per the packet.
function groupFindingsByDimension(findings) {
  const order = []
  const byDim = new Map()
  for (const f of findings) {
    const key = f.dimension || 'unspecified'
    if (!byDim.has(key)) {
      byDim.set(key, [])
      order.push(key)
    }
    byDim.get(key).push(f)
  }
  for (const key of order) byDim.get(key).sort((a, b) => (REPORT_SEVERITY_RANK[b.severity] || 0) - (REPORT_SEVERITY_RANK[a.severity] || 0))
  return order.map((dimension) => ({ dimension, findings: byDim.get(dimension) }))
}

// What this context tier could and couldn't see — the packet's three fixed disclosures.
const CONTEXT_DISCLOSURE = {
  bare: 'No repo conventions/documentation and no requirements source were found for this review — findings rely on generic engineering judgment only, with no repo-specific convention check and no acceptance-criteria check.',
  documented: "Repo conventions/documentation were available for this review, but no requirements source (tracked ticket or PR body) was found — any product-dimension findings are judged against the PR/commit's inferred intent, not a stated requirement.",
  tracked: "Full context was available for this review: repo conventions/documentation and a tracked requirements source — findings, including product-dimension ones, are judged against that source's stated acceptance criteria.",
}

// Keeps the report's BODY (frontmatter is exempt) under brigade-validate's review_report
// budget even on an unusually finding-heavy review — truncate, don't silently overflow.
function capBodyLines(lines, max) {
  let nonEmpty = 0
  const out = []
  for (const line of lines) {
    if (line.trim() !== '') nonEmpty += 1
    if (nonEmpty > max) {
      out.push('...(truncated — see the full findings set in the workflow run)')
      break
    }
    out.push(line)
  }
  return out
}

function buildReviewReportMarkdown(params) {
  const {
    reviewSlug, tier, model, now, input, range, contextTier, findings, productCaveatFired, evidence,
  } = params
  const counts = reportCounts(findings)
  const groups = groupFindingsByDimension(findings)

  const fm = [
    '---',
    'doc: review_report',
    'schema: 1',
    'role: inspector',
    `model: ${model}`,
    `created: ${now}`,
    `input: { kind: ${input.kind}, ref: ${yamlQuote(input.ref)} }`,
    `range: ${range}`,
    `context_tier: ${contextTier}`,
    `tier: ${tier}`,
    `counts: { blocking: ${counts.blocking}, high: ${counts.high}, medium: ${counts.medium}, low: ${counts.low} }`,
    'findings:',
    ...(findings.length ? findings.map(findingFrontmatterLine) : ['  []']),
    '---',
  ]

  const body = []
  body.push(
    '## Scope',
    '',
    `Reviewed ${input.kind} input "${input.ref}" (range ${range}), review slug \`${reviewSlug}\`, tier ${tier}. Context tier: ${contextTier}.`,
    '',
    '## Findings',
    '',
  )
  if (!groups.length) {
    body.push('No findings surfaced by this review.', '')
  } else {
    for (const g of groups) {
      body.push(`### ${g.dimension}`, '')
      for (const f of g.findings) {
        const confirmedNote = f.confirmed === true ? 'confirmed' : f.confirmed === false ? 'unconfirmed — one refute vote survived' : 'unverified — no verify pass at this tier'
        body.push(`- **[${f.severity}]** ${f.id} — \`${f.location}\` — ${f.summary} (${confirmedNote})`)
      }
      body.push('')
    }
  }
  body.push('## Context disclosure', '', CONTEXT_DISCLOSURE[contextTier] || CONTEXT_DISCLOSURE.bare, '')
  if (productCaveatFired) {
    body.push("No requirements source was found — any product-dimension findings above were judged against the PR/commit's stated intent, not a spec.", '')
  }
  body.push('## Evidence', '')
  for (const line of evidence) body.push(`- ${line}`)

  return `${fm.join('\n')}\n\n${capBodyLines(body, 220).join('\n')}\n`
}

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
  const SCHEMA_TICKET_PROBE_RETURN = { type: 'object', required: ['found', 'digest'], properties: { found: { type: 'boolean' }, digest: { type: 'string' }, ticketId: { type: 'string' } } }
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

Return: found (boolean), ticketId (the exact ticket id/key you resolved, e.g.
"BOARD-123" — empty string when found is false; the Report phase needs this exact id to
mirror a comment back to the same ticket), digest (markdown, <= 40 lines: ticket id/title,
key acceptance criteria, relevant Activity — empty string when found is false).`
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
    let ticketId = null

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
        if (ticketResult.ticketId) ticketId = ticketResult.ticketId
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

    return { contextTier, digest, digestPath, ticketId }
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

    const deduped = dedupFindings(rawFindings)
    return { findings: deduped, rawCount: rawFindings.length, dedupCount: deduped.length }
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
      return { findings: findings.map((f) => ({ ...f, confirmed: null })), dropped: [] }
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

    // Keyed by the finding OBJECT itself (Map supports object identity as a key), never
    // by finding.id — id strings are only unique within a single dispatch's own return
    // (each of the parallel per-dimension/group/merged Review calls hands out its own
    // "F1", "F2", ... independently), so two eligible findings from different dispatches
    // can easily share an id. Keying by id would merge their vote tallies together and
    // silently corrupt the votes=2/1/0 semantics; keying by the object reference can't
    // collide, since `eligible` and `tasks` both point at the exact same finding objects.
    const refuteFlagsByFinding = new Map()
    tasks.forEach((t, i) => {
      const r = voteResults[i]
      if (!r) blog('inspector', `Verify: vote ${t.voteIndex + 1} for finding ${t.finding.id} returned no result — treated as non-refuting.`)
      const list = refuteFlagsByFinding.get(t.finding) || []
      list.push(!!(r && r.refuted))
      refuteFlagsByFinding.set(t.finding, list)
    })

    const survivors = []
    const dropped = []
    for (const f of eligible) {
      const flags = refuteFlagsByFinding.get(f) || []
      const refuteCount = flags.filter(Boolean).length
      if (refuteCount >= votes) {
        blog('inspector', `Verify: finding ${f.id} refuted by all ${votes} vote(s) — dropped.`)
        dropped.push({ ...f, confirmed: false })
        continue
      }
      survivors.push({ ...f, confirmed: refuteCount === 0 })
    }

    return { findings: [...survivors, ...ineligible.map((f) => ({ ...f, confirmed: null }))], dropped }
  }

  // ---- Report: assemble + write review_report, mirror to the board when a ticket was
  // resolved, return the workflow ledger (D2/D1's final phase) ----

  function boardMirrorPrompt(ticketId, countsLine) {
    return `You are the Steward posting a short review-complete comment to a tracked
ticket after an automated code review. Working directory: ${A.repoRoot} (board wiring is
repo-level state, not part of the reviewed worktree).

Read .brigade/config.md for board wiring (source type, board id, identity). If it's
missing or unreadable, soft-fail: return ok: false with a one-line reason in 'detail' —
do not guess at a source, and never let this step fail the review itself.

Otherwise post a comment to ticket "${ticketId}" using that source's adapter conventions
(skills/brigade/sources/<source>.md Op 4 — Post a comment — or
skills/brigade/sources/TEMPLATE.md if a source-specific doc doesn't exist). Post exactly
this human-facing text, verbatim:

"${countsLine} — review report available in the session."

Never include a local filesystem path in the comment. Never post anything to a pull
request — this is a ticket/board comment only, never a PR comment or PR review.

Return the steward result: ok, detail.`
  }

  // Concrete resolve/probe/review/verify facts this review actually produced — the
  // report's "commands run with key output lines," built from real return values rather
  // than paraphrase.
  function buildEvidenceLines(resolveResult, probeResult, reviewResult, verifyResult) {
    const lines = []
    if (A.input.kind === 'pr') {
      lines.push(`gh pr view ${prNumber} --json number,title,body,headRefName,baseRefName; git fetch ${remote} pull/${prNumber}/head:${prReviewRef} -> resolved`)
    } else if (A.input.kind === 'range') {
      lines.push(`git rev-parse <both endpoints of "${A.input.ref}"> -> both resolved`)
    } else {
      lines.push(`git merge-base ${A.mainLine} ${A.input.ref} -> base ${resolveResult.base}`)
    }
    lines.push(`range resolved: ${resolveResult.range}`)
    lines.push(`context probe (level: ${POLICY.probe}): tier=${probeResult.contextTier}, digest written to ${probeResult.digestPath}`)
    lines.push(`review dispatch (${POLICY.dispatch}): ${reviewResult.rawCount} raw finding(s) -> ${reviewResult.dedupCount} after location dedup`)
    lines.push(`verify pass (severities=${POLICY.verify.severities.join(', ') || 'none'}, votes=${POLICY.verify.votes}): ${verifyResult.findings.length} survived, ${(verifyResult.dropped || []).length} dropped (refuted by all votes)`)
    return lines
  }

  async function reportPhase(verifyResult, probeResult, resolveResult, reviewResult) {
    const contextTier = probeResult.contextTier
    const findings = verifyResult.findings || []
    const dropped = verifyResult.dropped || []
    const unconfirmed = findings.filter((f) => f.confirmed === false)
    const counts = reportCounts(findings)

    const productCaveatFired = productCaveatNeeded(POLICY.product, contextTier, resolveResult.prBody)
      && findings.some((f) => String(f.dimension || '').split(',').map((s) => s.trim()).includes('product'))

    const evidence = buildEvidenceLines(resolveResult, probeResult, reviewResult, verifyResult)

    const markdown = buildReviewReportMarkdown({
      reviewSlug: A.reviewSlug,
      tier: A.tier,
      model: POLICY.agents.inspector,
      now: A.now,
      input: A.input,
      range: resolveResult.range,
      contextTier,
      findings,
      productCaveatFired,
      evidence,
    })

    const reportPath = `${A.repoRoot}/.brigade/reviews/${A.reviewSlug}/report.md`
    const writeResult = await agent(
      `You are the Steward writing a finished review report to disk — do not change a
single character of the content below, just write it verbatim.

Write exactly this content to ${reportPath} (create parent directories as needed):

---BEGIN CONTENT---
${markdown}
---END CONTENT---

Return the steward result: ok, detail.`,
      { label: 'report-write', phase: 'Report', schema: SCHEMA_STEWARD_RETURN, agentType: POLICY.agents.steward, effort: STEWARD.effort },
    )
    if (!writeResult || !writeResult.ok) {
      blog('inspector', `Report: failed to write review report to ${reportPath}: ${writeResult ? writeResult.detail : 'no result from steward'}`)
    }

    // Board mirror only fires when the probe actually resolved a tracked ticket — never
    // for bare/documented tiers, and never onto a PR.
    if (A.boardConfigured && contextTier === 'tracked' && probeResult.ticketId) {
      const countsLine = `Automated code review complete: ${counts.blocking} blocking, ${counts.high} high, ${counts.medium} medium, ${counts.low} low finding(s)`
      const mirrorResult = await agent(
        boardMirrorPrompt(probeResult.ticketId, countsLine),
        { label: 'report-board-mirror', phase: 'Report', schema: SCHEMA_STEWARD_RETURN, agentType: POLICY.agents.steward, effort: STEWARD.effort },
      )
      if (!mirrorResult || !mirrorResult.ok) {
        blog('inspector', `Report: board mirror comment failed (non-fatal, review still completed): ${mirrorResult ? mirrorResult.detail : 'no result from steward'}`)
      }
    }

    return { reportPath, contextTier, counts, findings, unconfirmed, dropped }
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
    return await reportPhase(verifyResult, probeResult, resolveResult, reviewResult)
  } finally {
    await cleanupWorktree()
  }
})()
