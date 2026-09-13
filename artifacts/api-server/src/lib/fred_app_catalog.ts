export type FredApplicationPage = {
  name: string;
  routes: string[];
  menu: string;
  access: string;
  purpose: string;
  functions: string[];
  fredDirect: string[];
  fredGuides: string[];
};

/**
 * Release-owned catalog of every routable Insights surface. This is the
 * authoritative source for Fred's navigation, permission, and capability
 * answers; it deliberately separates actions Fred can perform from actions
 * that still require a person to use the page.
 */
export const FRED_APPLICATION_PAGES: FredApplicationPage[] = [
  {
    name: "Design System",
    routes: ["/design-system"],
    menu: "Internal development route; not shown in normal navigation",
    access: "Internal UI reference",
    purpose: "Preview the portal's reusable visual components and tokens.",
    functions: ["Review component states, typography, colors, and controls"],
    fredDirect: [],
    fredGuides: [
      "Explain that this is a developer reference, not an operational workspace",
    ],
  },
  {
    name: "Sign in and break-glass recovery",
    routes: ["/login", "/forgot-password", "/reset-password"],
    menu: "Signed-out entry points",
    access:
      "Microsoft sign-in for staff; local recovery only for designated break-glass accounts",
    purpose:
      "Authenticate an authorized IT employee or recover a configured emergency account.",
    functions: [
      "Sign in with Microsoft",
      "Request a break-glass reset link",
      "Complete a time-limited break-glass reset",
    ],
    fredDirect: [],
    fredGuides: [
      "Direct ordinary staff to Microsoft sign-in",
      "Explain that these forms do not reset student or ordinary Entra accounts",
    ],
  },
  {
    name: "Home command center",
    routes: ["/"],
    menu: "SCCC logo / Home",
    access: "All authenticated IT staff",
    purpose:
      "Provide the shared operational starting point and current priorities.",
    functions: [
      "Open category workspaces",
      "Review urgent work and service summaries",
      "Launch common actions",
    ],
    fredDirect: [
      "Search current team work and live operational evidence through approved tools",
    ],
    fredGuides: [
      "Direct the user to the correct top-menu category and destination",
    ],
  },
  {
    name: "Status Dashboard",
    routes: ["/status"],
    menu: "Status & Reporting -> Status Dashboard",
    access: "All authenticated IT staff",
    purpose:
      "Summarize campus health, open work, reporting status, and operational activity.",
    functions: [
      "Review current health cards",
      "Open the underlying ticket, report, risk, incident, or system page",
    ],
    fredDirect: [
      "Query current network, monitoring, Azure, Zendesk, and team-work evidence",
    ],
    fredGuides: [
      "Explain each dashboard metric and link the user to its owning page",
    ],
  },
  {
    name: "Zendesk Monitor",
    routes: ["/support/zendesk"],
    menu: "Troubleshooting -> Zendesk Monitor",
    access:
      "All authenticated IT staff; supervisor controls are limited to Mark, Tracy, and CIO-authorized roles",
    purpose:
      "Monitor live ticket conversations and supervise Fred's reply drafts.",
    functions: [
      "Select and refresh a ticket",
      "Prepare open drafts",
      "Draft with Fred",
      "Edit, save, approve, copy, or clear a draft",
      "Send supported public replies",
      "Open Messaging in Zendesk",
      "Escalate or reassign",
      "Control Fred drafting and Zendesk replies",
    ],
    fredDirect: [
      "Search and read tickets",
      "Create a ticket",
      "Draft and save reviewable replies",
      "Add confirmed comments",
      "Update confirmed ticket fields",
      "Escalate confirmed tickets",
      "Solve an exact confirmed ticket list",
    ],
    fredGuides: [
      "Explain Messaging copy-and-send limitations",
      "Identify when an operator must review or send in Zendesk Agent Workspace",
    ],
  },
  {
    name: "Support Center",
    routes: ["/support"],
    menu: "Troubleshooting -> Support Center",
    access: "All authenticated IT staff",
    purpose:
      "Start from a symptom and reach the relevant live diagnostic or support workflow.",
    functions: [
      "Describe or choose a common symptom",
      "Review recent Zendesk activity",
      "Open network, monitoring, building, calling, and student-access tools",
    ],
    fredDirect: [
      "Run approved read-only diagnostics and retrieve current ticket evidence",
    ],
    fredGuides: [
      "Narrow the issue and direct the user to the correct diagnostic workspace",
    ],
  },
  {
    name: "Completed Work",
    routes: ["/items"],
    menu: "My Work -> Completed Work",
    access: "All authenticated IT staff; ownership rules apply",
    purpose: "Record completed tasks and accomplishments for weekly reporting.",
    functions: [
      "Create completed-work items",
      "Edit or remove owned items",
      "Link work to the weekly reporting cycle",
    ],
    fredDirect: [
      "Create attributed completed-work items for the signed-in user or an explicitly named active teammate",
    ],
    fredGuides: [
      "Guide edits and deletions that do not have an approved Fred tool",
    ],
  },
  {
    name: "To-do List",
    routes: ["/todos"],
    menu: "My Work -> To-do List",
    access:
      "Users see their own items; Mark and Tracy can view and manage the team",
    purpose:
      "Track outstanding assignments, owners, priorities, due dates, and completion.",
    functions: ["Create, edit, complete, filter, and reassign to-dos"],
    fredDirect: [
      "List permitted to-dos",
      "Create, edit, or complete an exact confirmed item",
      "Let Mark or Tracy reassign an exact confirmed item",
    ],
    fredGuides: ["Explain personal versus team visibility"],
  },
  {
    name: "Weekly Log",
    routes: ["/entries", "/entries/new", "/entries/:id", "/entries/:id/edit"],
    menu: "My Work -> Weekly Log",
    access: "Staff manage their own logs; the CIO can manage any log",
    purpose:
      "Assemble each employee's weekly accomplishments, challenges, support needs, tags, and linked tickets.",
    functions: [
      "List weekly logs",
      "Create or generate a log",
      "Review details",
      "Edit and submit a log",
    ],
    fredDirect: [
      "Create or edit a confirmed weekly log within the signed-in user's permission",
    ],
    fredGuides: ["Explain generation, review, and submission steps"],
  },
  {
    name: "Department Weekly Reports",
    routes: ["/reports", "/reports/:id"],
    menu: "Status & Reporting -> Weekly Reports",
    access: "CIO-managed department reporting",
    purpose:
      "Combine submitted logs and selected operational evidence into the department report.",
    functions: [
      "Create and edit reports",
      "Select work, projects, PIRs, maintenance, risks, goals, and cloud evidence",
      "Finalize, export, email, or delete a report",
    ],
    fredDirect: [
      "For the CIO, create, edit, or finalize an exact confirmed report",
    ],
    fredGuides: [
      "Guide selection, export, email, and deletion workflows that remain page-controlled",
    ],
  },
  {
    name: "Projects",
    routes: ["/projects", "/projects/new", "/projects/:id"],
    menu: "Administration -> Projects",
    access: "CIO-only",
    purpose:
      "Track initiatives, dates, owners, progress, attachments, and decisions.",
    functions: [
      "List and create projects",
      "Edit project details",
      "Log progress",
      "Record decisions",
      "Manage attachments and status",
    ],
    fredDirect: [
      "Read project context supplied by the application and search related team work",
    ],
    fredGuides: [
      "Provide exact project-page steps; Fred has no general project write tool",
    ],
  },
  {
    name: "Department Goals",
    routes: ["/strategic-objectives"],
    menu: "Administration -> Department Goals",
    access: "CIO-only",
    purpose:
      "Manage strategic objectives, KPIs, progress, and project alignment.",
    functions: [
      "Create and edit objectives",
      "Track KPI progress",
      "Link projects",
      "Include goal progress in reports",
    ],
    fredDirect: ["Read goal context supplied to the conversation"],
    fredGuides: [
      "Provide exact page steps; Fred has no general goal write tool",
    ],
  },
  {
    name: "Risks & Issues",
    routes: ["/risks", "/risks/new", "/risks/:id", "/risks/:id/edit"],
    menu: "Troubleshooting -> Risks & Issues",
    access: "All authenticated IT staff subject to record permissions",
    purpose:
      "Track risks, issues, design suggestions, severity, status, and mitigation.",
    functions: [
      "List and filter records",
      "Create a risk, issue, or design item",
      "Review or edit details",
      "Include open risks in weekly reports",
    ],
    fredDirect: ["Read risk context supplied by the application"],
    fredGuides: [
      "Provide exact creation and editing steps; Fred has no general risk write tool",
    ],
  },
  {
    name: "Buildings",
    routes: [
      "/network/buildings",
      "/network/buildings/:name",
      "/network/buildings/embed",
    ],
    menu: "Campus Technology -> Buildings",
    access: "Authenticated page; embed is an internal display surface",
    purpose:
      "Show the saved campus map, building health, mapped devices, VLANs, and building detail.",
    functions: [
      "Open a building from the map or cards",
      "Review health and device evidence",
      "Edit and save the shared map with authorized controls",
    ],
    fredDirect: [
      "Query current building health, devices, VLANs, links, and corroborating phone evidence",
    ],
    fredGuides: [
      "Explain map editing and saved-layout controls that remain page-controlled",
    ],
  },
  {
    name: "Network Inventory",
    routes: ["/network"],
    menu: "Campus Technology -> Network Map",
    access: "All authenticated IT staff; write actions are role-gated",
    purpose: "Search and maintain switch and VLAN inventory.",
    functions: [
      "Search switches and VLANs",
      "Open switch details",
      "Add or update approved inventory records",
    ],
    fredDirect: [
      "Query inventory",
      "Update an exact switch or VLAN after verified user evidence",
    ],
    fredGuides: [
      "Explain filters, fields, permissions, and links to topology or port views",
    ],
  },
  {
    name: "Network Topology and Port Map",
    routes: ["/network/visualize", "/network/map"],
    menu: "Campus Technology -> Network Map",
    access: "All authenticated IT staff; shared layout changes are governed",
    purpose:
      "Visualize nodes, links, switch ports, learned endpoints, VLANs, and campus paths.",
    functions: [
      "Search and trace topology",
      "Inspect every-port telemetry",
      "Move and save shared topology nodes",
      "Use CIO reset/restore controls where available",
    ],
    fredDirect: [
      "Query topology paths, reciprocal links, port telemetry, endpoints, errors, optics, and VLANs",
    ],
    fredGuides: [
      "Explain shared layout editing and controls Fred cannot manipulate directly",
    ],
  },
  {
    name: "Network Node Detail",
    routes: ["/network/nodes/:id"],
    menu: "Opened from Network Map",
    access: "All authenticated IT staff",
    purpose:
      "Inspect one network node and its current inventory and relationship details.",
    functions: [
      "Review node identity, building, links, interfaces, and related evidence",
    ],
    fredDirect: [
      "Query the exact node, topology path, stored configuration, and live diagnostics",
    ],
    fredGuides: [
      "Link the user back to the wider Network Map or relevant building",
    ],
  },
  {
    name: "Network Tools",
    routes: ["/network/tools"],
    menu: "Campus Technology -> Network Tools",
    access: "CIO, network, and network-engineer roles",
    purpose:
      "Use guarded FortiGate website exemptions and generate Windows support scripts.",
    functions: [
      "Add an approved URL to the configured FortiGate profile",
      "Generate printer-install, laptop-join, and equipment-removal PowerShell scripts",
    ],
    fredDirect: ["Run separate approved diagnostics when relevant"],
    fredGuides: [
      "Guide the guarded UI operation; generated scripts run on the technician's target Windows computer, not the server",
    ],
  },
  {
    name: "Azure VMs",
    routes: ["/azure-vms"],
    menu: "Campus Technology -> Azure",
    access: "All staff can view; CIO controls record changes and sync",
    purpose:
      "Track virtual machines, public exposure, ownership, purpose, and live Azure reconciliation.",
    functions: [
      "Filter and inspect VMs",
      "Sync from Azure",
      "Add, edit, or remove governed inventory records",
    ],
    fredDirect: [
      "Query live and stored VM evidence plus Azure health and security state",
    ],
    fredGuides: ["Explain CIO-only sync and inventory editing"],
  },
  {
    name: "Azure Inventory",
    routes: ["/azure-inventory"],
    menu: "Campus Technology -> Azure",
    access: "All authenticated IT staff",
    purpose:
      "Browse live Azure resources grouped by service and resource type.",
    functions: [
      "Filter resources",
      "Inspect subscription, resource group, type, location, and status",
    ],
    fredDirect: [
      "Query live Azure resources, health, Defender findings, and policy state",
    ],
    fredGuides: [
      "Direct users to the exact resource group or Azure portal destination",
    ],
  },
  {
    name: "Monitoring",
    routes: ["/monitoring", "/monitoring/embed"],
    menu: "Campus Technology -> Monitoring",
    access: "Authenticated page; embed is an internal display surface",
    purpose:
      "Display live Grafana-backed operational monitoring and building state.",
    functions: [
      "Review current dashboards",
      "Open the relevant Grafana panel and time window",
      "Correlate current alerts and last-seen telemetry",
    ],
    fredDirect: [
      "Query the live monitoring snapshot, Influx last-seen evidence, and exact Grafana links",
    ],
    fredGuides: [
      "Explain dashboard navigation and distinguish monitoring gaps from verified outages",
    ],
  },
  {
    name: "IT Apps directory",
    routes: ["/it-apps"],
    menu: "IT Apps -> App Directory",
    access: "All authenticated IT staff",
    purpose: "Launch shared IT applications, reports, and identity services.",
    functions: [
      "Search or browse application cards",
      "Open internal and external operational tools",
    ],
    fredDirect: [
      "Identify the correct application and known integration state",
    ],
    fredGuides: [
      "Give the exact card or route and explain what opens externally",
    ],
  },
  {
    name: "IT Calls (1200)",
    routes: ["/it-apps/webex-calling"],
    menu: "IT Apps -> IT Calls (1200)",
    access: "All authenticated IT staff",
    purpose: "Review IT hunt-group call activity and answer-rate reporting.",
    functions: [
      "Change reporting window",
      "Review answered and unanswered calls",
      "Inspect agent and call detail",
    ],
    fredDirect: [
      "Use current calling evidence when it is present in the operational context",
    ],
    fredGuides: [
      "Explain metrics and the correlation-based deduplication used by the report",
    ],
  },
  {
    name: "Cisco Webex Phones",
    routes: ["/it-apps/cisco-calling"],
    menu: "Campus Technology -> Cisco Webex Phones",
    access:
      "All authenticated IT staff; local labels are permission-controlled",
    purpose:
      "Review phone directory, device status, building assignments, E-911 context, and IT calling support.",
    functions: [
      "Search people, numbers, and devices",
      "Review live device connection",
      "Inspect building and E-911 mappings",
      "Update an Insights-only directory label where authorized",
    ],
    fredDirect: [
      "Query live calling support and device status by person, number, device, or building",
    ],
    fredGuides: [
      "Distinguish Insights labels from changes that must be made in Webex Control Hub",
    ],
  },
  {
    name: "Banner and EUP",
    routes: ["/banner"],
    menu: "IT Apps -> Banner",
    access:
      "All authenticated IT staff; source-system changes follow separate authorization",
    purpose:
      "Review EUP provisioning evidence, identity exceptions, operating procedures, and change history.",
    functions: [
      "Review current provisioning report",
      "Open procedures and architecture",
      "Inspect exceptions and verified change history",
    ],
    fredDirect: [
      "Use available identity evidence and application documentation to explain current state",
    ],
    fredGuides: [
      "Direct users to exact report sections; never claim a Banner or AD write without an approved tool and verified result",
    ],
  },
  {
    name: "Student Password Reset Activity",
    routes: ["/password-reset-activity"],
    menu: "IT Apps -> App Directory -> Student Password Reset",
    access: "All authenticated IT staff",
    purpose:
      "Review successful, failed, denied, and assisted kiosk password-reset events.",
    functions: [
      "Choose a time window",
      "Review timestamp, student-safe identifier, result, source kiosk, and reason",
    ],
    fredDirect: [
      "Explain the audited reset workflow from application knowledge",
    ],
    fredGuides: [
      "Direct users to this audit page; no password value is ever available to Fred",
    ],
  },
  {
    name: "MFA and Temporary Access Pass Activity",
    routes: ["/mfa-tap-activity"],
    menu: "IT Apps -> App Directory -> MFA/TAP Activity",
    access: "All authenticated IT staff",
    purpose:
      "Review audited Microsoft Temporary Access Pass and student MFA activity.",
    functions: [
      "Choose a time window",
      "Review issue, denial, verification, and source details",
    ],
    fredDirect: [
      "Explain the approved TAP workflow and correlate non-secret audit evidence when present",
    ],
    fredGuides: [
      "Direct users to the activity report; Fred never receives or repeats a TAP",
    ],
  },
  {
    name: "High School Student Access",
    routes: ["/student-access"],
    menu: "IT Apps -> High School Students",
    access:
      "Authenticated IT wrapper; Microsoft and student flows enforce their own roles",
    purpose:
      "Open student self-service and staff-assisted Microsoft Temporary Access Pass workflows.",
    functions: [
      "Open the tester guide",
      "Launch full-window Microsoft sign-in",
      "Use the embedded student-access service",
    ],
    fredDirect: [],
    fredGuides: [
      "Provide the exact student or staff-assisted workflow without requesting passwords, MFA codes, or TAP values",
    ],
  },
  {
    name: "Incident Rooms",
    routes: ["/incidents", "/incidents/:id"],
    menu: "Troubleshooting -> Incident Rooms",
    access: "All authenticated IT staff",
    purpose:
      "Coordinate live outage response in a shared incident conversation.",
    functions: [
      "List and open incidents",
      "Create an incident room",
      "Post team updates",
      "Use approved incident diagnostics and ticket actions",
    ],
    fredDirect: [
      "Analyze supplied incident evidence and use approved read or Zendesk tools",
    ],
    fredGuides: [
      "Guide room creation and team messaging; Fred does not impersonate a person or post without an explicit supported action",
    ],
  },
  {
    name: "Post-Incident Reviews",
    routes: ["/after-action", "/after-action/new", "/after-action/:id"],
    menu: "Troubleshooting -> Post-Incident Reviews",
    access: "Staff manage their own reviews; the CIO can manage any review",
    purpose:
      "Document incident timeline, cause, resolution, lessons, prevention, status, severity, and linked Zendesk evidence.",
    functions: [
      "List and filter reviews",
      "Create a review",
      "Edit every review field",
      "Refresh a linked Zendesk timeline",
      "Include the review in a weekly report",
    ],
    fredDirect: [
      "Create or edit an exact confirmed review within the signed-in user's permission",
    ],
    fredGuides: ["Explain linked-ticket refresh and reporting inclusion"],
  },
  {
    name: "Fred Workspace",
    routes: ["/ai-report", "/fred/mobile"],
    menu: "Fred button; mobile route is a focused bare workspace",
    access: "All authenticated IT staff; individual actions remain role-gated",
    purpose:
      "Ask operational questions, use approved tools, manage durable topics and files, and prepare CIO reporting.",
    functions: [
      "Switch report, architecture, chat, CIO insight, and memory tabs",
      "Create, rename, copy, or delete chat topics",
      "Choose lookback",
      "Attach governed files",
      "Use the mobile workspace",
    ],
    fredDirect: [
      "Use every approved tool exposed for the signed-in role",
      "Explain every page through this catalog",
      "Save non-secret durable knowledge when requested",
    ],
    fredGuides: [
      "State clearly when a requested page function has no Fred tool and provide exact UI steps instead",
    ],
  },
  {
    name: "Quick Start",
    routes: ["/quick-start"],
    menu: "Troubleshooting -> Quick Start",
    access: "All authenticated IT staff",
    purpose:
      "Provide a short orientation to the current top menu and daily work cycle.",
    functions: [
      "Review navigation categories",
      "Follow the to-do to completed-work to weekly-log workflow",
      "Open Zendesk, Fred, training, and full guide destinations",
    ],
    fredDirect: [
      "Answer follow-up questions using the current capability catalog",
    ],
    fredGuides: [
      "Direct new or returning users here before the full User Guide",
    ],
  },
  {
    name: "User Guide",
    routes: ["/user-guide"],
    menu: "Troubleshooting -> User Guide",
    access: "All authenticated IT staff",
    purpose:
      "Provide the complete written instructions for the current portal.",
    functions: [
      "Read full workflows, permissions, reporting steps, Zendesk supervision, Fred Memory, and administration guidance",
    ],
    fredDirect: [
      "Retrieve current application guidance and summarize the relevant section",
    ],
    fredGuides: [
      "Link here for detailed reference after giving the immediate steps",
    ],
  },
  {
    name: "Learn",
    routes: ["/learn"],
    menu: "Troubleshooting -> Learn",
    access: "All authenticated IT staff",
    purpose:
      "Practice desk and onsite scenarios with predetermined evidence and guided reasoning.",
    functions: [
      "Choose a scenario and mode",
      "Reveal simulated evidence",
      "Answer checkpoints",
      "Ask training-mode Fred for a hint",
    ],
    fredDirect: [
      "Coach inside the isolated simulation without touching production systems",
    ],
    fredGuides: [
      "Explain that simulated evidence and actions never change production",
    ],
  },
  {
    name: "Process Library",
    routes: ["/processes", "/processes/new", "/processes/:id"],
    menu: "Troubleshooting -> Process Library",
    access: "All authenticated IT staff subject to record permissions",
    purpose: "Store repeatable runbooks and operational procedures.",
    functions: [
      "Browse and search procedures",
      "Open procedure detail",
      "Create or edit a runbook",
    ],
    fredDirect: [
      "Use approved process content as guidance when it is available in context",
    ],
    fredGuides: [
      "Provide exact page steps; Fred has no general Process Library write tool",
    ],
  },
  {
    name: "Admin",
    routes: ["/admin"],
    menu: "Administration -> Admin",
    access: "CIO-only",
    purpose:
      "Manage Insights users, roles, active state, and designated break-glass accounts.",
    functions: [
      "Change portal roles",
      "Deactivate or reactivate users",
      "Reset a break-glass portal password",
    ],
    fredDirect: [],
    fredGuides: [
      "Explain the exact admin workflow; this page does not reset student, staff Entra, or AD passwords",
    ],
  },
  {
    name: "Usage Analytics",
    routes: ["/analytics"],
    menu: "Administration -> Usage Analytics",
    access: "CIO-only",
    purpose:
      "Review page use, contribution, time-on-page, and Fred adoption trends.",
    functions: [
      "Change reporting window",
      "Review adoption and contributor metrics",
      "Inspect popular destinations and Fred usage",
    ],
    fredDirect: [
      "Explain metric definitions from current application guidance",
    ],
    fredGuides: [
      "Direct the CIO to the exact analytics view; Fred has no analytics mutation tool",
    ],
  },
  {
    name: "OnlineKiosk regular-student recovery",
    routes: ["/online-kiosk"],
    menu: "IT Apps -> App Directory -> OnlineKiosk",
    access:
      "Eligible students through the protected recovery service; administrative functions have separate authorization",
    purpose:
      "Match one active regular-student identity, let the student choose a private password, and issue a one-use Microsoft pass under rate limits and audit controls. Authorized staff can prepare a supervised ten-minute recovery link through Fred after independent identity verification.",
    functions: [
      "Verify legal name, full 800 number, and SCCC username",
      "Set a student-selected private password",
      "Issue and verify a one-use Microsoft pass",
      "Create a support ticket on failure",
    ],
    fredDirect: [
      "For CIO and help-desk users, prepare a ten-minute single-use assisted reset link after exact identity matching, approved independent verification, Zendesk ticket attribution, and explicit confirmation",
    ],
    fredGuides: [
      "Direct eligible students to the kiosk",
      "Never request or repeat passwords, MFA codes, or TAP values",
      "Treat names, username, and 800 number as matching data rather than sufficient authentication",
      "Explain that completing the password reset clears Entra Smart Lockout but does not re-enable an administratively disabled, withdrawn, or ineligible account",
      "Escalate disabled or ineligible accounts for source-of-truth review rather than trying to enable them",
    ],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const GUIDANCE_QUERY_STOP_WORDS = new Set([
  "about",
  "does",
  "fred",
  "help",
  "how",
  "insights",
  "page",
  "show",
  "the",
  "use",
  "what",
  "where",
  "with",
]);

function routeMatches(pattern: string, route: string): boolean {
  const expression = pattern
    .split("/")
    .map((part) =>
      part.startsWith(":")
        ? "[^/]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${expression}/?$`, "i").test(route);
}

export function findFredApplicationPages(
  query?: string,
): FredApplicationPage[] {
  const term = normalize(query || "");
  if (!term) return FRED_APPLICATION_PAGES;

  if (term.startsWith("/")) {
    const routeMatchesFound = FRED_APPLICATION_PAGES.filter((page) =>
      page.routes.some((route) => routeMatches(route, term)),
    );
    if (routeMatchesFound.length) return routeMatchesFound;
  }

  const tokens = term
    .split(/[^a-z0-9]+/)
    .filter(
      (token) => token.length >= 3 && !GUIDANCE_QUERY_STOP_WORDS.has(token),
    );

  return FRED_APPLICATION_PAGES.filter((page) => {
    const searchable = normalize(
      [
        page.name,
        page.routes.join(" "),
        page.menu,
        page.access,
        page.purpose,
        page.functions.join(" "),
        page.fredDirect.join(" "),
        page.fredGuides.join(" "),
      ].join(" "),
    );
    return (
      searchable.includes(term) ||
      (tokens.length > 0 && tokens.every((token) => searchable.includes(token)))
    );
  });
}

export function renderFredApplicationPage(page: FredApplicationPage): string {
  const direct = page.fredDirect.length
    ? page.fredDirect.map((item) => `- ${item}`).join("\n")
    : "- No direct Fred action is approved for this page.";
  const guided = page.fredGuides.map((item) => `- ${item}`).join("\n");
  return [
    `## ${page.name}`,
    `Routes: ${page.routes.join(", ")}`,
    `Menu: ${page.menu}`,
    `Access: ${page.access}`,
    `Purpose: ${page.purpose}`,
    "Functions:",
    page.functions.map((item) => `- ${item}`).join("\n"),
    "Fred can perform:",
    direct,
    "Fred must guide:",
    guided,
  ].join("\n");
}

export function fredApplicationKnowledgeEntries() {
  return FRED_APPLICATION_PAGES.map((page) => ({
    category: "application",
    title: `Using the Platform: Page - ${page.name}`,
    content: renderFredApplicationPage(page),
  }));
}
