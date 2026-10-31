import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type NetNode = {
  id: string;
  hostname: string;
  nodeKind: string;
  vendor: string | null;
  model: string | null;
  mgmtIp: string | null;
  building: string;
  role: string;
  function: string | null;
  criticality: string;
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
};

type NetInterface = {
  id: string;
  nodeId: string;
  interfaceName: string;
  ifIndex: number | null;
  description: string | null;
  isPhysical: boolean;
  adminStatus: string | null;
  operStatus: string | null;
  statusReason?: string | null;
  portMode: string | null;
  nativeVlan: number | null;
  allowedVlans: number[] | null;
  duplex: string | null;
  speedMbps: number | null;
  mediaType?: string | null;
  macCount?: number;
  lldpNeighborCount?: number;
  inErrors: number | null;
  outErrors: number | null;
  utilizationPct: number | null;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  telemetryEvidence: string | null;
  telemetryUpdatedAt: string | null;
  configEvidence: string | null;
  configUpdatedAt: string | null;
};

type PortLink = {
  link: NetLink;
  neighbor: NetNode | undefined;
  localPort: string;
  remotePort: string;
};

const ROLE_COLOR: Record<string, string> = {
  core: "bg-red-100 text-red-800 border-red-200",
  distribution: "bg-orange-100 text-orange-800 border-orange-200",
  access: "bg-blue-100 text-blue-800 border-blue-200",
  edge: "bg-purple-100 text-purple-800 border-purple-200",
  firewall: "bg-amber-100 text-amber-800 border-amber-200",
};

const CRIT_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-slate-100 text-slate-600",
};

function fmtSpeed(mbps: number | null): string {
  if (!mbps) return "—";
  if (mbps >= 1_000_000) return `${mbps / 1_000_000}T`;
  if (mbps >= 1_000) return `${mbps / 1_000}G`;
  return `${mbps}M`;
}

function canonicalPort(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^ethernet/, "eth")
    .replace(/^gigabitethernet/, "gi")
    .replace(/^fastethernet/, "fa")
    .replace(/^tengigabitethernet/, "te");
}

function interfaceGroup(name: string): string {
  const parts = name.split("/");
  if (parts.length === 1) return "Ports";
  return parts.slice(0, -1).join("/");
}

function shortPort(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1];
}

