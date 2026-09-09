# Zendesk supervised conversation monitor

## Purpose

The **Troubleshooting** workspace at `/support` is the starting point for
Zendesk work. Its **ZENDESK SUPERVISION** card is headed **Fred & reply
controls** and shows the current global safety state. Select **Open Monitor**
to open `/support/zendesk`, where authenticated Insights users can watch the
current open-ticket conversation queue, inspect the recent thread, and manage
shared reply drafts.

Fred may prepare a reply, but drafting is always an observation-only AI call.
It cannot post, edit, solve, or reassign a Zendesk ticket during that step.
**Prepare open drafts** lets an operator ask Fred to walk the loaded open queue
one ticket at a time. Existing pending drafts are not replaced. Pending tickets,
internal-only activity, tickets whose latest public response is from staff, and
cases Fred identifies as escalation-only are skipped. Progress and counts remain
visible in the queue while the batch is running, and the operator can stop after
the current ticket.

The operator can edit the draft, replace it completely, clear the local editor,
or save it to the shared approval queue. Fred-generated drafts are persisted in
`data/zendesk-reply-drafts.json`, so another signed-in team member can review
the exact response later.

## Supervisor controls

The control card appears on both the Troubleshooting page and the Zendesk
Monitor. The controls are independent and global:

| Control | ON | OFF |
| --- | --- | --- |
| **Fred drafting** | **ON — supervised drafts allowed**. Fred may prepare saved drafts and perform separately confirmed Zendesk actions. | **OFF — Zendesk actions blocked**. The API blocks Fred-authored drafts, comments, internal notes, and ticket changes. |
| **Zendesk replies** | **ON — confirmed replies allowed**. A reviewed Support-ticket draft may be sent after explicit approval. | **OFF — public replies blocked** across every Insights and Fred send path. Pending drafts remain drafts; internal notes may still be allowed when the Fred control and the action's confirmation permit them. |

Only the CIO or a user granted the existing **Manage Todos** capability can
change these controls. A person's name or job title does not grant this
permission. Other signed-in users can see the current state, but the switches
are disabled for them. Each change shows a confirmation dialog before it is
saved.

On the monitor, the same ready states read **Available for supervised drafts**,
**Blocked from Zendesk actions**, **Confirmed public replies allowed**, and
**Public replies blocked**.

The saved OFF state is authoritative until an authorized supervisor changes
it. Reloading the page, restarting the browser, or deploying the application
must not silently turn a control back on. When present, **Last changed by** and
the timestamp identify the most recent saved change. This is the current-state
audit marker; Zendesk keeps its own actor and ticket-history records for each
ticket write.

If Insights cannot read the current control state, it displays **Unavailable —
status unknown**, disables both switches and Zendesk actions, and offers
**Retry controls**. Never interpret an unavailable card as ON. Restore or
verify the control API before drafting or sending.

If no control file exists yet, the first safe state is both controls OFF. An
authorized supervisor can then confirm either switch ON from the interface.

Escalation is independent of both switches, so the team can still assign an
urgent ticket to a person while Fred or public replies are paused.

## Sending a response

1. Open **Troubleshooting**, check **Fred & reply controls**, then select
   **Open Monitor**.
2. To prepare the queue, select **Prepare open drafts** and confirm the ticket
   count. Fred saves only reviewable drafts and reports saved, skipped, and
   failed counts. Nothing is sent.
3. Select a conversation from the live queue.
4. Read the recent public and internal conversation entries.
5. Select **Draft with Fred**, or type your own public reply. Fred saves her
   response to the shared approval queue automatically.
6. Edit or replace the response as needed, then select **Save for approval**.
7. For email, web form, and other Support tickets, select **Approve & send** and
   approve the exact text in the confirmation dialog.
8. For a Messaging ticket, select **Copy & open Zendesk**. Insights rechecks
   the current global reply control immediately before copying or opening
   anything; an OFF or unavailable control blocks the handoff. Review the
   copied text in Zendesk Agent Workspace and send it from the Messaging
   composer. Insights does not claim that a Messaging draft was delivered.

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
ID. A stale or replaced draft cannot be sent: reload it, review the current
text, and confirm again. The API also refuses to post a public ticket comment
to a Messaging ticket because Zendesk does not deliver that operation to the
live conversation.

Fred chat uses the same controls. She may search and read tickets, but every
write starts with a preview of the exact ticket, audience, and proposed values.
The user's explicit confirmation must follow that preview; an earlier general
instruction or Fred's own draft is not confirmation. With **Fred drafting**
OFF, Fred cannot add a public reply or internal note, create or update a ticket,
or solve tickets. With **Zendesk replies** OFF, no public reply can be posted,
even when Fred is ON; a confirmed internal note may still be permitted.
Requests such as “close all tickets” are not bounded approval. Fred must list
the exact ticket IDs and uses Zendesk's reversible **solved** state; Zendesk
automation applies final **closed** later.

## Failure and unavailable states

- **Loading control status…** means the saved state is not known yet. Wait; do
  not draft, approve, or change a control.
- **Unavailable — status unknown** means the control request failed. Both
  switches and dependent actions remain disabled until **Retry controls**
  succeeds.
- **Fred drafting is turned off** or **Zendesk replies are turned off** is an
  enforced pause, not a suggestion. Do not retry through another Insights
  route or relabel a Fred draft as an operator draft to bypass it.
- **The pending draft changed** means another user or browser replaced the
  draft. Reload, review the new body, and confirm that exact version.
- **Messaging manual send required** means copy the draft into Zendesk Agent
  Workspace, review it there, and use Zendesk's own Send action. Insights has
  not delivered it.
- A permission error means the signed-in account lacks the required supervisor
  capability. Ask the CIO to review the account; do not infer access from a
  name.
- If Zendesk is unconfigured or its API fails, Insights remains available for
  other work but must not report a draft, reply, note, assignment, or status
  change as successful. Use the native Zendesk workspace if it is available
  and report the integration failure.

## Monitoring and limits

- The open queue and shared draft list refresh every 15 seconds. The selected
  thread refreshes every 5 seconds.
- The selected thread and Fred's prompt use Zendesk's Conversation Log API,
  which includes live messages from end users, agents, and bots. Ticket
  comments remain a compatibility fallback.
- Auto-send is disabled. Fred cannot silently answer a requester.
- Batch review is explicitly started by a person, processes at most the 25
  tickets loaded in the recent-activity queue, and never calls a send endpoint.
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

## Control API for administrators

`GET /api/zendesk/controls` requires an authenticated session and returns
`fredEnabled`, `repliesEnabled`, `updatedAt`, `updatedBy`,
`updatedByUserId`, `updatedByEmail`, and `canManage`.
`PUT /api/zendesk/controls` accepts one or both boolean control fields from an
authorized supervisor. It rejects an empty body, non-boolean values, and
unknown fields; it never treats malformed input as permission to reset a saved
state. State-file read or write failures return HTTP 503 with code
`ZENDESK_SUPERVISION_UNAVAILABLE`, and no Zendesk write occurs. A forbidden
response means the account does not have the required capability.

See [zendesk-supervised-monitor-flow.mmd](zendesk-supervised-monitor-flow.mmd)
for the editable flow diagram.
