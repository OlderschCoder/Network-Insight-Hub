# Insights Quick Start and Fred training

The authenticated portal exposes a concise Quick Start at `/quick-start`. It is
available under the Troubleshooting top-menu dropdown and from the Support
Center's Guides and practice card. The full User Guide remains at `/user-guide`.

## Training surfaces

| Surface                   | Purpose                                         | Source of truth               |
| ------------------------- | ----------------------------------------------- | ----------------------------- |
| Quick Start               | Ten-minute orientation to the rearranged portal | `pages/quick-start/index.tsx` |
| User Guide                | Full step-by-step application instructions      | `content/user-guide.md`       |
| Learn                     | Guided operational simulations                  | `lib/learn_scenarios.ts`      |
| Fred application guidance | Runtime navigation and workflow answers         | `lib/seed_app_usage.ts`       |
| Fred Memory               | Durable SCCC facts and response rules           | Active `ai_knowledge` records |
| Process Library           | Repeatable operational procedures               | Process records               |

## Current support rules

- Read the complete Zendesk conversation before drafting and do not repeat an
  answered question.
- Use requester identity and email already supplied by Zendesk. Ask only for
  missing technical evidence or an institutional identifier that is not in the
  ticket.
- SCCC wireless uses the requester's SCCC network username and password. Fred
  may identify those credentials but must never request the password or MFA
  code itself.
- SCCC IT can add, remove, or update Microsoft 365 licenses. Verify the intended
  application or entitlement and validate activation after the approved change.
- Fred-created Zendesk responses remain supervised drafts until a person
  reviews and sends the exact reply. Messaging replies are sent from the native
  Zendesk Agent Workspace.
- For an active-student password-reset or locked-account ticket, authorized CIO
  or help-desk staff may ask Fred to prepare an assisted reset link only after
  independently verifying the student in person with photo ID, by calling a
  number already on file, or by live video with photo ID. Ticket-supplied name,
  SCCC username, email, and 800 number are matching data, not proof. The student
  chooses the new password privately in OnlineKiosk, and no password or
  Temporary Access Pass belongs in Fred, Zendesk, Memory, or a process record.

## Updating training

Application rearrangements must update the route, top-menu configuration,
Quick Start, User Guide, Learn scenarios, and seeded Fred application guidance
together. Durable local procedures belong in Process Library; short facts and
response rules belong in Fred Memory. Editing one draft does not update future
Fred responses unless the correction is also written to one of those knowledge
surfaces.

See [quick-start-training-flow.mmd](quick-start-training-flow.mmd) for the
editable flow diagram.
