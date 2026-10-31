import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Building2, Download, Laptop, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/authFetch";

const API = `${import.meta.env.VITE_API_URL || "/api"}/building-probes`;
type Adapter = { id: string; name: string; state: string; ipv4: string[]; gateways: string[]; dnsServers: string[] };
type Result = { outcome: string; completedAt: string; details: Record<string, unknown> };
type Job = { id: string; kind: string; status: string; createdAt: string; result: Result | null; slotAt?: string | null;
  options?: { profile: string; maxBytes: number; timeoutSeconds: number } | null };
type Probe = { id: string; building: string; computerName: string; enabled: boolean; state: string;
  buildingId?: string | null; buildingKey?: string; deviceId?: string | null; createdAt?: string;
  assignmentBasis?: "catalog-assignment" | "historical-assignment"; selected?: boolean; selectionRevision?: number;
  activationAt?: string | null; capabilities?: string[]; installedAt?: string | null; capable?: boolean; eligible?: boolean;
  cadenceAnchorAt?: string | null; cadenceAnchorSource?: "installed-at" | "selection-time-fallback" | null;
  cadenceAnchorResolvedAt?: string | null; selectionAt?: string | null;
  missedSlot?: string | null; missedSlotReason?: string | null; consecutiveFailures?: number; lastThroughputAt?: string | null;
  lastSeen: string | null; expectedVoiceSubnet: string | null; adapterId: string | null;
  snapshot: { agentVersion: string; uptimeSeconds: number; adapters: Adapter[];
    keyAlert: { installed: boolean; serviceState: string; version: string | null; uiProcessCount: number } } | null;
  jobs: Job[] | null };
type Building = { id: string; label: string; normalizedKey: string };
type Profile = { maxBytes: number; timeoutSeconds: number };
type Schedule = { enabled: boolean; targetReady: boolean; capacityEnabled: boolean; reason: string | null; targetId: string | null;
  profiles: { quick: Profile; hourly: Profile; capacity: Profile }; timeZone: string;
  capacityWindows: string[]; staggerWindowSeconds: number; capacityStartDeadlineMinutes?: number; capacityHardEndMinutes?: number;
  quickConcurrency?: number; hourlyConcurrency?: number; capacityConcurrency?: number };
type Overview = { enabled: boolean; probes: Probe[]; buildings?: Building[]; schedule?: Schedule };
type ProbeGroup = { key: string; current: Probe | null; history: Probe[]; conflicted: boolean };
const normalizedComputer = (value: string) => value.trim().toUpperCase();
const uniqueIds = <T extends { id: string }>(values: T[]) => [...new Map(values.map(value => [value.id, value])).values()];
function groupComputers(values: Probe[]): ProbeGroup[] {
  // Repeated assignments and renamed records sharing a device UUID form one
  // computer. A shared building label never merges different computers.
  const assignments = new Map<string, Probe>();
  for (const row of values) {
    const previous = assignments.get(row.id);
    if (!previous || (row.enabled && !previous.enabled) || (row.enabled === previous.enabled && (Date.parse(row.lastSeen || "") || 0) > (Date.parse(previous.lastSeen || "") || 0))) assignments.set(row.id, row);
  }
  const rows = [...assignments.values()], parents = rows.map((_, index) => index), identities = new Map<string, number>();
  const find = (index: number): number => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  rows.forEach((row, index) => {
    const keys = [`computer:${normalizedComputer(row.computerName)}`, ...(row.deviceId ? [`device:${row.deviceId.toLowerCase()}`] : [])];
    for (const key of keys) { const previous = identities.get(key); if (previous !== undefined) parents[find(index)] = find(previous); identities.set(key, index); }
  });
  const grouped = new Map<number, Probe[]>();
  rows.forEach((row, index) => { const root = find(index), group = grouped.get(root); if (group) group.push(row); else grouped.set(root, [row]); });
  return [...grouped.values()].map(group => {
    group.sort((a, b) => Number(b.enabled) - Number(a.enabled) ||
      (Date.parse(b.lastSeen || b.createdAt || "") || 0) - (Date.parse(a.lastSeen || a.createdAt || "") || 0) || a.id.localeCompare(b.id));
    const active = group.filter(row => row.enabled), current = active[0] || null;
    return { key: current?.id || group[0].id, current, history: group.filter(row => row !== current), conflicted: active.length > 1 };
  }).sort((a, b) => (a.current || a.history[0]).computerName.localeCompare((b.current || b.history[0]).computerName));
}
const label = (value: string) => value.replaceAll("_", " ");
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "No check-in yet";
const age = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "No sample yet";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
};
const bytes = (value: number) => {
  if (!Number.isFinite(value)) return "Not reported";
  for (const [size, unit] of [[1024 ** 3, "GiB"], [1024 ** 2, "MiB"], [1_000_000_000, "GB"], [1_000_000, "MB"]] as const) {
    if (value >= size && value % size === 0) return `${value / size} ${unit}`;
  }
  return `${value.toLocaleString()} bytes`;
};
const duration = (seconds: number) => seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} minutes` : `${seconds}s`;
const detailText = (value: unknown) => typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "unavailable");
const centralTime = (value: string | null | undefined, zone: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not activated";
async function request(path: string, body?: unknown) {
  const response = await authFetch(`${API}${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The monitor request failed.");
  return result;
}

