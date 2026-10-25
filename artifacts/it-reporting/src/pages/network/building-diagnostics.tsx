import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, RefreshCw, Shuffle } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Result = {
  id: string; recordedAt: string; downloadMbps: number | null; uploadMbps: number | null;
  latencyMs: number | null; requestLossPercent: number | null; error: string | null; targetLabel: string;
};
type Device = {
  deviceId: string | null; adObjectGuid: string; enrolled: boolean; computerName: string; adVerified: boolean; online: boolean;
  lastCheckIn: string | null; agentVersion: string | null; loggedOnUser: string | null;
  location: { building: string | null; kind: string; source: string | null; observedAt: string | null };
  lastResult: Result | null;
};
type Overview = {
  enabled: boolean; schedulerEnabled: boolean; targetLabel: string; inventoryUpdatedAt: string | null;
  devices: Device[];
  buildings: { building: string; onlineDevices: number; eligibleDevices: number; lastResult: Result | null; noCurrentMeasurement: boolean }[];
  jobs: { id: string; computerName: string; building: string | null; status: string; createdAt: string; requestedBy: string }[];
};

const API = `${import.meta.env.VITE_API_URL || "/api"}/building-diagnostics`;
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "Not reported";
const metric = (value: number | null | undefined, unit: string) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : "—";
const locationLabels: Record<string, string> = {
  "network-confirmed": "Network confirmed", assigned: "Assigned office", stale: "Stale evidence",
  unknown: "Unknown", ambiguous: "Conflicting evidence",
};

async function readOverview(): Promise<Overview> {
  const response = await authFetch(`${API}/overview`);
  if (!response.ok) throw new Error(response.status === 403 ? "Network administrator access is required." : `Could not load building diagnostics (${response.status}).`);
  return response.json();
}

