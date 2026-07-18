# Workspaces — multi-repo boards (Obsidian)

A **workspace** is a directory that is **not** itself a git repo, where you run the agent,
while member checkouts underneath are separate git repos. Boards live in the Obsidian
vault; worktrees hang off the workspace root.

## Registry

`~/.brigade/workspaces.md` lists workspaces. Each vault workspace folder has
`tickets/<id>/_workspace.md`:

```yaml
---
doc: brigade_workspace
id: acme
cwd: /path/to/acme
worktree_root: /path/to/acme/.worktrees
private: true
---
```

## Operating rules

When cwd matches a workspace `cwd`:

1. List/groom tickets across **all** member boards under `tickets/<workspace>/`
   (skip `_*.md`).
2. Every ticket frontmatter includes `workspace`, `project` (board id), and `repo`
   (absolute path to the child git checkout).
3. Create cook worktrees under `worktree_root`, with branches **inside** the child repo
   named by `repo`. Never treat the workspace root as the git remote.
4. Dish artifacts prefer `<repo>/.brigade/dishes/<slug>/` (git-excluded). Fallback:
   `<cwd>/.brigade/dishes/<project>/<slug>/`.
5. Private workspaces do not cross-link other org boards in registry docs.

## Flattened projects

`~/.brigade/projects.md` is the flat table (id → repo → board) generated from workspaces —
useful when cooking a single child from its own cwd.
