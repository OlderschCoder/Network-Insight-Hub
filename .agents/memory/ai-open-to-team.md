---
name: AI assistant is an open shared team tool
description: Owner-directed policy that the in-app AI (incl. network diagnostics) is open to all signed-in team members, not least-privilege gated.
---

The in-app AI assistant is intentionally a **shared knowledge/troubleshooting tool for the whole IT team** (~8 people), not a least-privilege-gated feature.

- **Network diagnostics** (`ping_host`, `test_net_connection`) are available to **every authenticated user** in the network AI chat, not just network-admin roles. The only guardrail is a per-chat-turn probe budget (`MAX_DIAG_CALLS`) to stop a single turn fanning out into a scan.
- **Secret-like content is redacted, not rejected** — `redactSecretLike` replaces credentials with `[REDACTED]` and saves the rest (memories, shadow notes, and the manual ai-knowledge / cio-shadow-notes routes). Do not reintroduce a hard 400 "kick it back" gate.

**Why:** The owner (CIO) explicitly overrode a code-review recommendation to role-gate diagnostics, saying anyone talking to the AI should be able to use it — it exists for the team members who need to know how someone else solved the same issue. Small, fully-trusted internal team; the owner prioritizes frictionless team knowledge-sharing over least-privilege. Recurring theme in the owner's requests: "loosen the chains" / make the AI more helpful and agentic.

**How to apply:** Before adding a role/permission gate to an AI capability in this app, assume the default is open-to-all-authed-users unless the owner asks for a restriction. Keep only abuse/DoS bounds (timeouts, caps) and secret redaction. Flag security tradeoffs to the owner but honor the override.
