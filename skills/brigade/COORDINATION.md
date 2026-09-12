# Claude/Codex coordination — the dish lease

Read when: before the first mutation of a dish; when another runtime holds the lease; when
a leftover lease or `operation_busy` blocks you.

Each dish is a single-writer shared state machine. Claude and Codex may run different
dishes concurrently; they must not mutate the same dish simultaneously. The lease below is
how the two runtimes take turns on one dish.

## The dish slug

The slug is a canonical identity, not a title. Resolve it mechanically with
`brigade-coord key <source> <immutable-ticket-id>`: the helper first reuses an existing
`PLAN.md` whose `source:` and verbatim `ticket:` match, otherwise it normalizes
`<source>-<ticket-id>` by lowercasing, collapsing every run outside `[a-z0-9]` to `-`, and
trimming leading/trailing `-`. For work with no source ticket, first mint a stable local
ticket id `local-<UTC-compact-timestamp>-<short-title-slug>` and record it verbatim in
PLAN. If lookup is ambiguous or normalization is empty, stop. Claude and Codex must run
this exact derivation before acquiring or creating a dish.

## Acquire, heartbeat, release

Before the first mutation of a dish:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord" acquire <dish-slug> claude
```

Retain the returned `owner` token; heartbeat and release both need it.

Heartbeat after every Scout, Cook, Inspector, and landing wave:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord" heartbeat <dish-slug> <owner-token>
```

Release before yielding at a human approval/question checkpoint and at completed handoff:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/brigade-coord" release <dish-slug> <owner-token>
```

## Held by another runtime

If another runtime holds the lease, remain read-only: show its runtime and heartbeat,
reconcile status/git/artifacts, and let the operator decide whether to wait or
investigate. Never silently break a lease.

## Leftover leases and the operation mutex

A leftover lease is not stale merely because time passed. Check live sessions,
`brigade-status`, `git worktree list`, branches, and artifact timestamps. Only after
explicit operator approval, archive it with `brigade-coord break <dish-slug> --force`,
then acquire a new lease.

Lifecycle updates are serialized by a short operation mutex. If a crashed helper leaves
one behind, `status` reports `operation_busy`; after the same live-state checks and
separate operator approval, archive only that mutex with
`brigade-coord recover-lock <dish-slug> --force`, then run `break` or resume normally.

## The wire contract

The shared wire contract is the canonical paths and shapes in `SCHEMAS.md`: PLAN statuses,
`reports/<item>-cook.md`, `reports/<item>-verdict.md`, `state/<item>.md`,
`wip/<delivery-slug>/<item>`, `.brigade/worktrees/<delivery-slug>--<item>`, and attempt
records `{model, trigger, result}`. Runtime/model identifiers are opaque provenance
strings; preserve unfamiliar Codex values.

The shared config keeps Claude agent overrides in
`models.scout|cook|cookHeavy|inspector|analyst|design|steward`. Codex uses separate nested
keys prefixed `codex`; never consume or rewrite them.
