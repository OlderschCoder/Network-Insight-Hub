import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Server, Activity, Pencil, Save, X, Trash2, Plus, RefreshCw,
  Wifi, WifiOff, AlertTriangle, Cable, ChevronRight, Building2, Loader2,
} from "lucide-react";

const API = "/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetNode {
  id: string;
  hostname: string;
  displayName: string | null;
  nodeKind: string;
  vendor: string | null;
  model: string | null;
  mgmtIp: string | null;
  building: string | null;
  location: string | null;
  role: string | null;
  function: string | null;
  criticality: string | null;
  tags: string[];
  status: string | null;
}

interface EnrichedLink {
  id: string;
  localPort: string | null;
  remotePort: string | null;
  linkKind: string | null;
  speedMbps: number | null;
  portMode: string | null;
  nativeVlan: number | null;
  allowedVlans: string | null;
  portchannel: string | null;
  lldpPeerHostname: string | null;
  lldpPeerMgmtIp: string | null;
  confidence: string | null;
  lastVerifiedAt: string | null;
  evidenceRef: string | null;
  direction: "a" | "b";
  peerNode: NetNode | null;
}

interface NodeDetailData extends NetNode {
  links: EnrichedLink[];
  liveStatus: "up" | "degraded" | "down" | "unknown";
}

