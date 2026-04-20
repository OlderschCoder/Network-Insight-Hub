import { useMemo, useRef, useState, useEffect } from "react";
import { useListSwitches, useListVlans } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Server, Network as NetworkIcon, Workflow, Building2,
  Sparkles, Send, Map as MapIcon, Loader2,
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

const matchSwitch = (s: any, q: string) =>
  !q ||
  s.hostname?.toLowerCase().includes(q) ||
  s.building?.toLowerCase().includes(q) ||
  s.ipAddress?.toLowerCase().includes(q) ||
  s.model?.toLowerCase().includes(q);

const matchVlan = (v: any, q: string) =>
  !q ||
  String(v.vlanId).includes(q) ||
  v.name?.toLowerCase().includes(q) ||
  v.description?.toLowerCase().includes(q) ||
  v.building?.toLowerCase().includes(q) ||
  v.subnet?.toLowerCase().includes(q);

function SwitchRow({ sw }: { sw: any }) {
  return (
    <div className="flex items-start justify-between border-b last:border-b-0 py-2 px-1 gap-3">
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
  );
}

function VlanRow({ vlan }: { vlan: any }) {
  return (
    <div className="flex items-start justify-between border-b last:border-b-0 py-2 px-1 gap-3">
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
  );
}

type ChatMsg = { role: "user" | "assistant"; content: string };

function AskAIPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

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
    <Sheet open={open} onOpenChange={setOpen}>
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
  const { data: switches, isLoading: switchesLoading } = useListSwitches({});
  const { data: vlans, isLoading: vlansLoading } = useListVlans({});

  const q = search.toLowerCase();
  const allSwitches = (switches ?? []) as any[];
  const allVlans = (vlans ?? []) as any[];
  const filteredSwitches = allSwitches.filter((s) => matchSwitch(s, q));
  const filteredVlans = allVlans.filter((v) => matchVlan(v, q));

  const buildings = useMemo(() => {
    const m: Record<string, { switches: any[]; vlans: any[] }> = {};
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
        .filter(Boolean) as [string, { switches: any[]; vlans: any[] }][];
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
          <AskAIPanel />
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
                            {group.switches.map((s) => <SwitchRow key={s.id} sw={s} />)}
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
                            {group.vlans.map((v) => <VlanRow key={v.id} vlan={v} />)}
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
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono font-medium text-sm">{sw.hostname}</p>
                        <p className="text-xs text-muted-foreground">{sw.building}</p>
                        <p className="font-mono text-xs text-primary mt-1">{sw.ipAddress}</p>
                        {sw.model && <p className="text-xs text-muted-foreground mt-1">{sw.model}</p>}
                        {sw.notes && <p className="text-xs italic text-muted-foreground/70 mt-1">{sw.notes}</p>}
                      </div>
                      <Badge variant="outline" className={statusColor[sw.status ?? "unknown"] ?? ""}>
                        {sw.status ?? "unknown"}
                      </Badge>
                    </div>
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
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-primary">VLAN {vlan.vlanId}</span>
                          <span className="font-medium text-sm truncate">{vlan.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{vlan.building}</p>
                        {vlan.description && (
                          <p className="text-xs text-muted-foreground mt-1">{vlan.description}</p>
                        )}
                        {vlan.subnet && (
                          <p className="font-mono text-xs text-emerald-400 mt-1">
                            {vlan.subnet}{vlan.gateway && ` via ${vlan.gateway}`}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className={`ml-2 shrink-0 ${vlanTypeColor[vlan.type ?? "other"] ?? ""}`}>
                        {vlan.type ?? "other"}
                      </Badge>
                    </div>
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
