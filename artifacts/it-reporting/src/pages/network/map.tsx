import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Network, Plus, Search, Link2, Upload, RefreshCw, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, Trash2, Pencil, Server, Route,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

type NetNode = {
  id: string;
  hostname: string;
  displayName: string;
  nodeKind: string;
  vendor: string | null;
  model: string | null;
  mgmtIp: string | null;
  building: string;
  location: string | null;
  role: string;
  function: string | null;
  criticality: string;
  tags: string[] | null;
  status: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type NetLink = {
  id: string;
  aNodeId: string;
  aPort: string;
  bNodeId: string;
  bPort: string;
  linkKind: string;
  speedMbps: number | null;
  portMode: string | null;
  nativeVlan: number | null;
  confidence: string;
  lastVerifiedAt: string;
  evidenceRef: string | null;
  notes: string | null;
  isStale?: boolean;
};

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const NODE_KIND_ICON: Record<string, string> = {
  switch: "🔀",
  firewall: "🛡️",
  router: "🌐",
  server: "🖥️",
  svi: "🔢",
  patch_panel: "🔌",
  isp: "📡",
  other: "⚙️",
};

const ROLE_COLOR: Record<string, string> = {
  core: "bg-red-100 text-red-800 border-red-200",
  distribution: "bg-orange-100 text-orange-800 border-orange-200",
  access: "bg-blue-100 text-blue-800 border-blue-200",
  edge: "bg-purple-100 text-purple-800 border-purple-200",
  firewall: "bg-amber-100 text-amber-800 border-amber-200",
  controller: "bg-green-100 text-green-800 border-green-200",
  svi: "bg-slate-100 text-slate-700 border-slate-200",
};

const CRIT_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-blue-100 text-blue-800",
  low: "bg-slate-100 text-slate-700",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  confirmed_lldp: "text-emerald-600",
  confirmed_cdp: "text-emerald-600",
  confirmed_manual: "text-blue-600",
  inferred: "text-amber-600",
  stale: "text-slate-400",
};

function apiReq(method: string, url: string, body?: unknown) {
  return authFetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(err.error ?? r.statusText);
    }
    return r.json();
  });
}

// ──────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────

