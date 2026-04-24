# SCCC IT Department Hub — Quick-Start Guide

Welcome! This guide explains what this site is for and exactly what each
person can do here. If you're not sure where to start, find your role
below and jump to the section labelled with it.

---

## What this site is

A single place for the SCCC IT department to:

- Log day-to-day work (Weekly Log, My Tasks)
- Track risks, incidents, and post-incident reviews
- Keep a living network inventory (switches, VLANs, Azure VMs)
- Document recurring procedures (Process Library)
- Pull weekly team reports together for leadership
- Ask an AI assistant questions about all of the above

Different people see slightly different menus depending on their role.
Everyone signs in once at `/login` and the site remembers you for the day.

---

## First time signing in

1. Open the site link your CIO emailed you.
2. Click **Login** and enter your SCCC email and password.
3. **Forgot your password?** Click the **Forgot password?** link on the
   login screen, type in your SCCC email, and follow the reset link sent
   to you. The link is good for one hour.
4. Once you're in, you'll land on either the **Dashboard** (CIO) or the
   **Home — My Work** view (everyone else).

If your account doesn't work or you don't have one yet, ask the CIO to
add you in **Admin → Users**.

---

## The five roles

| Role | What they mainly do here |
|---|---|
| **CIO** | Reviews everything; approves weekly team reports; manages users; creates projects and goals. |
| **Network Engineer** | Maintains the network inventory and after-action reports. |
| **Security Engineer** | Logs and tracks security risks; runs incident reviews. |
| **Help Desk** | Logs tickets and weekly work; flags risks. |
| **Staff** | Logs weekly work and tasks; can read most pages. |

For day-to-day use the only meaningful split is **CIO vs. everyone else**.
CIOs see two extra menu groups (**Leadership & Admin**) and can edit a
few things others can only view.

---

## Everyone (Staff, Help Desk, Network/Security Engineers)

These instructions apply to all non-CIO accounts.

### My Work

| Page | What to do here |
|---|---|
| **Home — My Work** (`/`) | Your landing page. Shows your open tasks and your weekly log status at a glance. |
| **My Tasks** (`/items`) | Add a quick to-do or follow-up item. Mark items done as you finish them. Use this for anything you don't want to forget. |
| **Weekly Log** (`/entries`) | Add one or more entries for the work you did this week. Pick a category (network, security, helpdesk, general). Your CIO pulls these into the team report on Friday. |

**Tip:** Try to log entries as the week goes on, not all at once on
Friday. The AI Assistant gets much better summaries when entries are
specific and timely.

### Knowledge

| Page | What to do here |
|---|---|
| **Network** (`/network`) | Browse switches and VLANs. Click a switch to see its maintenance log. You can add a maintenance note to any switch. **Visualizer** opens an interactive diagram; **Campus Map** shows building locations; **Export maintenance log** downloads a combined CSV/Markdown across every switch with optional building/author/date filters. |
| **Azure VMs** (`/azure-vms`) | Searchable list of all Azure VMs. Use the search box to filter by name, resource group, IP, or owner. Use **Prev / Next** to page through (25 per page). Click **Export CSV** to download whatever's currently filtered for use in Excel. |
| **Process Library** (`/processes`) | Read step-by-step procedures (offboarding, password resets, escalations, etc.). Open any process and use **Print**, **PDF**, or **Word** to print or share it offline. If you wrote a process, you'll also see **Edit** and **Delete**. |
| **AI Assistant** (`/ai-report`) | Ask questions like "Summarize the top 3 risks right now" or "Draft a Recent Wins section." The assistant has read access to entries, risks, after-action reports, and network inventory. Adjust **Lookback days** if you want it to consider older data. Use **Copy** to copy the conversation, **Clear** to start over. |

### Team

| Page | What to do here |
|---|---|
| **Risks & Issues** (`/risks`) | See open risks across the department. Click **+ New** to log a risk (give it a type, severity, probability, and a short description). Click any risk title to open its read-only **detail page** with all metadata and links to related project/device. From the detail page you can **Edit**, **Delete**, or **Archive** any risk you authored (CIO can do this for any risk). Archived risks drop out of the main list — ask your CIO if you need one restored. |
| **Post-Incident Reviews** (`/after-action`) | Record what happened during an incident — root cause, timeline, what worked, what didn't. These show up in the AI Assistant's lookups too. |
| **Reports** (`/reports`) | Read the published Weekly Team Reports the CIO sends out. You can't edit these, but you can open them and see exactly what your entries contributed to. |