export default function BuildingDiagnostics() {
  const { user } = useAuth();
  const canManage = ["cio", "network", "network_engineer"].includes(user?.role || "");
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [building, setBuilding] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["building-diagnostics"], queryFn: readOverview, enabled: canManage, retry: false, refetchInterval: 30_000 });
  const data = query.data;
  const devices = useMemo(() => (data?.devices || []).filter(d =>
    (!building || d.location.building === building) &&
    `${d.computerName} ${d.loggedOnUser || ""} ${d.location.building || ""}`.toLowerCase().includes(search.toLowerCase())), [data, building, search]);
  const eligible = (d: Device): d is Device & { deviceId: string } => !!d.deviceId && d.online && d.adVerified;
  const selectedEligible = (data?.devices || []).filter(eligible).filter(d => selected.has(d.deviceId));
  const queue = useMutation({
    mutationFn: async (deviceIds: string[]) => {
      const response = await authFetch(`${API}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceIds }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Could not queue measurements (${response.status}).`);
      }
      return response.json();
    },
    onSuccess: result => { setNotice(`${result.queued} measurements queued. Computers run one bounded test at a time.`); setSelected(new Set()); client.invalidateQueries({ queryKey: ["building-diagnostics"] }); },
  });

  function chooseBuildingSamples() {
    const groups = new Map<string, (Device & { deviceId: string })[]>();
    for (const device of devices) {
      if (!eligible(device) || device.location.kind !== "network-confirmed" || !device.location.building) continue;
      const group = groups.get(device.location.building) || [];
      group.push(device); groups.set(device.location.building, group);
    }
    const next = new Set<string>();
    for (const group of groups.values()) next.add(group[Math.floor(Math.random() * group.length)].deviceId);
    setSelected(next); setNotice(`Selected ${next.size} computers, one per building with current network evidence.`);
  }

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/network/buildings" className="text-sm text-muted-foreground hover:underline">Campus buildings</Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold"><Activity className="h-6 w-6" /> Building speed & computers</h1>
        <p className="mt-1 text-sm text-muted-foreground">AD computer presence, current building evidence, and measured HTTPS performance.</p></div>
      <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching || !canManage}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    {!canManage && <p role="alert">Network administrator access is required.</p>}
    {query.isPending && canManage && <p role="status">Loading computer reports…</p>}
    {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {data && <>
      <div className="flex flex-wrap gap-2"><Badge variant={data.enabled ? "default" : "secondary"}>Reporting {data.enabled ? "enabled" : "staged"}</Badge>
        <Badge variant="outline">Automatic measurements {data.schedulerEnabled ? "enabled" : "paused"}</Badge>
        <Badge variant="outline">{data.devices.filter(d => d.online).length} reporting online / {data.devices.length} inventoried</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Inventory updated {time(data.inventoryUpdatedAt)}. Online means a recent authenticated check-in; AD membership is verified centrally. Target: {data.targetLabel}. Measurements describe this computer’s path to Fred, not the maximum capacity of the campus Internet link.</p>
      <Card><CardHeader><CardTitle>Building measurements</CardTitle></CardHeader><CardContent>
        {data.buildings.length === 0 ? <p>No building evidence has been imported yet.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Building</TableHead><TableHead>Online / eligible</TableHead><TableHead>Download</TableHead><TableHead>Upload</TableHead><TableHead>Latency / request loss</TableHead><TableHead>Measured</TableHead></TableRow></TableHeader><TableBody>
          {data.buildings.map(b => <TableRow key={b.building}><TableCell className="font-medium">{b.building}</TableCell><TableCell>{b.onlineDevices} / {b.eligibleDevices}</TableCell><TableCell>{metric(b.lastResult?.downloadMbps, "Mbps")}</TableCell><TableCell>{metric(b.lastResult?.uploadMbps, "Mbps")}</TableCell><TableCell>{metric(b.lastResult?.latencyMs, "ms")} / {metric(b.lastResult?.requestLossPercent, "%")}</TableCell><TableCell>{b.noCurrentMeasurement ? "No current measurement" : time(b.lastResult?.recordedAt)}{b.lastResult?.error && <p className="text-destructive">{b.lastResult.error}</p>}</TableCell></TableRow>)}
        </TableBody></Table></div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Computer inventory</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3"><Input className="max-w-sm" aria-label="Search computers or users" placeholder="Computer, user, or building" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="rounded-md border bg-background px-3 text-sm" aria-label="Filter building" value={building} onChange={e => setBuilding(e.target.value)}><option value="">All buildings</option>{data.buildings.map(b => <option key={b.building}>{b.building}</option>)}</select>
          <Button variant="outline" onClick={chooseBuildingSamples} disabled={!data.enabled}><Shuffle className="mr-2 h-4 w-4" />Choose one per building</Button>
          <Button onClick={() => { setNotice(""); queue.mutate(selectedEligible.map(d => d.deviceId)); }} disabled={!data.enabled || !selectedEligible.length || queue.isPending}>Measure selected ({selectedEligible.length})</Button>
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}{queue.error && <p role="alert" className="text-destructive">{queue.error.message}</p>}
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Select</TableHead><TableHead>Computer / current user</TableHead><TableHead>Presence / AD</TableHead><TableHead>Building evidence</TableHead><TableHead>Last check-in</TableHead><TableHead>Agent</TableHead></TableRow></TableHeader><TableBody>
          {devices.map(d => <TableRow key={d.deviceId || d.adObjectGuid}><TableCell><input type="checkbox" aria-label={`Select ${d.computerName}`} checked={!!d.deviceId && selected.has(d.deviceId)} disabled={!data.enabled || !eligible(d)} onChange={e => { const id = d.deviceId; if (id) setSelected(previous => { const next = new Set(previous); e.target.checked ? next.add(id) : next.delete(id); return next; }); }} /></TableCell><TableCell><div className="font-medium">{d.computerName}</div><div className="text-xs text-muted-foreground">{d.loggedOnUser || "No user reported"}</div></TableCell><TableCell>{d.online ? "Online" : d.enrolled ? "No recent check-in" : "Not enrolled"}<div className="text-xs">{d.adVerified ? "AD verified" : "AD verification unavailable"}</div></TableCell><TableCell>{d.location.building || "Unknown"}<div className="text-xs text-muted-foreground">{locationLabels[d.location.kind] || d.location.kind}{d.location.source ? ` · ${d.location.source}` : ""}</div><div className="text-xs text-muted-foreground">{time(d.location.observedAt)}</div></TableCell><TableCell>{time(d.lastCheckIn)}</TableCell><TableCell>{d.agentVersion || "Not enrolled"}</TableCell></TableRow>)}
          {devices.length === 0 && <TableRow><TableCell colSpan={6}>No matching computers. AD inventory and diagnostic enrollment are separate from the alert receiver.</TableCell></TableRow>}
        </TableBody></Table></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Recent measurement jobs</CardTitle></CardHeader><CardContent>{data.jobs.length === 0 ? <p>No measurements requested.</p> : <ul className="space-y-2 text-sm">{data.jobs.slice(0, 30).map(job => <li key={job.id}><strong>{job.computerName}</strong> · {job.building || "Unlocated"} · {job.status} · {time(job.createdAt)} · {job.requestedBy}</li>)}</ul>}</CardContent></Card>
    </>}
  </div>;
}
