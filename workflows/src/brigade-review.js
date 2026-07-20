export const meta = {
  name: 'brigade-review',
  description: 'Reviews a branch, PR, or commit range along named dimensions, scaling depth to tier and available context.',
  phases: [{ title: 'Resolve' }, { title: 'Probe' }, { title: 'Review' }, { title: 'Verify' }, { title: 'Report' }],
}

//@BRIGADE_CONFIG@
// The harness sometimes hands us args as a JSON string instead of an object — normalize once, up front.
const A = typeof args === 'string' ? JSON.parse(args) : args

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

  async function reviewPhase() {
    blog('inspector', 'Review stub: dimension dispatch is not implemented yet.')
    return { findings: [] }
  }

  async function verifyPhase(reviewResult) {
    blog('inspector', 'Verify stub: refute-pass verification is not implemented yet.')
    return reviewResult
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
    const reviewResult = await reviewPhase()
    phase('Verify')
    const verifyResult = await verifyPhase(reviewResult)
    phase('Report')
    return await reportPhase(verifyResult, probeResult)
  } finally {
    await cleanupWorktree()
  }
})()
