# Brigade risk escalation (policy table)

What this file is for: a tunable table of file-path signals that force a work item
into escalation — the kind of change that shouldn't get decided by planner judgment
alone, run-to-run. `scripts/brigade-risk` reads the json block below and evaluates it
against a set of changed paths; nothing else in the fleet hardcodes these rules.

The decision rule is an OR: a change escalates if it touches more files than
`file_threshold`, OR if any changed path matches any category's regex. Either
condition alone is enough — this is a widening rule, never a narrowing one. A table
match can only add an escalation; planner judgment layered on top may add further
reasons to escalate, but it may never use its own judgment to remove one the table
already found.

Tuning happens by editing this file only — the categories and the threshold below are
the whole policy. Nothing else in the fleet should carry a parallel copy of this table.

A couple of the category patterns below carry a negative-lookahead guard to avoid a
known false-positive class: `auth` on its own would also catch `author`/`authoring`
(a person, not authentication), and `secret` alone would catch `secretary`. The
guards exclude exactly those words while still catching the security-sensitive terms
they're meant to catch (`authorize`, `authentication`, `oauth`, `secrets/`, etc).
`payments` deliberately has no `checkout` pattern, since `checkout` collides with the
unrelated and extremely common `git checkout`/`git-checkout` naming.

**Design review (separate from escalation).** The optional `design_review` array in the
json block lists categories of change that need a human design review: changes to a
public contract, to persisted data, or to a security boundary. A path that matches one
of them sets `design_review: true` and appears in `design_matches`, and `brigade-risk`
prints one `design-review:` line in text mode. A design-review match asks the operator
for design review at the contract checkpoint; it never changes `escalate`, and it never
adds or removes a row in `matches`. The same single-category rule applies: the first
design category a path matches is the one reported.

Design review skips documentation and test material before any pattern runs: a path under
`docs/`, `test/`, `tests/`, `__tests__/` or `fixtures/`, and any `.md` file, never
matches. `brigade-risk` applies this exclusion in code; the json block does not carry it.
A doc that names a contract is not the contract, and a fixture is not persisted data.

The design-review patterns are token-anchored: a token must sit between path separators
(`/ . _ -`) or at a path edge. That keeps `author`, `authoring`, `report`, `support`,
`export`, and `passports` from matching, and keeps the generic `policies/` directory out
of `security-boundary`. This repo's own risk table lives under `policies/`, so only
`access`, `iam`, or `security` in front of `policy`/`policies` counts.

Design-review patterns are case-sensitive, so every capitalised form is written out. A
camelCase file name gets its own suffix pattern: `[a-z](Port|Interface|Contract)` followed
by a file extension matches `NotifierPort.java`, and `Auth(Service|Svc|Guard|Provider)`
matches `AuthService.ts` and `authService.ts`. The lowercase-letter requirement keeps
`ContractCard.tsx` out. `oauth2` is a token, so `src/oauth2/client.ts` matches.

Seeds are not schema changes. A `.sql` file matches `persisted-data` unless its path has
a `seed`/`seeds` segment or its name ends `_seed.sql`, so `db/seed.sql` and
`db/seeds/users.sql` do not match, while `db/ledger.sql`, `db/schema.sql` and migrations
do. Known misses, accepted: `user.entity.ts` (an entity model is neither a contract nor a
boundary, and no pattern covers it) and camelCase names outside the suffixes above.
Matching of extensions and directory tokens is lowercase-only, as written.

Categories: `public-contract` (interface, port, contract, API schema files),
`persisted-data` (migrations, persisted schemas, SQL that is not seed data, and Prisma or
Avro files), and `security-boundary` (auth, authz, OAuth, permissions, RBAC, ACL, crypto,
access or security policy).

```json
{
  "file_threshold": 10,
  "categories": [
    {
      "id": "auth",
      "description": "authentication, sessions, tokens, credentials",
      "patterns": ["(auth(?!or(?:s|ed|ing)?\\b)|session|token|login|credential|password)"]
    },
    {
      "id": "dotenv",
      "description": "dotenv files carrying environment-specific secrets",
      "patterns": ["(^|/)\\.env(\\.|$)"]
    },
    {
      "id": "secrets",
      "description": "private keys, keystores, and other secret material",
      "patterns": ["(secret(?!ar)|private[_-]?key|\\.pem$|\\.p12$|keystore)"]
    },
    {
      "id": "ci-deploy",
      "description": "CI workflows, container images, and infrastructure-as-code",
      "patterns": [
        "(^|/)\\.github/workflows/",
        "(^|/)Dockerfile",
        "(^|/)(terraform|infra|k8s|helm)/",
        "\\.bicep$"
      ]
    },
    {
      "id": "payments",
      "description": "billing and payment processing",
      "patterns": ["(payment|billing|invoice|charge(?!r))"]
    },
    {
      "id": "data-migration",
      "description": "database schema and migration files",
      "patterns": ["(^|/)migrations?/", "(schema.*\\.(sql|prisma)$)"]
    }
  ],
  "design_review": [
    {
      "id": "public-contract",
      "description": "interfaces, ports, contracts, and API schema files other code depends on",
      "patterns": [
        "(^|[/._-])([Ii]nterfaces?|[Pp]orts?|[Cc]ontracts?)(?=[/._-]|$)",
        "[a-z](Port|Interface|Contract)\\.[A-Za-z]+$",
        "(^|[/._-])([Aa]pi[-_]?[Ss]chemas?|[Oo]pen[-_]?api|[Ss]wagger)(?=[/._-]|$)",
        "\\.(proto|graphql|gql)$"
      ]
    },
    {
      "id": "persisted-data",
      "description": "migrations and persisted schemas whose shape outlives one run",
      "patterns": [
        "(^|/)([Mm]igrations?|[Ss]chemas?)/",
        "(^|[/._-])[Ss]chema(?=[/._-]|$)",
        "^(?!(.*/)?seeds?([/._-]|$))(?!.*[/._-]seeds?\\.sql$).*\\.sql$",
        "\\.(prisma|avsc)$"
      ]
    },
    {
      "id": "security-boundary",
      "description": "authentication, authorization, permissions, crypto, and access policy",
      "patterns": [
        "(^|[/._-])([Oo]auth2?|[Aa]uth(entication|orization|orize|enticate|[nz])?|[Pp]ermissions?|[Rr]bac|[Aa]cl|[Cc]rypto(graphy)?|[Cc]ipher)(?=[/._-]|$)",
        "[Aa]uth(Service|Svc|Guard|Provider)\\.[A-Za-z]+$",
        "(^|[/._-])([Aa]ccess|[Ii]am|[Ss]ecurity)[-_]?[Pp]olic(y|ies)(?=[/._-]|$)"
      ]
    }
  ]
}
```
