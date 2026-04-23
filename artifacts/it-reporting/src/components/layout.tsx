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
  LogOut
} from "lucide-react";

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

  return (
    <SidebarProvider>
      <div className="flex h-screen bg-background w-full">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarContent>
            <div className="p-4 font-bold text-lg tracking-tight text-sidebar-foreground border-b border-sidebar-border">
              SCCC IT HUB
            </div>
            <SidebarGroup>
              <SidebarGroupLabel>Menu</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/"}>
                      <Link href="/">
                        <LayoutDashboard className="mr-2" />
                        Dashboard
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/items")}>
                      <Link href="/items">
                        <ListChecks className="mr-2" />
                        Tasks Completed
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/entries")}>
                      <Link href="/entries">
                        <FileText className="mr-2" />
                        Weekly Logs
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/reports")}>
                      <Link href="/reports">
                        <Files className="mr-2" />
                        Reports
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/projects")}>
                      <Link href="/projects">
                        <Briefcase className="mr-2" />
                        Projects
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/strategic-objectives")}>
                      <Link href="/strategic-objectives">
                        <Target className="mr-2" />
                        Strategic Objectives
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/risks")}>
                      <Link href="/risks">
                        <ShieldAlert className="mr-2" />
                        Risks & Issues
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/network")}>
                      <Link href="/network">
                        <Network className="mr-2" />
                        Network Ref
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/processes")}>
                      <Link href="/processes">
                        <BookOpen className="mr-2" />
                        Process Library
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/after-action")}>
                      <Link href="/after-action">
                        <Activity className="mr-2" />
                        After Action
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/ai-report")}>
                      <Link href="/ai-report">
                        <Sparkles className="mr-2" />
                        AI Reports
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {isCIO && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.startsWith("/admin")}>
                        <Link href="/admin">
                          <Users className="mr-2" />
                          Admin
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
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
          <div className="h-12 border-b border-border flex items-center px-4 shrink-0 bg-card">
            <SidebarTrigger />
          </div>
          <div className="flex-1 overflow-auto p-6 bg-background">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