export default function NetworkMapPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canWrite = user?.role === "cio" || user?.role === "network" || user?.role === "network_engineer";

  const [tab, setTab] = useState("nodes");
  const [nodeSearch, setNodeSearch] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<NetNode | null>(null);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [showLldpImport, setShowLldpImport] = useState(false);
  const [editingNode, setEditingNode] = useState<NetNode | null>(null);
  const [editingLink, setEditingLink] = useState<NetLink | null>(null);
  const [upstreamPath, setUpstreamPath] = useState<UpstreamPathResult | null>(null);
  const [loadingPath, setLoadingPath] = useState(false);

  const { data: nodes = [], isLoading: nodesLoading } = useQuery<NetNode[]>({
    queryKey: ["/api/network-map/nodes"],
    queryFn: () => authFetch("/api/network-map/nodes").then((r) => r.json()),
    refetchInterval: 60000,
  });

  const { data: links = [], isLoading: linksLoading } = useQuery<NetLink[]>({
    queryKey: ["/api/network-map/links"],
    queryFn: () => authFetch("/api/network-map/links").then((r) => r.json()),
    refetchInterval: 60000,
  });

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const filteredNodes = useMemo(() => {
    const q = nodeSearch.toLowerCase();
    return nodes.filter(
      (n) =>
        !q ||
        n.hostname.toLowerCase().includes(q) ||
        n.displayName.toLowerCase().includes(q) ||
        (n.mgmtIp ?? "").includes(q) ||
        n.building.toLowerCase().includes(q) ||
        n.role.toLowerCase().includes(q),
    );
  }, [nodes, nodeSearch]);

  const filteredLinks = useMemo(() => {
    const q = linkSearch.toLowerCase();
    return links.filter((l) => {
      const a = nodeById.get(l.aNodeId);
      const b = nodeById.get(l.bNodeId);
      return (
        !q ||
        a?.hostname.toLowerCase().includes(q) ||
        b?.hostname.toLowerCase().includes(q) ||
        l.aPort.toLowerCase().includes(q) ||
        l.bPort.toLowerCase().includes(q)
      );
    });
  }, [links, linkSearch, nodeById]);

  const deleteMutNode = useMutation({
    mutationFn: (id: string) => apiReq("DELETE", `/api/network-map/nodes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/network-map/nodes"] });
      qc.invalidateQueries({ queryKey: ["/api/network-map/links"] });
      toast({ title: "Node deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutLink = useMutation({
    mutationFn: (id: string) => apiReq("DELETE", `/api/network-map/links/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/network-map/links"] });
      toast({ title: "Link deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: () => apiReq("POST", "/api/network-map/seed-from-switches"),
    onSuccess: (data: { created: number; skipped: number }) => {
      qc.invalidateQueries({ queryKey: ["/api/network-map/nodes"] });
      toast({ title: `Seeded ${data.created} nodes (${data.skipped} already existed)` });
    },
    onError: (e: Error) => toast({ title: "Seed failed", description: e.message, variant: "destructive" }),
  });

  const handleUpstreamPath = useCallback(async (node: NetNode) => {
    setLoadingPath(true);
    setUpstreamPath(null);
    try {
      const result = await apiReq("GET", `/api/network-map/nodes/${node.id}/upstream-path`);
      setUpstreamPath(result);
      setSelectedNode(node);
    } catch {
      toast({ title: "Could not compute path", variant: "destructive" });
    } finally {
      setLoadingPath(false);
    }
  }, [toast]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Network className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Network Map</h1>
            <p className="text-sm text-muted-foreground">
              Physical topology — nodes, links, upstream paths
            </p>
          </div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${seedMutation.isPending ? "animate-spin" : ""}`} />
              Seed from Switches
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowLldpImport(true)}>
              <Upload className="h-4 w-4 mr-1" /> Import LLDP
            </Button>
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1"><Server className="h-3.5 w-3.5" /> {nodes.length} nodes</span>
        <span className="flex items-center gap-1"><Link2 className="h-3.5 w-3.5" /> {links.length} links</span>
        <span className="flex items-center gap-1 text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {links.filter((l) => l.isStale).length} stale links (&gt;90 days)
        </span>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="nodes">Nodes</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
        </TabsList>

        {/* ── Nodes tab ─────────────────────────────────────── */}
        <TabsContent value="nodes" className="space-y-3 mt-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search hostname, IP, building…"
                value={nodeSearch}
                onChange={(e) => setNodeSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            {canWrite && (
              <Button size="sm" onClick={() => { setEditingNode(null); setShowNodeForm(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Add Node
              </Button>
            )}
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Hostname</TableHead>
                  <TableHead>Building</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Criticality</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodesLoading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell>
                  </TableRow>
                )}
                {!nodesLoading && filteredNodes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      {nodes.length === 0
                        ? "No nodes yet — click \"Seed from Switches\" to import your inventory, or add manually."
                        : "No matches."}
                    </TableCell>
                  </TableRow>
                )}
                {filteredNodes.map((node) => (
                  <TableRow
                    key={node.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedNode(node)}
                  >
                    <TableCell className="text-base">{NODE_KIND_ICON[node.nodeKind] ?? "⚙️"}</TableCell>
                    <TableCell className="font-mono text-sm font-medium">{node.hostname}</TableCell>
                    <TableCell className="text-sm">{node.building}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{node.mgmtIp ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${ROLE_COLOR[node.role] ?? ""}`}>
                        {node.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{node.nodeKind}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${CRIT_COLOR[node.criticality] ?? ""}`}>
                        {node.criticality}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {node.status && (
                        <span className={`text-xs ${node.status === "online" ? "text-emerald-600" : node.status === "offline" ? "text-red-600" : "text-muted-foreground"}`}>
                          {node.status}
                        </span>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Show upstream path to core"
                          onClick={() => handleUpstreamPath(node)}
                          disabled={loadingPath}
                        >
                          <Route className="h-3.5 w-3.5" />
                        </Button>
                        {canWrite && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => { setEditingNode(node); setShowNodeForm(true); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => {
                                if (confirm(`Delete ${node.hostname}?`)) deleteMutNode.mutate(node.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Links tab ─────────────────────────────────────── */}
        <TabsContent value="links" className="space-y-3 mt-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search node, port…"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            {canWrite && (
              <Button size="sm" onClick={() => { setEditingLink(null); setShowLinkForm(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Add Link
              </Button>
            )}
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>A Side</TableHead>
                  <TableHead>A Port</TableHead>
                  <TableHead></TableHead>
                  <TableHead>B Port</TableHead>
                  <TableHead>B Side</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Speed</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Last Verified</TableHead>
                  {canWrite && <TableHead className="w-16"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {linksLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">Loading…</TableCell>
                  </TableRow>
                )}
                {!linksLoading && filteredLinks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      {links.length === 0
                        ? "No links yet — import LLDP output or add manually."
                        : "No matches."}
                    </TableCell>
                  </TableRow>
                )}
                {filteredLinks.map((link) => {
                  const a = nodeById.get(link.aNodeId);
                  const b = nodeById.get(link.bNodeId);
                  const stale = link.isStale;
                  return (
                    <TableRow key={link.id} className={stale ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-xs">{a?.hostname ?? link.aNodeId.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{link.aPort}</TableCell>
                      <TableCell className="text-muted-foreground">↔</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{link.bPort}</TableCell>
                      <TableCell className="font-mono text-xs">{b?.hostname ?? link.bNodeId.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{link.linkKind}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {link.speedMbps ? `${link.speedMbps >= 1000 ? `${link.speedMbps / 1000}G` : `${link.speedMbps}M`}` : "—"}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs ${stale ? "text-slate-400" : (CONFIDENCE_STYLE[link.confidence] ?? "")}`}>
                          {stale ? "stale" : link.confidence.replace("confirmed_", "")}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(link.lastVerifiedAt).toLocaleDateString()}
                        {stale && <span className="ml-1 text-amber-600" title="Not verified in 90+ days">⚠</span>}
                      </TableCell>
                      {canWrite && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => {
                              if (confirm("Delete this link?")) deleteMutLink.mutate(link.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Node detail sheet ──────────────────────────────── */}
      <Sheet open={!!selectedNode && !upstreamPath} onOpenChange={(o) => !o && setSelectedNode(null)}>
        <SheetContent className="w-96">
          {selectedNode && (
            <NodeDetail
              node={selectedNode}
              links={links.filter((l) => l.aNodeId === selectedNode.id || l.bNodeId === selectedNode.id)}
              nodeById={nodeById}
              onUpstreamPath={() => handleUpstreamPath(selectedNode)}
              loadingPath={loadingPath}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* ── Upstream path sheet ────────────────────────────── */}
      <Sheet open={!!upstreamPath} onOpenChange={(o) => !o && setUpstreamPath(null)}>
        <SheetContent className="w-[480px]">
          {upstreamPath && selectedNode && (
            <UpstreamPathView node={selectedNode} result={upstreamPath} />
          )}
        </SheetContent>
      </Sheet>

      {/* ── Node form dialog ───────────────────────────────── */}
      {showNodeForm && (
        <NodeFormDialog
          node={editingNode}
          onClose={() => setShowNodeForm(false)}
          onSaved={() => {
            setShowNodeForm(false);
            qc.invalidateQueries({ queryKey: ["/api/network-map/nodes"] });
          }}
        />
      )}

      {/* ── Link form dialog ───────────────────────────────── */}
      {showLinkForm && (
        <LinkFormDialog
          link={editingLink}
          nodes={nodes}
          onClose={() => setShowLinkForm(false)}
          onSaved={() => {
            setShowLinkForm(false);
            qc.invalidateQueries({ queryKey: ["/api/network-map/links"] });
          }}
        />
      )}

      {/* ── LLDP import dialog ─────────────────────────────── */}
      {showLldpImport && (
        <LldpImportDialog
          onClose={() => setShowLldpImport(false)}
          onImported={() => {
            setShowLldpImport(false);
            qc.invalidateQueries({ queryKey: ["/api/network-map/nodes"] });
            qc.invalidateQueries({ queryKey: ["/api/network-map/links"] });
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Node detail sidebar
// ──────────────────────────────────────────────────────────────

function NodeDetail({
  node, links, nodeById, onUpstreamPath, loadingPath,
}: {
  node: NetNode;
  links: NetLink[];
  nodeById: Map<string, NetNode>;
  onUpstreamPath: () => void;
  loadingPath: boolean;
}) {
  return (
    <div className="space-y-4 pt-2">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span>{NODE_KIND_ICON[node.nodeKind] ?? "⚙️"}</span>
          <span className="font-mono">{node.hostname}</span>
        </SheetTitle>
      </SheetHeader>

      <div className="space-y-1 text-sm">
        {node.displayName !== node.hostname && (
          <p className="text-muted-foreground">{node.displayName}</p>
        )}
        <div className="flex gap-2 flex-wrap mt-1">
          <Badge variant="outline" className={ROLE_COLOR[node.role] ?? ""}>{node.role}</Badge>
          <Badge variant="outline" className={CRIT_COLOR[node.criticality] ?? ""}>{node.criticality}</Badge>
          {node.status && (
            <Badge variant="outline" className={node.status === "online" ? "text-emerald-600" : node.status === "offline" ? "text-red-600" : ""}>
              {node.status}
            </Badge>
          )}
        </div>
      </div>

      <dl className="text-sm space-y-1">
        <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Building</dt><dd>{node.building}</dd></div>
        {node.location && <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Location</dt><dd>{node.location}</dd></div>}
        {node.mgmtIp && <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Mgmt IP</dt><dd className="font-mono">{node.mgmtIp}</dd></div>}
        {node.vendor && <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Vendor</dt><dd>{node.vendor}</dd></div>}
        {node.model && <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Model</dt><dd>{node.model}</dd></div>}
        {node.function && <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Function</dt><dd>{node.function}</dd></div>}
      </dl>

      {node.notes && (
        <p className="text-sm text-muted-foreground border-l-2 pl-3 italic">{node.notes}</p>
      )}

      <Button variant="outline" size="sm" className="w-full" onClick={onUpstreamPath} disabled={loadingPath}>
        <Route className="h-4 w-4 mr-2" />
        {loadingPath ? "Finding path…" : "Show upstream path to core"}
      </Button>

      {links.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
            Connections ({links.length})
          </h3>
          <div className="space-y-1">
            {links.map((link) => {
              const peer = link.aNodeId === node.id
                ? nodeById.get(link.bNodeId)
                : nodeById.get(link.aNodeId);
              const myPort = link.aNodeId === node.id ? link.aPort : link.bPort;
              const peerPort = link.aNodeId === node.id ? link.bPort : link.aPort;
              const stale = link.isStale;
              return (
                <div key={link.id} className={`text-xs p-2 rounded border ${stale ? "opacity-50 border-dashed" : ""}`}>
                  <div className="flex justify-between">
                    <span className="font-mono">{myPort}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono">{peer?.hostname ?? "?"}</span>
                    <span className="font-mono text-muted-foreground">{peerPort}</span>
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {link.linkKind} · {link.speedMbps ? `${link.speedMbps >= 1000 ? `${link.speedMbps / 1000}G` : `${link.speedMbps}M`}` : "speed unknown"}
                    {stale && " · ⚠ stale"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Upstream path view
// ──────────────────────────────────────────────────────────────

type UpstreamPathResult = {
  found: boolean;
  path: { from: NetNode; fromPort: string; to: NetNode; toPort: string }[];
  message?: string;
};

function UpstreamPathView({ node, result }: { node: NetNode; result: UpstreamPathResult }) {
  return (
    <div className="space-y-4 pt-2">
      <SheetHeader>
        <SheetTitle>Upstream Path</SheetTitle>
      </SheetHeader>
      <p className="text-sm text-muted-foreground">
        From <span className="font-mono font-medium">{node.hostname}</span> to core
      </p>

      {!result.found && (
        <div className="text-sm text-amber-600 border border-amber-200 rounded p-3">
          {result.message ?? "No path to core found."}
        </div>
      )}

      {result.found && result.path.length === 0 && (
        <div className="text-sm text-emerald-600 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> This device IS the core.
        </div>
      )}

      {result.found && result.path.length > 0 && (
        <div className="space-y-2">
          {result.path.map((seg, i) => (
            <div key={i} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium">{seg.from.hostname}</span>
                <Badge variant="outline" className={`text-xs ${ROLE_COLOR[seg.from.role] ?? ""}`}>{seg.from.role}</Badge>
              </div>
              <div className="ml-4 text-xs text-muted-foreground border-l-2 pl-3 py-1">
                <span className="font-mono">{seg.fromPort}</span>
                <span className="mx-1">↔</span>
                <span className="font-mono">{seg.toPort}</span>
              </div>
              {i === result.path.length - 1 && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono font-medium text-red-700">{seg.to.hostname}</span>
                  <Badge variant="outline" className="text-xs bg-red-100 text-red-800 border-red-200">core</Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Node form dialog
// ──────────────────────────────────────────────────────────────

function NodeFormDialog({ node, onClose, onSaved }: { node: NetNode | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isEdit = !!node;

  const [form, setForm] = useState({
    hostname: node?.hostname ?? "",
    displayName: node?.displayName ?? "",
    nodeKind: node?.nodeKind ?? "switch",
    vendor: node?.vendor ?? "",
    model: node?.model ?? "",
    mgmtIp: node?.mgmtIp ?? "",
    building: node?.building ?? "",
    location: node?.location ?? "",
    role: node?.role ?? "access",
    function: node?.function ?? "",
    criticality: node?.criticality ?? "medium",
    status: node?.status ?? "unknown",
    notes: node?.notes ?? "",
  });

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        vendor: form.vendor || null,
        model: form.model || null,
        mgmtIp: form.mgmtIp || null,
        location: form.location || null,
        function: form.function || null,
        notes: form.notes || null,
        status: form.status || null,
      };
      if (isEdit) return apiReq("PATCH", `/api/network-map/nodes/${node!.id}`, body);
      return apiReq("POST", "/api/network-map/nodes", body);
    },
    onSuccess: () => { toast({ title: isEdit ? "Node updated" : "Node created" }); onSaved(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Node" : "Add Node"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Hostname *</label>
              <Input value={form.hostname} onChange={(e) => set("hostname", e.target.value)} placeholder="sw-aa144-a48" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Display Name *</label>
              <Input value={form.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="Hobble Nexus A48" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Kind</label>
              <Select value={form.nodeKind} onValueChange={(v) => set("nodeKind", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["switch", "firewall", "router", "server", "svi", "patch_panel", "isp", "other"].map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Role *</label>
              <Select value={form.role} onValueChange={(v) => set("role", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["core", "distribution", "access", "edge", "firewall", "controller", "svi"].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Building *</label>
              <Input value={form.building} onChange={(e) => set("building", e.target.value)} placeholder="Hobble" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Location</label>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Room AA144" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Mgmt IP</label>
              <Input value={form.mgmtIp} onChange={(e) => set("mgmtIp", e.target.value)} placeholder="192.168.2.70" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Criticality</label>
              <Select value={form.criticality} onValueChange={(v) => set("criticality", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["critical", "high", "medium", "low"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Vendor</label>
              <Select value={form.vendor || "none"} onValueChange={(v) => set("vendor", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {["Cisco", "Aruba", "Fortinet", "Dell", "Unknown"].map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Model</label>
              <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="Nexus 9336C-FX2" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Status</label>
            <Select value={form.status || "unknown"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["online", "offline", "unknown"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!form.hostname.trim() || !form.displayName.trim() || !form.building.trim() || mut.isPending}
          >
            {mut.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Node"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// Link form dialog
// ──────────────────────────────────────────────────────────────

function LinkFormDialog({ link, nodes, onClose, onSaved }: {
  link: NetLink | null;
  nodes: NetNode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    aNodeId: link?.aNodeId ?? "",
    aPort: link?.aPort ?? "",
    bNodeId: link?.bNodeId ?? "",
    bPort: link?.bPort ?? "",
    linkKind: link?.linkKind ?? "fiber",
    speedMbps: link?.speedMbps?.toString() ?? "",
    portMode: link?.portMode ?? "",
    confidence: link?.confidence ?? "confirmed_manual",
    lastVerifiedAt: link?.lastVerifiedAt ? link.lastVerifiedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
    evidenceRef: link?.evidenceRef ?? "",
    notes: link?.notes ?? "",
  });

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        speedMbps: form.speedMbps ? parseInt(form.speedMbps) : null,
        portMode: form.portMode || null,
        evidenceRef: form.evidenceRef || null,
        notes: form.notes || null,
        lastVerifiedAt: new Date(form.lastVerifiedAt).toISOString(),
      };
      if (link) return apiReq("PATCH", `/api/network-map/links/${link.id}`, body);
      return apiReq("POST", "/api/network-map/links", body);
    },
    onSuccess: () => { toast({ title: link ? "Link updated" : "Link created" }); onSaved(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const sortedNodes = [...nodes].sort((a, b) => a.hostname.localeCompare(b.hostname));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{link ? "Edit Link" : "Add Link"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">A Node *</label>
              <Select value={form.aNodeId} onValueChange={(v) => set("aNodeId", v)}>
                <SelectTrigger><SelectValue placeholder="Select node" /></SelectTrigger>
                <SelectContent>
                  {sortedNodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.hostname}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">A Port *</label>
              <Input value={form.aPort} onChange={(e) => set("aPort", e.target.value)} placeholder="Eth1/28" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">B Node *</label>
              <Select value={form.bNodeId} onValueChange={(v) => set("bNodeId", v)}>
                <SelectTrigger><SelectValue placeholder="Select node" /></SelectTrigger>
                <SelectContent>
                  {sortedNodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.hostname}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">B Port *</label>
              <Input value={form.bPort} onChange={(e) => set("bPort", e.target.value)} placeholder="1/1/49" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Kind</label>
              <Select value={form.linkKind} onValueChange={(v) => set("linkKind", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["fiber", "dac", "copper", "wireless", "vpn", "virtual", "unknown"].map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Speed (Mbps)</label>
              <Input value={form.speedMbps} onChange={(e) => set("speedMbps", e.target.value)} placeholder="10000" type="number" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Port Mode</label>
              <Select value={form.portMode || "none"} onValueChange={(v) => set("portMode", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {["trunk", "access", "routed", "peerlink", "heartbeat", "unknown"].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Confidence</label>
              <Select value={form.confidence} onValueChange={(v) => set("confidence", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["confirmed_lldp", "confirmed_cdp", "confirmed_manual", "inferred", "stale"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Last Verified</label>
              <Input type="date" value={form.lastVerifiedAt} onChange={(e) => set("lastVerifiedAt", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Evidence Ref</label>
            <Input value={form.evidenceRef} onChange={(e) => set("evidenceRef", e.target.value)} placeholder="A48-lldp-2026-07-07.txt" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!form.aNodeId || !form.bNodeId || !form.aPort || !form.bPort || mut.isPending}
          >
            {mut.isPending ? "Saving…" : link ? "Save" : "Add Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// LLDP import dialog
// ──────────────────────────────────────────────────────────────

function LldpImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    sourceDeviceHostname: "",
    capturedAt: new Date().toISOString().slice(0, 16),
    evidenceRef: "",
    rawText: "",
  });

  const mut = useMutation({
    mutationFn: () =>
      apiReq("POST", "/api/network-map/import/lldp", {
        ...form,
        capturedAt: new Date(form.capturedAt).toISOString(),
        evidenceRef: form.evidenceRef || undefined,
      }),
    onSuccess: (data: { neighborsFound: number; linksUpserted: number; nodesUpserted: number; errors: string[] }) => {
      toast({
        title: `Imported ${data.neighborsFound} neighbors — ${data.linksUpserted} links, ${data.nodesUpserted} new nodes`,
        description: data.errors.length > 0 ? `Errors: ${data.errors.join("; ")}` : undefined,
      });
      onImported();
    },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import LLDP Neighbors</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Paste the output of <code className="bg-muted px-1 rounded">show lldp neighbors detail</code> from any Cisco NX-OS or Aruba device.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Source Device Hostname *</label>
              <Input
                value={form.sourceDeviceHostname}
                onChange={(e) => setForm((f) => ({ ...f, sourceDeviceHostname: e.target.value }))}
                placeholder="sw-aa144-a48"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Captured At</label>
              <Input
                type="datetime-local"
                value={form.capturedAt}
                onChange={(e) => setForm((f) => ({ ...f, capturedAt: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Evidence Reference (optional)</label>
            <Input
              value={form.evidenceRef}
              onChange={(e) => setForm((f) => ({ ...f, evidenceRef: e.target.value }))}
              placeholder="A48-lldp-2026-07-07.txt"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Raw LLDP Output *</label>
            <Textarea
              value={form.rawText}
              onChange={(e) => setForm((f) => ({ ...f, rawText: e.target.value }))}
              rows={12}
              placeholder={"Capability codes:\n  (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device\n  (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other\n\nDevice ID        Local Intf      Hold-time  Capability  Port ID\n...\n"}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!form.sourceDeviceHostname.trim() || !form.rawText.trim() || mut.isPending}
          >
            <Upload className="h-4 w-4 mr-1" />
            {mut.isPending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