function statusClass(iface: NetInterface, link: PortLink | undefined): string {
  if (link?.link.confidence === "confirmed_lldp" || link?.link.confidence === "confirmed_cdp") {
    return "bg-emerald-500 text-white border-emerald-600";
  }
  if (link?.link.confidence === "confirmed_manual") return "bg-blue-500 text-white border-blue-600";
  if (link?.link.confidence === "inferred") return "bg-amber-400 text-white border-amber-500";
  if (link?.link.confidence === "stale") return "bg-slate-300 text-slate-600 border-slate-400";
  if (iface.adminStatus === "down") return "bg-slate-200 text-slate-500 border-slate-300";
  if (iface.operStatus === "up") return "bg-emerald-100 text-emerald-900 border-emerald-400";
  if (iface.adminStatus === "up" && iface.operStatus === "down") return "bg-amber-50 text-amber-800 border-amber-300";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

export function TelemetrySwitchPortMap({
  nodes,
  links,
  nodeById,
  initialNodeId,
  showSelector = true,
}: {
  nodes: NetNode[];
  links: NetLink[];
  nodeById: Map<string, NetNode>;
  initialNodeId?: string;
  showSelector?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(initialNodeId ?? "");
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [pinnedName, setPinnedName] = useState<string | null>(null);
  const switches = useMemo(
    () => nodes
      .filter((node) => node.nodeKind === "switch" || node.nodeKind === "router")
      .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [nodes],
  );

  useEffect(() => {
    if (initialNodeId && initialNodeId !== selectedId) {
      setSelectedId(initialNodeId);
      return;
    }
    if (!selectedId && switches.length) {
      setSelectedId((switches.find((node) => node.role === "core") ?? switches[0]).id);
    }
  }, [initialNodeId, selectedId, switches]);

  const selectedSwitch = nodeById.get(selectedId) ?? switches.find((node) => node.role === "core") ?? switches[0];
  const effectiveId = selectedSwitch?.id ?? "";
  const { data: interfaces = [], isLoading, isError } = useQuery<NetInterface[]>({
    queryKey: ["/api/network-map/ports", effectiveId],
    queryFn: async () => {
      const response = await authFetch(`/api/network-map/ports?nodeId=${encodeURIComponent(effectiveId)}`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    enabled: Boolean(effectiveId),
    refetchInterval: 60_000,
  });
  const physicalInterfaces = useMemo(
    () => {
      const physical = interfaces.filter((iface) => iface.isPhysical);
      const collectorRows = physical.filter(
        (iface) => iface.telemetryEvidence?.startsWith("collector:") && iface.telemetryUpdatedAt,
      );
      const latestCollectorTime = Math.max(
        ...collectorRows.map((iface) => new Date(iface.telemetryUpdatedAt!).getTime()),
      );
      const latestCollectorRows = Number.isFinite(latestCollectorTime)
        ? collectorRows.filter(
            (iface) => new Date(iface.telemetryUpdatedAt!).getTime() === latestCollectorTime,
          )
        : [];
      // A successful SSH poll is the authoritative physical faceplate. Keep
      // older config/SNMP-only rows in the database, but do not mix stale
      // interface naming from a replaced or previously misidentified switch.
      return (latestCollectorRows.length ? latestCollectorRows : physical).sort((a, b) => {
        if (a.ifIndex != null && b.ifIndex != null && a.ifIndex !== b.ifIndex) return a.ifIndex - b.ifIndex;
        return a.interfaceName.localeCompare(b.interfaceName, undefined, { numeric: true, sensitivity: "base" });
      });
    },
    [interfaces],
  );

  const localLinks = useMemo(() => {
    const entries: PortLink[] = [];
    for (const link of links) {
      if (link.aNodeId === effectiveId) {
        entries.push({ link, neighbor: nodeById.get(link.bNodeId), localPort: link.aPort, remotePort: link.bPort });
      } else if (link.bNodeId === effectiveId) {
        entries.push({ link, neighbor: nodeById.get(link.aNodeId), localPort: link.bPort, remotePort: link.aPort });
      }
    }
    return entries;
  }, [effectiveId, links, nodeById]);

  const linkByInterface = useMemo(() => {
    const result = new Map<string, PortLink>();
    const exact = new Map(localLinks.map((entry) => [canonicalPort(entry.localPort), entry]));
    for (const iface of physicalInterfaces) {
      const direct = exact.get(canonicalPort(iface.interfaceName));
      if (direct) {
        result.set(iface.interfaceName, direct);
        continue;
      }
      const suffixMatches = localLinks.filter(
        (entry) => /^\d+$/.test(entry.localPort) && shortPort(iface.interfaceName) === entry.localPort,
      );
      const sameSuffixInterfaces = physicalInterfaces.filter((candidate) => shortPort(candidate.interfaceName) === shortPort(iface.interfaceName));
      if (suffixMatches.length === 1 && sameSuffixInterfaces.length === 1) result.set(iface.interfaceName, suffixMatches[0]);
    }
    return result;
  }, [localLinks, physicalInterfaces]);

  const groups = useMemo(() => {
    const grouped = new Map<string, NetInterface[]>();
    for (const iface of physicalInterfaces) {
      const group = interfaceGroup(iface.interfaceName);
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group)!.push(iface);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [physicalInterfaces]);

  const detailName = hoveredName ?? pinnedName;
  const detailInterface = physicalInterfaces.find((iface) => iface.interfaceName === detailName);
  const detailLink = detailInterface ? linkByInterface.get(detailInterface.interfaceName) : undefined;
  const matchedLinkIds = new Set(linkByInterface.values().map((entry) => entry.link.id));
  const topologyOnlyLinks = localLinks.filter((entry) => !matchedLinkIds.has(entry.link.id));
  const upCount = physicalInterfaces.filter((iface) => iface.operStatus === "up").length;
  const adminDownCount = physicalInterfaces.filter((iface) => iface.adminStatus === "down").length;
  const missingFields = [
    physicalInterfaces.every((iface) => iface.allowedVlans == null) ? "allowed VLAN lists" : null,
    physicalInterfaces.every((iface) => iface.inErrors == null && iface.outErrors == null) ? "error counters" : null,
    physicalInterfaces.every((iface) => iface.utilizationPct == null) ? "utilization" : null,
    physicalInterfaces.every((iface) => iface.rxPowerDbm == null && iface.txPowerDbm == null) ? "optics / DOM" : null,
  ].filter(Boolean) as string[];

  if (!switches.length) return <div className="py-16 text-center text-muted-foreground">No switches in the Network Map yet.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {showSelector && (
          <Select value={effectiveId} onValueChange={(value) => { setSelectedId(value); setPinnedName(null); setHoveredName(null); }}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select switch…" /></SelectTrigger>
            <SelectContent>
              {switches.map((node) => <SelectItem key={node.id} value={node.id}>{node.hostname} — {node.building}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {selectedSwitch && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <span className="font-mono">{selectedSwitch.mgmtIp ?? "no IP"}</span>
            <Badge variant="outline" className={ROLE_COLOR[selectedSwitch.role] ?? ""}>{selectedSwitch.role}</Badge>
            <span>{selectedSwitch.model ?? ""}</span>
            {physicalInterfaces.length > 0 && <span className="text-xs">{upCount} connected · {adminDownCount} admin-down · {physicalInterfaces.length} physical</span>}
          </div>
        )}
      </div>

      {isLoading && <div className="py-12 flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading interface telemetry…</div>}
      {!isLoading && (isError || physicalInterfaces.length === 0) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">No physical-interface telemetry has been imported for this switch.</p>
          <p className="text-xs mt-1">Topology links are preserved below, but the app will not invent a 24- or 48-port faceplate.</p>
        </div>
      )}

      {groups.map(([group, ports]) => (
        <div key={group} className="border rounded-xl bg-slate-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">{group === "Ports" ? "Physical ports" : `Module / member ${group}`}</p>
            <p className="text-xs text-muted-foreground">{ports.filter((port) => port.operStatus === "up").length} / {ports.length} operational</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ports.map((iface) => {
              const portLink = linkByInterface.get(iface.interfaceName);
              const isPinned = pinnedName === iface.interfaceName;
              return (
                <button
                  type="button"
                  key={iface.id}
                  title={`${iface.interfaceName}${iface.description ? ` — ${iface.description}` : ""}`}
                  className={`relative w-12 h-14 rounded border flex flex-col items-center justify-center transition-all hover:scale-105 ${statusClass(iface, portLink)} ${isPinned ? "ring-2 ring-yellow-400" : ""}`}
                  onMouseEnter={() => setHoveredName(iface.interfaceName)}
                  onMouseLeave={() => setHoveredName(null)}
                  onClick={() => setPinnedName(isPinned ? null : iface.interfaceName)}
                >
                  <span className="text-[9px] font-bold">{shortPort(iface.interfaceName)}</span>
                  {portLink?.neighbor?.hostname && <span className="text-[7px] truncate max-w-[42px]">{portLink.neighbor.hostname.substring(0, 8)}</span>}
                  <span className="text-[7px] opacity-80">{fmtSpeed(iface.speedMbps)}</span>
                  {(iface.macCount ?? 0) > 0 && <span className="text-[6px] opacity-75">{iface.macCount} MAC</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" /> Confirmed LLDP/CDP</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500" /> Manual link</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-400" /> Connected endpoint / oper up</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-300" /> Enabled, link down</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200" /> Admin down</span>
      </div>

      {detailInterface ? (
        <div className="border rounded-lg p-4 bg-white shadow-sm grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground uppercase">Interface</p><p className="font-mono font-bold">{detailInterface.interfaceName}</p><p className="text-xs">{detailInterface.description || "No description"}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">State</p><p>Admin <b>{detailInterface.adminStatus ?? "unknown"}</b></p><p>Oper <b>{detailInterface.operStatus ?? "unknown"}</b></p><p className="text-xs text-muted-foreground">{detailInterface.statusReason}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Layer 2</p><p>{detailInterface.portMode ?? "unknown mode"}</p><p>{detailInterface.nativeVlan != null ? `Native VLAN ${detailInterface.nativeVlan}` : "No native VLAN"}</p><p className="text-xs">{detailInterface.allowedVlans?.length ? `${detailInterface.allowedVlans.length} allowed VLANs` : "Allowed VLANs not collected"}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Traffic evidence</p><p>{fmtSpeed(detailInterface.speedMbps)} · {detailInterface.duplex ?? "duplex unknown"}</p><p>{detailInterface.macCount ?? 0} learned MACs</p><p>{detailInterface.lldpNeighborCount ?? 0} LLDP neighbors</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Connected device</p>{detailLink ? <><p className="font-bold">{detailLink.neighbor?.hostname ?? "Unknown"}</p><p className="font-mono text-xs">{detailLink.remotePort}</p><Badge className={CRIT_BADGE[detailLink.neighbor?.criticality ?? ""]}>{detailLink.link.confidence.replace(/_/g, " ")}</Badge></> : detailInterface.operStatus === "up" ? <><p className="font-medium text-emerald-700">Endpoint / unmapped device</p><p className="text-xs text-muted-foreground">Phone, computer, AP, printer, or other edge device</p></> : <p className="text-muted-foreground">No active connection</p>}</div>
          <p className="col-span-2 md:col-span-5 text-[11px] text-muted-foreground">{detailInterface.telemetryUpdatedAt ? `Polled ${new Date(detailInterface.telemetryUpdatedAt).toLocaleString()}` : "No live telemetry timestamp"}{detailInterface.telemetryEvidence ? ` · ${detailInterface.telemetryEvidence}` : ""}</p>
        </div>
      ) : <p className="text-xs text-muted-foreground text-center py-2">Hover or click a port for details</p>}

      {topologyOnlyLinks.length > 0 && (
        <div className="border rounded-lg p-3 text-xs">
          <p className="font-semibold mb-2">Topology-only links not matched to collected physical interfaces</p>
          <div className="flex flex-wrap gap-2">{topologyOnlyLinks.map((entry) => <Badge key={entry.link.id} variant="outline" className="font-mono">{entry.localPort} → {entry.neighbor?.hostname ?? "unknown"}:{entry.remotePort}</Badge>)}</div>
        </div>
      )}

      {physicalInterfaces.length > 0 && missingFields.length > 0 && (
        <div className="border border-amber-200 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div><p className="font-semibold">Still uncollected for this switch</p><p>{missingFields.join(", ")}. These stay blank rather than being inferred.</p></div>
        </div>
      )}
    </div>
  );
}

export function SingleSwitchPortMap({ nodeId }: { nodeId: string }) {
  const { data: nodes = [], isLoading: nodesLoading } = useQuery<NetNode[]>({
    queryKey: ["/api/network-map/nodes"],
    queryFn: async () => {
      const response = await authFetch("/api/network-map/nodes");
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });
  const { data: links = [], isLoading: linksLoading } = useQuery<NetLink[]>({
    queryKey: ["/api/network-map/links"],
    queryFn: async () => {
      const response = await authFetch("/api/network-map/links");
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  if (nodesLoading || linksLoading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading switch faceplate…</div>;
  }
  const selected = nodeById.get(nodeId);
  if (!selected) return <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">This switch is not yet linked to the Port Map inventory.</div>;

  return <TelemetrySwitchPortMap nodes={[selected]} links={links} nodeById={nodeById} initialNodeId={nodeId} showSelector={false} />;
}
