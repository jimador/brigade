export const meta = {
  name: 'brigade-execute',
  description: "Runs the cook, inspect, escalate, and land DAG for one dish's work items.",
  phases: [{ title: 'Cook' }, { title: 'Inspect' }, { title: 'Land' }],
}

//@BRIGADE_CONFIG@
const A = typeof args === 'string' ? JSON.parse(args) : args

// Tier policy first, then the operator's config layers folded over it: cook and
// inspector agent types, parallelism, and the circuit-breaker thresholds are all
// overridable without touching this script.
const POLICY = resolvePolicy(A.tier, A.overrides)
const PROMPT_EXTRAS = A.promptOverrides || {}

// Every run gets one fixed stamp (A.now) from the harness. The runtime forbids
// reading the wall clock or generating randomness directly, so every timestamp
// below comes from A.now — never a fresh read — and replays stay deterministic.

const gateBlock = () => A.gate.map((cmd) => `  ${cmd}`).join('\n')

const findingsHistoryBlock = (findingsHistory) => {
  if (findingsHistory.length === 0) return ''
  const rounds = findingsHistory
    .map((round) => {
      const lines = round.findings
        .map((f) => `- [${f.severity}] ${f.id} (${f.location}): ${f.summary}`)
        .join('\n')
      return `### Attempt ${round.attempt + 1} (${round.agentType}) findings\n${lines || '(no findings recorded)'}`
    })
    .join('\n\n')
  return `\nPrior attempts on this item failed inspection. Address every finding below.\nIf the approach itself was the problem, change it rather than repeating it harder.\n\n${rounds}\n`
}

const ledgerPath = (item) => `${A.dishDir}/state/${item.slug}.md`

const ledgerBlock = (item, attemptIndex) => {
  if (!POLICY.workingMemory) return ''
  if (!item.heavy && attemptIndex === 0) return ''
  return `
WORKING MEMORY — this dispatch carries a ledger (heavy item or rework attempt):
  Ledger file: ${ledgerPath(item)}
  If it exists, READ IT FIRST — it is the prior attempt's verified state.
  If not, create it and seed Canon from the packet before your first edit.
  Follow the cadence in your agent instructions. Ledger schema:
${MD_SCHEMA_BLOCKS.ledger}
`
}

const cookPrompt = (item, agentType, worktreePath, branch, reportPath, verdictPath, findingsHistory, attemptIndex) => `
You are cooking ONE work packet in an automated cook/inspect/land pipeline.

WORKTREE (work ONLY here, never the main checkout): ${worktreePath}
Branch already checked out there: ${branch}
Repo root: ${A.repoRoot}
Attempt: ${attemptIndex + 1} of this item's ladder
Stamp for report frontmatter (created:): ${A.now}

Write your cook report to: ${reportPath}
That file MUST exist on disk with doc: report frontmatter before you return —
returning a path you did not actually write is a failed attempt.
An Inspector will read that report and write its verdict to: ${verdictPath}

Verification gate — run every command, paste the real output as evidence:
${gateBlock()}
${findingsHistoryBlock(findingsHistory)}
${ledgerBlock(item, attemptIndex)}
THE PACKET (your entire contract):

${item.packet}

Report schema — follow this shape exactly:
${MD_SCHEMA_BLOCKS.report}
`

const inspectorPrompt = (item, worktreePath, branch, reportPath, verdictPath, ledgered) => `
You are the Inspector reviewing ONE cooked work packet before it lands.

WORKTREE: ${worktreePath}
Branch: ${branch}
Repo root: ${A.repoRoot}
Stamp for verdict frontmatter (created:): ${A.now}

THE PACKET the cook worked against:

${item.packet}

Cook's report: ${reportPath}
FIRST verify that report file exists with doc: report frontmatter (head -3 it).
Missing file or wrong doc type = automatic FAIL with a blocking finding (id A0,
location: the missing path) — inspect nothing else first.
Write your verdict to: ${verdictPath}

Verification gate the cook should have run — check the evidence is real, not paraphrased:
${gateBlock()}

${ledgered ? `Working-memory ledger — audit it: ${ledgerPath(item)}. Canon must match the packet; a missing, stale (updated: predates the final commit), or Canon-edited ledger is a finding.\n` : ''}
Rule PASS or FAIL with severity-ranked findings. Your report is information for the
next cook or the planner — you never implement fixes yourself, and you never edit
any file in the worktree.

Verdict schema — follow this shape exactly:
${MD_SCHEMA_BLOCKS.verdict}
`

