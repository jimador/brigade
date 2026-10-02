---
# Fails when the packet tells the reader to run a slash command (/review, /brigade:status),
# inline code included. File paths such as /path/to/repo or /dev/null do not count. A regex
# cannot see code fences, so the prompt keeps fences out of the Steps.
type: regex
pattern: '(?:^|[\s(`"''])/[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)?(?![\w/-]|\.\w)'
flags: m
match: not_contains
target: { source: file, path: .brigade/dishes/sample/packet.md }
---
