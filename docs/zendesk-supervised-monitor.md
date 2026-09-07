# Zendesk supervised conversation monitor

## Purpose

The Zendesk Monitor at `/support/zendesk` gives authenticated Insights users a
single place to watch the current open-ticket conversation queue, inspect the
recent thread, and manage shared reply drafts.

Fred may prepare a reply, but drafting is always an observation-only AI call.
It cannot post, edit, solve, or reassign a Zendesk ticket during that step.
The operator can edit the draft, replace it completely, clear the local editor,
or save it to the shared approval queue. Fred-generated drafts are persisted in
`data/zendesk-reply-drafts.json`, so another signed-in team member can review
the exact response later.

## Supervisor controls

Mark, Tracy, and CIO-role users can change two global controls at the top of
the monitor. **Fred drafting** disables the monitor's draft button and blocks
Fred's Zendesk write tools. **Zendesk replies** blocks all public replies from
the monitor and Fred at the API. Each change requires a confirmation and stores
the operator name and timestamp in `data/zendesk-supervision.json`.

Escalation is independent of the reply switch, so a supervisor can still assign
an urgent ticket to a person while public replies are paused. Other signed-in
users can see the current control state but cannot change it.

## Sending a response

1. Open **Troubleshooting → Zendesk Monitor**.
2. Select a conversation from the live queue.
3. Read the recent public and internal conversation entries.
4. Select **Draft with Fred**, or type your own public reply. Fred saves her
   response to the shared approval queue automatically.
5. Edit or replace the response as needed, then select **Save for approval**.
6. For email, web form, and other Support tickets, select **Approve & send** and
   approve the exact text in the confirmation dialog.
7. For a Messaging ticket, select **Copy & open Zendesk**. Review the copied
   text in Zendesk Agent Workspace and send it from the Messaging composer.
   Insights does not claim that a Messaging draft was delivered.

To escalate instead, choose an active team member under **Escalate to a team
member**, add an optional private handoff note, and confirm the exact
reassignment. The assignment and note are written to Zendesk together so the
next owner sees the context immediately. Fred can also recommend or perform a
confirmed escalation from chat using the same Zendesk assignment capability.

When the signed-in Insights user's Zendesk email can be resolved, the posted
comment is attributed to that Zendesk agent. Otherwise Zendesk retains the
configured integration account as the updater, so the native ticket audit
history still records the write.

The API independently requires `confirmed: true` and the current saved draft
ID. A stale or replaced draft cannot be sent. The API also refuses to post a
public ticket comment to a Messaging ticket because Zendesk does not deliver
that operation to the live conversation.

## Monitoring and limits

- The open queue and shared draft list refresh every 15 seconds. The selected
  thread refreshes every 5 seconds.
- The selected thread and Fred's prompt use Zendesk's Conversation Log API,
  which includes live messages from end users, agents, and bots. Ticket
  comments remain a compatibility fallback.
- Auto-send is disabled. Fred cannot silently answer a requester.
- Pending drafts show directly in the queue and remain available across users,
  browsers, and API-server restarts.
- Supervisor switches can pause Fred Zendesk actions or all public replies
  without redeploying the application.
- Escalations require explicit confirmation and are limited to active Insights
  team members with a Zendesk email mapping.
- The monitor uses the existing Zendesk Support ticket API configuration.
- The current Zendesk Suite Growth subscription does not expose the Sunshine
  Conversations API. Messaging drafts therefore require the final human send
  in Agent Workspace. Suite Professional or a separate Sunshine Conversations
  license is required before Insights can deliver Messaging replies itself.
- The optional `ZENDESK_WIDGET_KEY` enables Zendesk's requester-facing floating
  widget; it does not grant Fred agent permissions.

See [zendesk-supervised-monitor-flow.mmd](zendesk-supervised-monitor-flow.mmd)
for the editable flow diagram.