const stewardCreatePrompt = (worktreePath, branch) => `
You are the Steward preparing a worktree for one work item, before any cook runs.

Run:
  git -C ${A.repoRoot} worktree add ${worktreePath} -b ${branch} ${A.deliveryBranch}

If that fails because the worktree or branch already exists, this item is being
reworked — do not treat that as an error. Instead verify the worktree exists at
${worktreePath} and that ${branch} is checked out there, and return ok: true.
Any other failure is real: return ok: false with the actual error in detail.

You never run git add or git commit, never touch any file outside .brigade/, and
never push. Return the result per the steward schema.
`

const stewardLandPrompt = (worktreePath, branch, verdictPath) => `
You are the Steward landing ONE finished, passed work item. Follow these steps in
order and stop at the first failure.

1. Stand-down contamination check — run:
     git -C ${A.repoRoot} status --porcelain
   Any modified or untracked file OUTSIDE .brigade/ is contamination. If you see
   one, do NOT land: return ok: false, contamination: true, and describe what you
   found in detail.

1b. Artifact check — run: head -3 ${verdictPath} — it must exist and its
   frontmatter must start doc: verdict. If it is missing or the doc type is wrong,
   treat that as the artifact-missing outcome: do NOT land, return ok: false with
   detail naming the missing artifact (never treat the failing head as a shell error
   to retry).

2. Rebase the item branch onto the delivery branch:
     git -C ${worktreePath} rebase ${A.deliveryBranch}

3. Fast-forward the delivery worktree onto the item branch:
     git -C ${A.repoRoot}/.brigade/worktrees/${A.deliverySlug} merge --ff-only ${branch}

4. Capture the landed SHA range from step 3 (the tip before and after) — you'll
   return it.

5. Update this item's status line in ${A.dishDir}/PLAN.md to \`status: done\`.
   Before writing, assert the old status-line string for this item occurs exactly once
   in the file. If it occurs zero times or more than once, fail loudly and return
   ok: false rather than guessing which line to change.

6. Clean up — but confirm the item actually landed BEFORE tearing anything down.
   First evaluate the merge-check against the DELIVERY worktree, not repoRoot —
   repoRoot's HEAD is unrelated to the delivery branch, so a check (or \`branch -d\`)
   run with \`-C ${A.repoRoot}\` can report "not fully merged" even when step 3 already
   fast-forwarded the branch into delivery. Run:
     git -C ${A.repoRoot}/.brigade/worktrees/${A.deliverySlug} merge-base --is-ancestor ${branch} ${A.deliveryBranch}
   If the \`--is-ancestor\` check exits non-zero, the branch is genuinely NOT merged —
   a real "didn't land" case. Do NOT delete the branch (never fall back to \`-D\`) and
   do NOT remove the worktree. Return ok: false with detail naming the branch and
   stating it was not contained in ${A.deliveryBranch}, leaving BOTH the branch and the
   worktree in place for investigation.
   Only if that check exits 0 — the branch tip IS contained in the delivery branch —
   tear down, worktree first then branch:
     git -C ${A.repoRoot} worktree remove ${worktreePath}
     git -C ${A.repoRoot}/.brigade/worktrees/${A.deliverySlug} branch -d ${branch}
   The delete is run at the delivery worktree so its merge-check passes; it is safe
   because the ancestor check already proved the commits are in delivery.

7. Re-run the porcelain check:
     git -C ${A.repoRoot} status --porcelain
   A dirty tree after cleanup is not silent — record it in the detail you return.

You never run git add or git commit on anything, never touch any file outside
.brigade/ and git refs beyond what's listed above, and never push.

Return the result per the steward schema.
`

// Cook attempts share a semaphore sized to the tier's parallelism budget.
// Inspector and steward calls are uncapped here — the runtime enforces its own
// global cap on those.
const maxParallelCooks = A.maxParallel ?? POLICY.maxParallel
let activeCooks = 0
const cookWaiters = []
const acquireCookSlot = () => new Promise((resolve) => {
  if (activeCooks < maxParallelCooks) {
    activeCooks += 1
    resolve()
  } else {
    cookWaiters.push(resolve)
  }
})
const releaseCookSlot = () => {
  activeCooks -= 1
  const next = cookWaiters.shift()
  if (next) {
    activeCooks += 1
    next()
  }
}

