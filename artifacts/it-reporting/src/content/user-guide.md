# SCCC IT Department Reporting — User Guide

A step-by-step guide to using the platform. The IT team uses this app to record daily and weekly work, track tasks and projects, log risks and incidents, keep network and Azure inventory, and roll everything up into weekly executive reports for the CIO.

---

## 1. Signing in

1. Go to the app URL and you'll land on the **Login** page.
2. Click **"Sign in with Microsoft"** and authenticate with your SCCC Microsoft (Entra ID) account. Access is limited to the IT team, so as long as you're in the authorized group you'll be signed straight in.
3. Your Hub account is **created automatically the first time** you sign in with Microsoft — there is no separate registration step.
4. **Can't get in?** Ask the CIO to confirm your IT group membership and role. (A break-glass email/password login exists only for designated emergency admin accounts, for use when Microsoft sign-in is unavailable.)

---

## 2. Getting around (navigation)

Use the top menu to move between the Hub's major work areas. You can also use
Search in the header when you know the destination by name.

The top menu is organized into category dropdowns. Click a **category title**
to open its landing page; click its separate chevron to open the category's
options:

- **Status & Reporting** — Status Dashboard and Weekly Reports
- **Campus Technology** — Buildings, Network Map, Monitoring, Cisco Webex Phones, Azure, and role-restricted Network Tools
- **Troubleshooting** — Support Center, Zendesk Monitor, Incident Rooms, Risks & Issues, Post-Incident Reviews, Process Library, and Learn
- **My Work** — To-do List, Completed Work, and Weekly Log
- **IT Apps** — App Directory, Banner, and High School Students
- **Administration** (CIO) — Projects, Department Goals, Usage Analytics, and Admin

The header also has a persistent **Fred** shortcut. Fred can list your accessible
to-dos and, after you confirm the exact change, create, edit, or complete them.
Mark and Tracy can also ask Fred to move a to-do to another team member.
Dashboard actions live together in the Quick Actions card.

### Dashboard ticket counts and Cisco Webex Phones

- The dashboard's **Zendesk Tickets Resolved** and **Team Submission Status** data use the same current six-person roster—Tracy, Mark, Maria, Lucas, Illia, and Craig—including a zero when someone has no activity in the selected period. Retired or former staff remain attached to historical records but are excluded from current-team status.
- **Cisco Webex Phones** is marked **New Feature** under **Campus Technology**. Use it for the phone directory, live device status, building assignments, and E-911 health.

### Building-first network support

1. Open **Campus Technology → Buildings**. Start on the live campus map; select a building marker to drill in. The same health-sorted building cards appear immediately below the map.
2. Select a building card—or its marker on the campus map—to open the building detail page.
3. Review the building's **Devices**, **VLANs**, or **Port Map** tab. The Port Map is scoped to that building's switches and stacks while retaining physical interface and LLDP/CDP evidence.
4. Use **Campus Technology → Network Map → Port Map** for the unfiltered, campus-wide engineering view.

Long dropdown lists are height-limited and scrollable. Use the mouse wheel, the visible scrollbar, arrow keys, Page Up/Page Down, or type the first letters of a switch name to move through the list.

---

## 3. Your day-to-day: To-dos and Completed Work

Use **To-do List** for work that still needs to happen:

1. Open **My Work → To-do List**.
2. Click **New to-do**, then add a title, details, due date, and priority.
3. Mark the item complete when the work is finished; click its title to edit it.
4. Mark and Tracy can view the whole team and assign or reassign work. Other users can create, view, edit, complete, and delete only their own items.

Use **Completed Work** to record finished tickets, installs, research, and project
work. Those completed-work records—not outstanding to-dos—are the raw material
for the weekly log.

---

## 4. Your Weekly Log

At the end of the week, consolidate your work.

1. Open **Weekly Log**.
2. Create or **generate** the current week's entry — all of that week's **Completed Work items are rolled in automatically**.
3. Review, add accomplishments/challenges/support-needed, and **submit**.

Notes:

- There is **one weekly log per person per week**.
- Once rolled in, past logs stay stable even if you edit the underlying items later.
- To write a log directly, use **Weekly Log → New**.

---

## 5. Risks & Issues

Track anything the team needs visibility on or a decision about.

1. Open **Risks & Issues**.
2. Click **New**.
3. Choose a **type** (risk / issue / design suggestion), set **severity** and **status**, and add a **title, description, and mitigation**.
4. Save. Edit later from the item's detail page.

Open risks can be pulled into the weekly report (see section 8).

---

## 6. Post-Incident Reviews

Document incidents after they're resolved.

1. Open **Post-Incident Reviews**.
2. Click **New**.
3. Fill in **title, incident date, outcome, summary, timeline, what went well, what went poorly, and action items**.
4. Save.

These can be included in the relevant week's report so leadership sees lessons learned.

---

## 7. Systems & Tools

### Zendesk Monitor

