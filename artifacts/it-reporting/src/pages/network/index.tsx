import { useMemo, useRef, useState, useEffect } from "react";
import {
  useListSwitches,
  useListVlans,
  useAddSwitchMaintenanceLogEntry,
  getListSwitchesQueryKey,
} from "@workspace/api-client-react";
import type { NetworkSwitch, Vlan, MaintenanceLogEntry } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Server, Network as NetworkIcon, Workflow, Building2,
  Sparkles, Send, Map as MapIcon, Loader2, Cloud, Radio,
  Activity, Wrench, Save,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";

const statusColor: Record<string, string> = {
  online: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  offline: "bg-red-500/20 text-red-300 border-red-500/30",
  unknown: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const vlanTypeColor: Record<string, string> = {
  data: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  voice: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  management: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  security: "bg-red-500/20 text-red-300 border-red-500/30",
  ospf: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  other: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const matchSwitch = (s: NetworkSwitch, q: string) =>
  !q ||
  s.hostname?.toLowerCase().includes(q) ||
  s.building?.toLowerCase().includes(q) ||
  s.ipAddress?.toLowerCase().includes(q) ||
  (s.model ?? "").toLowerCase().includes(q);

const matchVlan = (v: Vlan, q: string) =>
  !q ||
  String(v.vlanId).includes(q) ||
  v.name?.toLowerCase().includes(q) ||
  (v.description ?? "").toLowerCase().includes(q) ||
  v.building?.toLowerCase().includes(q) ||
  (v.subnet ?? "").toLowerCase().includes(q);

function switchPostIncidentHref(sw: NetworkSwitch): string {
  const today = new Date().toISOString().slice(0, 10);
  const title = `Incident on ${sw.hostname}${sw.building ? ` (${sw.building})` : ""}`;
  const summary = [
    `Device: ${sw.hostname} (${sw.ipAddress})`,
    sw.model && `Model: ${sw.model}`,
    sw.building && `Building: ${sw.building}`,
    sw.location && `Location: ${sw.location}`,
    sw.notes && `Existing notes: ${sw.notes}`,
  ].filter(Boolean).join("\n");
  const params = new URLSearchParams({
    title,
    summary,
    incidentDate: today,
    outcome: "partial",
    source: "/network",
    sourceLabel: `Switch ${sw.hostname}`,
  });
  return `/after-action/new?${params.toString()}`;
}

function vlanPostIncidentHref(vlan: Vlan): string {
  const today = new Date().toISOString().slice(0, 10);
  const title = `Incident on VLAN ${vlan.vlanId} — ${vlan.name}`;
  const summary = [
    `VLAN: ${vlan.vlanId} (${vlan.name})`,
    `Type: ${vlan.type}`,
    vlan.building && `Building: ${vlan.building}`,
    vlan.subnet && `Subnet: ${vlan.subnet}${vlan.gateway ? ` via ${vlan.gateway}` : ""}`,
    vlan.description && `Description: ${vlan.description}`,
    vlan.notes && `Existing notes: ${vlan.notes}`,
  ].filter(Boolean).join("\n");
  const params = new URLSearchParams({
    title,
    summary,
    incidentDate: today,
    outcome: "partial",
    source: "/network",
    sourceLabel: `VLAN ${vlan.vlanId} (${vlan.name})`,
  });
  return `/after-action/new?${params.toString()}`;
}

function buildSwitchAIPrompt(sw: NetworkSwitch): string {
  return `Tell me about switch ${sw.hostname} (${sw.ipAddress})${sw.building ? ` in ${sw.building}` : ""}. ` +
    `What does it serve, what is its uplink path, and what should I check first if a user on it reports an issue?`;
}

function buildVlanAIPrompt(vlan: Vlan): string {
  return `Tell me about VLAN ${vlan.vlanId} (${vlan.name})${vlan.building ? ` in ${vlan.building}` : ""}. ` +
    `What is it used for, which switches and buildings rely on it, and what should I check first if users on it report issues?`;
}

function formatLogTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function MaintenanceLogList({ entries }: { entries: MaintenanceLogEntry[] }) {
  if (!entries?.length) return null;
  const recent = entries.slice(0, 3);
  const remaining = entries.length - recent.length;
  return (
    <div className="w-full mt-2 space-y-1.5">
      {recent.map((e) => (
        <div
          key={e.id}
          className="text-xs border-l-2 border-primary/40 pl-2 py-1 bg-muted/30 rounded-sm"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-semibold text-foreground/80 normal-case tracking-normal text-xs">
              {e.authorName}
            </span>
            <span>{formatLogTimestamp(e.createdAt)}</span>
            {(e.windowStart || e.windowEnd) && (
              <span className="text-amber-300 normal-case tracking-normal">
                window: {formatLogTimestamp(e.windowStart)}
                {e.windowEnd ? ` → ${formatLogTimestamp(e.windowEnd)}` : ""}
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-xs text-muted-foreground mt-0.5">{e.body}</p>
        </div>
      ))}
      {remaining > 0 && (
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          + {remaining} older {remaining === 1 ? "entry" : "entries"}
        </p>
      )}
    </div>
  );
}

function SwitchNotesEditor({ sw }: { sw: NetworkSwitch }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const queryClient = useQueryClient();
  const addEntry = useAddSwitchMaintenanceLogEntry();
  const { toast } = useToast();

  const reset = () => {
    setBody("");
    setWindowStart("");
    setWindowEnd("");
  };

  const save = async () => {
    if (!body.trim()) return;
    try {
      const toIso = (s: string) => (s ? new Date(s).toISOString() : null);
      await addEntry.mutateAsync({
        id: sw.id,
        data: {
          body: body.trim(),
          windowStart: toIso(windowStart),
          windowEnd: toIso(windowEnd),
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getListSwitchesQueryKey().slice(0, 1),
      });
      toast({ title: "Maintenance note added", description: sw.hostname });
      reset();
      setEditing(false);
    } catch (e: any) {
      toast({
        title: "Couldn't save note",
        description: e?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  if (!editing) {
    const hasHistory = (sw.maintenanceLog?.length ?? 0) > 0;
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => setEditing(true)}
      >
        <Wrench className="h-3 w-3 mr-1" />
        {hasHistory ? "Add maintenance note" : "Add first maintenance note"}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 mt-1">
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What changed, why, and anything the next engineer should know..."
        className="text-xs"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Window start (optional)
          <Input
            type="datetime-local"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            className="h-7 text-xs mt-1"
          />
        </label>
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Window end (optional)
          <Input
            type="datetime-local"
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            className="h-7 text-xs mt-1"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={save}
          disabled={addEntry.isPending || !body.trim()}
        >
          <Save className="h-3 w-3 mr-1" />
          {addEntry.isPending ? "Saving…" : "Add to log"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            reset();
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SwitchRow({ sw, onAskAI }: { sw: NetworkSwitch; onAskAI?: (prompt: string) => void }) {
  return (
    <div className="border-b last:border-b-0 py-2 px-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono font-medium text-sm">{sw.hostname}</p>
          <p className="font-mono text-xs text-primary mt-0.5">{sw.ipAddress}</p>
          {sw.model && <p className="text-xs text-muted-foreground mt-0.5">{sw.model}</p>}
          {sw.location && <p className="text-xs text-muted-foreground/80 mt-0.5">{sw.location}</p>}
          {sw.notes && <p className="text-xs italic text-muted-foreground/70 mt-1">{sw.notes}</p>}
        </div>
        <Badge variant="outline" className={`shrink-0 ${statusColor[sw.status ?? "unknown"] ?? ""}`}>
          {sw.status ?? "unknown"}
        </Badge>
      </div>
      <MaintenanceLogList entries={sw.maintenanceLog ?? []} />
      <div className="flex flex-wrap gap-2 mt-2">
        <SwitchNotesEditor sw={sw} />
        <Link href={switchPostIncidentHref(sw)}>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Activity className="h-3 w-3 mr-1" />
            Start Post-Incident Review
          </Button>
        </Link>
        {onAskAI && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onAskAI(buildSwitchAIPrompt(sw))}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Ask AI about this switch
          </Button>
        )}
      </div>
    </div>
  );
}

function VlanRow({ vlan, onAskAI }: { vlan: Vlan; onAskAI?: (prompt: string) => void }) {
  return (
    <div className="border-b last:border-b-0 py-2 px-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-primary text-sm">VLAN {vlan.vlanId}</span>
            <span className="font-medium text-sm truncate">{vlan.name}</span>
          </div>
          {vlan.description && <p className="text-xs text-muted-foreground mt-0.5">{vlan.description}</p>}
          {vlan.subnet && (
            <p className="font-mono text-xs text-emerald-400 mt-0.5">
              {vlan.subnet}{vlan.gateway && ` via ${vlan.gateway}`}
            </p>
          )}
        </div>
        <Badge variant="outline" className={`shrink-0 ${vlanTypeColor[vlan.type ?? "other"] ?? ""}`}>
          {vlan.type ?? "other"}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <Link href={vlanPostIncidentHref(vlan)}>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Activity className="h-3 w-3 mr-1" />
            Start Post-Incident Review
          </Button>
        </Link>
        {onAskAI && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onAskAI(buildVlanAIPrompt(vlan))}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Ask AI about this VLAN
          </Button>
        )}
      </div>
    </div>
  );
}

type ChatMsg = { role: "user" | "assistant"; content: string };

function AskAIPanel({
  open,
  onOpenChange,
  pendingPrompt,
  onPromptConsumed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPrompt: string | null;
  onPromptConsumed: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt);
      onPromptConsumed();
    }
  }, [pendingPrompt, onPromptConsumed]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/network/ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply || "(empty response)" }]);
    } catch (e: any) {
      setError(e?.message || "AI request failed");
    } finally {
      setBusy(false);
    }
  };

  const suggestions = [
    "Which switch serves Cosmetology and what is its uplink?",
    "Where on the campus map is the Sharp Champion Center, and which VLAN ties it to the core?",
    "List every OSPF /30 transit VLAN and the building it connects to.",
    "If a user in Humanities reports no internet, what's the failure path I should check first?",
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Sparkles className="h-4 w-4 mr-2" /> Ask AI
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Network Engineer Assistant
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Knows the SCCC campus map and your live switch / VLAN inventory.
          </p>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="px-5 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try one of these:</p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="block text-left text-sm w-full p-2 rounded border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </div>
              </div>
            )}
            {error && (
              <div className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded p-2">
                {error}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about a building, switch, VLAN, OSPF link…"
            disabled={busy}
          />
          <Button onClick={send} disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CloudRemotePanel() {
  return (
    <Card className="border-primary/30">
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="h-4 w-4 text-primary" />
          Cloud &amp; Remote Sites
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Hybrid Azure deployment and the West campus IPsec site. Switches and
          subnets below are also indexed under their building in the tabs.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion type="multiple" className="space-y-2">
          <AccordionItem value="azure" className="border rounded-md px-3 bg-card">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Cloud className="h-4 w-4 text-sky-400" />
                <span className="font-medium">Microsoft Azure — Hybrid-VNet (Central US)</span>
                <Badge variant="outline" className="ml-auto text-xs">RG-Prod-CentralUS</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3 pt-2">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VNet</p>
                  <p><span className="text-muted-foreground">Name:</span> <span className="font-mono">Hybrid-VNet</span></p>
                  <p><span className="text-muted-foreground">Region:</span> centralus</p>
                  <p><span className="text-muted-foreground">Address space:</span> <span className="font-mono text-emerald-400">10.0.0.0/24, 10.3.0.0/27</span></p>
                  <p><span className="text-muted-foreground">Peering:</span> none configured</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key subnets</p>
                  <p><span className="font-mono">GatewaySubnet</span> — <span className="font-mono text-emerald-400">10.0.0.224/27</span> (Hybrid-VPNGateway)</p>
                  <p><span className="font-mono">Hybrid_default</span> — <span className="font-mono text-emerald-400">10.0.0.0/25</span> (workloads, NAT, PEs)</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VPN</p>
                  <p><span className="font-mono">Hybrid-VPNGateway</span> — RouteBased, Gen2, Active/Active (VpnGw2AZ)</p>
                  <p><span className="font-mono">S2S-OnPrem</span> — Connected → <span className="font-mono">OnPrem-LNG</span></p>
                  <p><span className="font-mono">OnPrem-SNAT</span>: 10.1.0.0/24 → 172.20.1.0/26 (egress)</p>
                  <p className="text-xs text-amber-400/80"><span className="font-mono">Azure_Ipsec</span> on VNG_NEW — <strong>NotConnected</strong> (separate path)</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Routes (RT-To-Onprem)</p>
                  <p><span className="font-mono">192.168.0.0/16</span> → VirtualNetworkGateway</p>
                  <p><span className="font-mono">10.70.0.0/16</span> → VirtualNetworkGateway</p>
                  <p><span className="font-mono">10.0.0.192/26</span> → VnetLocal (bastion)</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Local Network Gateway (OnPrem-LNG)</p>
                  <p><span className="text-muted-foreground">Public IP:</span> <span className="font-mono">207.178.111.98</span></p>
                  <p className="text-xs text-muted-foreground">Address prefixes include 172.25.0.0/21, 172.25.0.0/24…172.25.6.0/24, plus extensive 10.x, 172.16/18/20/23 and 192.168.0.0/16. Confirm in portal before edits.</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">DNS (VNet)</p>
                  <p className="font-mono text-xs">10.40.1.80, 10.40.1.82, 10.0.0.34, 10.40.1.77, 10.40.1.68 — on-prem / hybrid mix</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other VNets in subscription</p>
                  <p className="text-xs font-mono">Hybrid-TEST01-vnet · 104_VNET · vnet-prod-web · vnet_NEW · aadds-vnet (SCCC_DOMAIN_SERVICES) · test-gateway-vnet · TestVM01-vnet · test-wsus-vnet</p>
                </div>
              </div>
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                Snapshot is point-in-time from the last <span className="font-mono">azure_visualizer.ps1</span> export.
                Re-run that script (PowerShell, requires <span className="font-mono">az login</span> and the
                <span className="font-mono"> resource-graph</span> extension) to refresh.
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="west" className="border rounded-md px-3 bg-card">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Radio className="h-4 w-4 text-amber-400" />
                <span className="font-medium">West Campus — IPsec site (172.25.0.0/21)</span>
                <Badge variant="outline" className="ml-auto text-xs">VPN-only</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3 pt-2">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Addressing</p>
                  <p><span className="font-mono text-emerald-400">172.25.0.0/21</span> — West aggregate (FortiGate Phase 2 Vlan_910_915, Azure OnPrem-LNG)</p>
                  <p><span className="font-mono">VLAN 910</span> — <span className="font-mono text-emerald-400">172.25.1.0/24</span> (West_17225_to_Azure)</p>
                  <p><span className="font-mono">West_Wired</span> — <span className="font-mono text-emerald-400">172.25.0.0/24</span></p>
                  <p><span className="font-mono">West_Wireless</span> — <span className="font-mono text-emerald-400">10.11.16.0/24</span></p>
                  <p className="text-xs text-amber-400/80">FortiGate <span className="font-mono">West_All</span> may exclude 172.25.1.0/24 — Vlan_910 sources can miss policies that use it.</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connectivity</p>
                  <p>Reaches main campus / Azure via <strong>IPsec</strong> through <span className="font-mono">West_FGT</span> ↔ <span className="font-mono">Fortigate1-Sccc</span>.</p>
                  <p className="text-xs text-muted-foreground">Static route <span className="font-mono">172.25.0.0/21 → West_FGT</span> on the HQ side.</p>
                  <p className="text-xs text-muted-foreground">Not extended as a campus L2 VLAN like Epworth — design is VPN-only.</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tunnel runtime (last reviewed)</p>
                  <p><span className="font-mono">West_FGT</span>: ~28 Phase 2 selectors, 14 up; <span className="text-amber-400">~240k TX errors flagged</span> — investigate MTU / path.</p>
                  <p><span className="font-mono">Azure-SCCC2</span>: 56 selectors, 33 up (not all SAs up at once is normal).</p>
                  <p>Phase 2 names: <span className="font-mono">West_17225_to_Azure</span> (172.25.1.0/24 → Azure), <span className="font-mono">Vlan_910_915</span> (172.25.0.0/21 → Azure).</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relevant FortiGate policies (Fortigate1-Sccc)</p>
                  <p className="text-xs">222/223 — West ↔ campus &nbsp;·&nbsp; 229 — campus → Azure &nbsp;·&nbsp; 244/245/246/248 — West ↔ Azure</p>
                  <p className="text-xs"><span className="font-mono">SCCC_To_WestsideFGT</span>: port3 → West_FGT (src WestFGT_Outgoing, dst WestFGT_Incoming)</p>
                  <p className="text-xs"><span className="font-mono">WestFGT_To_SCCC</span>: West_FGT → port3 (mirror direction)</p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="epworth" className="border rounded-md px-3 bg-card">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Radio className="h-4 w-4 text-emerald-400" />
                <span className="font-medium">Epworth — dark fiber / OSPF site</span>
                <Badge variant="outline" className="ml-auto text-xs">L2/L3 extended</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-2 pt-2">
              <p>Connected to the core via <strong>dark fiber</strong> with OSPF, in contrast to West's IPsec design.</p>
              <p><span className="font-mono">VLAN 773</span> — <span className="font-mono">EpworthBuilding</span> (named on the aa144 Nexus pair).</p>
              <p><span className="font-mono">VLAN 616</span> — <span className="font-mono">OSPF10-Epworth</span> (transit /30, e.g. interface description <span className="font-mono">OSPF10-Epworth-To-Cisco9k-A48</span>).</p>
              <p><span className="font-mono">E117-E213-EpworthLabs</span> for lab segments.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function CampusMapPanel() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <MapIcon className="h-4 w-4 mr-2" /> Campus Map
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>SCCC Main Campus Map</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <img
            src={`${import.meta.env.BASE_URL}network/campus-map.png`}
            alt="SCCC campus map"
            className="w-full rounded border"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Remote sites Epworth and West are not shown on the main-campus map.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Network() {
  const [search, setSearch] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const askAI = (prompt: string) => {
    setPendingPrompt(prompt);
    setAiOpen(true);
  };
  const { data: switches, isLoading: switchesLoading } = useListSwitches({});
  const { data: vlans, isLoading: vlansLoading } = useListVlans({});

  const q = search.toLowerCase();
  const allSwitches: NetworkSwitch[] = switches ?? [];
  const allVlans: Vlan[] = vlans ?? [];
  const filteredSwitches = allSwitches.filter((s) => matchSwitch(s, q));
  const filteredVlans = allVlans.filter((v) => matchVlan(v, q));

  const buildings = useMemo(() => {
    const m: Record<string, { switches: NetworkSwitch[]; vlans: Vlan[] }> = {};
    for (const s of allSwitches) {
      const b = s.building || "Unassigned";
      (m[b] ||= { switches: [], vlans: [] }).switches.push(s);
    }
    for (const v of allVlans) {
      const b = v.building || "Unassigned";
      (m[b] ||= { switches: [], vlans: [] }).vlans.push(v);
    }
    let entries = Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
    if (q) {
      entries = entries
        .map(([name, group]) => {
          const swMatch = group.switches.filter((s) => matchSwitch(s, q));
          const vlMatch = group.vlans.filter((v) => matchVlan(v, q));
          const buildingMatches = name.toLowerCase().includes(q);
          if (buildingMatches) return [name, group] as const;
          if (swMatch.length || vlMatch.length) {
            return [name, { switches: swMatch, vlans: vlMatch }] as const;
          }
          return null;
        })
        .filter(Boolean) as [string, { switches: NetworkSwitch[]; vlans: Vlan[] }][];
    }
    return entries;
  }, [allSwitches, allVlans, q]);

  const isLoading = switchesLoading || vlansLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Network Reference</h1>
        <div className="flex gap-2 flex-wrap">
          <CampusMapPanel />
          <Link href="/network/visualize">
            <Button variant="outline" size="sm">
              <Workflow className="h-4 w-4 mr-2" /> Visualizer
            </Button>
          </Link>
          <AskAIPanel
            open={aiOpen}
            onOpenChange={setAiOpen}
            pendingPrompt={pendingPrompt}
            onPromptConsumed={() => setPendingPrompt(null)}
          />
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by hostname, IP, building, VLAN ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <CloudRemotePanel />

      <Tabs defaultValue="buildings">
        <TabsList>
          <TabsTrigger value="buildings">
            <Building2 className="h-4 w-4 mr-2" /> Buildings ({buildings.length})
          </TabsTrigger>
          <TabsTrigger value="switches">
            <Server className="h-4 w-4 mr-2" /> Switches ({allSwitches.length})
          </TabsTrigger>
          <TabsTrigger value="vlans">
            <NetworkIcon className="h-4 w-4 mr-2" /> VLANs ({allVlans.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buildings" className="mt-4">
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : buildings.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {q ? "No buildings match your search." : "No buildings yet — add switches or VLANs to get started."}
            </div>
          ) : (
            <Accordion
              type="multiple"
              defaultValue={buildings.slice(0, 3).map(([n]) => n)}
              className="space-y-2"
            >
              {buildings.map(([name, group]) => (
                <AccordionItem
                  key={name}
                  value={name}
                  className="border rounded-md px-3 bg-card"
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 flex-1">
                      <Building2 className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">{name}</span>
                      <span className="ml-auto text-xs text-muted-foreground flex gap-3">
                        <span>{group.switches.length} switch{group.switches.length === 1 ? "" : "es"}</span>
                        <span>{group.vlans.length} VLAN{group.vlans.length === 1 ? "" : "s"}</span>
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
                          <Server className="h-3 w-3" /> Switches
                        </p>
                        {group.switches.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No switches recorded.</p>
                        ) : (
                          <div className="rounded border bg-background/40">
                            {group.switches.map((s) => <SwitchRow key={s.id} sw={s} onAskAI={askAI} />)}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
                          <NetworkIcon className="h-3 w-3" /> VLANs
                        </p>
                        {group.vlans.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No VLANs recorded.</p>
                        ) : (
                          <div className="rounded border bg-background/40">
                            {group.vlans.map((v) => <VlanRow key={v.id} vlan={v} onAskAI={askAI} />)}
                          </div>
                        )}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </TabsContent>

        <TabsContent value="switches" className="mt-4">
          {switchesLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : filteredSwitches.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No switches found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredSwitches.map((sw) => (
                <Card key={sw.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1">{sw.building}</p>
                    <SwitchRow sw={sw} onAskAI={askAI} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="vlans" className="mt-4">
          {vlansLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : filteredVlans.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No VLANs found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredVlans.map((vlan) => (
                <Card key={vlan.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1">{vlan.building}</p>
                    <VlanRow vlan={vlan} onAskAI={askAI} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
