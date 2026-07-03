# SCCC IT Department Reporting — User Guide

A step-by-step guide to using the platform. The IT team uses this app to record daily and weekly work, track tasks and projects, log risks and incidents, keep network and Azure inventory, and roll everything up into weekly executive reports for the CIO.

---

## 1. Signing in

1. Go to the app URL and you'll land on the **Login** page.
2. Enter your **@sccc.edu email** and password, then click **Sign In**.
3. **New user?** Click **Register**, fill in your details, and submit. Your account stays **inactive until the CIO approves it** in Admin — you won't be able to log in until then.
4. **Forgot your password?** Ask the CIO to reset it in Admin. There's no automatic "change password on next login," so update it yourself once you're in.

---

## 2. Getting around (navigation)

There is **no fixed sidebar**. To move between pages:

1. Click the **Menu** button ("search or jump to any page") in the top header, or press **⌘K / Ctrl+K**.
2. Start typing a page name, or click one of the grouped items.

Pages are grouped as:

- **My Work** — Home/Dashboard, My Tasks, Weekly Log
- **Systems & Tools** — Network, Network Tools, Azure VMs, Azure Inventory, Monitoring, IT Apps, Process Library, AI Assistant
- **Reports & Records** — Risks & Issues, Post-Incident Reviews, Reports
- **Leadership & Admin** (CIO only) — Projects, Department Goals, Usage Analytics, Admin

The header also has **Quick Add** (fast new item) and **Ask AI** shortcuts.

---

## 3. Your day-to-day: My Tasks

Use **My Tasks** to capture work as it happens.

1. Open **My Tasks** from the menu.
2. Click **Add** (or **Quick Add** in the header).
3. Enter a **title**, **date**, **category**, and any **notes**.
4. Save. Repeat throughout the week.

These items are the raw material for your weekly log — you don't have to remember everything at week's end.

---

## 4. Your Weekly Log

At the end of the week, consolidate your work.

1. Open **Weekly Log**.
2. Create or **generate** the current week's entry — all of that week's **My Tasks items are rolled in automatically**.
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
- **IT Apps** — unified view of the other apps built for IT.

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

## 10. AI Assistant & AI Memory

Open **AI Assistant**. It has these tabs:

- **Ask AI** — chat with read access to your entries, risks, post-incident reviews, and network inventory. Great for summaries and questions ("Summarize the top 3 risks right now").
- **Status Report** (CIO only) — generate an executive status report.
- **AI Memory** — the assistant's **persistent knowledge** about the SCCC environment. Every active entry is fed into the AI's context.

Using AI Memory:
1. **Search** or **filter by category** to find what the AI already knows.
2. Click **Add memory** to teach it a new fact (device details, procedures, contacts, policies).
3. **Edit** any entry, or use the **toggle** to activate/deactivate it (inactive = ignored by the AI).
4. Only the **CIO can delete** entries.

The AI can also **save memories itself** — just tell it a durable fact or say "remember this," and you'll see a confirmation. **Never store passwords or secrets;** the system blocks credential-like content.

---

## 11. Admin & Usage Analytics (CIO)

- **Admin** — approve/activate new registrations, change roles, reset passwords, and deactivate accounts. Deactivating a user immediately ends their sessions.
- **Usage Analytics** — platform usage insights.

---

## 12. A typical week at a glance

**Staff member:**
1. Add items to **My Tasks** as work happens.
2. Log **Risks & Issues** and write **Post-Incident Reviews** for any incidents.
3. End of week: open **Weekly Log**, generate/submit the entry (task items roll in automatically).

**CIO:**
4. Open the week's **Report**, select the extras to include, review, then **Finalize** and **Export/Email**.

At any point, use the **AI Assistant** to draft summaries or answer questions about the data.

---

*The embedded AI Assistant also knows all of the above — you can ask it "how do I file a post-incident review?" or "how do I finalize a report?" and it will walk you through it.*
