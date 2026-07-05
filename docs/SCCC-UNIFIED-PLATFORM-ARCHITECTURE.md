# SCCC Unified Platform Architecture
**Version 1.0 — July 4, 2026**
**Author: Dr. Mark C. Bojeun, CIO**

---

## The Problem This Solves

Seven applications. One identity. One appserver. One team. The goal is not to merge them into one app — each surface serves a different audience with different needs and different trust levels. The goal is to make them one *platform*: shared infrastructure beneath, distinct experiences above.

---

## Platform Topology

```
                        Microsoft Entra ID (OIDC/PKCE)
                               │
              ┌────────────────┼────────────────┐
              │         SCCC Appserver           │
              │         10.5.0.1 (Azure)         │
              │                                  │
              │  ┌──────────────────────────┐    │
              │  │   Shared Services Layer  │    │
              │  │  • PostgreSQL (one DB)   │    │
              │  │  • Fred AI Engine        │    │
              │  │  • SMTP (O365 relay)     │    │
              │  │  • Banner ODBC           │    │
              │  │  • Exec Shell (gated)    │    │
              │  └──────────────────────────┘    │
              │                                  │
              │  Path-routed Express 5 API        │
              └────────────────┬─────────────────┘
                               │
         ┌─────────┬───────────┼───────────┬─────────┐
         │         │           │           │         │
      /acr    /itreport   /board-docs  /portal  /saints-connect
```

All apps share one Entra tenant, one PostgreSQL cluster (schema-separated), one deploy pipeline, and one AI engine. Each has its own React frontend, its own design system, and its own audience.

---

## The Seven Surfaces

### 1. SCCC_ACR — Academic Continuity Repository
**Audience:** Students, Faculty, Staff (read-only)
**Identity:** Entra SSO — role determines which views render
**Design language:** Institutional calm. Dark forest green header. Data-dense but clean. This is the failover system — when Canvas is down, people are stressed. The UI should not add to that.
**Unique interaction:** Students see courses, grades, account. Faculty see rosters, outage status. Staff see analytics dashboards. Same login, three completely different experiences.
**Path:** `/acr/` on appserver

**Current state:** On Replit. Migration target: appserver. Fixes deployed 2026-07-04.
**Next milestone:** pg_dump → restore → Entra redirect update → DNS cutover → cancel Replit.

---

### 2. SCCC_IT_HUB — IT Department Reporting
**Audience:** IT team only (Cecil, Craig, Illia, Lucas, Tracy, Mark)
**Identity:** Entra SSO — roles: cio / network_engineer / helpdesk / security_engineer / staff
**Design language:** Dark professional. Command-palette navigation. Density over decoration. This is the tool people use to log work, not admire.
**Unique interaction:** Command palette (Cmd/K) is the primary nav. Quick Add and Ask AI always visible in header. Fred is the persistent thread — he remembers what the team told him last week.
**Path:** `/itreport/` on appserver (currently at separate subdomain)

**Current state:** Deployed. Team goes live Monday 2026-07-07.

---

### 3. Board Repo — Governance Document Platform
**Audience:** Board members, President, Cabinet, public
**Identity:** Entra SSO for editing/admin; public read for published docs
**Design language:** Formal. White space. Institution letterhead feel. This replaced a $30K/year vendor. It should look like it cost more.
**Unique interaction:** Board members can comment on agenda items. Voting/motions recorded. Documents are versioned. Public portal is read-only with no login required for approved-public docs.
**Path:** `/board-docs/` on appserver

---

### 4. Mobile Portal — Student PWA
**Audience:** Students on phones
**Identity:** Entra SSO
**Design language:** Phone-first. Large tap targets. Bottom nav. Card-based. No sidebar, no tables, no dense dashboards.
**Unique interaction:** Courses, grades, account balance, emergency contacts. Offline-capable PWA — installable, works on flaky campus wifi.
**Path:** `/portal/` on appserver

---

### 5. Saints Connect — Community Platform
**Audience:** Students, Faculty, Staff, Alumni
**Identity:** Entra SSO for current; email-based for alumni
**Design language:** Warm, social. Distinct from the institutional tools. This is where community lives, not operations.
**Unique interaction:** Community boards, alumni directory, event announcements. Faculty office hours. Peer tutoring requests.
**Path:** `/saints-connect/` on appserver

---

### 6. SCCC NOC Dashboard — Network Operations
**Audience:** IT team (network-admin roles)
**Identity:** Entra SSO
**Design language:** Grafana-dark embedded within the IT Hub. Not a standalone app — it's a window into monitoring infrastructure.
**Unique interaction:** Live switch health, interface utilization, VPN tunnel state, building availability. Fred watches this data and alerts proactively.
**Path:** Embedded in IT Hub at `/itreport/monitoring` — Grafana at `10.0.0.22:3000` (private Azure VNet)

---

