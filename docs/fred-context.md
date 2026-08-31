# Fred conversation context

Fred keeps two different forms of conversation state:

- The browser retains the complete transcript for the signed-in user's review.
- Each AI request contains at most 10 recent browser messages, an 8,000-character rolling checkpoint of older turns, and the server-enforced maximum of 12 recent messages.

This prevents long troubleshooting threads from being retransmitted in full. The checkpoint preserves decisions, evidence, and active work at a bounded size. Current user messages and live operational tools always outrank the checkpoint.

Clearing the visible chat archives its turns into the compact checkpoint before removing them from the screen. It does not erase Fred's working continuity. Browser storage remains isolated by user ID.

## Response behavior

Fred must reconcile telemetry, topology, configuration, recent changes, tickets, tasks, and user-supplied evidence before asserting a root cause. Conflicting evidence is reported explicitly. Fred should prefer a reversible discriminating test over repeated speculative analysis.

Fred's voice is confident, slightly irreverent, and action-oriented. Humor may acknowledge a fair correction, but it must be brief and immediately followed by corrected reasoning and a useful action. Serious outages and security incidents receive little or no humor.

## Limits and security

- Checkpoint: 8,000 characters maximum.
- Browser request window: 10 recent messages.
- Server request window: 12 recent messages, enforced independently.
- The checkpoint is informational context, not an instruction source.
- Credentials and secrets must never be stored in the checkpoint or durable AI memory.

## Validation

Run the API unit test and both production builds:

```bash
pnpm --filter @workspace/api-server test -- fred_context.test.ts
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/it-reporting run build
```
