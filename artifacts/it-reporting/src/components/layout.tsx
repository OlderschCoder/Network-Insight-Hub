import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useLogout, useListSwitches, useAddSwitchMaintenanceLogEntry } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
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
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListChecks as ListChecksIcon, ShieldAlert as ShieldAlertIcon, Activity as ActivityIcon, Network as NetworkIcon } from "lucide-react";
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
  Cloud,
  BarChart3,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<any>; match?: (loc: string) => boolean };
type NavGroup = { label: string; items: NavItem[] };

function QuickAddMaintenanceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: switches = [] } = useListSwitches({});
  const [search, setSearch] = useState("");
  const [switchId, setSwitchId] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useAddSwitchMaintenanceLogEntry();

  const filtered = switches.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.hostname.toLowerCase().includes(q) ||
      (s.building ?? "").toLowerCase().includes(q) ||
      (s.location ?? "").toLowerCase().includes(q)
    );
  });

  const reset = () => {
    setSearch("");
    setSwitchId(null);
    setBody("");
    setWindowStart("");
    setWindowEnd("");
  };

  const submit = async () => {
    if (!switchId || !body.trim()) {
      toast({ title: "Pick a switch and enter a note", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        id: switchId,
        data: {
          body: body.trim(),
          windowStart: windowStart || undefined,
          windowEnd: windowEnd || undefined,
        },
      });
      toast({ title: "Maintenance note added" });
      queryClient.invalidateQueries({ queryKey: ["/api/network/switches"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add note";
      toast({ title: "Could not save note", description: msg, variant: "destructive" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Maintenance Note</DialogTitle>
          <DialogDescription>
            Pick a switch, then describe the maintenance window or change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Switch</Label>
            <Input
              placeholder="Search by hostname, building, or location"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="border rounded mt-1 max-h-40 overflow-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">No matching switches.</p>
              ) : (
                filtered.slice(0, 50).map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setSwitchId(s.id)}
                    className={`w-full text-left text-xs px-2 py-1 hover:bg-muted ${
                      switchId === s.id ? "bg-muted font-medium" : ""
                    }`}
                  >
                    {s.hostname}
                    {s.building ? ` · ${s.building}` : ""}
                    {s.location ? ` · ${s.location}` : ""}
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Window start (optional)</Label>
              <Input
                type="datetime-local"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Window end (optional)</Label>
              <Input
                type="datetime-local"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Note</Label>
            <Textarea
              rows={3}
              placeholder="What changed, what was the impact, what should the team know?"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!switchId || !body.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Add note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuickAddMenu() {
  const [taskOpen, setTaskOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Zap className="h-4 w-4 mr-2" />
            Quick Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setTaskOpen(true)}>
            <ListChecksIcon className="h-4 w-4 mr-2" />
            Add Task
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/risks/new">
              <ShieldAlertIcon className="h-4 w-4 mr-2" />
              Add Risk / Issue
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/after-action/new">
              <ActivityIcon className="h-4 w-4 mr-2" />
              Start Post-Incident Review
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMaintOpen(true)}>
            <NetworkIcon className="h-4 w-4 mr-2" />
            Add Maintenance Note
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <QuickAddItemDialog open={taskOpen} onOpenChange={setTaskOpen} />
      <QuickAddMaintenanceDialog open={maintOpen} onOpenChange={setMaintOpen} />
    </>
  );
}

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
      { href: "/azure-vms", label: "Azure VMs", icon: Cloud },
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
      { href: "/analytics", label: "Usage Analytics", icon: BarChart3 },
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
              <QuickAddMenu />
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
