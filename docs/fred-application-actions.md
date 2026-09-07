# Fred application actions

Fred can guide authenticated users through the current SCCC IT Portal and can perform bounded record actions through typed tools. The tools call the same database tables and Zendesk API used by the application routes; they do not automate the browser or bypass role checks.

## Capability and authorization matrix

| Area                  | Read or guide                          | Confirmed writes                                                                                                                        | Authorization                                                  |
| --------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Application guidance  | Search the current seeded portal guide | None                                                                                                                                    | Any authenticated user                                         |
| Zendesk               | Get and search tickets                 | Create; edit subject, status, priority, or assignee; add a public reply or internal note; solve an explicit list of up to 25 ticket IDs | Any authenticated IT user; Zendesk API permissions still apply |
| Post-Incident Reviews | Included in Fred context               | Create; edit every PIR field                                                                                                            | Owner or CIO                                                   |
| Weekly logs           | Included in Fred context               | Create or update every weekly-log field                                                                                                 | Owner or CIO                                                   |
| Weekly status reports | Included in Fred context               | Create, update every report-editor field, or finalize                                                                                   | CIO only                                                       |
| Team to-dos           | List accessible to-dos                 | Create; edit; complete; reassign                                                                                                        | Own items; Mark or Tracy may manage/reassign any team item     |

Every write tool requires `confirmed: true`. Fred must first show the exact target and proposed values. Observation-only/background Fred calls cannot see any of these write tools.

Zendesk ticket closure uses the platform's normal lifecycle: Fred marks an explicitly confirmed ticket as **solved**. Zendesk applies the final irreversible **closed** state later through its configured automation. A broad request such as “close all tickets” is never interpreted as authority to mutate an unknown set; Fred searches, lists the exact IDs, and asks for confirmation.

## Guidance source

`seed_app_usage.ts` is reseeded idempotently on service start and documents the Home, Status, Campus Technology, Troubleshooting, top-menu navigation, Fred, reporting, and record workflows. The `get_application_guidance` tool queries those live seeded entries, keeping how-to answers grounded in the deployed interface.

See [fred-application-actions.mmd](fred-application-actions.mmd) for the editable authorization and write flow.