1. Open **Troubleshooting → Zendesk Monitor** to watch the open conversation queue and select a ticket.
2. Mark, Tracy, or the CIO can use the two supervisor switches to turn **Fred drafting** and **Zendesk replies** on or off for everyone. Each change requires confirmation and records who changed it.
3. Read the live Conversation Log, then select **Draft with Fred**. Fred saves the suggested response in the shared approval queue; she does not send it.
4. Edit Fred's draft, replace it with your own response, or select **Save for approval** so another signed-in team member can review it.
5. For email, web form, and other Support tickets, select **Approve & send** and approve the exact saved draft.
6. For a Messaging ticket, select **Copy & open Zendesk**, paste the copied draft into the Zendesk Messaging composer, review it, and send it there. Insights will not falsely report a Messaging ticket comment as delivered chat.
7. Use **Zendesk** in the ticket header whenever you need the full native agent workspace.
8. To hand off the issue, choose an active teammate under **Escalate to a team member**, add an optional private note, then review and confirm the reassignment.

The queue and shared drafts refresh every 15 seconds; the selected Conversation
Log refreshes every 5 seconds. Every public reply is confirmation-gated in both
the interface and the server API, so the operator can always stop or override
Fred.
Fred can also recommend an escalation in chat and, after you approve the exact
assignee, reassign the Zendesk ticket to that team member.
Turning **Zendesk replies** off blocks public comments at the server even if a
browser is stale. Turning **Fred drafting** off also blocks Fred's Zendesk write
tools. Escalation stays available so a supervisor can still hand urgent work to
a person.

### Network

- **Network** — searchable reference for **switches and VLANs** (hostname, building, IP, model; VLAN ID, subnet, gateway).
- **Network → Visualize** — the topology **diagram**. Node positions are saved and shared across the team.

### Network Tools (network-admin roles only)

- **FortiGate website whitelist** — add a URL to the FortiGate web-filter exemption list. Works only when the server can reach the FortiGate (on the SCCC network/VPN).
- **PowerShell generators** — Install Printer, Add Laptop, Remove Equipment. These produce a **downloadable `.ps1` file** to run on the target Windows machine; nothing runs on the server.

### Azure

- **Azure VMs** — cloud VM inventory. Everyone can view; only the CIO can add/edit/delete. Click **Sync from Azure** to pull the live list (preserves manual fields like purpose/notes/owner; flags removed VMs as deleted).
- **Azure Inventory** — all Azure resources grouped by type.

### Monitoring & IT Apps

- **Monitoring** — live Grafana dashboards embedded in the app.
- **IT Apps** — the top-menu category for the application directory, protected Banner/EUP operations, and High School Students access tools.

### Process Library

- Runbooks and documented procedures. Browse, open a procedure, or click **New** to add one. Document recurring fixes here so knowledge isn't lost.

---

## 8. Weekly Reports (CIO)

Reports aggregate everyone's weekly logs into one department report per week.

1. Open **Reports** and select the week.
2. In the report editor, choose the **extras** to include: Post-Incident Reviews, network maintenance windows, a goal-progress snapshot, and open risks.
3. Review the assembled report. Resolved **Zendesk tickets** for that week are pulled in automatically.
4. **Finalize** to lock it.
5. **Export** as DOCX, XLSX, or PDF — or **Email Report** to send a PDF/DOCX to recipients (requires SMTP to be configured).

---

## 9. Projects & Department Goals (CIO)

- **Projects** — track initiatives with status, % progress, target/revised dates, assignees, attachments, a progress log, and pending decisions. Create with **New**, then open a project to log progress or record decisions.
- **Department Goals** — strategic objectives / KPIs. Link projects to objectives; goal progress can be snapshotted into weekly reports.

---

## 10. Fred & Fred Memory

Open **Fred**. It has these tabs:

- **Ask Fred** — chat with read access to your entries, risks, post-incident reviews, and network inventory. Great for summaries and questions ("Summarize the top 3 risks right now").
- **Status Report** (CIO only) — generate an executive status report.
- **Fred Memory** — Fred's **persistent knowledge** about the SCCC environment. Every active entry is fed into Fred's context.

Using Fred Memory:

1. **Search** or **filter by category** to find what the AI already knows.
2. Click **Add memory** to teach it a new fact (device details, procedures, contacts, policies).
3. **Edit** any entry, or use the **toggle** to activate/deactivate it (inactive = ignored by the AI).
4. Only the **CIO can delete** entries.

The AI can also **save memories itself** — just tell it a durable fact or say "remember this," and you'll see a confirmation. **Never store passwords or secrets;** the system blocks credential-like content.

---

## 11. Admin & Usage Analytics (CIO)

- **Admin** — manage users: change roles, deactivate accounts, and (for break-glass accounts only) reset passwords. Deactivating a user immediately ends their sessions.
- **Usage Analytics** — platform usage insights.

---

## 12. A typical week at a glance

**Staff member:**

1. Track outstanding assignments in **To-do List**, then record finished work under **Completed Work**.
2. Log **Risks & Issues** and write **Post-Incident Reviews** for any incidents.
3. End of week: open **Weekly Log**, generate/submit the entry (completed-work items roll in automatically).

**CIO:** 4. Open the week's **Report**, select the extras to include, review, then **Finalize** and **Export/Email**.

At any point, use **Fred** to draft summaries or answer questions about the data.

---

_Fred also knows all of the above — you can ask "how do I file a post-incident review?" or "how do I finalize a report?" and Fred will walk you through it._
