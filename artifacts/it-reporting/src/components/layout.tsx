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
import { Button } from "@/components/ui/button";
import { Logo, Signature } from "@/components/system";
import QuickAddItemDialog from "@/components/QuickAddItemDialog";
import { AppLauncher } from "@/components/AppLauncher";
import { TopNav } from "@/components/TopNav";
import { ZendeskAlerts } from "@/components/ZendeskAlerts";
import { ZendeskChatWidget } from "@/components/ZendeskChatWidget";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ListChecks as ListChecksIcon,
  ShieldAlert as ShieldAlertIcon,
  Activity as ActivityIcon,
  Network as NetworkIcon,
} from "lucide-react";
import { LogOut, Zap, Sparkles, LayoutGrid, Search } from "lucide-react";

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

function AccountMenu({
  name,
  role,
  onLogout,
}: {
  name?: string;
  role?: string;
  onLogout: () => void;
}) {
  const initials = (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/25"
          aria-label="Account menu"
        >
          {initials || "?"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{name}</span>
          <span className="text-xs font-normal capitalize text-muted-foreground">{role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, isCIO } = useAuth();
  const [location] = useLocation();
  const logoutMutation = useLogout();
  const [launcherOpen, setLauncherOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      logout();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLauncherOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-sidebar px-4 text-sidebar-foreground">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Logo variant="white" className="h-7" />
        </Link>

        <TopNav />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            className="hidden h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-sm text-white/70 transition-colors hover:bg-white/15 md:flex"
            aria-label="Search pages"
          >
            <Search className="h-4 w-4" />
            <span className="hidden lg:inline">Search</span>
            <kbd className="hidden items-center gap-0.5 rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/80 lg:inline-flex">
              ⌘K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 md:hidden"
            aria-label="Open menu"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>

          <div className="[&_button]:border-white/20 [&_button]:bg-white/10 [&_button]:text-white [&_button:hover]:bg-white/20">
            <QuickAddMenu />
          </div>

          <Link href={location === "/ai-report" ? "/ai-report" : `/ai-report?from=${encodeURIComponent(location)}`}>
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Ask AI</span>
            </Button>
          </Link>

          <ZendeskAlerts />

          <AccountMenu name={user?.name} role={user?.role} onLogout={handleLogout} />
        </div>
      </header>

      <ZendeskChatWidget />

      <main className="flex-1 overflow-auto bg-background">
        <div className="p-6">{children}</div>
        <footer className="border-t border-border px-6 py-4">
          <Signature />
        </footer>
      </main>

      <AppLauncher open={launcherOpen} onOpenChange={setLauncherOpen} />
    </div>
  );
}
