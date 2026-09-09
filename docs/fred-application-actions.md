# Fred application actions

Fred can guide authenticated users through the current SCCC IT Portal and can perform bounded record actions through typed tools. The tools call the same database tables and Zendesk API used by the application routes; they do not automate the browser or bypass role checks.

## Capability and authorization matrix

| Area                  | Read or guide                          | Confirmed writes                                                                                                                        | Authorization and active controls                                         |
| --------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Application guidance  | Search the current seeded portal guide | None                                                                                                                                    | Any authenticated user                                                    |
| Zendesk               | Get and search tickets                 | Create; edit subject, status, priority, or assignee; add a public reply or internal note; solve an explicit list of up to 25 ticket IDs | Authenticated IT user; Fred control ON; public replies also require reply control ON and Zendesk API permission |
| Post-Incident Reviews | Included in Fred context               | Create; edit every PIR field                                                                                                            | Owner or CIO                                                              |
| Weekly logs           | Included in Fred context               | Create or update every weekly-log field                                                                                                 | Owner or CIO                                                              |
| Weekly status reports | Included in Fred context               | Create, update every report-editor field, or finalize                                                                                   | CIO only                                                                  |
| Team to-dos           | List accessible to-dos                 | Create; edit; complete; reassign                                                                                                        | Own items; users with the Manage Todos capability may manage team items   |

Every write tool requires `confirmed: true`. Fred must first show the exact
target, audience, and proposed values. The user's confirmation must follow that
preview; a broad earlier request and Fred's own wording do not count.
Observation-only/background Fred calls cannot see any of these write tools.

## Zendesk supervision

The **Troubleshooting** workspace at `/support` contains the **ZENDESK
SUPERVISION** card headed **Fred & reply controls**. The same status appears in
the Zendesk Monitor at `/support/zendesk`.

- **Fred drafting** OFF blocks Fred-authored Zendesk drafts and every
  Fred-originated ticket write, including comments, internal notes, ticket
  changes, creation, and solving.
- **Zendesk replies** OFF blocks every public reply route. Drafts remain
  reviewable, and a confirmed internal note may remain available when Fred is
  otherwise enabled.
- Confirmed human escalation remains available while either control is OFF.
- Only the CIO or an account with the existing Manage Todos capability may
  change the global controls. Names and titles are not authorization.
- If the saved control state cannot be loaded, the interface reports the state
  as unavailable, keeps actions disabled, and never assumes ON.

Control changes require a confirmation and return the persisted state plus the
most recent actor and timestamp. See
[Zendesk supervised conversation monitor](zendesk-supervised-monitor.md) for
the operator workflow, failure states, and control API contract.

Zendesk ticket closure uses the platform's normal lifecycle: Fred marks an explicitly confirmed ticket as **solved**. Zendesk applies the final irreversible **closed** state later through its configured automation. A broad request such as “close all tickets” is never interpreted as authority to mutate an unknown set; Fred searches, lists the exact IDs, and asks for confirmation.

## Guidance source

`seed_app_usage.ts` is reseeded idempotently on service start and documents the
Home command center, four workspace modes, fixed role-aware navigation, Fred,
reporting, and record workflows. The `get_application_guidance` tool queries
those live seeded entries, keeping how-to answers grounded in the deployed
interface.

See [fred-application-actions.mmd](fred-application-actions.mmd) for the editable authorization and write flow.
