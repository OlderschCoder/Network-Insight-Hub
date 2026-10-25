import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Building2, Download, Laptop, Radio, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/authFetch";

const API = `${import.meta.env.VITE_API_URL || "/api"}/building-probes`;
type Adapter = { id: string; name: string; state: string; ipv4: string[]; gateways: string[]; dnsServers: string[] };
type Result = { outcome: string; completedAt: string; details: Record<string, unknown> };
type Job = { id: string; kind: string; status: string; createdAt: string; result: Result | null };
type Probe = { id: string; building: string; computerName: string; enabled: boolean; state: string;
  lastSeen: string | null; expectedVoiceSubnet: string | null; adapterId: string | null;
  snapshot: { agentVersion: string; uptimeSeconds: number; adapters: Adapter[];
    keyAlert: { installed: boolean; serviceState: string; version: string | null; uiProcessCount: number } } | null;
  jobs: Job[] | null };
const label = (value: string) => value.replaceAll("_", " ");
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "No check-in yet";
async function request(path: string, body?: unknown) {
  const response = await authFetch(`${API}${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The monitor request failed.");
  return result;
}

export default function BuildingProbes() {
  const { isCIO } = useAuth();
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState<{ computerName: string; [key: string]: unknown } | null>(null);
  const [replace, setReplace] = useState<Probe | null>(null);
  const query = useQuery<{ enabled: boolean; probes: Probe[] }>({ queryKey: ["building-probes"],
    queryFn: () => request("/"), refetchInterval: 15_000 });
  const probes = query.data?.probes || [];
  const enabled = query.data?.enabled === true;
  const refresh = () => cache.invalidateQueries({ queryKey: ["building-probes"] });
  async function act(key: string, action: () => Promise<void>) {
    setError(""); setNotice(""); setBusy(key);
    try { await action(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); }
    finally { setBusy(null); }
  }
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    await act("assign", async () => {
      const result = await request("/assignments", { building: data.get("building"), computerName: data.get("computer"),
        adapterId: String(data.get("adapter") || "").trim() || null,
        expectedVoiceSubnet: String(data.get("subnet") || "").trim() || null });
      setProvisioning(result.provisioning); form.reset();
    });
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
        <p className="text-muted-foreground mt-2">One selected lab computer per building. App status, network checks, and paging observations in one place.</p></div>
      <Button variant="outline" onClick={() => void refresh()} disabled={query.isFetching}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
    </div>
    {(error || query.error) && <p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{error || query.error?.message}</p>}
    {notice && <p role="status" className="rounded-lg border p-4">{notice}</p>}
    {query.isLoading && <p role="status">Loading building probes…</p>}
    {query.data && !enabled && <Card><CardHeader><CardTitle>Monitoring is not enabled yet</CardTitle></CardHeader>
      <CardContent>The probe service and server must be configured before computers can enroll. Installing the package alone does not activate monitoring.</CardContent></Card>}
    <div className="grid sm:grid-cols-3 gap-4">
      {[{ title: "Selected buildings", value: probes.filter(p => p.enabled).length, Icon: Building2 },
        { title: "Reporting now", value: probes.filter(p => p.state === "reporting").length, Icon: Activity },
        { title: "Awaiting / stale", value: probes.filter(p => p.enabled && p.state !== "reporting").length, Icon: Laptop }]
        .map(({ title, value, Icon }) => <Card key={title}><CardContent className="pt-6 flex justify-between items-center"><div><p className="text-sm text-muted-foreground">{title}</p><p className="text-3xl font-semibold">{value}</p></div><Icon className="h-7 w-7 text-muted-foreground" /></CardContent></Card>)}
    </div>
    <div className="rounded-lg border p-4 text-sm space-y-1"><p className="font-semibold flex items-center gap-2"><Radio className="h-4 w-4" />Paging test: 239.0.1.216:24016 · source 10.40.4.20</p>
      <p>Queue a test, wait for “dispatched,” then send a test page during its 60-second listening window. A lab PC measures only its attached adapter and VLAN; packet receipt does not verify phone playback. No packets observed is inconclusive.</p></div>
    {enabled && probes.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No building computers selected yet. Add the first target below.</CardContent></Card>}
    <div className="grid xl:grid-cols-2 gap-5">{probes.map(probe => {
      const snapshot = probe.snapshot;
      const pending = probe.jobs?.some(j => ["pending", "dispatched"].includes(j.status));
      return <Card key={probe.id} data-testid="probe-card"><CardHeader>
        <div className="flex justify-between gap-3"><div><CardTitle>{probe.building}</CardTitle><p className="mt-1 font-mono text-sm">{probe.computerName}</p></div>
          <Badge variant={probe.state === "reporting" ? "default" : "secondary"}>{label(probe.state)}</Badge></div>
        <p className="text-xs text-muted-foreground">Last server check-in: {time(probe.lastSeen)}</p></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-md bg-muted/50 p-3"><p className="font-medium">SCCC Key &amp; Alert</p>
            {snapshot ? <><p>Installed: {snapshot.keyAlert.installed ? "Yes" : "No"} · version {snapshot.keyAlert.version || "unknown"}</p>
              <p>Receiver service: {snapshot.keyAlert.serviceState} · UI processes: {snapshot.keyAlert.uiProcessCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Installation and process status; alert delivery and MFA are not tested.</p></> : <p>No app snapshot yet.</p>}</div>
          <div><p className="font-medium">Network adapters</p>{snapshot?.adapters.length ? snapshot.adapters.map(a => <div key={a.id} className="mt-2 border-l-2 pl-3 break-words">
            <p>{a.name} · {a.state}{probe.adapterId === a.id ? " · selected" : ""}</p><p className="font-mono text-xs">{a.ipv4.join(", ") || "No IPv4 address"}</p>
            <p className="text-xs text-muted-foreground">Gateway: {a.gateways.join(", ") || "none"} · DNS: {a.dnsServers.join(", ") || "none"}</p></div>) : <p className="text-muted-foreground">No adapter snapshot yet.</p>}
            <p className="text-xs mt-2">Expected voice subnet: {probe.expectedVoiceSubnet || "Not specified; observations cannot confirm voice VLAN coverage."}</p></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy || probe.state !== "reporting" || pending}
            onClick={() => void act(probe.id, async () => { await request(`/assignments/${probe.id}/jobs`, { kind: "network" }); setNotice(`Network test queued for ${probe.computerName}.`); })}>Run network check</Button>
            <Button size="sm" variant="outline" disabled={!!busy || probe.state !== "reporting" || pending}
              onClick={() => void act(probe.id, async () => { await request(`/assignments/${probe.id}/jobs`, { kind: "multicast" }); setNotice(`Paging capture queued for ${probe.computerName}. Wait for dispatched, then send the test page.`); })}>Listen for paging</Button>
            {isCIO && probe.enabled && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setReplace(probe)}>Revoke target</Button>}</div>
          <div className="border-t pt-3"><p className="font-medium">Recent tests</p>{!probe.jobs?.length && <p className="text-muted-foreground">No test has run. Paging is not yet verified.</p>}
            {probe.jobs?.map(job => <div key={job.id} className="mt-3 rounded-md border p-3"><p className="font-medium capitalize">{job.kind} · {label(job.status)}{job.result ? ` · ${label(job.result.outcome)}` : ""}</p>
              <p className="text-xs text-muted-foreground">{time(job.result?.completedAt || job.createdAt)}</p>
              {job.result && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-2 text-xs">{Object.entries(job.result.details).map(([key, value]) => <div key={key} className="contents"><dt className="text-muted-foreground">{key}</dt><dd className="break-all">{Array.isArray(value) ? value.join(", ") : String(value ?? "unavailable")}</dd></div>)}</dl>}</div>)}</div>
          {snapshot && <p className="text-xs text-muted-foreground">Probe {snapshot.agentVersion} · computer uptime {Math.floor(snapshot.uptimeSeconds / 3600)} hours</p>}
        </CardContent></Card>;
    })}</div>
    {isCIO && enabled && <Card><CardHeader><CardTitle>Select one computer for a building</CardTitle></CardHeader><CardContent>
      <form onSubmit={assign} className="grid md:grid-cols-2 gap-4">
        <label className="text-sm">Building<Input name="building" required maxLength={160} placeholder="West Campus" /></label>
        <label className="text-sm">Windows computer name<Input name="computer" required maxLength={15} pattern="[A-Za-z0-9][A-Za-z0-9-]{0,14}" placeholder="WEST-LAB-01" /></label>
        <label className="text-sm">Adapter ID (optional)<Input name="adapter" maxLength={100} placeholder="Use the adapter ID from the target PC" /></label>
        <label className="text-sm">Expected voice subnet (optional)<Input name="subnet" placeholder="10.30.25.0/24" /></label>
        <p className="text-sm text-muted-foreground md:col-span-2">Download the one-time provisioning file and install it on this computer within 20 minutes. Use a GPO computer security group containing only the selected targets.</p>
        <Button type="submit" disabled={!!busy}>Create target &amp; provisioning file</Button>
      </form></CardContent></Card>}
    <Dialog open={!!provisioning} onOpenChange={open => { if (!open) setProvisioning(null); }}><DialogContent><DialogHeader><DialogTitle>Provision {provisioning?.computerName}</DialogTitle>
      <DialogDescription>This file contains a one-time enrollment credential, valid for 20 minutes. Store it in an administrator-only deployment share. It is bound to this computer name. If enrollment expires, revoke the target and create it again.</DialogDescription></DialogHeader>
      <Button onClick={download}><Download className="h-4 w-4 mr-2" />Download provisioning JSON</Button><p className="text-sm">Closing this dialog clears the browser’s copy. The credential cannot be retrieved again.</p></DialogContent></Dialog>
    <Dialog open={!!replace} onOpenChange={open => { if (!open) setReplace(null); }}><DialogContent><DialogHeader><DialogTitle>Revoke {replace?.computerName}?</DialogTitle>
      <DialogDescription>This blocks future reports and tests and cancels queued jobs for {replace?.building}. Uninstall the local probe separately. You can then select a replacement computer.</DialogDescription></DialogHeader>
      <Button variant="destructive" disabled={!!busy} onClick={() => void act("revoke", async () => { await request(`/assignments/${replace!.id}/revoke`, {}); setReplace(null); })}>Revoke target</Button></DialogContent></Dialog>
  </div>;
}
