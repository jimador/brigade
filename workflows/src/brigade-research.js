export const meta = {
  name: 'brigade-research',
  description: 'Fans research questions out to scouts in parallel and collects their structured briefs.',
  phases: [{ title: 'Scout' }],
}

//@BRIGADE_CONFIG@
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
