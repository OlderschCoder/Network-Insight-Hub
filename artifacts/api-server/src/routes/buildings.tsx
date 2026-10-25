import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2, Server, Wifi, WifiOff, AlertTriangle, Activity,
  ArrowLeft, ChevronRight, Loader2, RefreshCw, Search, Pencil, Save, X,
} from "lucide-react";

const API = "/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BuildingSummary {
  name: string;
  nodeCount: number;
  vlanCount: number;
  healthColor: "green" | "amber" | "red" | "unknown";
  influxConfigured: boolean;
}

interface NetNodeSummary {
  id: string;
  hostname: string;
  displayName: string | null;
  nodeKind: string;
  vendor: string | null;
  model: string | null;
  mgmtIp: string | null;
  location: string | null;
  role: string | null;
  criticality: string | null;
  status: string | null;
  liveStatus: "up" | "degraded" | "down" | "unknown";
}

interface VlanSummary {
  id: number;
  vlanId: number;
  name: string | null;
  description: string | null;
  building: string;
  ipRange: string | null;
  vlanPurpose: string | null;
}

interface BuildingDetail {
  name: string;
  nodes: NetNodeSummary[];
  vlans: VlanSummary[];
  links: any[];
  healthColor: "green" | "amber" | "red" | "unknown";
  influxConfigured: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const healthStyles: Record<string, { bg: string; border: string; ring: string; label: string; icon: ReactNode }> = {
  green: {
    bg: "bg-green-50 hover:bg-green-100",
    border: "border-green-400",
    ring: "ring-green-300",
    label: "All systems up",
    icon: <Wifi className="h-5 w-5 text-green-600" />,
  },
  amber: {
    bg: "bg-amber-50 hover:bg-amber-100",
    border: "border-amber-400",
    ring: "ring-amber-300",
    label: "Degraded",
    icon: <AlertTriangle className="h-5 w-5 text-amber-500" />,
  },
  red: {
    bg: "bg-red-50 hover:bg-red-100",
    border: "border-red-400",
    ring: "ring-red-300",
    label: "One or more devices down",
    icon: <WifiOff className="h-5 w-5 text-red-600" />,
  },
  unknown: {
    bg: "bg-gray-50 hover:bg-gray-100",
    border: "border-gray-300",
    ring: "ring-gray-200",
    label: "Status unknown",
    icon: <Activity className="h-5 w-5 text-gray-400" />,
  },
};

type CampusOverlay = {
  code: string;
  buildingName: string;
  aliases: string[];
  x: number;
  y: number;
};

const CAMPUS_OVERLAYS: CampusOverlay[] = [
  { code: "TA", buildingName: "Industrial Technology Campus", aliases: ["ta", "industrial technology campus", "technical arts"], x: 43.8, y: 6.2 },
  { code: "TB", buildingName: "Industrial Technology Campus", aliases: ["tb", "industrial technology campus"], x: 43.8, y: 11.5 },
  { code: "TD", buildingName: "Industrial Technology Campus", aliases: ["td", "industrial technology campus"], x: 58.2, y: 6.1 },
  { code: "TT", buildingName: "Industrial Technology Campus", aliases: ["tt", "industrial technology campus"], x: 61.2, y: 6.4 },
  { code: "V", buildingName: "Agriculture", aliases: ["v", "agriculture", "ag"], x: 75.1, y: 13.1 },
  { code: "COS", buildingName: "Cosmetology", aliases: ["cos", "cosmetology"], x: 37.8, y: 21.1 },
  { code: "CAH", buildingName: "Colvin Family Center for Allied Health", aliases: ["cah", "colvin family center for allied health", "allied health"], x: 33.6, y: 27.0 },
  { code: "AA", buildingName: "Hobble", aliases: ["aa", "hobble", "hobble academic", "hobble academic building"], x: 40.1, y: 36.2 },
  { code: "A", buildingName: "Hobble", aliases: ["a", "hobble", "hobble academic", "hobble academic building"], x: 43.5, y: 37.9 },
  { code: "H", buildingName: "Humanities Building", aliases: ["h", "humanities", "humanities building"], x: 54.9, y: 42.0 },
  { code: "SA", buildingName: "Student Union / Activities", aliases: ["sa", "student union / activities", "student union", "activities"], x: 69.9, y: 35.4 },
  { code: "SU", buildingName: "Student Union / Activities", aliases: ["su", "student union / activities", "student union", "activities"], x: 71.6, y: 31.5 },
  { code: "SW", buildingName: "Student Union / Activities", aliases: ["sw", "student union / activities", "student union", "activities"], x: 73.3, y: 28.0 },
  { code: "SHC", buildingName: "Student Health Center", aliases: ["shc", "student health center", "health center"], x: 79.6, y: 20.3 },
  { code: "SLC", buildingName: "Student Living Center", aliases: ["slc", "student living center", "mansions"], x: 82.8, y: 24.3 },
  { code: "SFCC", buildingName: "Sharp Family Champion Center", aliases: ["sfcc", "sharp family champion center", "sharp champion center"], x: 82.1, y: 67.5 },
];

function normalizeBuildingName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesAlias(name: string, aliases: string[]): boolean {
  const normalized = normalizeBuildingName(name);
  return aliases.some((alias) => {
    const candidate = normalizeBuildingName(alias);
    return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
  });
}

function LiveBadge({ status }: { status: "up" | "degraded" | "down" | "unknown" }) {
  const cfg = {
    up: { cls: "bg-green-100 text-green-700 border-green-300", icon: <Wifi className="h-3 w-3" /> },
    degraded: { cls: "bg-amber-100 text-amber-700 border-amber-300", icon: <AlertTriangle className="h-3 w-3" /> },
    down: { cls: "bg-red-100 text-red-700 border-red-300", icon: <WifiOff className="h-3 w-3" /> },
    unknown: { cls: "bg-gray-100 text-gray-500 border-gray-300", icon: <Activity className="h-3 w-3" /> },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium ${cfg.cls}`}>
      {cfg.icon} {status}
    </span>
  );
}

function critColor(c: string | null) {
  if (!c) return "bg-gray-100 text-gray-500 border-gray-200";
  return {
    critical: "bg-red-100 text-red-700 border-red-300",
    high: "bg-orange-100 text-orange-700 border-orange-300",
    medium: "bg-amber-100 text-amber-700 border-amber-300",
    low: "bg-green-100 text-green-700 border-green-300",
  }[c] ?? "bg-gray-100 text-gray-500 border-gray-200";
}

// ─── Grid View ────────────────────────────────────────────────────────────────

function CampusStatusMap({ buildings }: { buildings: BuildingSummary[] }) {
  const buildingByCode = useMemo(() => {
    const byName = new Map(buildings.map((building) => [normalizeBuildingName(building.name), building]));
    const resolved = new Map<string, BuildingSummary | null>();

    for (const overlay of CAMPUS_OVERLAYS) {
      let match = byName.get(normalizeBuildingName(overlay.buildingName)) ?? null;
      if (!match) {
        match = buildings.find((building) => matchesAlias(building.name, overlay.aliases)) ?? null;
      }
      resolved.set(overlay.code, match);
    }

    return resolved;
  }, [buildings]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-xl">
          <Building2 className="h-5 w-5 text-primary" />
          Live Campus Status Map
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Building codes are matched to the campus map and colored by current building health.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-green-500" /> All mapped devices up</div>
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-400" /> One or more mapped devices degraded</div>
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-red-500" /> One or more mapped devices down</div>
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-gray-300" /> No live building match yet</div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border bg-[#dfe8d8]">
          <img
            src={`${import.meta.env.BASE_URL}network/campus-map.png`}
            alt="SCCC campus map with live building status overlays"
            className="block w-full"
          />

          {CAMPUS_OVERLAYS.map((overlay) => {
            const match = buildingByCode.get(overlay.code);
            const style = healthStyles[match?.healthColor ?? "unknown"];
            const href = match ? `/network/buildings/${encodeURIComponent(match.name)}` : undefined;
            const marker = (
              <div
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 px-2.5 py-1 shadow-sm backdrop-blur-sm transition-transform duration-150 hover:scale-105 ${style.bg} ${style.border}`}
                style={{ left: `${overlay.x}%`, top: `${overlay.y}%` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold tracking-[0.14em] text-foreground">{overlay.code}</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      match?.healthColor === "green"
                        ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.55)]"
                        : match?.healthColor === "amber"
                          ? "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.45)]"
                          : match?.healthColor === "red"
                            ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
                          : "bg-gray-300"
                    }`}
                  />
                </div>
                <div className="mt-1 min-w-[112px] max-w-[160px] text-[10px] leading-tight text-muted-foreground">
                  <div className="font-medium text-foreground">{match?.name ?? overlay.buildingName}</div>
                  <div>{style.label}</div>
                </div>
              </div>
            );

            return href ? <Link key={overlay.code} href={href}>{marker}</Link> : <div key={overlay.code}>{marker}</div>;
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Remote sites like Epworth and West are not part of the main-campus image. Their status should stay in the building list and network views.
        </p>
      </CardContent>
    </Card>
  );
}

function BuildingsGrid() {
  const [buildings, setBuildings] = useState<BuildingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`${API}/network/buildings`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      setBuildings(await r.json());
    } catch (e: any) {
      toast({ title: "Failed to load buildings", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = buildings.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  // sort: green first, then amber, then unknown, alpha within
  const sorted = [...filtered].sort((a, b) => {
    const order = { red: 0, amber: 1, green: 2, unknown: 3 };
    const diff = (order[a.healthColor] ?? 3) - (order[b.healthColor] ?? 3);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Campus Buildings</h1>
          <Badge variant="outline">{buildings.length} buildings</Badge>
        </div>
        <div className="flex items-center gap-2">
  
        <Button variant="outline" size="sm" onClick={load} className="gap-1">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-green-500" /> All devices up</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-400" /> One or more degraded</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-red-500" /> One or more down</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-gray-300" /> No live data</div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Filter buildings..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      <CampusStatusMap buildings={buildings} />

      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-center py-16">
          {search ? "No buildings match your search." : "No buildings found. Add devices with a building name to see them here."}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {sorted.map(b => {
            const style = healthStyles[b.healthColor];
            return (
              <Link key={b.name} href={`/network/buildings/${encodeURIComponent(b.name)}`}>
                <div className={`
                  relative rounded-xl border-2 p-4 cursor-pointer transition-all duration-150
                  ${style.bg} ${style.border}
                  hover:shadow-md hover:scale-[1.02]
                `}>
                  {/* Health indicator dot */}
                  <div className={`absolute top-2 right-2 h-2.5 w-2.5 rounded-full ${
                    b.healthColor === "green" ? "bg-green-500 shadow-[0_0_6px_#22c55e]"
                    : b.healthColor === "amber" ? "bg-amber-400 shadow-[0_0_6px_#f59e0b]"
                    : b.healthColor === "red" ? "bg-red-500 shadow-[0_0_6px_#ef4444]"
                    : "bg-gray-300"
                  }`} />

                  <div className="flex flex-col gap-2">
                    <div className="text-muted-foreground">{style.icon}</div>
                    <div>
                      <p className="font-semibold text-sm leading-tight">{b.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{style.label}</p>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        <Server className="h-3 w-3 inline mr-0.5" />{b.nodeCount}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        VLANs: {b.vlanCount}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Building Detail View ─────────────────────────────────────────────────────

function BuildingDetailView({ name }: { name: string }) {
  const [detail, setDetail] = useState<BuildingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = !!user;
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(name);
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`${API}/network/buildings/${encodeURIComponent(name)}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      setDetail(await r.json());
    } catch (e: any) {
      toast({ title: "Failed to load building", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [name, toast]);

  useEffect(() => { load(); }, [load]);

  const saveBuildingName = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) { setEditingName(false); return; }
    setSavingName(true);
    try {
      const r = await authFetch(`${API}/network/buildings/${encodeURIComponent(name)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Building override saved", description: `${name} renamed to ${trimmed}.` });
      window.location.assign(`/network/buildings/${encodeURIComponent(trimmed)}`);
    } catch (e: any) {
      toast({ title: "Building update failed", description: e.message, variant: "destructive" });
    } finally { setSavingName(false); }
  };


  const editVlanBuilding = async (vlan: VlanSummary) => {
    const building = window.prompt(`Move VLAN ${vlan.vlanId} to which building?`, vlan.building || name)?.trim();
    if (!building || building === vlan.building) return;
    try {
      const r = await authFetch(`${API}/network/vlans/${vlan.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "VLAN moved", description: `VLAN ${vlan.vlanId} is now assigned to ${building}.` });
      await load();
    } catch (e: any) {
      toast({ title: "VLAN update failed", description: e.message, variant: "destructive" });
    }
  };
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Building not found.{" "}
        <Link href="/network/buildings"><span className="text-primary underline cursor-pointer">All Buildings</span></Link>
      </div>
    );
  }

  const style = healthStyles[detail.healthColor];

  const upCount = detail.nodes.filter(n => n.liveStatus === "up").length;
  const downCount = detail.nodes.filter(n => n.liveStatus === "down").length;
  const degradedCount = detail.nodes.filter(n => n.liveStatus === "degraded").length;
  const unknownCount = detail.nodes.filter(n => n.liveStatus === "unknown").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/network">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Network
          </Button>
        </Link>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <Link href="/network/buildings">
          <Button variant="ghost" size="sm" className="gap-1">
            <Building2 className="h-4 w-4" /> Buildings
          </Button>
        </Link>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <div className="flex items-center gap-2 flex-1">
          {style.icon}
                    {editingName ? (
            <div className="flex items-center gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9 w-64" aria-label="Building name" />
              <Button size="sm" onClick={saveBuildingName} disabled={savingName}><Save className="h-4 w-4 mr-1" />Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingName(false); setNewName(name); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : <h1 className="text-2xl font-bold">{detail.name}</h1>}
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
            detail.healthColor === "green" ? "bg-green-100 text-green-700 border-green-300"
            : detail.healthColor === "amber" ? "bg-amber-100 text-amber-700 border-amber-300"
            : detail.healthColor === "red" ? "bg-red-100 text-red-700 border-red-300"
            : "bg-gray-100 text-gray-600 border-gray-300"
          }`}>{style.label}</span>
        </div>
        {canEdit && !editingName && (
          <Button variant="outline" size="sm" onClick={() => setEditingName(true)} className="gap-1"><Pencil className="h-4 w-4" /> Edit Building</Button>
        )}
        <Button variant="outline" size="sm" onClick={load} className="gap-1">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Devices" value={detail.nodes.length} icon={<Server className="h-5 w-5 text-primary" />} />
        <SummaryCard label="VLANs" value={detail.vlans.length} icon={<Activity className="h-5 w-5 text-blue-500" />} />
        {detail.influxConfigured ? (
          <>
            <SummaryCard label="Up" value={upCount} icon={<Wifi className="h-5 w-5 text-green-600" />} color="text-green-600" />
            <SummaryCard label="Issues" value={downCount + degradedCount} icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
              color={downCount + degradedCount > 0 ? "text-amber-600" : "text-gray-500"} />
          </>
        ) : (
          <div className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-2">
            <Activity className="h-4 w-4 opacity-50" />
            Live status available after InfluxDB connection
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">Devices ({detail.nodes.length})</TabsTrigger>
          <TabsTrigger value="vlans">VLANs ({detail.vlans.length})</TabsTrigger>
        </TabsList>

        {/* Devices Tab */}
        <TabsContent value="devices" className="mt-4">
          {detail.nodes.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No devices associated with this building.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Vendor / Model</TableHead>
                    <TableHead>Mgmt IP</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Criticality</TableHead>
                    <TableHead>Status</TableHead>
                    {detail.influxConfigured && <TableHead>Live</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.nodes.map(node => (
                    <TableRow key={node.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/network/nodes/${node.id}`}>
                          <span className="text-primary underline font-medium text-sm">
                            {node.displayName || node.hostname}
                          </span>
                        </Link>
                        {node.displayName && (
                          <div className="text-xs text-muted-foreground">{node.hostname}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">{node.nodeKind}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {[node.vendor, node.model].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{node.mgmtIp ?? "—"}</TableCell>
                      <TableCell className="text-xs">{node.location ?? "—"}</TableCell>
                      <TableCell className="text-xs">{node.role ?? "—"}</TableCell>
                      <TableCell>
                        {node.criticality ? (
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium capitalize ${critColor(node.criticality)}`}>
                            {node.criticality}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{node.status ?? "—"}</TableCell>
                      {detail.influxConfigured && (
                        <TableCell><LiveBadge status={node.liveStatus} /></TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* VLANs Tab */}
        <TabsContent value="vlans" className="mt-4">
          {detail.vlans.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No VLANs associated with this building.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VLAN ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>IP Range</TableHead>
                    <TableHead>Purpose</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.vlans
                    .sort((a, b) => (a.vlanId ?? a.id) - (b.vlanId ?? b.id))
                    .map(vlan => (
                      <TableRow key={vlan.id}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">{vlan.vlanId ?? vlan.id}</Badge>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{vlan.name ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{vlan.description ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{vlan.ipRange ?? "—"}</TableCell>
                        <TableCell className="text-xs">{vlan.vlanPurpose ?? "—"}</TableCell>
                        {canEdit && <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => editVlanBuilding(vlan)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button></TableCell>}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon, color = "text-foreground",
}: { label: string; value: number; icon: React.ReactNode; color?: string }) {
  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Root Export — handles both /buildings and /buildings/:name ────────────────

export default function Buildings() {
  const params = useParams<{ name?: string }>();
  const buildingName = params?.name ? decodeURIComponent(params.name) : undefined;

  return buildingName ? <BuildingDetailView name={buildingName} /> : <BuildingsGrid />;
}