// The delivery branch is a single moving target: two landings racing its rebase
// and fast-forward would corrupt it. This promise chain is the mutex — every
// landing waits for the previous one to settle (pass or fail) before starting
// its own, so exactly one steward-land call is in flight at a time.
let landLock = Promise.resolve()
const withLandLock = (landFn) => {
  const turn = landLock.then(landFn, landFn)
  landLock = turn.then(() => {}, () => {})
  return turn
}

let ladderExhausts = 0
let totalInspectorFails = 0
let breakerTripped = false
let breakerReason = null

const recordInspectorFail = (slug) => {
  totalInspectorFails += 1
  blog('inspector', `inspector FAIL recorded for ${slug} (${totalInspectorFails} total)`)
  if (!breakerTripped && totalInspectorFails >= POLICY.circuitBreaker.maxTotalFails) {
    breakerTripped = true
    breakerReason = `total inspector FAILs reached ${POLICY.circuitBreaker.maxTotalFails}`
    blog('blocked', `circuit breaker tripped: ${breakerReason}`)
  }
}

const recordLadderExhaust = (slug) => {
  ladderExhausts += 1
  blog('blocked', `ladder exhausted for ${slug} (${ladderExhausts} items so far)`)
  if (!breakerTripped && ladderExhausts >= POLICY.circuitBreaker.maxLadderExhausts) {
    breakerTripped = true
    breakerReason = `${ladderExhausts} items exhausted their escalation ladder`
    blog('blocked', `circuit breaker tripped: ${breakerReason}`)
  }
}

const emptyLedgerEntry = (slug, status, blockedReason) => ({
  slug,
  status,
  attempts: [],
  landedRange: null,
  reportPath: null,
  verdictPath: null,
  findings: [],
  blockedReason: blockedReason || null,
})

