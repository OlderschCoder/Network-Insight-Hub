import { and, eq, like, sql } from "drizzle-orm";
import { db, aiKnowledgeTable } from "@workspace/db";
import { logger } from "./logger";

// Arbitrary constant key for a Postgres advisory lock so concurrent app
// instances/restarts can't run the delete+insert at the same time.
const SEED_LOCK_KEY = 748213001;

// "How to use this platform" knowledge injected into every AI prompt so the
// embedded assistant can guide users. Seeded on server startup (idempotent) so
// the knowledge exists in whatever database the app is connected to — including
// the production database, which is provisioned fresh (schema only) on publish.
const TITLE_PREFIX = "Using the Platform:";

const APP_USAGE_ENTRIES: {
  category: string;
  title: string;
  content: string;
}[] = [
  {
    category: "general",
    title: "Using the Platform: What this app is",
    content:
      "This is the SCCC IT Department Portal, also called Insights. The Home command center at / is the shared starting point for reporting, campus technology, and troubleshooting. The IT team uses the portal to record weekly work, track tasks and projects, log risks and incidents, maintain network and Azure evidence, work Zendesk tickets, and prepare weekly executive reports. Roles: the CIO has full access (all reports, finalization, user management, projects, goals, analytics); other staff see their own work plus shared systems and records. When a user asks how to do something, use the current application guidance, point to the correct page by name, and give click-by-click steps.",
  },
  {
    category: "general",
    title: "Using the Platform: Navigation",
    content:
      "Use the top menu to choose Status & Reporting (/status), Campus Technology (/network/buildings), Troubleshooting (/support), My Work (/todos), IT Apps (/it-apps), or CIO-only Administration (/projects). Clicking a category title opens its landing page; clicking the separate chevron opens that category's dropdown destinations. The top bar also provides search (Cmd/Ctrl+K), theme, Fred, alerts, and account controls. IT Apps launches Cisco Calling, Banner, IT Calls (1200), ETHOS EUP, ACR Analytics, and Continuity LMS.",
  },
  {
    category: "general",
    title: "Using the Platform: Logging in and accounts",
    content:
      "Users sign in at /login by clicking 'Sign in with Microsoft' and authenticating with their SCCC Microsoft (Entra ID) account. Access is limited to the IT team via Entra group / app-role membership, so authorized users are signed straight in and their Hub account is created automatically on first sign-in — there is no separate self-registration step. A break-glass email/password login exists only for designated emergency admin accounts, for use when Microsoft sign-in is unavailable. If a user can't sign in, the CIO should confirm their IT group membership and role. If a user is deactivated, their active sessions are dropped immediately.",
  },
  {
    category: "general",
    title: "Using the Platform: To-dos, completed work, and the Weekly Log",
    content:
      "Use To-do List (/todos) for outstanding assignments, priorities, due dates, and completion status. Fred can list accessible to-dos and, after showing the exact item/change and receiving confirmation, create, edit, or complete them. Mark and Tracy can also ask Fred to move (reassign) any team member's to-do; everyone else can create and manage only their own. Completed Work (/items) is separate: staff record finished tickets, installs, research, and project work there so it rolls into the Weekly Log. When it's time to report, go to Weekly Log (/entries) and generate the week's entry. There is one weekly log per user per week, and submitting it feeds the department weekly report.",
  },
  {
    category: "general",
    title: "Using the Platform: Weekly Reports (CIO)",
    content:
      "Reports (/reports) aggregate everyone's weekly logs into one department report per week. Open /reports/:id to edit the title, summary, accomplishments, challenges, strategic progress, next-week plans, selected work items, custom tasks, projects, Post-Incident Reviews, maintenance, risks, cloud/goal inclusion, and email recipients. The CIO can create, edit, finalize, delete, export, or email a report. Fred can create, edit, or finalize these reports only for the CIO and only after showing the exact change and receiving confirmation. Resolved Zendesk tickets for the report's week are pulled in automatically.",
  },
  {
    category: "general",
    title: "Using the Platform: Risks & Issues",
    content:
      "Risks & Issues (/risks) tracks open risks, issues, and design suggestions. Create one at /risks/new with a type (risk/issue/design), severity, status, title, description, and mitigation. Edit at /risks/:id/edit. Open risks can be pulled into a weekly report from the report editor. Use this page for anything the team needs visibility on or a decision about.",
  },
  {
    category: "general",
    title: "Using the Platform: Post-Incident Reviews",
    content:
      "Post-Incident Reviews (/after-action, also called after-action reports) document incidents after they're resolved. Create or edit title, incident description/date, building, device type, affected systems, timeline, root cause, resolution, lessons learned, prevention measures, severity, status, and linked Zendesk ticket. Staff may manage their own reviews; the CIO may manage any. Fred can create or edit a PIR after showing the exact change and receiving explicit confirmation. PIRs can be selected into the relevant weekly report so leadership sees the lessons learned.",
  },
  {
    category: "general",
    title: "Using the Platform: Projects and Department Goals (CIO)",
    content:
      "Projects (/projects, CIO group) track initiatives with status, percent progress, target and revised dates, assignees, attachments, a progress log, and pending decisions. Create at /projects/new, open detail at /projects/:id to log progress or record decisions. Department Goals (/strategic-objectives) hold strategic objectives/KPIs; projects can be linked to objectives, and goal progress can be snapshotted into weekly reports.",
  },
  {
    category: "general",
    title: "Using the Platform: Network reference and topology",
    content:
      "Network (/network) is the reference for switches and VLANs with search tabs, seeded from SCCC inventory. /network/visualize shows the topology diagram (React Flow); node positions are saved and shared across users (last writer wins; the CIO can reset layout). Use this to look up a switch's hostname, building, IP, model, or a VLAN's ID, subnet, and gateway.",
  },
  {
    category: "general",
    title: "Using the Platform: Network Tools",
    content:
      "Network Tools (/network/tools) is visible only to network-admin roles (CIO, network, network engineer). It has two parts: (1) FortiGate website whitelist — add a URL to the FortiGate web-filter exemption list via live API (only works when the server can reach the FortiGate, i.e. on the SCCC network/VPN); and (2) client-side PowerShell script generators (Install Printer, Add Laptop, Remove Equipment) that produce a downloadable .ps1 file to run on the target Windows machine — nothing runs on the server. Day-to-day phone support for the wider IT team is under IT Apps > Cisco Calling (/it-apps/cisco-calling), not Network Tools.",
  },
  {
    category: "general",
    title: "Using the Platform: Azure VMs and Inventory",
    content:
      "Azure VMs (/azure-vms) is the cloud VM inventory. Anyone can view; only the CIO can add/edit/delete. Click 'Sync from Azure' to pull the live VM list from the subscription — it updates existing rows, preserves manual fields (purpose, notes, owner), and flags VMs that no longer exist as deleted. Azure Inventory (/azure-inventory) shows all Azure resources grouped by type. Both require the Azure service-principal credentials to be configured.",
  },
  {
    category: "general",
    title: "Using the Platform: Monitoring and IT Apps",
    content:
      "Monitoring (/monitoring) embeds live Grafana dashboards for at-a-glance system health. IT Apps (/it-apps) is Fred's shared launcher for operational systems: Cisco Calling (/it-apps/cisco-calling), Banner (/banner), IT Calls (1200) (/it-apps/webex-calling), ETHOS EUP, ACR Analytics Dashboard (/acr/analytics/), and Continuity LMS (/acr/continuity/). Use IT Apps when a user asks where one of those shared tools lives.",
  },
  {
    category: "general",
    title: "Using the Platform: Process Library",
    content:
      "Process Library (/processes) holds runbooks and documented procedures — the team's how-to knowledge for repeatable tasks. Browse existing procedures, open one at /processes/:id, or add a new one at /processes/new. Encourage staff to document recurring fixes here so knowledge isn't lost.",
  },
  {
    category: "general",
    title: "Using the Platform: Zendesk tickets with Fred",
    content:
      "Troubleshooting (/support) shows recent Zendesk activity and opens diagnostic workflows. Fred can search and read tickets, create a ticket, edit its subject/status/priority/assignment, and add public replies or internal notes. Fred can also solve a specific confirmed list of tickets. In Zendesk, 'close' should be treated as 'solve'; Zendesk automation applies the final irreversible Closed state later. Before any ticket write, Fred must show the exact ticket or ticket IDs and proposed change and receive explicit confirmation. An unbounded request such as 'close all tickets' is not enough—Fred must search, present the exact set, and ask for confirmation.",
  },
  {
    category: "general",
    title: "Using the Platform: Fred and Fred Memory",
    content:
      "Fred (/ai-report) can answer operational questions, guide users through the whole portal, list accessible to-dos, create or complete confirmed to-dos, let Mark or Tracy move confirmed to-dos between team members, work with confirmed Zendesk tickets, manage confirmed Post-Incident Reviews and weekly logs within the user's permissions, and let the CIO create, edit, or finalize confirmed weekly status reports. Fred Memory is persistent knowledge about the SCCC environment; every active entry is loaded into Fred's context. Users can search, filter, add, edit, and toggle memories; only the CIO can delete. Never store passwords or secrets in Fred Memory; the system blocks credential-like content.",
  },
  {
    category: "general",
    title: "Using the Platform: User Guide page",
    content:
      "The built-in User Guide at /user-guide contains the full written, step-by-step guide to signing in, Home, Status, To-do List, Completed Work, Weekly Log, Risks & Issues, Post-Incident Reviews, Network and IT Tools, Troubleshooting, Weekly Reports, Projects, Department Goals, Fred, and Admin. When a user wants a detailed walkthrough, give the immediate click-by-click steps and link to the User Guide for the longer reference.",
  },
  {
    category: "general",
    title: "Using the Platform: Admin and Usage Analytics (CIO)",
    content:
      "Admin (/admin, CIO only) manages users: change roles, deactivate accounts (which immediately ends their sessions), and reset passwords for break-glass emergency accounts. New users are provisioned automatically on first Microsoft sign-in, so there is no manual registration-approval step. Usage Analytics (/analytics, CIO only) shows platform usage insights. These are the CIO's control surfaces for access and adoption.",
  },
  {
    category: "general",
    title: "Using the Platform: Typical weekly workflow",
    content:
      "Recommended rhythm: (1) start at Home and use Status for current workload; (2) track outstanding assignments in To-do List, then record finished work under Completed Work; (3) log risks/issues and write Post-Incident Reviews for incidents; (4) near week-end, generate, review, and submit the Weekly Log; (5) the CIO opens the weekly Report, selects PIRs, maintenance, goal progress, open risks, and other extras, then finalizes and exports or emails it. Fred can guide each step and, after showing the exact change and receiving confirmation, can create or edit the relevant supported records within the signed-in user's permissions.",
  },
];

// Idempotent: removes the previously seeded app-usage rows (identified by the
// title prefix + source 'seed') and re-inserts the current set, so the content
// stays in sync with this file across restarts and deployments.
export async function seedAppUsageKnowledge(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Serialize concurrent seeders (multiple instances / overlapping restarts)
      // so delete+insert can't interleave into duplicate rows. Lock is released
      // automatically when the transaction ends.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
      await tx
        .delete(aiKnowledgeTable)
        .where(
          and(
            eq(aiKnowledgeTable.source, "seed"),
            like(aiKnowledgeTable.title, `${TITLE_PREFIX}%`),
          ),
        );
      await tx.insert(aiKnowledgeTable).values(
        APP_USAGE_ENTRIES.map((e) => ({
          category: e.category,
          title: e.title,
          content: e.content,
          source: "seed",
          isActive: true,
        })),
      );
    });
    logger.info(
      { count: APP_USAGE_ENTRIES.length },
      "Seeded app-usage AI knowledge",
    );
  } catch (err) {
    logger.error({ err }, "Failed to seed app-usage AI knowledge");
  }
}