### Projects & Goals (read-only for non-CIOs)

| Page | What to do here |
|---|---|
| **Projects** (`/projects`) | Browse projects the CIO is tracking. Open a project to see its team, milestones, linked risks, and progress. Use **Print / PDF / Word** to share a project summary. You cannot create or delete projects. |
| **Department Goals** (`/strategic-objectives`) | View the strategic objectives projects roll up to. Read-only. |

### Confirming destructive actions

Whenever you click **Delete** or **Archive** on anything you authored, a
small dialog appears in the middle of the page asking you to confirm.
The red **Delete** button means it's gone for good. The grey **Cancel**
button is always safe.

---

## CIO

You see everything above, plus:

### Leadership & Admin (sidebar group)

| Page | What you can do |
|---|---|
| **Projects** (`/projects`) | Create new projects with **+ New Project**, edit any field, link risks, assign team members, and delete projects you no longer need. Use **Print / PDF / Word** on a project detail page to share an executive snapshot. |
| **Department Goals** (`/strategic-objectives`) | Create, rename, archive, or delete strategic objectives. Each project can be linked to one or more objectives. |
| **Admin** (`/admin`) | Manage users — add new staff, change roles (CIO / Network Engineer / Security Engineer / Help Desk / Staff), or deactivate accounts when someone leaves. |

### Your home page is different

Your `/` is the **Management Dashboard** instead of My Work. It shows:

- **Team Submission Status** — who has and hasn't filed weekly entries.
- **Recent Activity** — latest entries, risks, after-action reports.
- **Global Metrics** — open risks, network status, project burn-down.

You still have your own My Tasks and Weekly Log pages — they're in the
sidebar under **My Work** like everyone else's.

### Weekly Team Report (CIO only)

`/reports/new` (or **+ New Report** from the Reports page).

Workflow:

1. Pick the week (defaults to last Monday in Central Time).
2. The system pulls every staff member's entries for that week and
   organises them into draft sections.
3. Edit the draft — combine, rewrite, or trim — then click **Save**.
4. When you're ready, click **Finalize** to lock the report (it cannot
   be edited after that). A confirmation dialog will ask you to confirm.
5. Optionally email the published report to a distribution list using
   the **Email Report** action.

Staff can read finalized reports under `/reports`.

### Risk oversight

You can edit, delete, or archive **any** risk in the system — not just
your own. Go to `/risks/<id>` and use the buttons in the toolbar.

### Process Library moderation

You can edit or delete any process, even ones you didn't write. Useful
for cleaning up obsolete procedures.

### Network diagram reset

On the Network Visualizer (`/network/visualize`), the **Reset diagram**
button restores the auto-layout for everyone. A confirmation dialog
warns you before it does.

---

## Print and export — what's available where

| Page | Print | PDF | Word | CSV |
|---|---|---|---|---|
| Process detail | ✓ | ✓ | ✓ | — |
| Project detail | ✓ | ✓ | ✓ | — |
| Azure VMs list | — | — | — | ✓ |
| Network → switch maintenance | — | — | Markdown | ✓ |
| Network → all switches | — | — | Markdown | ✓ |
| Weekly Team Report | ✓ (browser print) | — | — | — |

Downloads come straight from the server with your login attached, so
keep them on a trusted device.

---

## Common questions

**I can't see the Admin page.**
Only CIO accounts have it. If you need access, ask the CIO to change
your role in **Admin → Users**.

**I deleted something by accident — can I get it back?**
Risks can be **Archived** instead of deleted, and the CIO can restore
them. For everything else (entries, items, processes, projects), once
deleted it's gone. Always look for the styled confirmation dialog
before clicking the red button.

**The AI Assistant gave me a weird answer.**
Try increasing **Lookback days** if you're asking about older work, or
rephrase the question more concretely. Hit **Clear** to start a fresh
conversation if the chat is going off-track.

**I forgot my password again.**
Use **Forgot password?** on the login page. The reset link is good for
one hour and can only be used once.

**Who do I ask for help?**
Your CIO is the administrator of this site. They can fix accounts,
roles, and permissions.
