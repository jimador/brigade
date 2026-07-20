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

  // Later phases are stubs for now — real dimension dispatch, verification, and report
  // assembly land in follow-on packets. Each stub still logs so a run of this workflow shows
  // every phase happened, even though nothing found anything yet.
  async function probePhase() {
    blog('inspector', `Probe stub: context gathering for tier '${A.tier}' (boardConfigured: ${!!A.boardConfigured}) is not implemented yet.`)
    return { contextTier: 'bare' }
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
    const probeResult = await probePhase()
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
