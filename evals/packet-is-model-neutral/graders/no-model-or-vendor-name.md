---
# Fails when the packet names a model family or an AI vendor, in any case. The packet is read
# by whichever model the fleet dispatches, so it never says which model that will be.
type: regex
pattern: '\b(?:claude|anthropic|openai|chatgpt|gpt-?\d[\w.]*|gemini|codex|copilot|opus|sonnet|haiku|llama|mistral|deepseek|qwen)\b'
flags: i
match: not_contains
target: { source: file, path: .brigade/dishes/sample/packet.md }
---
