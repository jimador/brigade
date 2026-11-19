---
title: Reviews
description: Run an advisory code review on any branch, PR or range, cook the findings you pick, and see how the handoff red team guards every Brigade PR.
---

Brigade reviews code in three places: an on-demand advisory review of anything you point it at, a dispatch step that cooks the findings you select, and the red team that runs on every dish's delivery range before its PR can leave draft. The per-item inspector gate inside a dish is separate and covered in [Run a dish](usage.md).

## Review a branch, PR or range

```text
/brigade:review feature/orders-export
/brigade:review 418
/brigade:review main..feature/orders-export
/brigade:review feature/orders-export --tier three-star
```

The input kind comes from the ref: anything with `..` is a range, a bare number, `#<number>` or a PR URL is a pull request, anything else is a branch. Branches and ranges resolve locally. A pull request needs an authenticated `gh` and a remote; if either is missing, the review stops and tells you the branch or range command to run instead.

The review is **advisory**. It returns findings, never a pass or fail verdict, and it never posts to a pull request. Its only other write is a plain-language comment on the ticket it found, when there is one. The report lands at `.brigade/reviews/<review-slug>/report.md`, and the summary shows counts by severity, how much context the review had (`bare`, `documented` or `tracked`), and the top findings.

### Dimensions

Eight dimensions, each with an id you can configure under `review.dimensions` (see [Configuration](configuration.md)):

| Id | Looks at |
| --- | --- |
| `correctness` | Does it do what it claims |
| `tests` | Do the tests prove it |
| `architecture` | Does it fit the system's shape |
| `maintainability` | Will the next person understand it |
| `reuse` | Does it rebuild something that exists |
| `duplication` | Does it repeat itself |
| `security` | Does it open a hole |
| `product` | Does it match the requirements |

### How depth scales with tier

The tier comes from `--tier`, else the repo's configured tier. Before the review runs, `brigade-risk` checks the changed files; a change that touches auth, secrets, payments, data migrations or CI and deploy files, or more than ten files, bumps the tier up one level, capped at ★★★, and never down.

| | ★★★ | ★★ | ★ |
| --- | --- | --- | --- |
| Review passes | 8, one per dimension | 4 groups (correctness and tests, architecture and maintainability, reuse and duplication, security), plus product when it applies | 1 merged pass |
| Product dimension | Always; falls back to the PR or commit intent with a "no requirements source" caveat | Only with a requirements source | Only with a requirements source |
| Verify pass | Every blocking and high finding, two independent verifiers trying to refute it | Blocking findings, one verifier | None; findings are labelled unverified |
| Context | Docs, ticket, knowledge base and up to two context scouts | Docs and ticket | Docs only |

At ★★★ a finding both verifiers refute is dropped, and one only one refutes is reported as unconfirmed.

Every finding is packet-shaped: files, a fix direction and a verify hint. That is what lets you cook it next.

## Cook the findings you pick

```text
/brigade:review-dispatch <review-slug>
/brigade:review-dispatch <review-slug> f1 f3
/brigade:review-dispatch .brigade/reviews/<review-slug>/report.md
```

It validates the report first, then lets you pick findings: by id on the command line, or from a multi-select list. There is no bulk mode; a finding is never cooked unless you selected it.

1. **Re-check stale findings.** Any selected finding that was never confirmed is re-checked against the current main line by an inspector told to refute it. A refuted finding is dropped, and its ticket gets a note that it no longer reproduces.
2. **Build a mini-dish.** One work item per surviving finding in `.brigade/dishes/review-fixes-<review-slug>/PLAN.md`, with no second planning pass. Each packet re-checks the finding's premise when the cook starts and becomes a safe no-op if it no longer holds. A bug fix carries a self-falsification step: the cook reintroduces the bug, shows the red run, restores the fix and shows the green run. Two findings on the same file are sequenced, never run in parallel.
3. **Plan check.** Runs by your tier's policy, exactly as for any dish.
4. **Execute.** The usual cook, inspect and land loop on a new delivery branch. When the review found a tracked ticket, it is claimed first and gets a closing comment listing which findings shipped and which were dropped.

## The handoff red team

The inspector judges each item alone. Before a dish's PR can leave draft, the red team reviews the whole delivery range at its current head, after the acceptance pass. It adds to the per-item gate and never replaces it.

1. **Pick the tools and write the brief.** `brigade-pr redteam` records the head and range, picks the tools and writes the brief both passes read:

   ```bash
   "$CLAUDE_PLUGIN_ROOT/scripts/brigade-pr" redteam --base main --author claude \
     --brief .brigade/dishes/<dish-slug>/reports/red-team-brief.md --json
   ```

   `--author` is the runtime that wrote the code. The **find pass** runs in a tool other than the author's, and the **verify pass** in a tool other than the find pass's, each as its own process with its own context. A tool that is not installed is skipped and the next in `review.redTeam.reviewerOrder` takes its place. At least one pass must run in a Claude session; Codex alone is refused.
2. **Run both passes.** The find pass writes `reports/red-team-find-<head7>.txt`, and running `redteam` again with `--findings` gives the verify command, which writes `reports/red-team-verify-<head7>.txt`. The Planner never stands in for a pass, and a cook that wrote the code never runs one.
3. **Fix what survives.** Each `error`, and each `warning` not recorded as a decision in the PR, becomes a rework item whose first step is a test that fails on the reviewed head. The gate is re-proved.
4. **Review the new head.** A push makes the review stale, so the range is reviewed again. After two rounds that still leave an error, the Planner stops and asks you one decision-ready question, and the PR stays a draft.
5. **Record the verdict.** Each round goes in `reports/red-team-<head7>.md`. `verdict: clean` only when no error and no undecided warning survives on that head.

`brigade-pr check --pr <n> --ready` refuses to pass without a clean verdict or a human override on the current head. Only a human waives the review, in their own words with a reason; an agent never writes an override. Setting `review.redTeam.required` to `false` makes the red team advisory: it still runs, and the PR may record n/a with a reason. Lenses, severities and reviewer commands are configurable; see [Configuration](configuration.md).

## Worked example: ACME-142

ACME-142 "Add CSV export to the orders page" landed on `feat/orders-csv-export` and its draft PR is #418.

1. During handoff, the red team's find pass reports one error: the CSV writer does not quote fields containing commas. The verify pass confirms it.
2. A rework item starts with a test exporting an order whose customer name is `Acme, Inc.`; it fails on the reviewed head, the fix makes it pass, and the inspector gates it. The new head is reviewed again and comes back clean, so the PR is marked ready.
3. A week later you run `/brigade:review feature/orders-export-filters` on a teammate's follow-up branch at ★★. It reports a `tests` finding (`f1`, no test for an empty export) and a `duplication` finding (`f2`, a second date formatter).
4. `/brigade:review-dispatch feature-orders-export-filters f1` re-checks `f1` against main, where it still holds, and cooks it as a one-item mini-dish. `f2` stays in the report for later.
