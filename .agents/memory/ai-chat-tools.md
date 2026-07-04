---
name: AI chat tool authorization
description: How AI chat write-tools must enforce role/ownership since they bypass route middleware
---

AI chat write-capabilities are exposed as OpenAI tools inside `runChatWithMemory`
(`artifacts/api-server/src/lib/ai_knowledge.ts`), invoked from the chat routes
(status_report.ts, network.ts). The chat routes only require plain auth — they do
NOT run `requireNetworkAdmin`/`requireCIO`. So any authorization that a normal REST
route enforces via middleware must be re-enforced INSIDE the tool executor itself.

**Rule:** every AI tool that writes must (a) scope to the acting user
(`opts.userId` for personal data like log_items) and (b) re-check role for
privileged writes. Network inventory upserts (upsert_switch/upsert_vlan) gate on
`NETWORK_ADMIN_ROLES` (cio/network/network_engineer) passed in via `opts.userRole`;
the routes forward `req.user.role`.

**Why:** the tool loop is a second, middleware-free path to the same DB writes.
Forgetting the in-executor check would let any authenticated staffer mutate
protected data just by asking the assistant.

**How to apply:** when adding a new AI tool, pass any needed identity (userId/role)
through the `runChatWithMemory` opts and check it in the executor before the DB
write — don't rely on the calling route's guards.