interface InfluxDeviceMetrics {
  interfaces: Array<{
    name: string;
    inOctets: number | null;
    outOctets: number | null;
    operStatus: string | null;
  }>;
  pingLoss: number | null;
  rtt: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    up: "bg-green-100 text-green-800 border-green-300",
    degraded: "bg-amber-100 text-amber-800 border-amber-300",
    down: "bg-red-100 text-red-800 border-red-300",
    unknown: "bg-gray-100 text-gray-600 border-gray-300",
  };
  const icon = status === "up" ? <Wifi className="h-3 w-3 mr-1" />
    : status === "down" ? <WifiOff className="h-3 w-3 mr-1" />
    : status === "degraded" ? <AlertTriangle className="h-3 w-3 mr-1" />
    : <Activity className="h-3 w-3 mr-1" />;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${map[status] ?? map.unknown}`}>
      {icon}{status}
    </span>
  );
}

function fmtSpeed(mbps: number | null) {
  if (!mbps) return "—";
  if (mbps >= 1000) return `${mbps / 1000}G`;
  return `${mbps}M`;
}

function fmtBytes(bytes: number | null) {
  if (bytes === null) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

const NODE_KINDS = ["switch", "router", "firewall", "ap", "server", "camera", "ups", "other"];
const CRITICALITY_LEVELS = ["critical", "high", "medium", "low"];
const LINK_KINDS = ["ethernet", "fiber", "lag", "p2p", "uplink", "downlink"];
const PORT_MODES = ["access", "trunk", "hybrid"];
const CONFIDENCE_LEVELS = ["confirmed", "lldp", "inferred", "unknown"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NodeDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isCIO } = useAuth();

  const [node, setNode] = useState<NodeDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveMetrics, setLiveMetrics] = useState<InfluxDeviceMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [influxConfigured, setInfluxConfigured] = useState(false);

  // edit state
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Partial<NetNode>>({});
  const [saving, setSaving] = useState(false);

  // delete node
  const [confirmDelete, setConfirmDelete] = useState(false);

  // add link dialog
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [newLink, setNewLink] = useState({
    localPort: "", remotePort: "", linkKind: "ethernet", speedMbps: "",
    portMode: "trunk", nativeVlan: "", allowedVlans: "", portchannel: "",
    lldpPeerHostname: "", lldpPeerMgmtIp: "", confidence: "confirmed", evidenceRef: "",
    bNodeId: "",
  });
  const [addingLink, setAddingLink] = useState(false);

  // delete link
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null);

  // edit link
  const [editLinkId, setEditLinkId] = useState<string | null>(null);
  const [editLinkFields, setEditLinkFields] = useState<Partial<EnrichedLink>>({});

  // ── Fetch node ──────────────────────────────────────────────────────────────
  const fetchNode = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/network/nodes/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const data: NodeDetailData = await r.json();
      setNode(data);
      setEditFields({
        hostname: data.hostname,
        displayName: data.displayName ?? "",
        nodeKind: data.nodeKind,
        vendor: data.vendor ?? "",
        model: data.model ?? "",
        mgmtIp: data.mgmtIp ?? "",
        building: data.building ?? "",
        location: data.location ?? "",
        role: data.role ?? "",
        function: data.function ?? "",
        criticality: data.criticality ?? "",
        status: data.status ?? "",
        tags: data.tags,
      });
    } catch (e: any) {
      toast({ title: "Failed to load node", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  // ── Fetch live metrics ───────────────────────────────────────────────────────
  const fetchMetrics = useCallback(async () => {
    if (!node?.mgmtIp) return;
    setMetricsLoading(true);
    try {
      const r = await fetch(`${API}/network/influx/device/${encodeURIComponent(node.mgmtIp)}`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      if (data.configured === false) { setInfluxConfigured(false); return; }
      setInfluxConfigured(true);
      setLiveMetrics(data);
    } finally {
      setMetricsLoading(false);
    }
  }, [node?.mgmtIp]);

  useEffect(() => { fetchNode(); }, [fetchNode]);
  useEffect(() => { if (node) fetchMetrics(); }, [node?.id]); // eslint-disable-line

  // ── Save node ────────────────────────────────────────────────────────────────
  const saveNode = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const payload = { ...editFields };
      if (typeof payload.tags === "string") {
        payload.tags = (payload.tags as unknown as string).split(",").map((t: string) => t.trim()).filter(Boolean);
      }
      const r = await fetch(`${API}/network/nodes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Saved" });
      setEditing(false);
      fetchNode();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete node ──────────────────────────────────────────────────────────────
  const deleteNode = async () => {
    if (!id) return;
    try {
      const r = await fetch(`${API}/network/nodes/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Node deleted" });
      navigate("/network");
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  // ── Add link ─────────────────────────────────────────────────────────────────
  const addLink = async () => {
    if (!id) return;
    setAddingLink(true);
    try {
      const payload: Record<string, any> = {
        localPort: newLink.localPort || null,
        remotePort: newLink.remotePort || null,
        linkKind: newLink.linkKind,
        speedMbps: newLink.speedMbps ? Number(newLink.speedMbps) : null,
        portMode: newLink.portMode || null,
        nativeVlan: newLink.nativeVlan ? Number(newLink.nativeVlan) : null,
        allowedVlans: newLink.allowedVlans || null,
        portchannel: newLink.portchannel || null,
        lldpPeerHostname: newLink.lldpPeerHostname || null,
        lldpPeerMgmtIp: newLink.lldpPeerMgmtIp || null,
        confidence: newLink.confidence,
        evidenceRef: newLink.evidenceRef || null,
      };
      if (newLink.bNodeId) payload.bNodeId = newLink.bNodeId;
      const r = await fetch(`${API}/network/nodes/${id}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Link added" });
      setAddLinkOpen(false);
      setNewLink({
        localPort: "", remotePort: "", linkKind: "ethernet", speedMbps: "",
        portMode: "trunk", nativeVlan: "", allowedVlans: "", portchannel: "",
        lldpPeerHostname: "", lldpPeerMgmtIp: "", confidence: "confirmed", evidenceRef: "",
        bNodeId: "",
      });
      fetchNode();
    } catch (e: any) {
      toast({ title: "Failed to add link", description: e.message, variant: "destructive" });
    } finally {
      setAddingLink(false);
    }
  };

  // ── Delete link ──────────────────────────────────────────────────────────────
  const deleteLink = async (linkId: string) => {
    try {
      const r = await fetch(`${API}/network/links/${linkId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Link removed" });
      setDeleteLinkId(null);
      fetchNode();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  // ── Save link edit ────────────────────────────────────────────────────────────
  const saveLink = async () => {
    if (!editLinkId) return;
    try {
      const r = await fetch(`${API}/network/links/${editLinkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editLinkFields),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Link updated" });
      setEditLinkId(null);
      fetchNode();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!node) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Node not found.{" "}
        <Link href="/network"><span className="text-primary underline cursor-pointer">Back to Network</span></Link>
      </div>
    );
  }

  const canEdit = !!isCIO;
  const tagsStr = Array.isArray(editFields.tags) ? (editFields.tags as string[]).join(", ") : editFields.tags ?? "";

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/network">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Network
          </Button>
        </Link>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        {node.building && (
          <>
            <Link href={`/network/buildings/${encodeURIComponent(node.building)}`}>
              <Button variant="ghost" size="sm" className="gap-1">
                <Building2 className="h-4 w-4" /> {node.building}
              </Button>
            </Link>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </>
        )}
        <div className="flex items-center gap-2 flex-1">
          <Server className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">{node.displayName || node.hostname}</h1>
          <Badge variant="outline" className="capitalize">{node.nodeKind}</Badge>
          {statusBadge(node.liveStatus)}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchMetrics()} disabled={metricsLoading} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${metricsLoading ? "animate-spin" : ""}`} /> Refresh Status
          </Button>
          {canEdit && !editing && (
            <Button size="sm" onClick={() => setEditing(true)} className="gap-1">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {canEdit && editing && (
            <>
              <Button size="sm" onClick={saveNode} disabled={saving} className="gap-1">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
            </>
          )}
          {canEdit && (
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="links">Ports / Links ({node.links.length})</TabsTrigger>
          <TabsTrigger value="live">Live Status</TabsTrigger>
        </TabsList>

        {/* ── Details Tab ── */}
        <TabsContent value="details" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Identity */}
            <Card>
              <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FieldRow label="Hostname" editing={editing}
                  view={node.hostname}
                  edit={<Input value={editFields.hostname ?? ""} onChange={e => setEditFields(f => ({ ...f, hostname: e.target.value }))} />} />
                <FieldRow label="Display Name" editing={editing}
                  view={node.displayName ?? "—"}
                  edit={<Input value={editFields.displayName ?? ""} onChange={e => setEditFields(f => ({ ...f, displayName: e.target.value }))} />} />
                <FieldRow label="Kind" editing={editing}
                  view={<span className="capitalize">{node.nodeKind}</span>}
                  edit={
                    <Select value={editFields.nodeKind ?? ""} onValueChange={v => setEditFields(f => ({ ...f, nodeKind: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{NODE_KINDS.map(k => <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>)}</SelectContent>
                    </Select>
                  } />
                <FieldRow label="Vendor" editing={editing}
                  view={node.vendor ?? "—"}
                  edit={<Input value={editFields.vendor ?? ""} onChange={e => setEditFields(f => ({ ...f, vendor: e.target.value }))} />} />
                <FieldRow label="Model" editing={editing}
                  view={node.model ?? "—"}
                  edit={<Input value={editFields.model ?? ""} onChange={e => setEditFields(f => ({ ...f, model: e.target.value }))} />} />
              </CardContent>
            </Card>

            {/* Location & Role */}
            <Card>
              <CardHeader><CardTitle className="text-base">Location & Role</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FieldRow label="Management IP" editing={editing}
                  view={node.mgmtIp ?? "—"}
                  edit={<Input value={editFields.mgmtIp ?? ""} onChange={e => setEditFields(f => ({ ...f, mgmtIp: e.target.value }))} placeholder="10.x.x.x" />} />
                <FieldRow label="Building" editing={editing}
                  view={node.building ?? "—"}
                  edit={<Input value={editFields.building ?? ""} onChange={e => setEditFields(f => ({ ...f, building: e.target.value }))} />} />
                <FieldRow label="Location" editing={editing}
                  view={node.location ?? "—"}
                  edit={<Input value={editFields.location ?? ""} onChange={e => setEditFields(f => ({ ...f, location: e.target.value }))} placeholder="IDF closet, rack 3" />} />
                <FieldRow label="Role" editing={editing}
                  view={node.role ?? "—"}
                  edit={<Input value={editFields.role ?? ""} onChange={e => setEditFields(f => ({ ...f, role: e.target.value }))} />} />
                <FieldRow label="Function" editing={editing}
                  view={node.function ?? "—"}
                  edit={<Input value={editFields.function ?? ""} onChange={e => setEditFields(f => ({ ...f, function: e.target.value }))} />} />
                <FieldRow label="Criticality" editing={editing}
                  view={node.criticality ?? "—"}
                  edit={
                    <Select value={editFields.criticality ?? ""} onValueChange={v => setEditFields(f => ({ ...f, criticality: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CRITICALITY_LEVELS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                    </Select>
                  } />
                <FieldRow label="Tags" editing={editing}
                  view={node.tags?.length ? node.tags.join(", ") : "—"}
                  edit={<Input value={tagsStr} onChange={e => setEditFields(f => ({ ...f, tags: e.target.value as any }))} placeholder="tag1, tag2" />} />
                <FieldRow label="Status" editing={editing}
                  view={node.status ?? "—"}
                  edit={<Input value={editFields.status ?? ""} onChange={e => setEditFields(f => ({ ...f, status: e.target.value }))} placeholder="active, decommissioned..." />} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Links Tab ── */}
        <TabsContent value="links" className="mt-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {node.links.length === 0 ? "No links recorded." : `${node.links.length} link${node.links.length !== 1 ? "s" : ""}`}
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => setAddLinkOpen(true)} className="gap-1">
                <Plus className="h-4 w-4" /> Add Link
              </Button>
            )}
          </div>

          {node.links.length > 0 && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Local Port</TableHead>
                    <TableHead>Remote Port</TableHead>
                    <TableHead>Peer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Speed</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Native VLAN</TableHead>
                    <TableHead>Allowed VLANs</TableHead>
                    <TableHead>Port-Channel</TableHead>
                    <TableHead>Confidence</TableHead>
                    {canEdit && <TableHead className="w-16">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {node.links.map(link => (
                    <TableRow key={link.id}>
                      <TableCell className="font-mono text-xs">{link.localPort ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{link.remotePort ?? "—"}</TableCell>
                      <TableCell>
                        {link.peerNode ? (
                          <Link href={`/network/nodes/${link.peerNode.id}`}>
                            <span className="text-primary underline cursor-pointer text-xs">
                              {link.peerNode.displayName || link.peerNode.hostname}
                            </span>
                          </Link>
                        ) : link.lldpPeerHostname ? (
                          <span className="text-xs text-muted-foreground">{link.lldpPeerHostname}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{link.linkKind ?? "—"}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtSpeed(link.speedMbps)}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs capitalize">{link.portMode ?? "—"}</Badge></TableCell>
                      <TableCell className="text-xs">{link.nativeVlan ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate" title={link.allowedVlans ?? ""}>{link.allowedVlans ?? "—"}</TableCell>
                      <TableCell className="text-xs">{link.portchannel ?? "—"}</TableCell>
                      <TableCell>
                        <ConfidenceBadge c={link.confidence} />
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditLinkId(link.id); setEditLinkFields({ ...link }); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteLinkId(link.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Live Status Tab ── */}
        <TabsContent value="live" className="mt-4">
          {!influxConfigured ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">InfluxDB not configured</p>
                <p className="text-sm mt-1">Set INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG env vars on the server.<br />
                  Live status will activate once the polling server (10.0.0.22) is reachable.</p>
              </CardContent>
            </Card>
          ) : metricsLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !liveMetrics ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No live data for this device.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Ping summary */}
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="py-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Ping Loss</p>
                    <p className="text-2xl font-bold">{liveMetrics.pingLoss !== null ? `${liveMetrics.pingLoss}%` : "—"}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">RTT</p>
                    <p className="text-2xl font-bold">{liveMetrics.rtt !== null ? `${liveMetrics.rtt.toFixed(1)} ms` : "—"}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Status</p>
                    <div className="flex justify-center mt-1">{statusBadge(node.liveStatus)}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Interface table */}
              {liveMetrics.interfaces.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><Cable className="h-4 w-4" /> Interfaces</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="rounded-md overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Interface</TableHead>
                            <TableHead>Oper Status</TableHead>
                            <TableHead>In</TableHead>
                            <TableHead>Out</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {liveMetrics.interfaces.map(iface => (
                            <TableRow key={iface.name}>
                              <TableCell className="font-mono text-xs">{iface.name}</TableCell>
                              <TableCell>
                                {iface.operStatus === "1" || iface.operStatus === "up"
                                  ? <span className="text-green-600 text-xs font-medium">up</span>
                                  : <span className="text-red-500 text-xs font-medium">down</span>}
                              </TableCell>
                              <TableCell className="text-xs">{fmtBytes(iface.inOctets)}</TableCell>
                              <TableCell className="text-xs">{fmtBytes(iface.outOctets)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Delete Node Dialog ── */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {node.hostname}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the node and all its links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteNode} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Link Dialog ── */}
      <AlertDialog open={!!deleteLinkId} onOpenChange={o => !o && setDeleteLinkId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this link?</AlertDialogTitle>
            <AlertDialogDescription>This link record will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteLinkId && deleteLink(deleteLinkId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add Link Dialog ── */}
      <Dialog open={addLinkOpen} onOpenChange={setAddLinkOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Link from {node.hostname}</DialogTitle>
            <DialogDescription>Record a physical or logical connection from this device.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <Label>Local Port</Label>
              <Input placeholder="GigabitEthernet0/1" value={newLink.localPort}
                onChange={e => setNewLink(l => ({ ...l, localPort: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Remote Port</Label>
              <Input placeholder="Gi0/24" value={newLink.remotePort}
                onChange={e => setNewLink(l => ({ ...l, remotePort: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Link Kind</Label>
              <Select value={newLink.linkKind} onValueChange={v => setNewLink(l => ({ ...l, linkKind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LINK_KINDS.map(k => <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Speed (Mbps)</Label>
              <Input placeholder="1000" type="number" value={newLink.speedMbps}
                onChange={e => setNewLink(l => ({ ...l, speedMbps: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Port Mode</Label>
              <Select value={newLink.portMode} onValueChange={v => setNewLink(l => ({ ...l, portMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PORT_MODES.map(m => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Native VLAN</Label>
              <Input placeholder="1" type="number" value={newLink.nativeVlan}
                onChange={e => setNewLink(l => ({ ...l, nativeVlan: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Allowed VLANs</Label>
              <Input placeholder="1,10,100-200,500" value={newLink.allowedVlans}
                onChange={e => setNewLink(l => ({ ...l, allowedVlans: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Port-Channel</Label>
              <Input placeholder="Po1" value={newLink.portchannel}
                onChange={e => setNewLink(l => ({ ...l, portchannel: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Confidence</Label>
              <Select value={newLink.confidence} onValueChange={v => setNewLink(l => ({ ...l, confidence: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONFIDENCE_LEVELS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Peer Hostname (LLDP)</Label>
              <Input placeholder="sw-core-01" value={newLink.lldpPeerHostname}
                onChange={e => setNewLink(l => ({ ...l, lldpPeerHostname: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Peer Mgmt IP</Label>
              <Input placeholder="10.x.x.x" value={newLink.lldpPeerMgmtIp}
                onChange={e => setNewLink(l => ({ ...l, lldpPeerMgmtIp: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Peer Node ID (if known)</Label>
              <Input placeholder="UUID of peer node in this system" value={newLink.bNodeId}
                onChange={e => setNewLink(l => ({ ...l, bNodeId: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Evidence Reference</Label>
              <Input placeholder="LLDP capture 2025-06-01, config backup" value={newLink.evidenceRef}
                onChange={e => setNewLink(l => ({ ...l, evidenceRef: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddLinkOpen(false)}>Cancel</Button>
            <Button onClick={addLink} disabled={addingLink} className="gap-1">
              {addingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Link Dialog ── */}
      <Dialog open={!!editLinkId} onOpenChange={o => !o && setEditLinkId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Link</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <Label>Local Port</Label>
              <Input value={editLinkFields.localPort ?? ""}
                onChange={e => setEditLinkFields(f => ({ ...f, localPort: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Remote Port</Label>
              <Input value={editLinkFields.remotePort ?? ""}
                onChange={e => setEditLinkFields(f => ({ ...f, remotePort: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Speed (Mbps)</Label>
              <Input type="number" value={editLinkFields.speedMbps ?? ""}
                onChange={e => setEditLinkFields(f => ({ ...f, speedMbps: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div className="space-y-1">
              <Label>Port Mode</Label>
              <Select value={editLinkFields.portMode ?? ""} onValueChange={v => setEditLinkFields(f => ({ ...f, portMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PORT_MODES.map(m => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Native VLAN</Label>
              <Input type="number" value={editLinkFields.nativeVlan ?? ""}
                onChange={e => setEditLinkFields(f => ({ ...f, nativeVlan: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div className="space-y-1">
              <Label>Confidence</Label>
              <Select value={editLinkFields.confidence ?? ""} onValueChange={v => setEditLinkFields(f => ({ ...f, confidence: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONFIDENCE_LEVELS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Allowed VLANs</Label>
              <Input value={editLinkFields.allowedVlans ?? ""}
                onChange={e => setEditLinkFields(f => ({ ...f, allowedVlans: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Port-Channel</Label>
              <Input value={editLinkFields.portchannel ?? ""}
                onChange={e => setEditLinkFields(f => ({ ...f, portchannel: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Evidence Reference</Label>
              <Input value={editLinkFields.evidenceRef ?? ""}
                onChange={e => setEditLinkFields(f => ({ ...f, evidenceRef: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditLinkId(null)}>Cancel</Button>
            <Button onClick={saveLink} className="gap-1"><Save className="h-4 w-4" /> Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function FieldRow({
  label, editing, view, edit,
}: { label: string; editing: boolean; view: React.ReactNode; edit: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {editing ? edit : <span className="text-sm">{view}</span>}
    </div>
  );
}

function ConfidenceBadge({ c }: { c: string | null }) {
  const map: Record<string, string> = {
    confirmed: "bg-green-100 text-green-700 border-green-300",
    lldp: "bg-blue-100 text-blue-700 border-blue-300",
    inferred: "bg-amber-100 text-amber-700 border-amber-300",
    unknown: "bg-gray-100 text-gray-600 border-gray-300",
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium ${map[c ?? "unknown"] ?? map.unknown}`}>
      {c ?? "unknown"}
    </span>
  );
}
