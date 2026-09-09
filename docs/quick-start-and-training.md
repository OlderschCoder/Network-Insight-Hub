# Insights Quick Start and Fred training

The authenticated portal exposes a concise Quick Start at `/quick-start`. It is
available under **Troubleshooting** in the fixed sidebar and from the Support
Center's **Guides and practice** card. The full User Guide remains at
`/user-guide`.

## Current interface orientation

Insights opens on a Home command center with four first-class workspaces:
**Status & Reporting**, **IT Tools & Network**, **IT Apps**, and
**Troubleshooting**. Inner pages retain a four-position workspace switcher at
the top of the sidebar. **Apps** stays visible there from every mode; selecting
it opens the shared App Directory rather than a duplicate set of links.

The header's **Fred** shortcut and the prompt on Home or Troubleshooting all
open the same `/ai-report` experience. A prompt may be prefilled from the page
the user was viewing, but conversations, confirmation rules, memory, and role
checks do not change.

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

- Start Zendesk work in **Troubleshooting**. The **ZENDESK SUPERVISION** card,
  headed **Fred & reply controls**, displays **Fred drafting** and **Zendesk
  replies** independently; **Open Monitor** opens `/support/zendesk`.
- If the control card says **Loading control status…**, wait. If it says
  **Unavailable — status unknown**, use **Retry controls** and do not assume
  either control is ON.
- Only the CIO or an account with the existing Manage Todos capability may
  change a global control. Every change has its own confirmation. The monitor
  displays the latest actor and timestamp when available.
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
- Turning **Fred drafting** OFF blocks Fred-authored drafts and Zendesk writes.
  Turning **Zendesk replies** OFF blocks every public send path. Confirmed human
  escalation remains available in either state.

## Updating training

Application rearrangements must update the route, sidebar/workspace
configuration, Quick Start, User Guide, Learn scenarios, and seeded Fred
application guidance together. Durable local procedures belong in Process
Library; short facts and response rules belong in Fred Memory. Editing one
draft does not update future Fred responses unless the correction is also
written to one of those knowledge surfaces.

See [quick-start-training-flow.mmd](quick-start-training-flow.mmd) for the
editable flow diagram.
