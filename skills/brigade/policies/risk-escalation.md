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
  ]
}
```