export default function BuildingProbes() {
  const { isCIO, user } = useAuth();
  const canView = ["cio", "network", "network_engineer"].includes(user?.role || "");
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ id: string; selected: boolean } | null>(null);
  const [provisioning, setProvisioning] = useState<{ computerName: string; [key: string]: unknown } | null>(null);
  const [replace, setReplace] = useState<Probe | null>(null);
  const query = useQuery<Overview>({ queryKey: ["building-probes"], enabled: canView,
    queryFn: () => request("/"), refetchInterval: 15_000 });
  const data = canView ? query.data : undefined;
  const enabled = data?.enabled === true;
  const historyQuery = useQuery<{ probes: Probe[] }>({ queryKey: ["building-probe-history"], enabled: canView && enabled,
    queryFn: () => request("/history"), refetchInterval: 60_000 });
  const groups = useMemo(() => groupComputers([...(data?.probes || []), ...(canView ? historyQuery.data?.probes || [] : [])]), [data?.probes, historyQuery.data, canView]);
  const currentGroups = groups.filter(group => group.current), probes = currentGroups.map(group => group.current!);
  const retiredGroups = groups.filter(group => !group.current);
  const buildings = uniqueIds(data?.buildings || []);
  const catalog = new Map(buildings.map(building => [building.id, building]));
  const schedule = data?.schedule;
  const selected = probes.filter(probe => probe.selected);
  const selectedBuildings = new Set(selected.map(probe => probe.buildingId).filter(id => id && catalog.has(id))).size;
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: ["building-probes"] }), cache.invalidateQueries({ queryKey: ["building-probe-history"] })]);
  async function act(key: string, action: () => Promise<void>) {
    setError(""); setNotice(""); setBusy(key);
    try { await action(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); }
    finally { setBusy(null); }
  }
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    await act("assign", async () => {
      const result = await request("/assignments", { buildingId: data.get("buildingId"), computerName: data.get("computer"),
        adapterId: String(data.get("adapter") || "").trim() || null,
        expectedVoiceSubnet: String(data.get("subnet") || "").trim() || null });
      setProvisioning(result.provisioning); form.reset();
    });
  }
  async function addBuilding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    await act("building", async () => { await request("/buildings", { label: new FormData(form).get("label") }); form.reset(); setNotice("Canonical building created. Select it explicitly when enrolling a computer; existing assignments were not inferred or moved."); });
  }
  async function setSelected(probe: Probe, value: boolean) {
    if (busy) return;
    setPendingSelection({ id: probe.id, selected: value });
    await act(probe.id, async () => {
      await request(`/assignments/${probe.id}/selection`, { selected: value });
      setNotice(value ? `${probe.computerName} selected persistently. An initial baseline becomes due when the server's activation and capability gates permit it.` : `${probe.computerName} removed from recurring tests. Its enrollment and ordinary reporting remain active.`);
    });
    setPendingSelection(null);
  }
  function download() {
    if (!provisioning) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(provisioning, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${provisioning.computerName}.probe.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-6 max-w-7xl mx-auto pb-10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-medium text-primary">SCCC Key &amp; Alert · GPO monitor</p>
        <h1 className="text-3xl font-bold tracking-tight mt-1">Building probes</h1>
        <p className="text-muted-foreground mt-2">Select one or two low-use computers per canonical building for recurring performance reports. Enrollment and alert reception remain separate.</p></div>
      <Button variant="outline" onClick={() => void refresh()} disabled={query.isFetching}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
    </div>
    {(error || query.error) && <p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{error || query.error?.message}</p>}
    {notice && <p role="status" className="rounded-lg border p-4">{notice}</p>}
    {query.isLoading && <p role="status">Loading building probes…</p>}
    {!canView && <p role="alert">Network administrator access is required.</p>}
    {data && !enabled && <Card><CardHeader><CardTitle>Monitoring is not enabled yet</CardTitle></CardHeader>
      <CardContent>The probe service and server must be configured before computers can enroll. Installing the package alone does not activate monitoring.</CardContent></Card>}
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {[{ title: "Selected buildings", value: selectedBuildings, Icon: Building2 },
        { title: "Selected / enrolled computers", value: `${selected.length} / ${probes.filter(p => !!p.deviceId).length}`, Icon: Laptop },
        { title: "Reporting now", value: probes.filter(p => p.state === "reporting").length, Icon: Activity },
        { title: "Awaiting / offline probes", value: probes.filter(p => p.state !== "reporting").length, Icon: Laptop }]
        .map(({ title, value, Icon }) => <Card key={title} data-testid={`summary-${title.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`}><CardContent className="pt-6 flex justify-between items-center gap-3"><div><p className="text-sm text-muted-foreground">{title}</p><p className="text-3xl font-semibold">{value}</p></div><Icon className="h-7 w-7 shrink-0 text-muted-foreground" /></CardContent></Card>)}
    </div>
    {canView && <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Measurement schedule</CardTitle><Badge variant={schedule?.enabled && schedule.targetReady ? "default" : "secondary"}>{schedule?.enabled && schedule.targetReady ? "Active" : "Pilot paused"}</Badge></div></CardHeader><CardContent className="space-y-3 text-sm">
      <p role="status">{schedule?.reason || (!schedule ? "The server has not published a schedule." : !schedule.enabled ? "Pilot enrollment is open; recurring tests are still off." : !schedule.targetReady ? "The external test target is not ready." : "Selected computers are reporting on the bounded schedule.")}</p>
      {schedule && <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3"><strong>Live health</strong><p>Every 5 minutes · up to {bytes(schedule.profiles.quick.maxBytes)} · {duration(schedule.profiles.quick.timeoutSeconds)}</p></div>
        <div className="rounded-md border p-3"><strong>Hourly speed</strong><p>Up to {bytes(schedule.profiles.hourly.maxBytes)} · {duration(schedule.profiles.hourly.timeoutSeconds)}</p></div>
        <div className="rounded-md border p-3"><strong>10 GB capacity</strong><p>7:00 AM and 7:00 PM · one computer per building</p></div>
      </div>}
      <details><summary className="cursor-pointer text-muted-foreground">Schedule safeguards</summary><p className="mt-2">Tests use one transfer at a time per computer, fixed byte/time ceilings and campus-wide concurrency limits. The 10 GB test remains separately gated. A NIC link rate is not reported as a measured speed.</p></details>
    </CardContent></Card>}
    {enabled && probes.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No current computer enrollments. Add a target under an explicit canonical building below.</CardContent></Card>}
    <Card><CardHeader><CardTitle>Building computers</CardTitle></CardHeader><CardContent className="px-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow>
      <TableHead className="pl-6">Use</TableHead><TableHead>Computer</TableHead><TableHead>Building</TableHead><TableHead>Status</TableHead><TableHead>Network</TableHead><TableHead>Latest speed</TableHead><TableHead className="pr-6">Actions</TableHead>
    </TableRow></TableHeader><TableBody>{currentGroups.map(group => {
      const probe = group.current!;
      const snapshot = probe.snapshot;
      const jobs = uniqueIds(probe.jobs || []);
      const pending = jobs.some(j => ["pending", "dispatched"].includes(j.status));
      const canonicalBuilding = probe.buildingId ? catalog.get(probe.buildingId) : undefined;
      const selectedInBuilding = selected.filter(item => item.buildingId === probe.buildingId).length;
      const capable = probe.capable === true && !!probe.capabilities?.includes("throughput-v1");
      const selectionBlocked = !probe.selected && (!schedule || !canonicalBuilding || group.conflicted || selectedInBuilding >= 2);
      const adapter = snapshot?.adapters.find(item => item.id === probe.adapterId) || snapshot?.adapters.find(item => item.ipv4.length) || snapshot?.adapters[0];
      const speed = jobs.find(job => job.kind === "throughput" && job.result);
      const mbps = speed && typeof speed.result?.details.mbps === "number" ? `${speed.result.details.mbps.toFixed(1)} Mbps` : "No sample";
      return <TableRow key={group.key} data-testid="probe-row" className="align-top">
        <TableCell className="pl-6"><input type="checkbox" aria-label={`Select ${normalizedComputer(probe.computerName)} for recurring tests`} checked={pendingSelection?.id === probe.id ? pendingSelection.selected : !!probe.selected} disabled={!isCIO || !!busy || selectionBlocked} onChange={event => void setSelected(probe, event.target.checked)} /></TableCell>
        <TableCell><p className="font-mono font-medium">{normalizedComputer(probe.computerName)}</p><p className="text-xs text-muted-foreground">Probe {snapshot?.agentVersion || "not reporting"}</p></TableCell>
        <TableCell>{canonicalBuilding?.label || probe.building}</TableCell>
        <TableCell><Badge variant={probe.state === "reporting" ? "default" : "secondary"}>{label(probe.state)}</Badge><p className="mt-1 text-xs text-muted-foreground">{age(probe.lastSeen)}</p></TableCell>
        <TableCell><p>{adapter?.name || "Not reported"}</p><p className="font-mono text-xs text-muted-foreground">{adapter?.ipv4.join(", ") || "No IPv4"}</p></TableCell>
        <TableCell><p className="font-medium">{mbps}</p><p className="text-xs text-muted-foreground">{age(speed?.result?.completedAt || probe.lastThroughputAt)}</p></TableCell>
        <TableCell className="pr-6"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy || !probe.selected || probe.state !== "reporting" || pending} onClick={() => void act(probe.id, async () => { await request(`/assignments/${probe.id}/jobs`, { kind: "network" }); setNotice(`Network test queued for ${probe.computerName}.`); })}>Check now</Button>
          <details className="w-full text-xs"><summary className="cursor-pointer text-muted-foreground">Advanced</summary><div className="mt-2 min-w-72 space-y-2 rounded-md border p-3">
            <p><strong>Enrollment:</strong> {probe.deviceId ? "Credential enrolled" : "Awaiting credential"} · {capable ? "speed capable" : "upgrade required"}</p>
            <p><strong>Last check-in:</strong> {time(probe.lastSeen)}</p><p><strong>Gateway:</strong> {adapter?.gateways.join(", ") || "not reported"}</p><p><strong>DNS:</strong> {adapter?.dnsServers.join(", ") || "not reported"}</p>
            <p><strong>SCCC Key &amp; Alert:</strong> {snapshot ? `${snapshot.keyAlert.installed ? "installed" : "not installed"} · ${snapshot.keyAlert.serviceState}` : "not reported"}</p>
            <p data-testid="cadence-anchor"><strong>Cadence anchor:</strong> {probe.cadenceAnchorAt ? centralTime(probe.cadenceAnchorAt, schedule?.timeZone || "America/Chicago") : "not reported"}</p>
            <p><strong>Failures:</strong> {probe.consecutiveFailures ?? "not reported"}</p>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy || !probe.selected || probe.state !== "reporting" || pending} onClick={() => void act(probe.id, async () => { await request(`/assignments/${probe.id}/jobs`, { kind: "multicast" }); setNotice(`Paging capture queued for ${probe.computerName}. Wait for dispatched, then send the test page.`); })}>Listen for paging</Button>{isCIO && probe.enabled && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setReplace(probe)}>Revoke</Button>}</div>
            {!!jobs.length && <details><summary className="cursor-pointer">Recent results ({jobs.length})</summary>{jobs.map(job => <div key={job.id} className="mt-2 border-t pt-2"><p className="font-medium capitalize">{job.kind} · {label(job.status)}</p><p>{time(job.result?.completedAt || job.createdAt)}</p>{job.result && <p className="break-all text-muted-foreground">{Object.entries(job.result.details).map(([key, value]) => `${key}: ${detailText(value)}`).join(" · ")}</p>}</div>)}</details>}
            {!!group.history.length && <p>Previous assignments: {group.history.length}</p>}
          </div></details></div></TableCell>
      </TableRow>;
    })}</TableBody></Table></div></CardContent></Card>
    {!!retiredGroups.length && <Card><CardContent className="pt-6"><details data-testid="retired-history"><summary className="cursor-pointer font-semibold">Retired computer history ({retiredGroups.length})</summary><p className="mt-2 text-sm text-muted-foreground">Historical assignments are retained once per computer and do not count as current enrollments or selections.</p><ul className="mt-3 space-y-3">{retiredGroups.map(group => <li key={group.key} className="rounded-md border p-3"><p className="font-mono text-sm">{normalizedComputer(group.history[0].computerName)}</p><ul className="mt-2 space-y-2 text-xs">{group.history.map(previous => <li key={previous.id}>{previous.building} · revoked · last check-in {time(previous.lastSeen)}<code className="block break-all">{previous.id}</code></li>)}</ul></li>)}</ul></details></CardContent></Card>}
    {canView && historyQuery.error && <p role="alert" className="text-sm text-destructive">Assignment history could not be loaded. Current reporting is shown independently.</p>}
    {isCIO && enabled && <Card><CardHeader><CardTitle>Canonical building catalog</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Buildings use immutable IDs assigned here. Display labels, switch names and topology are not used to infer an assignment.</p>
      {buildings.length ? <details><summary className="cursor-pointer text-sm">View {buildings.length} canonical buildings</summary><ul className="mt-2 space-y-2 text-sm">{buildings.map(building => <li key={building.id}><strong>{building.label}</strong><code className="block break-all text-xs text-muted-foreground">{building.id}</code></li>)}</ul></details> : <p>No canonical buildings have been created.</p>}
      <form onSubmit={addBuilding} className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">New canonical building label<Input name="label" required maxLength={160} placeholder="IT Office" /></label><Button type="submit" disabled={!!busy}>Create canonical building</Button></form>
    </CardContent></Card>}
    {isCIO && enabled && <Card><CardHeader><CardTitle>Enroll a computer</CardTitle></CardHeader><CardContent>
      <form onSubmit={assign} className="grid md:grid-cols-2 gap-4">
        <label className="min-w-0 text-sm">Canonical building<select aria-label="Canonical building" name="buildingId" required defaultValue="" disabled={!buildings.length} className="mt-1 block w-full min-w-0 rounded-md border bg-background p-2"><option value="" disabled>Choose an explicit building assignment</option>{buildings.map(building => <option key={building.id} value={building.id}>{building.label}</option>)}</select></label>
        <label className="text-sm">Windows computer name<Input name="computer" required maxLength={15} pattern="[A-Za-z0-9][A-Za-z0-9-]{0,14}" placeholder="WEST-LAB-01" /></label>
        <label className="text-sm">Adapter ID (optional)<Input name="adapter" maxLength={100} placeholder="Use the adapter ID from the target PC" /></label>
        <label className="text-sm">Expected voice subnet (optional)<Input name="subnet" placeholder="10.30.25.0/24" /></label>
        <p className="text-sm text-muted-foreground md:col-span-2">New enrollments are not selected for recurring tests. Install the one-time provisioning file within 20 minutes through the protected GPO workflow, then select a capable reporting computer above.</p>
        <Button type="submit" disabled={!!busy || !buildings.length}>Create target &amp; provisioning file</Button>
      </form></CardContent></Card>}
    <Dialog open={!!provisioning} onOpenChange={open => { if (!open) setProvisioning(null); }}><DialogContent><DialogHeader><DialogTitle>Provision {provisioning?.computerName}</DialogTitle>
      <DialogDescription>This file contains a one-time enrollment credential, valid for 20 minutes. Store it in an administrator-only deployment share. It is bound to this computer name. If enrollment expires, revoke the target and create it again.</DialogDescription></DialogHeader>
      <Button onClick={download}><Download className="h-4 w-4 mr-2" />Download provisioning JSON</Button><p className="text-sm">Closing this dialog clears the browser’s copy. The credential cannot be retrieved again.</p></DialogContent></Dialog>
    <Dialog open={!!replace} onOpenChange={open => { if (!open) setReplace(null); }}><DialogContent><DialogHeader><DialogTitle>Revoke {replace?.computerName}?</DialogTitle>
      <DialogDescription>This blocks future reports and tests and cancels queued jobs for {replace?.building}. Uninstall the local probe separately. You can then select a replacement computer.</DialogDescription></DialogHeader>
      <Button variant="destructive" disabled={!!busy} onClick={() => void act("revoke", async () => { await request(`/assignments/${replace!.id}/revoke`, {}); setReplace(null); })}>Revoke target</Button></DialogContent></Dialog>
  </div>;
}
