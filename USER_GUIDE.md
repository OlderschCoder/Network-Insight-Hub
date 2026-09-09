# SCCC IT Insights Hub — User Guide

A step-by-step guide to using the platform. The IT team uses this app to record daily and weekly work, track tasks and projects, log risks and incidents, keep network and Azure inventory, and roll everything up into weekly executive reports for the CIO.

New to the rearranged portal? Open **Troubleshooting → Quick Start** for the
10-minute version. It explains the four workspaces, fixed sidebar, daily work
loop, supervised Zendesk drafting, and how to teach Fred.

---

## 1. Signing in

1. Go to the app URL and you'll land on the **Login** page.
2. Click **"Sign in with Microsoft"** and authenticate with your SCCC Microsoft (Entra ID) account. Access is limited to the IT team, so as long as you're in the authorized group you'll be signed straight in.
3. Your Hub account is **created automatically the first time** you sign in with Microsoft — there is no separate registration step.
4. **Can't get in?** Ask the CIO to confirm your IT group membership and role. (A break-glass email/password login exists only for designated emergency admin accounts, for use when Microsoft sign-in is unavailable.)

---

## 2. Getting around (navigation)

The Insights Home page presents four first-class workspaces:

- **Status & Reporting** — operational reporting, KPIs, submissions, and weekly reports
- **IT Tools & Network** — campus technology, buildings, monitoring, switching, telephony, and Azure
- **IT Apps** — the Applications launchpad for operational systems, reports, ACR, and student access
- **Troubleshooting** — the Support Center, Zendesk activity and supervision, diagnostics, response, and training

On inner pages, use the fixed sidebar or the four-position workspace switcher
at its top. **Apps** remains visible in that switcher from every workspace.
Search in the header can find any page by name.

The sidebar is grouped as:

- **Status & Reporting** — Status Dashboard and Weekly Reports
- **Campus Technology** — Buildings, Network Map, Monitoring, Cisco Webex Phones, Azure, and role-restricted Network Tools
- **Troubleshooting** — Quick Start, Support Center, Zendesk Monitor, Incident Rooms, Risks & Issues, Post-Incident Reviews, Process Library, Learn, and the full User Guide
- **My Work** — To-do List, Completed Work, and Weekly Log
- **IT Apps** — App Directory, Banner, and High School Students
- **Administration** (CIO only) — Projects, Department Goals, Usage Analytics, and Admin

The header also has persistent Search and **Fred** shortcuts. The Home and
Troubleshooting prompts open that same Fred experience with page context
prefilled; they do not create separate chats.

---

## 3. Your day-to-day: To-dos and Completed Work

Use **To-do List** for work that still needs to happen:

1. Open **My Work → To-do List**.
2. Click **New to-do**, then add a title, details, due date, and priority.
3. Mark the item complete when the work is finished; click its title to edit it.
4. Users granted **Manage Todos** can view the whole team and assign or reassign work. Other users can create, view, edit, complete, and delete only their own items.

Use **Completed Work** to record finished tickets, installs, research, and
project work. Those completed-work records—not outstanding to-dos—are the raw
material for the weekly log.

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

1. Open **Troubleshooting**. Under **ZENDESK SUPERVISION**, check the **Fred & reply controls** card, then select **Open Monitor** to watch the open conversation queue.
2. **Fred drafting** and **Zendesk replies** are separate, global controls. The CIO or a user granted **Manage Todos** can change them after confirming the exact switch change. Other signed-in users can view the state but cannot change it.
3. Select **Prepare open drafts** to let Fred review up to 25 loaded open tickets. She skips existing drafts, pending tickets, staff-last replies, internal-only activity, and escalation-only cases. Nothing sends.
4. Select a conversation, read the current thread, and choose **Draft with Fred** for one supervised suggestion.
5. Edit or replace the draft, then choose **Save for approval**. Fred never sends automatically.
6. For a Support ticket, choose **Approve & send** and confirm the exact saved reply. For a Messaging ticket, choose **Copy & open Zendesk**; Insights rechecks the global reply control immediately before copying or opening anything. Then review the draft in Zendesk Agent Workspace and send it there.
7. To hand off the issue, choose an active teammate, add an optional private note, and confirm the exact reassignment. Escalation remains available while Fred or public replies are paused.

