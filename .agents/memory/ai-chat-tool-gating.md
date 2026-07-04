---
name: AI chat tool gating vs. prompt instructions
description: Why AI chat tools must be exposed whenever the system prompt tells the model to use them, or the model narrates phantom actions.
---

# AI chat tool availability must match prompt instructions

In the status-report and network AI chat routes, the CIO's chat deliberately does
NOT auto-capture work: `create_task` is only added to the tool list when
`allowTaskCapture` is true, which for a CIO is `messageRequestsCapture(lastUserMsg)`
(a regex heuristic). Ordinary staff always capture.

**Why:** the CIO asks many analytical questions; auto-logging every message as their
own task would pollute their weekly report. So the tool is intentionally withheld
unless intent is detected.

**The trap:** if the system prompt instructs a behavior (e.g. "you can delegate
tasks to teammates") but the corresponding tool is gated OFF for that message, the
model will *narrate* the action ("Assigned to Cecil…") while nothing is persisted —
`createdTasks` comes back empty and the user thinks it worked. Prompt guidance and
runtime tool availability must agree.

**How to apply:** whenever you add prompt guidance that tells the AI to call a tool,
verify that tool is actually exposed for the messages that trigger that guidance. For
the CIO capture gate specifically, any new "the AI can do X via create_task" prompt
line needs a matching intent pattern in `CAPTURE_INTENT_PATTERNS`
(`artifacts/api-server/src/lib/ai_knowledge.ts`). Delegation phrasing ("assign",
"delegate", "Have <Name> …") had to be added there so the tool opens even when the
word "task" is absent. Watch regex case flags: an un-`i` verb alternation misses a
capitalized sentence-start verb like "Have".
