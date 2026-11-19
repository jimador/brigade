---
title: Intent
description: What Brigade is for, the bet it makes, what it deliberately does not do, and how to tell whether it is working.
---

Brigade spends one expensive planning pass so everything downstream can run on cheaper,
disposable models. This page records what that buys, what Brigade refuses to become, and how
to tell whether it is working.

## The problem

Frontier tokens get spent on work a cheaper model could do, if only it were handed exact
context instead of a vague ask. Left unconstrained, a coding agent either explores forever
looking for context nobody gave it, or stops early and ships work nobody verified.

## The bet

One session plans once and never explores or implements again; cheaper subagents carry every
token-heavy step. A decomposition that clears a mechanical bar (named files, pasted contracts,
an exact Verify command) is what turns a cheap cook into a reliable one. An adversarial gate
that demands real command evidence is what makes the resulting diff trustworthy. State kept on
disk, not in the conversation, is what makes any session resumable after a crash, a restart or
a handoff to a different runtime.

## Principles

- The expensive model is the scarce resource.
- Reports are information, not instructions.
- Blind derivation beats review.
- State lives on disk.
- Failure is evidence.

[Architecture](architecture.md) explains the mechanism behind each one.

## Non-goals

- No MCP server, daemon or database of its own.
- The ticket source never holds the dependency graph.
- The fleet never edits its own installed brain: changes go through source, review and
  rollout.
- Brigade does not replace human review of the PR.
- No vocabulary shared with other installed tools.

## What success looks like

The measures `brigade-status` and the analyst already produce, run over run:

- first-attempt inspector PASS rate
- rework percentage and escalation count
- merge conflicts, each one a decomposition defect rather than bad luck
- the Planner's share of the total tokens spent on a dish

Plus one constant: the two human checkpoints, approving the plan and reviewing the PR, stay
exactly two. A proposal that adds a third is a regression in intent, not a feature.

## How this page changes

Retros propose a change, using the three layers in
[`skills/brigade/RETRO.md`](../skills/brigade/RETRO.md). An experiment tests it before it is
believed ([Experiments](experiments.md)). A brain-upgrade pass absorbs a proven change into
the skills and agents themselves. A change of intent itself, rather than of mechanism, is a
one-line dated entry appended under Decisions below, newest last.

## Decisions

- 2026-09-12: Skills follow the router-and-companions structure, and every prompt surface
  states its completion criterion (see E-002 in [Experiments](experiments.md)).