async function runItem(item, promises) {
  // Yield one turn so every item's promise is registered in `promises` before any
  // dependency lookup below runs. The dispatch loop that populates `promises` is
  // fully synchronous, but without this yield a dependency declared later in
  // A.items wouldn't have its entry yet when this function reads it.
  await Promise.resolve()

  if (item.status === 'done') {
    blog('landed', `skip ${item.slug}: already landed`)
    return emptyLedgerEntry(item.slug, 'skipped', null)
  }

  // PLAN.md uses snake_case `depends_on`; the Workflow args contract uses camelCase
  // `dependsOn`. Accept either so a Planner that pastes frontmatter fields still works.
  const depSlugs = item.dependsOn || item.depends_on || []
  const depResults = await Promise.all(
    depSlugs.map((dep) => promises[dep] || Promise.resolve({ status: 'missing' })),
  )
  const depsOk = depResults.every((r) => r.status === 'done' || r.status === 'skipped')
  if (!depsOk) {
    const badDeps = depSlugs.filter(
      (dep, i) => depResults[i].status !== 'done' && depResults[i].status !== 'skipped',
    )
    blog('blocked', `blocked-on-dep ${item.slug}: waiting on ${badDeps.join(', ')}`)
    return emptyLedgerEntry(item.slug, 'blocked-on-dep', `unmet dependencies: ${badDeps.join(', ')}`)
  }

  if (breakerTripped) {
    blog('blocked', `breaker tripped: not starting ${item.slug}`)
    return emptyLedgerEntry(item.slug, 'blocked', `circuit breaker: ${breakerReason}`)
  }

  const worktreePath = `${A.repoRoot}/.brigade/worktrees/${A.deliverySlug}--${item.slug}`
  const branch = `wip/${A.deliverySlug}/${item.slug}`
  const reportPath = `${A.dishDir}/reports/${item.slug}-cook.md`
  const verdictPath = `${A.dishDir}/reports/${item.slug}-verdict.md`
  const ladder = item.heavy ? POLICY.heavyAttempts : POLICY.attempts

  const attempts = []
  const findingsHistory = []
  let landedRange = null
  let status = null
  let blockedReason = null

  for (let i = 0; i < ladder.length; i += 1) {
    if (i === 0) {
      blog('steward', `dispatch ${item.slug}: preparing worktree`)
      const creation = await agent(stewardCreatePrompt(worktreePath, branch), {
        label: `steward-create:${item.slug}`,
        phase: 'Cook',
        schema: SCHEMA_STEWARD_RETURN,
        agentType: POLICY.agents.steward,
        effort: STEWARD.effort,
      })
      if (!creation || !creation.ok) {
        status = 'blocked'
        blockedReason = `steward-create failed: ${creation ? creation.detail : 'agent returned no result'}`
        blog('blocked', `blocked ${item.slug}: ${blockedReason}`)
        break
      }
    }

    const agentType = ladder[i]
    blog('cook', `dispatch ${item.slug}: cook attempt ${i + 1} (${agentType})`)
    await acquireCookSlot()
    let cookResult
    try {
      cookResult = await agent(
        withPromptOverrides(
          cookPrompt(item, agentType, worktreePath, branch, reportPath, verdictPath, findingsHistory, i),
          PROMPT_EXTRAS.cook,
        ),
        { label: `cook:${item.slug}:${i}`, phase: 'Cook', schema: SCHEMA_COOK_RETURN, agentType },
      )
    } finally {
      releaseCookSlot()
    }

    if (!cookResult) {
      attempts.push({ agentType, result: 'failed' })
      blog('cook', `cook attempt ${i + 1} for ${item.slug} returned no result`)
      continue
    }

    if (cookResult.status === 'blocked') {
      attempts.push({ agentType, result: 'blocked' })
      status = 'blocked'
      blockedReason = cookResult.blockedReason || 'cook reported blocked'
      blog('blocked', `blocked ${item.slug}: ${blockedReason}`)
      break
    }

    blog('inspector', `inspect ${item.slug}: attempt ${i + 1}`)
    const verdictResult = await agent(
      withPromptOverrides(
        inspectorPrompt(item, worktreePath, branch, reportPath, verdictPath, POLICY.workingMemory && (item.heavy || i > 0)),
        PROMPT_EXTRAS.inspector,
      ),
      {
        label: `inspect:${item.slug}:${i}`,
        phase: 'Inspect',
        schema: SCHEMA_VERDICT_RETURN,
        agentType: POLICY.agents.inspector,
      },
    )

    if (!verdictResult) {
      attempts.push({ agentType, result: 'failed' })
      recordInspectorFail(item.slug)
      blog('inspector', `inspector returned no result for ${item.slug} attempt ${i + 1}`)
      continue
    }

    if (verdictResult.verdict === 'FAIL' && !verdictResult.trivialOnly) {
      attempts.push({ agentType, result: 'failed' })
      findingsHistory.push({ agentType, attempt: i, findings: verdictResult.findings || [] })
      recordInspectorFail(item.slug)
      blog('inspector', `verdict FAIL for ${item.slug} attempt ${i + 1}: ${(verdictResult.findings || []).length} findings`)
      continue
    }

    attempts.push({ agentType, result: 'done' })
    findingsHistory.push({ agentType, attempt: i, findings: verdictResult.findings || [] })
    blog('inspector', `verdict PASS for ${item.slug} attempt ${i + 1}${verdictResult.trivialOnly ? ' (trivial findings only)' : ''}; landing`)

    const landResult = await withLandLock(() => agent(stewardLandPrompt(worktreePath, branch, verdictPath), {
      label: `steward-land:${item.slug}`,
      phase: 'Land',
      schema: SCHEMA_STEWARD_RETURN,
      agentType: POLICY.agents.steward,
      effort: STEWARD.effort,
    }))

    if (!landResult || !landResult.ok) {
      status = 'rework-needed'
      blockedReason = landResult ? landResult.detail : 'steward-land returned no result'
      blog('steward', `landing failed for ${item.slug}: ${blockedReason}`)
      break
    }

    status = 'done'
    landedRange = landResult.landedRange || null
    blog('landed', `landed ${item.slug}: ${landedRange}`)
    break
  }

  if (!status) {
    recordLadderExhaust(item.slug)
    status = 'blocked'
    blockedReason = `escalation ladder exhausted after ${ladder.length} attempts with no PASS`
  }

  return {
    slug: item.slug,
    status,
    attempts,
    landedRange,
    reportPath,
    verdictPath,
    findings: findingsHistory.flatMap((round) => round.findings),
    blockedReason,
  }
}

async function runAll(items) {
  const promises = {}
  for (const item of items) {
    promises[item.slug] = runItem(item, promises)
  }
  const results = await Promise.all(items.map((item) => promises[item.slug]))
  return {
    items: results,
    stoppedEarly: breakerTripped,
    reason: breakerTripped ? breakerReason : null,
  }
}

// A top-level `await` here would conflict with the top-level `return` below: Node's
// module-type detection has to pick CommonJS, where `await` isn't legal at the top
// level, or ESM, where a bare `return` isn't — no format admits both. So this stays
// a plain `return` of the promise `runAll` produces; the runtime (which already
// treats this whole script body as async) resolves it same as any awaited value.
return runAll(A.items)
