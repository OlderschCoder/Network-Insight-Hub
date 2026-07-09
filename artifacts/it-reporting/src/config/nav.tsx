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
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<any>;
  match?: (loc: string) => boolean;
  cioBadge?: boolean;
  netBadge?: boolean;
};

export type NavGroup = { label: string; items: NavItem[]; separator?: number[] };

export function getNavGroups(isCIO: boolean, canNetworkTools = false): NavGroup[] {
  const myWork: NavGroup = {
    label: "My Work",
    items: [
      {
        href: "/",
        label: isCIO ? "Dashboard" : "Home",
        desc: "Your overview and personal workspace",
        icon: LayoutDashboard,
        match: (l) => l === "/",
      },
      { href: "/items", label: "My Tasks", desc: "Track and update your action items", icon: ListChecks },
      { href: "/entries", label: "Weekly Log", desc: "Record your weekly accomplishments", icon: FileText },
    ],
  };

  const operations: NavGroup = {
    label: "Operations",
    separator: [3], // separator index before CIO-only items
    items: [
      { href: "/incidents", label: "Incident Rooms", desc: "Live group chat for outage response", icon: Siren, match: (l) => l === "/incidents" || l.startsWith("/incidents/") },
      { href: "/risks", label: "Risks & Issues", desc: "Open risks, issues, and design notes", icon: ShieldAlert },
      { href: "/after-action", label: "Post-Incident Reviews", desc: "Document incidents and lessons", icon: Activity },
      { href: "/reports", label: "Weekly Reports", desc: "Department weekly reports", icon: Files },
      ...(isCIO
        ? [
            { href: "/projects", label: "Projects", desc: "Initiatives and progress tracking", icon: Briefcase, cioBadge: true } as NavItem,
            { href: "/strategic-objectives", label: "Department Goals", desc: "Strategic objectives and KPIs", icon: Target, cioBadge: true } as NavItem,
            { href: "/admin", label: "Admin", desc: "Manage users and access", icon: Users, cioBadge: true } as NavItem,
          ]
        : []),
    ],
  };

  const infrastructure: NavGroup = {
    label: "Infrastructure",
    items: [
      { href: "/network", label: "Network", desc: "Switches, VLANs, and topology", icon: Network, match: (l) => l === "/network" || l.startsWith("/network/visualize") || l.startsWith("/network/nodes") },
      { href: "/network/buildings", label: "Buildings", desc: "Campus building health and device map", icon: Building2, match: (l) => l === "/network/buildings" || l.startsWith("/network/buildings/") },
      { href: "/azure-vms", label: "Azure", desc: "VMs and cloud resource inventory", icon: Cloud },
      { href: "/monitoring", label: "Monitoring", desc: "Live Grafana dashboards", icon: Gauge },
      { href: "/processes", label: "Process Library", desc: "Runbooks and documented procedures", icon: BookOpen },
      ...(canNetworkTools
        ? [{ href: "/network/tools", label: "Network Tools", desc: "Whitelist websites and generate setup scripts", icon: ShieldCheck, netBadge: true } as NavItem]
        : []),
    ],
  };

  return [myWork, operations, infrastructure];
}

export function isNavItemActive(item: NavItem, location: string): boolean {
  if (item.match) return item.match(location);
  return location.startsWith(item.href);
}

export function findActiveItem(groups: NavGroup[], location: string): NavItem | null {
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
