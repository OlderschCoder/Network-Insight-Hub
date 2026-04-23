import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useLogout } from "@workspace/api-client-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import QuickAddItemDialog from "@/components/QuickAddItemDialog";
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
  LogOut,
  Zap,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<any>; match?: (loc: string) => boolean };
type NavGroup = { label: string; items: NavItem[] };

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, isCIO } = useAuth();
  const [location] = useLocation();
  const logoutMutation = useLogout();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      logout();
    }
  };

  const myWorkGroup: NavGroup = {
    label: "My Work",
    items: [
      { href: "/", label: isCIO ? "Dashboard" : "Home", icon: LayoutDashboard, match: (l) => l === "/" },
      { href: "/items", label: "My Tasks", icon: ListChecks },
      { href: "/entries", label: "Weekly Log", icon: FileText },
    ],
  };

  const knowledgeGroup: NavGroup = {
    label: "Knowledge",
    items: [
      { href: "/network", label: "Network", icon: Network },
      { href: "/processes", label: "Process Library", icon: BookOpen },
      { href: "/ai-report", label: "AI Assistant", icon: Sparkles },
    ],
  };

  const teamGroup: NavGroup = {
    label: "Team",
    items: [
      { href: "/risks", label: "Risks & Issues", icon: ShieldAlert },
      { href: "/after-action", label: "Post-Incident Reviews", icon: Activity },
      { href: "/reports", label: "Reports", icon: Files },
    ],
  };

  const leadershipGroup: NavGroup = {
    label: "Leadership & Admin",
    items: [
      { href: "/projects", label: "Projects", icon: Briefcase },
      { href: "/strategic-objectives", label: "Department Goals", icon: Target },
      { href: "/admin", label: "Admin", icon: Users },
    ],
  };

  const groups: NavGroup[] = isCIO
    ? [myWorkGroup, knowledgeGroup, teamGroup, leadershipGroup]
    : [myWorkGroup, knowledgeGroup, teamGroup];

  const isActive = (item: NavItem) => {
    if (item.match) return item.match(location);
    return location.startsWith(item.href);
  };

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarContent>
            <div className="p-4 font-bold text-lg tracking-tight text-sidebar-foreground border-b border-sidebar-border">
              SCCC IT HUB
            </div>
            {groups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton asChild isActive={isActive(item)}>
                            <Link href={item.href}>
                              <Icon className="mr-2" />
                              {item.label}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-4 flex flex-col gap-2">
            <div className="text-xs text-muted-foreground truncate">
              {user?.name} ({user?.role})
            </div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </SidebarFooter>
        </Sidebar>
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0 bg-card gap-2">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <QuickAddItemDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <Zap className="h-4 w-4 mr-2" />
                    Quick Add
                  </Button>
                }
              />
              <Link href={location === "/ai-report" ? "/ai-report" : `/ai-report?from=${encodeURIComponent(location)}`}>
                <Button variant="outline" size="sm">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Ask AI
                </Button>
              </Link>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-6 bg-background">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
