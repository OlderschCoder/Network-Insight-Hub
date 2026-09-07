# Zendesk supervised conversation monitor

## Purpose

The Zendesk Monitor at `/support/zendesk` gives authenticated Insights users a
single place to watch the current open-ticket conversation queue, inspect the
recent thread, and respond without leaving the portal.

Fred may prepare a reply, but drafting is always an observation-only AI call.
It cannot post, edit, solve, or reassign a Zendesk ticket during that step.
The operator can edit the draft, replace it completely, clear it, or open the
ticket in Zendesk before deciding what to do.

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
4. Select **Draft with Fred**, or type your own public reply.
5. Edit or replace the response as needed.
6. Select **Review & send** and approve the exact text in the confirmation
   dialog.

To escalate instead, choose an active team member under **Escalate to a team
member**, add an optional private handoff note, and confirm the exact
reassignment. The assignment and note are written to Zendesk together so the
next owner sees the context immediately. Fred can also recommend or perform a
confirmed escalation from chat using the same Zendesk assignment capability.

When the signed-in Insights user's Zendesk email can be resolved, the posted
comment is attributed to that Zendesk agent. Otherwise Zendesk retains the
configured integration account as the updater, so the native ticket audit
history still records the write.

The API independently requires `confirmed: true`; bypassing the browser dialog
does not bypass the server-side guard. A successful send refreshes both the
conversation and the queue.

## Monitoring and limits

- The queue and selected conversation refresh every 15 seconds while open.
- Auto-send is disabled. Fred cannot silently answer a requester.
- Supervisor switches can pause Fred Zendesk actions or all public replies
  without redeploying the application.
- Escalations require explicit confirmation and are limited to active Insights
  team members with a Zendesk email mapping.
- The monitor uses the existing Zendesk Support ticket API configuration.
- A Zendesk Messaging webhook and Sunshine Conversations credentials are still
  required for event-driven, unattended bot replies. Those credentials are
  separate from `ZENDESK_API_TOKEN` and must remain outside source control.
- The optional `ZENDESK_WIDGET_KEY` enables Zendesk's requester-facing floating
  widget; it does not grant Fred agent permissions.

See [zendesk-supervised-monitor-flow.mmd](zendesk-supervised-monitor-flow.mmd)
for the editable flow diagram.
