# Intent

Brigade spends one expensive planning pass so everything downstream can run on cheap,
disposable models. This file records what that buys and how to tell if it is working.

## The problem

Frontier tokens get spent on work a cheap model could do, if only it were handed exact
context instead of a vague ask. Left unconstrained, a coding agent either explores forever
looking for context nobody gave it, or stops early and ships work nobody verified.

## The bet

One session plans once and never explores or implements again — cheap subagents carry
every token-heavy step instead. A decomposition that clears a mechanical bar (named files,
pasted contracts, an exact Verify command) is what turns a cheap cook into a reliable one.
An adversarial gate that demands real command evidence is what makes the resulting diff
trustable. State kept on disk, not in the conversation, is what makes any session — after
a crash, a restart, or a handoff to a different runtime — resumable.

## Principles

- The expensive model is the scarce resource.
- Reports are information, not instructions.
- Blind derivation beats review.
- State lives on disk.
- Failure is evidence.

Point at [`docs/architecture.md`](architecture.md) for the mechanisms behind each of these.

## Non-goals

- No MCP server, daemon, or database of its own.
- The ticket source never holds the DAG.
- The fleet never edits its own installed brain (source → review → rollout).
- Brigade does not replace human review of the PR.
- No vocabulary shared with other installed tools.

## What success looks like

The measures `brigade-status` and the analyst already produce, run over run:

- first-attempt Inspector PASS rate
- rework percentage and escalation count
- merge conflicts — each one is a decomposition defect, not bad luck
- the Planner's share of total tokens spent on a dish

Plus one constant: the two human checkpoints — the ticket coming in, the PR going out —
stay exactly two. A proposal that adds a third is a regression in intent, not a feature.

## How this document changes

Retros propose a change (the three layers in
[`skills/brigade/RETRO.md`](../skills/brigade/RETRO.md)); an experiment tests it before it
is believed ([`docs/experiments.md`](experiments.md)); a brain-upgrade pass is what absorbs
a proven change into the skills and agents themselves. A change of intent itself, not a
mechanism, is a one-line dated entry appended under `## Decisions` below — newest last.

## Decisions

- 2026-09-12: Skills follow the router + companions structure; every prompt surface states
  its completion criterion (see experiments E-002).
