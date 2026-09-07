import {
  LayoutDashboard,
  FileText,
  Files,
  ListChecks,
  ShieldAlert,
  Network,
  Activity,
  Users,
  BookOpen,
  Briefcase,
  Target,
  Cloud,
  Gauge,
  ShieldCheck,
  BarChart3,
  LayoutGrid,
  Siren,
  Building2,
  KeyRound,
  GraduationCap,
  PhoneCall,
  BookOpenCheck,
  ClipboardList,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<any>;
  match?: (loc: string) => boolean;
  cioBadge?: boolean;
  netBadge?: boolean;
  newBadge?: boolean;
};

export type NavGroup = {
  label: string;
  href: string;
  items: NavItem[];
  separator?: number[];
};

export function getNavGroups(
  isCIO: boolean,
  canNetworkTools = false,
): NavGroup[] {
  const statusReporting: NavGroup = {
    label: "Status & Reporting",
    href: "/status",
    items: [
      {
        href: "/status",
        label: "Status Dashboard",
        desc: "Current campus health and operational workload",
        icon: LayoutDashboard,
        match: (l) => l === "/status",
      },
      {
        href: "/reports",
        label: "Weekly Reports",
        desc: "Department weekly reports",
        icon: Files,
      },
    ],
  };

  const campusTechnology: NavGroup = {
    label: "Campus Technology",
    href: "/network/buildings",
    items: [
      {
        href: "/network/buildings",
        label: "Buildings",
        desc: "Campus building health and device map",
        icon: Building2,
        match: (l) =>
          l === "/network/buildings" || l.startsWith("/network/buildings/"),
      },
      {
        href: "/network",
        label: "Network Map",
        desc: "Switches, VLANs, ports, and topology",
        icon: Network,
        match: (l) =>
          l === "/network" ||
          l.startsWith("/network/visualize") ||
          l.startsWith("/network/nodes"),
      },
      {
        href: "/monitoring",
        label: "Monitoring",
        desc: "Live Grafana dashboards",
        icon: Gauge,
      },
      {
        href: "/it-apps/cisco-calling",
        label: "Cisco Webex Phones",
        desc: "Phone directory, device status, buildings, and E-911",
        icon: PhoneCall,
        newBadge: true,
      },
      {
        href: "/azure-vms",
        label: "Azure",
        desc: "VMs and cloud resource inventory",
        icon: Cloud,
      },
      ...(canNetworkTools
        ? [
            {
              href: "/network/tools",
              label: "Network Tools",
              desc: "Whitelist websites and generate setup scripts",
              icon: ShieldCheck,
              netBadge: true,
            } as NavItem,
          ]
        : []),
    ],
  };

  const myWork: NavGroup = {
    label: "My Work",
    href: "/todos",
    items: [
      {
        href: "/todos",
        label: "To-do List",
        desc: "Assignments, due dates, and priorities",
        icon: ClipboardList,
      },
      {
        href: "/items",
        label: "Completed Work",
        desc: "Log finished work for weekly reporting",
        icon: ListChecks,
      },
      {
        href: "/entries",
        label: "Weekly Log",
        desc: "Record your weekly accomplishments",
        icon: FileText,
      },
    ],
  };

  const troubleshooting: NavGroup = {
    label: "Troubleshooting",
    href: "/support",
    items: [
      {
        href: "/support",
        label: "Support Center",
        desc: "Zendesk activity and diagnostic shortcuts",
        icon: ShieldCheck,
        match: (l) => l === "/support",
      },
      {
        href: "/incidents",
        label: "Incident Rooms",
        desc: "Live group chat for outage response",
        icon: Siren,
        match: (l) => l === "/incidents" || l.startsWith("/incidents/"),
      },
      {
        href: "/risks",
        label: "Risks & Issues",
        desc: "Open risks, issues, and design notes",
        icon: ShieldAlert,
      },
      {
        href: "/after-action",
        label: "Post-Incident Reviews",
        desc: "Document incidents and lessons",
        icon: Activity,
      },
      {
        href: "/processes",
        label: "Process Library",
        desc: "Runbooks and documented procedures",
        icon: BookOpen,
      },
      {
        href: "/learn",
        label: "Learn",
        desc: "Practice IT situations with guided simulations",
        icon: BookOpenCheck,
      },
    ],
  };

  const itApps: NavGroup = {
    label: "IT Apps",
    href: "/it-apps",
    items: [
      {
        href: "/it-apps",
        label: "App Directory",
        desc: "IT applications, shared tools, and operational reports",
        icon: LayoutGrid,
        match: (l) => l === "/it-apps",
      },
      {
        href: "/banner",
        label: "Banner",
        desc: "EUP provisioning report, operating procedure, and change log",
        icon: GraduationCap,
      },
      {
        href: "/student-access",
        label: "High School Students",
        desc: "Student self-service and faculty access grants",
        icon: KeyRound,
      },
    ],
  };

  const administration: NavGroup = {
    label: "Administration",
    href: "/projects",
    items: [
      {
        href: "/projects",
        label: "Projects",
        desc: "Initiatives and progress tracking",
        icon: Briefcase,
        cioBadge: true,
      },
      {
        href: "/strategic-objectives",
        label: "Department Goals",
        desc: "Strategic objectives and KPIs",
        icon: Target,
        cioBadge: true,
      },
      {
        href: "/analytics",
        label: "Usage Analytics",
        desc: "Adoption and contribution trends",
        icon: BarChart3,
        cioBadge: true,
      },
      {
        href: "/admin",
        label: "Admin",
        desc: "Manage users and access",
        icon: Users,
        cioBadge: true,
      },
    ],
  };

  return [
    statusReporting,
    campusTechnology,
    troubleshooting,
    myWork,
    itApps,
    ...(isCIO ? [administration] : []),
  ];
}

export function isNavItemActive(item: NavItem, location: string): boolean {
  if (item.match) return item.match(location);
  return location.startsWith(item.href);
}

export function findActiveItem(
  groups: NavGroup[],
  location: string,
): NavItem | null {
  let best: NavItem | null = null;
  for (const g of groups) {
    for (const it of g.items) {
      if (isNavItemActive(it, location)) {
        if (!best || it.href.length > best.href.length) best = it;
      }
    }
  }
  return best;
}