### 7. Auth_Page — Identity Gateway
**Audience:** All users
**Identity:** This IS the identity layer
**Design language:** SCCC branded. Clean. Single purpose.
**Unique interaction:** Break-glass login for non-Entra scenarios. MFA challenge handling. Onboarding flow for new staff accounts.
**Path:** `/auth/` — shared across all apps

---

## Shared Services Layer

### PostgreSQL — One Cluster, Schema-Separated
Each app owns its schema. Cross-app queries run as joins within the same cluster. No separate DB per app — that's how you end up with five places to look for a student record.

```
sccc_db
  ├── acr.*           (ACR tables — enrollment, courses, registrar)
  ├── itreport.*      (IT Hub — users, entries, risks, tasks, network)
  ├── board.*         (Board Repo — documents, agenda, votes)
  ├── portal.*        (Student PWA — lightweight mirror of ACR student data)
  └── connect.*       (Saints Connect — community, events, alumni)
```

Cross-schema reads (e.g., IT Hub AI pulling at-risk student data from ACR) require an explicit service account with read-only grants on the target schema. No app writes to another app's schema directly.

---

## Fred — The Platform AI

Fred is not a chatbot. Fred is the institutional intelligence layer. He knows the network, the team, the students, and the infrastructure. He gets smarter every week because the team keeps talking to him.

### Fred's Current Capabilities (IT Hub)
- Answer questions about switches, VLANs, Azure VMs, team logs, risks
- Write tasks to any team member's My Tasks (CIO delegates, anyone collaborates)
- Update network inventory from chat (network-admin role)
- Save durable facts to AI Memory
- Draft weekly status reports

### Fred's Constraint Philosophy (revised)

**Old rule:** Reject any input containing credential-like content.
**New rule:** REDACT and continue.

When Fred encounters a password, secret, or credential pattern in a switch config, a pasted CLI output, or any diagnostic data:
1. Replace the credential with `[REDACTED]` inline
2. Continue processing the rest of the content
3. Flag a one-line note: *"Credential detected and redacted — rotate that password."*
4. Never store the original in AI Memory or logs

This applies to: Aruba `password` fields, `enable secret`, SNMP community strings, API keys in config files, anything matching `password|secret|key|token|credential` patterns adjacent to a value.

Fred does not refuse to help because a config has a password in it. Fred redacts it and keeps working.

### Fred's Expanded Capabilities (Next Phase)

**Identity:** Fred has a service identity on the appserver — a dedicated service account (`fred@sccc.edu` or service principal) with:
- Read access to Active Directory (Get-ADUser, Get-ADGroupMember)
- ICMP to all monitored switch IPs (ping via exec shell)
- Test-NetConnection to known management ports (SSH 22, SNMP 161)
- Read-only SNMP queries to switches in inventory
- NO write access to AD. NO firewall policy changes. NO VLAN modifications from Fred's service account (those go through the IT Hub UI with role gates).

**Proactive Switch Health:** Fred runs a scheduled check (every 15 minutes) against the switch inventory:
- ICMP ping each switch IP
- If no response: check against last-seen in InfluxDB
- If InfluxDB also shows stale: escalate — create a Priority 1 alert, push to CIO via SMTP, create a Risk entry automatically
- If ICMP responds but SNMP is failing: flag a warning-level issue

**Task Delegation (corrected model):**
- Any authenticated user can assign tasks to any other user
- Fred writes to the target user's `log_items` with `assignedBy` attribution
- CIO delegates by name: "Have Cecil replace the SFP in CAH" → Fred matches Cecil from roster, creates the task, toasts confirmation to Mark
- Team collaboration: "Cecil and Illia are working on the CAH refresh" → Fred creates tasks for both
- Fred uses critical thinking on ambiguous statements — if it sounds like work that needs to be tracked, Fred tracks it; if it's a question, Fred answers it
- No hard rule that blocks cross-user task creation. The CIO is the manager. Managers assign work.

