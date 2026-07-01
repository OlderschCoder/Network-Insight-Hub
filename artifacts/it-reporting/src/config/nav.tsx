import {
  LayoutDashboard,
  FileText,
  Files,
  ListChecks,
  ShieldAlert,
  Network,
  Activity,
  Users,
  Sparkles,
  BookOpen,
  Briefcase,
  Target,
  Cloud,
  BarChart3,
  Gauge,
  LayoutGrid,
  Boxes,
  ShieldCheck,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<any>;
  match?: (loc: string) => boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

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

  const knowledge: NavGroup = {
    label: "Systems & Tools",
    items: [
      { href: "/network", label: "Network", desc: "Switches, VLANs, and topology", icon: Network, match: (l) => l === "/network" || l.startsWith("/network/visualize") },
      ...(canNetworkTools
        ? [{ href: "/network/tools", label: "Network Tools", desc: "Whitelist websites and generate setup scripts", icon: ShieldCheck } as NavItem]
        : []),
      { href: "/azure-vms", label: "Azure VMs", desc: "Cloud virtual machine inventory", icon: Cloud },
      { href: "/azure-inventory", label: "Azure Inventory", desc: "Full inventory of all Azure resources by type", icon: Boxes },
      { href: "/monitoring", label: "Monitoring", desc: "Live Grafana dashboards", icon: Gauge },
      { href: "/it-apps", label: "IT Apps", desc: "Unified view of apps built for IT", icon: LayoutGrid },
      { href: "/processes", label: "Process Library", desc: "Runbooks and documented procedures", icon: BookOpen },
      { href: "/ai-report", label: "AI Assistant", desc: "Generate reports and ask questions", icon: Sparkles },
    ],
  };

  const team: NavGroup = {
    label: "Reports & Records",
    items: [
      { href: "/risks", label: "Risks & Issues", desc: "Open risks, issues, and design notes", icon: ShieldAlert },
      { href: "/after-action", label: "Post-Incident Reviews", desc: "Document incidents and lessons", icon: Activity },
      { href: "/reports", label: "Reports", desc: "Weekly department reports", icon: Files },
    ],
  };

  const leadership: NavGroup = {
    label: "Leadership & Admin",
    items: [
      { href: "/projects", label: "Projects", desc: "Initiatives and progress tracking", icon: Briefcase },
      { href: "/strategic-objectives", label: "Department Goals", desc: "Strategic objectives and KPIs", icon: Target },
      { href: "/analytics", label: "Usage Analytics", desc: "Platform usage insights", icon: BarChart3 },
      { href: "/admin", label: "Admin", desc: "Manage users and access", icon: Users },
    ],
  };

  return isCIO ? [myWork, knowledge, team, leadership] : [myWork, knowledge, team];
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