Turning **Fred drafting** OFF blocks Fred-authored drafts, replies, internal
notes, and ticket changes. Turning **Zendesk replies** OFF blocks every public
send path; pending drafts remain drafts. When available, the monitor shows the
last operator and timestamp. If it says **Loading control status…**, wait. If
it says **Unavailable — status unknown**, both switches and dependent actions
remain disabled; choose **Retry controls** and never assume either control is
ON.

Every ticket write requires an explicit confirmation after the exact ticket,
audience, and change are shown. If a draft changed, reload and review it before
confirming again. An error or unavailable state is not success, and copying a
Messaging draft is not delivery.

### Network
- **Network** — searchable reference for **switches and VLANs** (hostname, building, IP, model; VLAN ID, subnet, gateway).
- **Network → Visualize** — the topology **diagram**. Node positions are saved and shared across the team.

### Network Tools (network-admin roles only)
- **FortiGate website whitelist** — add a URL to the FortiGate web-filter exemption list. Works only when the server can reach the FortiGate (on the SCCC network/VPN).
- **Install Printer** — authorized network staff select an exact driver registered on `prntsp2.sccc.edu`, then create or update the shared queue directly through Fred. Fred accepts only private campus IPv4 addresses, verifies TCP/9100 first, and displays the client UNC path. It never installs or guesses driver packages. If the driver list does not load, stop and report the service error instead of choosing an approximate model.
- **PowerShell generators** — Add Laptop and Remove Equipment still produce a **downloadable `.ps1` file** to run on the target Windows machine.

### Azure
- **Azure VMs** — cloud VM inventory. Everyone can view; only the CIO can add/edit/delete. Click **Sync from Azure** to pull the live list (preserves manual fields like purpose/notes/owner; flags removed VMs as deleted).
- **Azure Inventory** — all Azure resources grouped by type.

### Monitoring & IT Apps
- **Monitoring** — live Grafana dashboards embedded in the app.
- **IT Apps** — a first-class workspace available from Home, the workspace switcher, and the sidebar. Its App Directory launches Cisco Webex Phones, Banner/EUP operations, reports, ACR tools, and student-access systems.

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

Open **Fred** from the header, Home, or Troubleshooting. It has these tabs:

- **Ask Fred** — chat with read access to your entries, risks, post-incident reviews, and network inventory. Great for summaries and questions ("Summarize the top 3 risks right now").
- **Status Report** (CIO only) — generate an executive status report.
- **Architecture** — inspect enterprise architecture evidence and relationships.
- **CIO Insights** (CIO only) — review leadership-level operational signals.
- **Fred Memory** — Fred's **persistent knowledge** about the SCCC environment. Every active entry is fed into Fred's context.

Using Fred Memory:
1. **Search** or **filter by category** to find what the AI already knows.
2. Click **Add memory** to teach it a new fact (device details, procedures, contacts, policies).
3. **Edit** any entry, or use the **toggle** to activate/deactivate it (inactive = ignored by the AI).
4. Only the **CIO can delete** entries.

Fred can also **save memories herself** — tell her a durable fact or say
"remember this," and verify the saved entry. Editing a ticket draft does not by
itself train Fred; save the correction to Memory when it should affect future
answers. Use the **Process Library** for full repeatable procedures. **Never
store passwords or secrets;** the system blocks credential-like content.

Fred may search and read Zendesk tickets. Before any Zendesk or application
write, she must show the exact record, audience, and proposed values and receive
your explicit confirmation. Her own draft and an earlier broad request do not
count. A success message identifies the completed action; a blocked,
unavailable, or failed response means no success should be assumed.

---

## 11. Admin & Usage Analytics (CIO)

- **Admin** — manage users: change roles, deactivate accounts, and (for break-glass accounts only) reset passwords. Deactivating a user immediately ends their sessions.
- **Usage Analytics** — platform usage insights.

---

## 12. A typical week at a glance

**Staff member:**
1. Track outstanding assignments in **To-do List**, then record finished work under **Completed Work**.
2. Log **Risks & Issues** and write **Post-Incident Reviews** for any incidents.
3. End of week: open **Weekly Log**, generate/submit the entry (task items roll in automatically).

**CIO:**
4. Open the week's **Report**, select the extras to include, review, then **Finalize** and **Export/Email**.

At any point, use **Fred** to draft summaries or answer questions about the data.

---

*Fred also knows all of the above — you can ask "how do I file a post-incident review?" or "how do I finalize a report?" and she will walk you through it.*