**Azure VM Alerting (Task #86):**
When Azure sync runs, Fred evaluates every VM against risk criteria:
- Public IP present + no NSG documented → HIGH risk alert to CIO
- VM status = Running but purpose = blank + owner = blank → flag for review
- VM missing from last sync (deleted in Azure but still in DB) → alert

Alert delivery: SMTP to mark.bojeun@sccc.edu + auto-create a Risk entry in IT Hub.

---

## Design System — Unified but Distinct

Each app has its own visual identity. They share one thing: the SCCC brand foundation.

| App | Primary Color | Navigation | Density | Audience Signal |
|-----|--------------|------------|---------|-----------------|
| ACR | Forest green `#2D5016` | Top bar + role-gated sidebar | Medium | Institutional reliability |
| IT Hub | Dark slate `#1E293B` | Command palette | High | Ops efficiency |
| Board Repo | White + navy `#1B2B5E` | Left nav + document tree | Low | Formal governance |
| Mobile Portal | SCCC blue `#0055A5` | Bottom nav (mobile) | Low | Student friendly |
| Saints Connect | Warm amber `#C17B00` | Top nav + community sidebar | Medium | Social warmth |
| NOC Dashboard | Grafana dark | Embedded iframe | Very high | Real-time ops |
| Auth Page | White + SCCC seal | Single focus | Minimal | Trust signal |

**Shared tokens** (defined once, imported per-app):
```css
--color-sccc-green: #2D5016;
--color-sccc-blue: #0055A5;
--color-sccc-gold: #C8960C;
--font-heading: 'Inter', sans-serif;
--font-body: 'Inter', sans-serif;
--radius-card: 8px;
--shadow-card: 0 1px 3px rgba(0,0,0,0.12);
```

Each app imports the token file and overrides only its primary palette. Component libraries (shadcn/ui base) are shared via the monorepo. Themes diverge at the app level.

---

## Deployment Architecture

```
appserver (10.5.0.1, Azure VM)
  └── nginx (reverse proxy)
       ├── / → ACR (Express + React, port 3001)
       ├── /itreport → IT Hub (Express + React, port 3002)
       ├── /board-docs → Board Repo (Express + React, port 3003)
       ├── /portal → Mobile PWA (React static, port 3004)
       ├── /saints-connect → Saints Connect (Express + React, port 3005)
       └── /auth → Auth gateway (port 3000)

NOC VM (10.0.0.22, private Azure VNet)
  └── Docker Compose
       ├── Grafana :3000
       ├── InfluxDB :8086
       └── Telegraf (SNMP, ICMP, syslog collectors)

Fred service (runs on appserver)
  └── Scheduled jobs (node-cron)
       ├── Switch health check: every 15 min
       ├── Azure VM risk scan: on sync completion
       └── Weekly AI red flags: Friday 4pm
```

**Deploy pipeline:** `git push origin main` → GitHub Actions → SSH to appserver → `git pull && pnpm install && pnpm build && systemctl restart sccc-[app]`

Each app is a separate systemd service. One deploy script per app. Rolling deploy — not all at once.

---

## Data Flow — The MDM Principle

All data flows in one direction: authoritative source → read-only connector → local PostgreSQL cache.

```
Banner SIS (ODBC on appserver)
  └── nightly delta → acr.enrollment_detail, acr.banner_registration

Canvas LMS (API)
  └── nightly → acr.courses, acr.enrollments

Ellucian Ethos (REST)
  └── on-demand → acr.student_profile supplements

Azure ARM (service principal)
  └── on-demand sync → itreport.azure_vms

Aruba switches (SNMP + REST)
  └── every 15 min → itreport.network_switches (health/status)
  └── on-demand → Fred proactive health check

Grafana/InfluxDB (private VNet)
  └── read-only → NOC dashboard embed
```

No app writes back to Banner. No app writes back to Canvas. They are authoritative sources. We read them. We cache them. We make them faster and more resilient. That is the MDM contract.

---

## The Convergence Roadmap

**Phase 1 — Complete (July 4, 2026)**
- IT Hub live with AI Memory, task delegation, network inventory writes
- ACR enrollment dashboard fixes deployed
- Shared Entra tenant across both platforms

**Phase 2 — This Month**
- ACR migrated from Replit to appserver
- Banner ODBC moved from Mark's machine to appserver (automated nightly sync)
- Fred REDACT behavior implemented (stops rejecting configs with passwords)
- Fred proactive switch health checks live
- Task delegation cross-user (CIO assigns to Cecil, etc.)

**Phase 3 — Next Quarter**
- Azure VM risk alerting (Task #86)
- At-risk student email automation (GPA < 2.5 → high school SMTP)
- Fred weekly red flags report (auto-generated, delivered Friday)
- Board Repo on appserver

**Phase 4 — End of Year**
- Saints Connect launch
- Mobile Portal (PWA) launch
- Fred cross-platform: IT Hub AI can read ACR enrollment data for at-risk correlation
- Zendesk AI integration (webhook → Fred → private ticket note)

---

## What This Is Not

This is not a portal. A portal aggregates links. This is a platform — shared data, shared identity, shared intelligence, distinct experiences per audience.

Each app should feel purpose-built for its users. A student should never feel like they're in an IT tool. A board member should never feel like they're in a helpdesk system. A network engineer should have exactly the density and control they need without wading through student-facing chrome.

The unification happens at the infrastructure layer, invisibly. Fred is the one thing that knows everything. Every surface feeds him. He feeds the CIO.

---

## Open Decisions

1. **Saints Connect** — does it require FERPA-gated alumni separation from current students? Define data sharing boundary before building.
2. **Fred's PowerShell scope** — ping and Test-NetConnection confirmed. Get-ADUser confirmed. Define the explicit allow-list before deployment to avoid scope creep.
3. **Cross-schema reads** — Fred reading ACR student data from IT Hub requires explicit data governance decision. Who approves? What's the audit log? Define before Phase 4.
4. **Board Repo public access** — what docs are public vs. board-only vs. cabinet-only? Three access tiers need to be mapped before build.

---

*This document is the authoritative architectural reference. Update it when the architecture changes. Do not let the code drift from this document silently — if they diverge, update one of them.*
