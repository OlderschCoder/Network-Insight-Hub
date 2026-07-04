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

const APP_USAGE_ENTRIES: { category: string; title: string; content: string }[] = [
  {
    category: "general",
    title: "Using the Platform: What this app is",
    content:
      "This is the SCCC IT Department Reporting platform. The IT team uses it to record daily/weekly work, track tasks and projects, log risks and incidents, keep network and Azure inventory, and roll everything up into weekly executive reports for the CIO. Roles: the CIO has full access (all reports, finalization, user management, projects, goals, analytics); other staff (help desk, network engineer, security engineer, staff) see their own work plus shared systems and records. When a user asks how to do something, point them to the correct page by name and give click-by-click steps.",
  },
  {
    category: "general",
    title: "Using the Platform: Navigation",
    content:
      "There is no fixed sidebar. Navigation is a command palette: click the 'Menu — search or jump to any page' button in the top header, or press Cmd/Ctrl+K, then type or click a destination. Pages are grouped into 'My Work' (Home/Dashboard, My Tasks, Weekly Log), 'Systems & Tools' (Network, Network Tools, Azure VMs, Azure Inventory, Monitoring, IT Apps, Process Library, AI Assistant, User Guide), 'Reports & Records' (Risks & Issues, Post-Incident Reviews, Reports), and a CIO-only 'Leadership & Admin' group (Projects, Department Goals, Usage Analytics, Admin). The header also has 'Quick Add' and 'Ask AI' shortcuts.",
  },
  {
    category: "general",
    title: "Using the Platform: Logging in and accounts",
    content:
      "Users sign in at /login by clicking 'Sign in with Microsoft' and authenticating with their SCCC Microsoft (Entra ID) account. Access is limited to the IT team via Entra group / app-role membership, so authorized users are signed straight in and their Hub account is created automatically on first sign-in — there is no separate self-registration step. A break-glass email/password login exists only for designated emergency admin accounts, for use when Microsoft sign-in is unavailable. If a user can't sign in, the CIO should confirm their IT group membership and role. If a user is deactivated, their active sessions are dropped immediately.",
  },
  {
    category: "general",
    title: "Using the Platform: My Tasks and the Weekly Log",
    content:
      "Throughout the week, staff add standalone action items on 'My Tasks' (/items) — quick title, date, category, and notes. When it's time to report, go to 'Weekly Log' (/entries) and create/generate the week's log entry; all of that week's task items are rolled into it and stamped to that weekly entry so past logs stay stable even if items are edited later. There is one weekly log per user per week. Use /entries/new to write it directly, or open a week to edit. Submitting the weekly log is what feeds the department's weekly report.",
  },
  {
    category: "general",
    title: "Using the Platform: Weekly Reports (CIO)",
    content:
      "Reports (/reports) aggregate everyone's weekly logs into one department report per week. Open a report (/reports/:id) to review it, then use the report editor to include extras for that week — Post-Incident Reviews, network maintenance windows, goal-progress snapshot, and open risks — via the selection cards. The CIO can Finalize a report (locks it), Delete it, and Export it as DOCX, XLSX, or PDF. 'Email Report' sends the PDF or DOCX to recipients over SMTP (needs SMTP settings configured). Resolved Zendesk tickets for the report's week are pulled in automatically.",
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
      "Post-Incident Reviews (/after-action, also called after-action reports) document incidents after they're resolved. Create one at /after-action/new: title, incident date, outcome, summary, timeline, what went well, what went poorly, and action items. These can be selected into the relevant week's report so leadership sees lessons learned.",
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
      "Network Tools (/network/tools) is visible only to network-admin roles (CIO, network, network engineer). It has two parts: (1) FortiGate website whitelist — add a URL to the FortiGate web-filter exemption list via live API (only works when the server can reach the FortiGate, i.e. on the SCCC network/VPN); and (2) client-side PowerShell script generators (Install Printer, Add Laptop, Remove Equipment) that produce a downloadable .ps1 file to run on the target Windows machine — nothing runs on the server.",
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
      "Monitoring (/monitoring) embeds live Grafana dashboards for at-a-glance system health. IT Apps (/it-apps) is a unified embedded view of the other apps built for the IT department. Both open external tools inside the platform so users don't have to hunt for links.",
  },
  {
    category: "general",
    title: "Using the Platform: Process Library",
    content:
      "Process Library (/processes) holds runbooks and documented procedures — the team's how-to knowledge for repeatable tasks. Browse existing procedures, open one at /processes/:id, or add a new one at /processes/new. Encourage staff to document recurring fixes here so knowledge isn't lost.",
  },
  {
    category: "general",
    title: "Using the Platform: AI Assistant and AI Memory",
    content:
      "AI Assistant (/ai-report) has tabs: 'Ask AI' (chat with read access to entries, risks, post-incident reviews, and network inventory — good for summaries and questions), 'Status Report' (CIO-only executive report generation), and 'AI Memory'. AI Memory is the assistant's persistent knowledge about the SCCC environment; every active entry is loaded into the AI's context. Users can search, filter by category, add, edit, and toggle memories on/off; only the CIO can delete. The AI can also save a memory itself when a user states a durable environment fact or says 'remember this' — a toast confirms what was saved. Never store passwords or secrets in AI Memory; the system blocks credential-like content.",
  },
  {
    category: "general",
    title: "Using the Platform: User Guide page",
    content:
      "There is a built-in User Guide page at /user-guide, in the 'Systems & Tools' menu group (labeled 'User Guide'). It contains the full written, step-by-step guide to the platform: signing in, My Tasks, Weekly Log, Risks & Issues, Post-Incident Reviews, Systems & Tools, Weekly Reports, Projects & Department Goals, AI Assistant, and Admin. When a user wants a detailed walkthrough or how-to instructions, point them to this User Guide page by name in addition to giving the quick steps.",
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
      "Recommended rhythm for a staff member: (1) add action items to My Tasks as work happens during the week; (2) log risks/issues and write Post-Incident Reviews for any incidents; (3) near end of week, open Weekly Log and generate/submit the week's entry (task items roll in automatically). For the CIO: (4) open the week's Report, select the extras to include (post-incident reviews, maintenance, goal progress, open risks), review, then Finalize and Export or Email it. Use the AI Assistant to draft summaries or answer questions about the data at any point.",
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
