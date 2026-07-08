import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  useListSwitches,
  useListVlans,
  useListAzureVms,
  useGetNetworkLayout,
  useSaveNetworkLayout,
  useClearNetworkLayout,
} from "@workspace/api-client-react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeDragHandler,
  useNodesState,
  useEdgesState,
  getNodesBounds,
  getViewportForBounds,
} from "reactflow";
import "reactflow/dist/style.css";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { RotateCcw } from "lucide-react";
import { toPng, toSvg } from "html-to-image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Server,
  Network as NetIcon,
  Search,
  X,
  Building2,
  Download,
  Cloud,
  Lock,
  History,
  Undo2,
} from "lucide-react";
import { Link } from "wouter";
import { authFetch } from "@/lib/authFetch";

// ── Network Map types (net_nodes / net_links) ──────────────────
type NMNode = {
  id: string; hostname: string; displayName: string; nodeKind: string;
  vendor: string|null; model: string|null; mgmtIp: string|null;
  building: string; location: string|null; role: string; function: string|null;
  criticality: string; tags: string[]|null; status: string|null; notes: string|null;
};
type NMLink = {
  id: string; aNodeId: string; aPort: string; bNodeId: string; bPort: string;
  linkKind: string; speedMbps: number|null; portMode: string|null;
  confidence: string; lastVerifiedAt: string; notes: string|null; isStale?: boolean;
};
type UpstreamSeg = { fromHostname: string; toHostname: string; fromPort: string; toPort: string; linkKind: string; speedMbps: number|null; };
type UpstreamResult = { path: UpstreamSeg[]; reachedCore: boolean; };

const statusFill: Record<string, string> = {
  online: "#10b981",
  offline: "#ef4444",
  unknown: "#64748b",
};

function apiBase() {
  return `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");
}
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

interface LayoutLockStatus {
  locked: boolean;
  lockedById: number | null;
  lockedByName: string | null;
  expiresAt: string | null;
  heldByMe: boolean;
}
interface LayoutEvent {
  id: number;
  action: string;
  actorId: number | null;
  actorName: string | null;
  nodeCount: number;
  createdAt: string;
}

export default function NetworkVisualize() {
  const confirm = useConfirm();
  const { data: switches = [] } = useListSwitches({});
  const { data: vlans = [] } = useListVlans({});
  const { data: azureVms = [] } = useListAzureVms({});
  const [search, setSearch] = useState("");
  const [selectedSwitchIds, setSelectedSwitchIds] = useState<Set<number>>(new Set());
  const [selectedVlanIds, setSelectedVlanIds] = useState<Set<number>>(new Set());
  const [selectedVmIds, setSelectedVmIds] = useState<Set<number>>(new Set());

  // ── Network Map topology source ────────────────────────────────
  const [dataSource, setDataSource] = useState<"inventory"|"netmap">("inventory");
  const [nmSelectedNode, setNmSelectedNode] = useState<NMNode|null>(null);
  const [nmUpstream, setNmUpstream] = useState<UpstreamResult|null>(null);
  const [nmUpstreamLoading, setNmUpstreamLoading] = useState(false);
  // Nodes the user has chosen to show — empty = blank canvas
  const [nmVisibleNodeIds, setNmVisibleNodeIds] = useState<Set<string>>(new Set());
  const [nmSearch, setNmSearch] = useState("");
  const [nmExpandedBuildings, setNmExpandedBuildings] = useState<Set<string>>(new Set());

  const { data: nmNodes = [] } = useQuery<NMNode[]>({
    queryKey: ["/api/network-map/nodes"],
    queryFn: () => authFetch("/api/network-map/nodes").then(r => r.json()),
    enabled: dataSource === "netmap",
  });
  const { data: nmLinks = [] } = useQuery<NMLink[]>({
    queryKey: ["/api/network-map/links"],
    queryFn: () => authFetch("/api/network-map/links").then(r => r.json()),
    enabled: dataSource === "netmap",
  });

  const nmNodeById = useMemo(() => new Map(nmNodes.map(n => [n.id, n])), [nmNodes]);

  const handleNmUpstreamPath = useCallback(async (node: NMNode) => {
    setNmUpstreamLoading(true);
    setNmUpstream(null);
    try {
      const r = await authFetch(`/api/network-map/nodes/${node.id}/upstream-path`);
      setNmUpstream(await r.json());
    } catch { /* ignore */ } finally { setNmUpstreamLoading(false); }
  }, []);

  // Add a node + all its direct link neighbours to the visible set
  const addNodeToView = useCallback((nodeId: string) => {
    const toAdd = new Set([nodeId]);
    for (const link of nmLinks) {
      if (link.aNodeId === nodeId) toAdd.add(link.bNodeId);
      if (link.bNodeId === nodeId) toAdd.add(link.aNodeId);
    }
    setNmVisibleNodeIds(prev => new Set([...prev, ...toAdd]));
  }, [nmLinks]);

  const removeNodeFromView = useCallback((nodeId: string) => {
    setNmVisibleNodeIds(prev => { const n = new Set(prev); n.delete(nodeId); return n; });
  }, []);

  // Building-grouped list of nmNodes for the left panel
  const nmByBuilding = useMemo(() => {
    const q = nmSearch.toLowerCase();
    const map = new Map<string, NMNode[]>();
    for (const n of nmNodes) {
      if (q && !n.hostname.toLowerCase().includes(q) && !n.building.toLowerCase().includes(q)) continue;
      if (!map.has(n.building)) map.set(n.building, []);
      map.get(n.building)!.push(n);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [nmNodes, nmSearch]);

  // Build ReactFlow graph — only from nodes the user has selected
  const nmGraph = useMemo(() => {
    const visibleNodes = nmVisibleNodeIds.size > 0
      ? nmNodes.filter(n => nmVisibleNodeIds.has(n.id))
      : [];
    if (!visibleNodes.length) return { nodes: [] as Node[], edges: [] as Edge[] };

    const ROLE_COLOR: Record<string,string> = {
      core:         "#ef4444",
      distribution: "#f97316",
      access:       "#3b82f6",
      firewall:     "#f59e0b",
      edge:         "#8b5cf6",
      controller:   "#10b981",
    };

    // Group by building
    const buildings = new Map<string, NMNode[]>();
    for (const n of visibleNodes) {
      if (!buildings.has(n.building)) buildings.set(n.building, []);
      buildings.get(n.building)!.push(n);
    }

    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    let bx = 0;
    for (const [building, bNodes] of buildings) {
      const bId = `nmb-${building}`;
      const cols = 3;
      const W = 180, H = 70, PAD = 16, GAP = 12;
      const rows = Math.ceil(bNodes.length / cols);
      const bw = cols * W + (cols - 1) * GAP + PAD * 2;
      const bh = rows * H + (rows - 1) * GAP + PAD * 2 + 28;

      // Building container
      rfNodes.push({
        id: bId,
        type: "group",
        position: { x: bx, y: 0 },
        style: {
          width: bw, height: bh,
          background: "rgba(51,65,85,0.4)",
          border: "1px solid #475569",
          borderRadius: 8,
        },
        data: { label: building },
      });

      // Building label node
      rfNodes.push({
        id: `${bId}-label`,
        parentNode: bId,
        extent: "parent",
        position: { x: PAD, y: 6 },
        style: { fontSize: 11, color: "#94a3b8", fontWeight: 600, pointerEvents: "none", background: "transparent", border: "none" },
        data: { label: building },
      });

      bNodes.forEach((n, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const color = ROLE_COLOR[n.role] ?? "#64748b";
        rfNodes.push({
          id: `nm-${n.id}`,
          parentNode: bId,
          extent: "parent",
          position: { x: PAD + col * (W + GAP), y: PAD + 24 + row * (H + GAP) },
          style: { width: W, height: H, background: "#1e293b", border: `2px solid ${color}`, borderRadius: 6, cursor: "pointer", fontSize: 11 },
          data: {
            label: (
              <div style={{ padding: "4px 6px", lineHeight: 1.4 }}>
                <div style={{ color, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.hostname}</div>
                <div style={{ color: "#94a3b8", fontSize: 10 }}>{n.role} · {n.nodeKind}</div>
                {n.mgmtIp && <div style={{ color: "#64748b", fontSize: 9, fontFamily: "monospace" }}>{n.mgmtIp}</div>}
                {n.status && <div style={{ color: n.status === "online" ? "#10b981" : "#ef4444", fontSize: 9 }}>● {n.status}</div>}
              </div>
            ),
            nmNode: n,
          },
        });
      });

      bx += bw + 40;
    }

    for (const link of nmLinks) {
      const aNode = nmNodeById.get(link.aNodeId);
      const bNode = nmNodeById.get(link.bNodeId);
      if (!aNode || !bNode) continue;

      const isStale = link.isStale || link.confidence === "stale";
      const confirmed = link.confidence === "confirmed_lldp" || link.confidence === "confirmed_cdp" || link.confidence === "confirmed_manual";
      const strokeColor = isStale ? "#64748b" : confirmed ? "#10b981" : "#f59e0b";
      const fmtSpeed = (m: number|null) => !m ? "" : m >= 100000 ? "100G" : m >= 25000 ? "25G" : m >= 10000 ? "10G" : m >= 1000 ? "1G" : `${m}M`;
      const label = `${link.aPort}↔${link.bPort}${link.speedMbps ? " " + fmtSpeed(link.speedMbps) : ""}`;

      rfEdges.push({
        id: `nme-${link.id}`,
        source: `nm-${link.aNodeId}`,
        target: `nm-${link.bNodeId}`,
        label,
        labelStyle: { fontSize: 9, fill: "#94a3b8" },
        labelBgStyle: { fill: "#0f172a", fillOpacity: 0.8 },
        style: {
          stroke: strokeColor,
          strokeWidth: confirmed ? 2 : 1,
          strokeDasharray: isStale ? "4 3" : link.confidence === "inferred" ? "6 3" : undefined,
        },
        data: { link, aNode, bNode },
      });
    }

    return { nodes: rfNodes, edges: rfEdges };
  }, [nmNodes, nmLinks, nmNodeById, nmVisibleNodeIds]);

  const [nmFlowNodes, setNmFlowNodes, onNmNodesChange] = useNodesState(nmGraph.nodes);
  const [nmFlowEdges, setNmFlowEdges, onNmEdgesChange] = useEdgesState(nmGraph.edges);
  useEffect(() => { setNmFlowNodes(nmGraph.nodes); }, [nmGraph.nodes, setNmFlowNodes]);
  useEffect(() => { setNmFlowEdges(nmGraph.edges); }, [nmGraph.edges, setNmFlowEdges]);

  const filteredSwitches = useMemo(() => {
    const q = search.toLowerCase();
    return switches.filter(
      (s) =>
        !q ||
        s.hostname?.toLowerCase().includes(q) ||
        s.building?.toLowerCase().includes(q) ||
        s.ipAddress?.toLowerCase().includes(q)
    );
  }, [switches, search]);

  const filteredVlans = useMemo(() => {
    const q = search.toLowerCase();
    return vlans.filter(
      (v) =>
        !q ||
        String(v.vlanId).includes(q) ||
        v.name?.toLowerCase().includes(q) ||
        v.building?.toLowerCase().includes(q)
    );
  }, [vlans, search]);

  const filteredVms = useMemo(() => {
    const q = search.toLowerCase();
    return azureVms.filter(
      (v) =>
        !q ||
        v.name?.toLowerCase().includes(q) ||
        v.resourceGroup?.toLowerCase().includes(q) ||
        v.privateIp?.toLowerCase().includes(q) ||
        v.publicIp?.toLowerCase().includes(q) ||
        v.purpose?.toLowerCase().includes(q),
    );
  }, [azureVms, search]);

  const toggle = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  };

  const computed = useMemo(() => {
    const selSwitches = switches.filter((s) => selectedSwitchIds.has(s.id));
    const selVlans = vlans.filter((v) => selectedVlanIds.has(v.id));

    // Normalize building names so e.g. "Hobble (A Building)", "Hobble (AA-158)",
    // and "Hobble (AA105)" all collapse into a single "Hobble" container.
    const normalizeBuilding = (raw?: string | null) => {
      if (!raw) return "Unknown";
      // Strip a trailing parenthetical room/code like " (AA-158)" or " (A Building)".
      return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
    };

    // Campus-level buckets float above buildings (e.g. VLAN 1 Mgmt, Camera VLAN).
    const CAMPUS_KEYS = new Set(["Campus-wide", "Core"]);

    // Group selected items by normalized building (excluding campus-level VLANs).
    const switchesByBuilding: Record<string, typeof selSwitches> = {};
    for (const s of selSwitches) {
      const b = normalizeBuilding(s.building);
      (switchesByBuilding[b] ||= []).push(s);
    }
    const vlansByBuilding: Record<string, typeof selVlans> = {};
    const campusVlans: typeof selVlans = [];
    for (const v of selVlans) {
      const b = normalizeBuilding(v.building);
      if (CAMPUS_KEYS.has(b)) {
        campusVlans.push(v);
      } else {
        (vlansByBuilding[b] ||= []).push(v);
      }
    }

    const buildings = Array.from(
      new Set([
        // Hobble is always rendered: it carries the FortiGate + Cisco 9500 core.
        "Hobble",
        ...Object.keys(switchesByBuilding),
        ...Object.keys(vlansByBuilding),
      ])
    ).sort((a, b) => {
      // Hobble first so the rest of campus radiates out from it
      if (a === "Hobble") return -1;
      if (b === "Hobble") return 1;
      return a.localeCompare(b);
    });

    // Layout constants
    const NODE_W = 180;
    const NODE_H = 70;
    const COL_GAP = 18;
    const ROW_GAP = 16;
    const COLS = 2;
    const PADDING_X = 18;
    const PADDING_TOP = 44;
    const PADDING_BOTTOM = 18;
    const SECTION_GAP = 24;
    const BUILDING_GAP = 48;

    // Spine layout (Internet up top, then optional campus VLAN row, then buildings;
    // the FortiGate and Cisco 9500 core live INSIDE the Hobble container as the first row).
    const SPINE_X_W = 240;
    const INTERNET_Y = 0;
    const CAMPUS_VLAN_Y = 110;
    const CAMPUS_VLAN_W = 200;
    const CAMPUS_VLAN_GAP = 16;
    const BUILDINGS_Y = campusVlans.length > 0 ? 230 : 130;

    // Live FortiGate switch record (for status badge on the spine node).
    const fortigateRecord = switches.find((s) =>
      (s.hostname ?? "").toLowerCase().includes("fortigate")
    );
    const fortigateStatus = (fortigateRecord?.status ?? "unknown") as keyof typeof statusFill;
    const fortigateBorder = statusFill[fortigateStatus] ?? statusFill.unknown;

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Inside the Hobble container we always render an "infrastructure" row
    // with the FortiGate and the Cisco 9500 core as the first two tiles.
    const HOBBLE_INFRA_COUNT = 2;
    const HOBBLE_INFRA_HEIGHT = NODE_H;

    // First pass: compute building widths so we can center the spine over them.
    const buildingDims: Record<string, { w: number; h: number }> = {};
    buildings.forEach((b) => {
      const sws = switchesByBuilding[b] ?? [];
      const vls = vlansByBuilding[b] ?? [];
      const swRows = Math.ceil(sws.length / COLS) || 0;
      const vlRows = Math.ceil(vls.length / COLS) || 0;
      const swHeight = swRows ? swRows * NODE_H + (swRows - 1) * ROW_GAP : 0;
      const vlHeight = vlRows ? vlRows * NODE_H + (vlRows - 1) * ROW_GAP : 0;

      const isHobble = b === "Hobble";
      const minInnerCols = isHobble ? HOBBLE_INFRA_COUNT : 1;
      const innerColCount = Math.min(
        COLS,
        Math.max(minInnerCols, sws.length, vls.length, 1)
      );
      const innerWidth = innerColCount * NODE_W + (innerColCount - 1) * COL_GAP;
      const w = innerWidth + PADDING_X * 2;
      const infraHeight = isHobble ? HOBBLE_INFRA_HEIGHT + SECTION_GAP : 0;
      const h =
        PADDING_TOP +
        infraHeight +
        swHeight +
        (swHeight && vlHeight ? SECTION_GAP : 0) +
        vlHeight +
        PADDING_BOTTOM;
      buildingDims[b] = { w, h };
    });

    const totalBuildingsWidth = buildings.reduce(
      (acc, b, i) => acc + buildingDims[b].w + (i > 0 ? BUILDING_GAP : 0),
      0
    );
    const spineCenterX = Math.max(SPINE_X_W / 2, totalBuildingsWidth / 2);

    // --- Spine: Internet, FortiGate, Hobble Cisco 9K core ---
    const internetId = "spine-internet";
    nodes.push({
      id: internetId,
      position: { x: spineCenterX - SPINE_X_W / 2, y: INTERNET_Y },
      data: {
        exportLabel: "Internet / WAN",
        exportShape: "cloud",
        label: (
          <div style={{ fontSize: 12, fontWeight: 700, textAlign: "center" }}>
            🌐 Internet / WAN
          </div>
        ),
      },
      style: {
        width: SPINE_X_W,
        background: "#0c4a6e",
        color: "#e0f2fe",
        border: "2px solid #0284c7",
        borderRadius: 999,
        padding: 10,
      },
      draggable: true,
    });

    // FortiGate and Cisco 9500 core are children of the Hobble container
    // (rendered later in the building loop). We expose their child-node ids
    // here so spine + cross-building edges can target them directly.
    const fortigateChildId = "hobble-fortigate";
    const coreChildId = "hobble-core";

    edges.push({
      id: "e-internet-fortigate",
      source: internetId,
      target: fortigateChildId,
      animated: true,
      style: { stroke: "#38bdf8", strokeWidth: 2 },
      label: "WAN",
      labelStyle: { fill: "#94a3b8", fontSize: 10 },
      labelBgStyle: { fill: "#020617" },
    });
    edges.push({
      id: "e-fortigate-core",
      source: fortigateChildId,
      target: coreChildId,
      animated: true,
      style: { stroke: "#f87171", strokeWidth: 2 },
      label: "inside",
      labelStyle: { fill: "#94a3b8", fontSize: 10 },
      labelBgStyle: { fill: "#020617" },
    });

    // --- Campus-wide VLAN row (floats above buildings, fans out to each) ---
    const campusVlanRowWidth =
      campusVlans.length > 0
        ? campusVlans.length * CAMPUS_VLAN_W +
          (campusVlans.length - 1) * CAMPUS_VLAN_GAP
        : 0;
    let campusVlanX = spineCenterX - campusVlanRowWidth / 2;
    const campusVlanIds: string[] = [];
    campusVlans.forEach((v) => {
      const id = `cv-${v.id}`;
      campusVlanIds.push(id);
      nodes.push({
        id,
        position: { x: campusVlanX, y: CAMPUS_VLAN_Y },
        data: {
          exportLabel: `VLAN ${v.vlanId} · ${v.name}\n${v.subnet ?? ""}\ncampus-wide · ${v.type ?? ""}`.trim(),
          exportColor: "#312e81",
          label: (
            <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "center" }}>
              <div style={{ fontWeight: 700 }}>
                VLAN {v.vlanId} · {v.name}
              </div>
              {v.subnet && (
                <div style={{ opacity: 0.75, fontFamily: "monospace", fontSize: 10 }}>
                  {v.subnet}
                </div>
              )}
              <div
                style={{
                  opacity: 0.85,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                campus-wide · {v.type}
              </div>
            </div>
          ),
        },
        style: {
          width: CAMPUS_VLAN_W,
          background: "#312e81",
          color: "#e0e7ff",
          border: "2px solid #818cf8",
          borderRadius: 8,
          padding: 8,
        },
        draggable: true,
      });

      // Tie campus VLAN up to the core spine
      edges.push({
        id: `e-core-${id}`,
        source: coreChildId,
        target: id,
        animated: true,
        style: { stroke: "#818cf8", strokeWidth: 1.5, strokeDasharray: "3 3" },
      });

      campusVlanX += CAMPUS_VLAN_W + CAMPUS_VLAN_GAP;
    });

    // --- Building containers ---
    let cursorX = spineCenterX - totalBuildingsWidth / 2;
    buildings.forEach((b) => {
      const sws = switchesByBuilding[b] ?? [];
      const vls = vlansByBuilding[b] ?? [];
      const { w: buildingW, h: buildingH } = buildingDims[b];
      const swRows = Math.ceil(sws.length / COLS) || 0;
      const swHeight = swRows ? swRows * NODE_H + (swRows - 1) * ROW_GAP : 0;

      const buildingId = `b-${b}`;
      nodes.push({
        id: buildingId,
        position: { x: cursorX, y: BUILDINGS_Y },
        data: { label: "", exportLabel: b, exportShape: "container" },
        style: {
          width: buildingW,
          height: buildingH,
          background: "rgba(30,41,59,0.55)",
          border: b === "Hobble" ? "2px solid #3b82f6" : "2px solid #475569",
          borderRadius: 12,
          color: "#f8fafc",
          fontWeight: 600,
          fontSize: 13,
          padding: 0,
        },
        draggable: true,
        selectable: true,
      });

      // Cisco 9500 core → building edge. Hobble doesn't need an external uplink
      // (the core IS inside Hobble), so only draw it for other buildings.
      if (b !== "Hobble") {
        edges.push({
          id: `e-core-${b}`,
          source: coreChildId,
          target: buildingId,
          animated: false,
          style: { stroke: "#64748b", strokeWidth: 1.5, strokeDasharray: "6 4" },
          label: "OSPF uplink",
          labelStyle: { fill: "#94a3b8", fontSize: 10 },
          labelBgStyle: { fill: "#020617" },
        });
      }

      // Campus-wide VLANs fan out to every building container too.
      campusVlanIds.forEach((cvId) => {
        edges.push({
          id: `e-${cvId}-${b}`,
          source: cvId,
          target: buildingId,
          animated: false,
          style: { stroke: "#818cf8", strokeWidth: 1, strokeDasharray: "2 4", opacity: 0.7 },
        });
      });

      // Building label sits inside the box, top-left.
      nodes.push({
        id: `${buildingId}-label`,
        position: { x: PADDING_X - 6, y: 8 },
        parentNode: buildingId,
        extent: "parent",
        draggable: false,
        selectable: false,
        data: {
          exportSkip: true,
          label: (
            <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1", letterSpacing: 0.3 }}>
              {b.toUpperCase()}
            </div>
          ),
        },
        style: {
          background: "transparent",
          border: "none",
          padding: 0,
          width: buildingW - PADDING_X * 2,
        },
      });

      // For Hobble: render the FortiGate and Cisco 9500 core as the first
      // infrastructure row inside the container.
      const isHobble = b === "Hobble";
      const infraOffset = isHobble ? HOBBLE_INFRA_HEIGHT + SECTION_GAP : 0;

      if (isHobble) {
        nodes.push({
          id: fortigateChildId,
          parentNode: buildingId,
          extent: "parent",
          position: { x: PADDING_X, y: PADDING_TOP },
          data: {
            exportLabel: `FortiGate Edge Firewall\n${fortigateRecord?.ipAddress ?? ""} · ${fortigateStatus}\nHobble · AA-158`,
            exportColor: "#7f1d1d",
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "left" }}>
                <div
                  style={{
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  🛡 FortiGate Edge
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: fortigateBorder,
                      boxShadow: `0 0 6px ${fortigateBorder}`,
                    }}
                    title={`status: ${fortigateStatus}`}
                  />
                </div>
                <div style={{ opacity: 0.85, fontSize: 10 }}>
                  {fortigateRecord?.ipAddress ?? "—"} · {fortigateStatus}
                </div>
                <div style={{ opacity: 0.6, fontSize: 10 }}>Hobble · AA-158</div>
              </div>
            ),
          },
          style: {
            width: NODE_W,
            height: NODE_H,
            background: "#7f1d1d",
            color: "#fee2e2",
            border: `2px solid ${fortigateBorder}`,
            borderRadius: 8,
            padding: 8,
          },
          draggable: true,
        });
        nodes.push({
          id: coreChildId,
          parentNode: buildingId,
          extent: "parent",
          position: { x: PADDING_X + NODE_W + COL_GAP, y: PADDING_TOP },
          data: {
            exportLabel: "Cisco 9500 Core\nOSPF Area 0\nDistribution to all buildings",
            exportColor: "#1e3a8a",
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "left" }}>
                <div style={{ fontWeight: 700 }}>⚡ Cisco 9500 Core</div>
                <div style={{ opacity: 0.85, fontSize: 10 }}>OSPF Area 0</div>
                <div style={{ opacity: 0.6, fontSize: 10 }}>Distribution to all buildings</div>
              </div>
            ),
          },
          style: {
            width: NODE_W,
            height: NODE_H,
            background: "#1e3a8a",
            color: "#dbeafe",
            border: "2px solid #3b82f6",
            borderRadius: 8,
            padding: 8,
          },
          draggable: true,
        });
      }

      // Switches grid
      sws.forEach((s, idx) => {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        nodes.push({
          id: `s-${s.id}`,
          parentNode: buildingId,
          extent: "parent",
          position: {
            x: PADDING_X + col * (NODE_W + COL_GAP),
            y: PADDING_TOP + infraOffset + row * (NODE_H + ROW_GAP),
          },
          data: {
            exportLabel: `${s.hostname}\n${s.ipAddress ?? ""}\n${s.model ?? ""}`.trim(),
            exportColor: "#0f172a",
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>{s.hostname}</div>
                <div style={{ opacity: 0.85, fontFamily: "monospace" }}>{s.ipAddress}</div>
                {s.model && <div style={{ opacity: 0.6, fontSize: 10 }}>{s.model}</div>}
              </div>
            ),
          },
          style: {
            width: NODE_W,
            height: NODE_H,
            background: "#0f172a",
            color: "#f8fafc",
            border: `2px solid ${statusFill[s.status ?? "unknown"]}`,
            borderRadius: 8,
            padding: 8,
          },
          draggable: true,
        });
      });

      // VLANs grid (below switches inside the same container)
      const vlanYStart =
        PADDING_TOP + infraOffset + swHeight + (swHeight ? SECTION_GAP : 0);
      vls.forEach((v, idx) => {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        nodes.push({
          id: `v-${v.id}`,
          parentNode: buildingId,
          extent: "parent",
          position: {
            x: PADDING_X + col * (NODE_W + COL_GAP),
            y: vlanYStart + row * (NODE_H + ROW_GAP),
          },
          data: {
            exportLabel: `VLAN ${v.vlanId} · ${v.name}\n${v.subnet ?? ""}\n${v.type ?? ""}`.trim(),
            exportColor: "#1e1b4b",
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>
                  VLAN {v.vlanId} · <span style={{ opacity: 0.9 }}>{v.name}</span>
                </div>
                {v.subnet && (
                  <div style={{ opacity: 0.75, fontFamily: "monospace", fontSize: 10 }}>
                    {v.subnet}
                  </div>
                )}
                {v.type && (
                  <div style={{ opacity: 0.6, fontSize: 10, textTransform: "uppercase" }}>
                    {v.type}
                  </div>
                )}
              </div>
            ),
          },
          style: {
            width: NODE_W,
            height: NODE_H,
            background: "#1e1b4b",
            color: "#e0e7ff",
            border: "2px dashed #6366f1",
            borderRadius: 8,
            padding: 8,
          },
          draggable: true,
        });
      });

      cursorX += buildingW + BUILDING_GAP;
    });

    // --- Azure (via FortiGate) container ---
    // Selected Azure VMs render in their own container to the RIGHT of the
    // buildings row, with a single edge from the FortiGate to the container.
    // The container uses its own wider grid (AZURE_COLS) so the border stays
    // a sensible shape even when many VMs are selected, and we always size
    // the container to fully encircle every VM child.
    const selVms = azureVms.filter((v) => selectedVmIds.has(v.id));
    if (selVms.length > 0) {
      const AZURE_COLS = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(selVms.length))));
      const vmRows = Math.ceil(selVms.length / AZURE_COLS) || 0;
      const vmHeight = vmRows ? vmRows * NODE_H + (vmRows - 1) * ROW_GAP : 0;
      const innerCols = Math.min(AZURE_COLS, Math.max(1, selVms.length));
      const innerWidth = innerCols * NODE_W + (innerCols - 1) * COL_GAP;
      const azureW = innerWidth + PADDING_X * 2;
      const azureH = PADDING_TOP + vmHeight + PADDING_BOTTOM;
      const azureId = "container-azure";

      nodes.push({
        id: azureId,
        position: { x: cursorX, y: BUILDINGS_Y },
        data: { label: "", exportLabel: "Azure (via FortiGate)", exportShape: "container" },
        style: {
          width: azureW,
          height: azureH,
          background: "rgba(8,47,73,0.55)",
          border: "2px solid #0ea5e9",
          borderRadius: 12,
          color: "#f0f9ff",
          fontWeight: 600,
          fontSize: 13,
          padding: 0,
        },
        draggable: true,
        selectable: true,
      });

      // Container header label
      nodes.push({
        id: `${azureId}-label`,
        position: { x: PADDING_X - 6, y: 8 },
        parentNode: azureId,
        extent: "parent",
        draggable: false,
        selectable: false,
        data: {
          exportSkip: true,
          label: (
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#bae6fd",
                letterSpacing: 0.3,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ☁ AZURE (via FortiGate)
            </div>
          ),
        },
        style: {
          background: "transparent",
          border: "none",
          padding: 0,
          width: azureW - PADDING_X * 2,
        },
      });

      // Single edge from FortiGate to the Azure container.
      edges.push({
        id: "e-fortigate-azure",
        source: fortigateChildId,
        target: azureId,
        animated: true,
        style: { stroke: "#0ea5e9", strokeWidth: 2, strokeDasharray: "4 3" },
        label: "Azure tunnel",
        labelStyle: { fill: "#94a3b8", fontSize: 10 },
        labelBgStyle: { fill: "#020617" },
      });

      selVms.forEach((vm, idx) => {
        const col = idx % AZURE_COLS;
        const row = Math.floor(idx / AZURE_COLS);
        const status = (vm.status ?? "unknown").toLowerCase();
        const borderColor =
          status === "running" ? "#10b981" : status === "stopped" ? "#ef4444" : "#0ea5e9";
        nodes.push({
          id: `vm-${vm.id}`,
          parentNode: azureId,
          extent: "parent",
          position: {
            x: PADDING_X + col * (NODE_W + COL_GAP),
            y: PADDING_TOP + row * (NODE_H + ROW_GAP),
          },
          data: {
            exportLabel: `${vm.name}\n${vm.privateIp ?? vm.publicIp ?? ""}\n${vm.os ?? vm.size ?? ""}`.trim(),
            exportColor: "#082f49",
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>{vm.name}</div>
                {(vm.privateIp || vm.publicIp) && (
                  <div style={{ opacity: 0.85, fontFamily: "monospace", fontSize: 10 }}>
                    {vm.privateIp ?? vm.publicIp}
                  </div>
                )}
                {(vm.os || vm.size) && (
                  <div style={{ opacity: 0.6, fontSize: 10 }}>{vm.os ?? vm.size}</div>
                )}
              </div>
            ),
          },
          style: {
            width: NODE_W,
            height: NODE_H,
            background: "#082f49",
            color: "#e0f2fe",
            border: `2px solid ${borderColor}`,
            borderRadius: 8,
            padding: 8,
          },
          draggable: true,
        });
      });
    }

    return { nodes, edges };
  }, [switches, vlans, azureVms, selectedSwitchIds, selectedVlanIds, selectedVmIds]);

  // ---- Layout persistence -------------------------------------------------
  // Saved per-node positions (shared across users) override the auto-layout
  // so the diagram remembers manual arrangement between visits.
  const { toast } = useToast();
  const { data: savedLayout = [], refetch: refetchLayout } = useGetNetworkLayout();
  const saveLayoutMutation = useSaveNetworkLayout();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isCIO = user?.role === "cio";

  // ---- Shared-layout edit lock -------------------------------------------
  // A short-TTL advisory lock warns when someone else is already rearranging
  // the shared diagram, and disables dragging so their work isn't clobbered.
  const [lock, setLock] = useState<LayoutLockStatus | null>(null);
  const lockedByOther = !!(lock?.locked && !lock.heldByMe);

  const refreshLock = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase()}/network/layout/lock`, { headers: authHeaders() });
      if (res.ok) setLock(await res.json());
    } catch {
      /* transient — keep last known lock state */
    }
  }, []);

  const acquireLock = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase()}/network/layout/lock`, {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => null);
      if (body) setLock(body);
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Poll the lock while the diagram is open; release it on unmount.
  useEffect(() => {
    refreshLock();
    const t = setInterval(refreshLock, 20_000);
    return () => {
      clearInterval(t);
      // Best-effort release so the next editor isn't blocked by our stale lock.
      fetch(`${apiBase()}/network/layout/lock`, {
        method: "DELETE",
        headers: authHeaders(),
        keepalive: true,
      }).catch(() => {});
    };
  }, [refreshLock]);

  const clearLayoutMutation = useClearNetworkLayout();

  const savedById = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width?: number | null; height?: number | null }>();
    for (const p of savedLayout as any[]) {
      map.set(p.nodeId, { x: p.x, y: p.y, width: p.width, height: p.height });
    }
    return map;
  }, [savedLayout]);

  // Apply saved positions on top of the auto-layout.
  // The Azure container is auto-sized to fit its currently selected VM
  // children — never apply a stale saved width/height to it, otherwise the
  // border could fail to encircle newly-added VMs.
  const AUTO_SIZED_CONTAINERS = new Set(["container-azure"]);
  const hydratedNodes = useMemo<Node[]>(() => {
    return computed.nodes.map((n) => {
      const saved = savedById.get(n.id);
      if (!saved) return n;
      const next: Node = { ...n, position: { x: saved.x, y: saved.y } };
      const allowSize = !AUTO_SIZED_CONTAINERS.has(n.id);
      if (allowSize && (saved.width != null || saved.height != null)) {
        next.style = {
          ...n.style,
          ...(saved.width != null ? { width: saved.width } : {}),
          ...(saved.height != null ? { height: saved.height } : {}),
        };
      }
      return next;
    });
  }, [computed.nodes, savedById]);

  const [nodes, setNodes, onNodesChange] = useNodesState(hydratedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computed.edges);

  // Re-sync local state when underlying data or saved layout changes.
  useEffect(() => {
    setNodes(hydratedNodes);
  }, [hydratedNodes, setNodes]);
  useEffect(() => {
    setEdges(computed.edges);
  }, [computed.edges, setEdges]);

  // Persist the dragged node's position. React Flow gives us the node in the
  // *parent's* coordinate space when it has parentNode, which matches what we
  // store and re-apply.
  // Grab the edit lock as soon as the user starts dragging so concurrent
  // editors are warned off before they clobber each other.
  const handleNodeDragStart = useCallback<NodeDragHandler>(() => {
    void acquireLock();
  }, [acquireLock]);

  const handleNodeDragStop = useCallback<NodeDragHandler>(
    async (_evt, node) => {
      // Refresh/confirm the lock before persisting (heartbeat while editing).
      // If another editor holds it, don't save — the server would reject the
      // write anyway (409), so warn and re-sync the lock banner instead.
      const held = await acquireLock();
      if (!held) {
        await refreshLock();
        toast({
          title: "Someone else is editing",
          description: "Your move wasn't saved because another user holds the layout lock.",
          variant: "destructive",
        });
        await refetchLayout();
        return;
      }
      const w =
        typeof node.style?.width === "number" ? (node.style.width as number) : undefined;
      const h =
        typeof node.style?.height === "number" ? (node.style.height as number) : undefined;
      saveLayoutMutation.mutate(
        {
          data: {
            positions: [
              {
                nodeId: node.id,
                x: node.position.x,
                y: node.position.y,
                ...(w != null ? { width: w } : {}),
                ...(h != null ? { height: h } : {}),
              },
            ],
          },
        },
        {
          onError: (err: any) => {
            const locked = err?.status === 409 || /LAYOUT_LOCKED/.test(String(err?.message));
            void refreshLock();
            toast({
              title: locked ? "Someone else is editing" : "Couldn't save layout",
              description: locked
                ? "Your move wasn't saved — another user holds the layout lock."
                : err?.message ?? "Try again in a moment.",
              variant: "destructive",
            });
          },
        },
      );
    },
    [acquireLock, refreshLock, refetchLayout, saveLayoutMutation, toast],
  );

  // Reset/restore change log (CIO-governed). Snapshots let a reset be undone.
  const { data: layoutEvents = [], refetch: refetchEvents } = useQuery<LayoutEvent[]>({
    queryKey: ["network", "layout-events"],
    queryFn: async () => {
      const res = await fetch(`${apiBase()}/network/layout/events?limit=25`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: isCIO,
  });

  const handleResetLayout = useCallback(async () => {
    if (!(await confirm({
      title: "Reset the diagram?",
      description:
        "Restores the automatic layout for everyone. The current arrangement is snapshotted to the layout history so you can restore it later.",
      confirmText: "Reset",
      destructive: true,
    }))) return;
    try {
      const res = await fetch(`${apiBase()}/network/layout/reset`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      await refetchLayout();
      await refetchEvents();
      queryClient.invalidateQueries({ queryKey: ["network", "layout-events"] });
      toast({
        title: "Layout reset",
        description: `Auto-layout restored (${body?.removed ?? 0} positions saved to history).`,
      });
    } catch (err: any) {
      toast({
        title: "Reset failed",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    }
  }, [confirm, refetchLayout, refetchEvents, queryClient, toast]);

  const handleRestoreLayout = useCallback(
    async (ev: LayoutEvent) => {
      if (!(await confirm({
        title: "Restore this layout?",
        description: `Re-applies ${ev.nodeCount} saved position(s) from ${new Date(
          ev.createdAt,
        ).toLocaleString()}. This affects everyone viewing the diagram.`,
        confirmText: "Restore",
      }))) return;
      try {
        const res = await fetch(`${apiBase()}/network/layout/events/${ev.id}/restore`, {
          method: "POST",
          headers: authHeaders(),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        await refetchLayout();
        await refetchEvents();
        toast({ title: "Layout restored", description: `${body?.restored ?? 0} positions re-applied.` });
      } catch (err: any) {
        toast({
          title: "Restore failed",
          description: err?.message ?? "Try again.",
          variant: "destructive",
        });
      }
    },
    [confirm, refetchLayout, refetchEvents, toast],
  );

  const totalSelected = selectedSwitchIds.size + selectedVlanIds.size + selectedVmIds.size;

  // Buildings tab data: list every distinct (normalized) building with its
  // switch + VLAN counts and a "select all in this building" toggle.
  const buildingOptions = useMemo(() => {
    const normalize = (raw?: string | null) => {
      if (!raw) return "Unknown";
      return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
    };
    const map = new Map<
      string,
      { name: string; switchIds: number[]; vlanIds: number[] }
    >();
    for (const s of switches) {
      const n = normalize(s.building);
      if (!map.has(n)) map.set(n, { name: n, switchIds: [], vlanIds: [] });
      map.get(n)!.switchIds.push(s.id);
    }
    for (const v of vlans) {
      const n = normalize(v.building);
      if (!map.has(n)) map.set(n, { name: n, switchIds: [], vlanIds: [] });
      map.get(n)!.vlanIds.push(v.id);
    }
    const arr = Array.from(map.values());
    const q = search.toLowerCase();
    return arr
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [switches, vlans, search]);

  const flowWrapperRef = useRef<HTMLDivElement>(null);

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportImage = async (kind: "png" | "svg") => {
    const wrapper = flowWrapperRef.current;
    if (!wrapper) return;
    const viewport = wrapper.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewport) return;
    const bounds = getNodesBounds(nodes);
    const pad = 60;
    const w = Math.ceil(bounds.width + pad * 2);
    const h = Math.ceil(bounds.height + pad * 2);
    const transform = getViewportForBounds(bounds, w, h, 0.5, 2, 0.1);
    const opts = {
      backgroundColor: "#020617",
      width: w,
      height: h,
      style: {
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
      },
    };
    const dataUrl = kind === "png" ? await toPng(viewport, opts) : await toSvg(viewport, opts);
    downloadDataUrl(dataUrl, `network-diagram.${kind}`);
  };

  const exportDrawio = () => {
    // Convert each node to an mxCell. Children of group buildings retain
    // parent="<buildingId>" so positions stay relative just like in React Flow.
    const sanitizeId = (id: string) => `n_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const cells: string[] = [];
    cells.push('<mxCell id="0"/>');
    cells.push('<mxCell id="1" parent="0"/>');

    for (const n of nodes) {
      const data = (n.data ?? {}) as Record<string, unknown>;
      if (data.exportSkip) continue;
      const id = sanitizeId(n.id);
      const parent = n.parentNode ? sanitizeId(n.parentNode) : "1";
      const label = (data.exportLabel as string) ?? "";
      const x = Math.round(n.position?.x ?? 0);
      const y = Math.round(n.position?.y ?? 0);
      const style = n.style as Record<string, unknown> | undefined;
      const w = typeof style?.width === "number" ? style.width : 180;
      const h = typeof style?.height === "number" ? style.height : 70;
      const fill = (data.exportColor as string) ?? "#1e293b";
      let mxStyle = "";
      if (data.exportShape === "container") {
        mxStyle = `rounded=1;whiteSpace=wrap;html=1;fillColor=#1e293b;strokeColor=#475569;fontColor=#cbd5e1;verticalAlign=top;align=left;spacingTop=6;spacingLeft=10;`;
      } else if (data.exportShape === "cloud") {
        mxStyle = `ellipse;shape=cloud;whiteSpace=wrap;html=1;fillColor=#0c4a6e;strokeColor=#0284c7;fontColor=#e0f2fe;`;
      } else {
        mxStyle = `rounded=1;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=#94a3b8;fontColor=#f8fafc;`;
      }
      cells.push(
        `<mxCell id="${id}" value="${esc(label)}" style="${mxStyle}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${Math.round(Number(w))}" height="${Math.round(Number(h))}" as="geometry"/></mxCell>`
      );
    }

    for (const e of edges) {
      const id = sanitizeId(e.id);
      const src = sanitizeId(e.source);
      const tgt = sanitizeId(e.target);
      const label = e.label ? esc(String(e.label)) : "";
      const stroke = (e.style?.stroke as string) ?? "#94a3b8";
      const dashed = e.style?.strokeDasharray ? "dashed=1;" : "";
      cells.push(
        `<mxCell id="${id}" value="${label}" style="endArrow=classic;html=1;rounded=0;strokeColor=${stroke};${dashed}" edge="1" parent="1" source="${src}" target="${tgt}"><mxGeometry relative="1" as="geometry"/></mxCell>`
      );
    }

    const xml =
      '<mxfile host="app.diagrams.net"><diagram name="SCCC Network">' +
      '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">' +
      "<root>" +
      cells.join("") +
      "</root></mxGraphModel></diagram></mxfile>";

    const dataUrl = "data:application/xml;charset=utf-8," + encodeURIComponent(xml);
    downloadDataUrl(dataUrl, "network-diagram.drawio");
  };

  const toggleBuilding = (b: { switchIds: number[]; vlanIds: number[] }) => {
    const allSelected =
      b.switchIds.every((id) => selectedSwitchIds.has(id)) &&
      b.vlanIds.every((id) => selectedVlanIds.has(id));
    if (allSelected) {
      const ns = new Set(selectedSwitchIds);
      b.switchIds.forEach((id) => ns.delete(id));
      setSelectedSwitchIds(ns);
      const nv = new Set(selectedVlanIds);
      b.vlanIds.forEach((id) => nv.delete(id));
      setSelectedVlanIds(nv);
    } else {
      const ns = new Set(selectedSwitchIds);
      b.switchIds.forEach((id) => ns.add(id));
      setSelectedSwitchIds(ns);
      const nv = new Set(selectedVlanIds);
      b.vlanIds.forEach((id) => nv.add(id));
      setSelectedVlanIds(nv);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Network Visualizer</h1>
        <Link href="/network">
          <Button variant="outline" size="sm">Back to Network Reference</Button>
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        {dataSource === "netmap"
          ? "Click a building to expand it, then click a switch to add it and its neighbours to the map. Click again to remove."
          : "Pick switches and VLANs from the lists below — they'll appear in the diagram, grouped by building."}
      </p>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-3">
          {/* ── Network Map picker (replaces inventory tabs) ── */}
          {dataSource === "netmap" ? (<>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter buildings / switches…"
                value={nmSearch}
                onChange={(e) => setNmSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            {nmVisibleNodeIds.size > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{nmVisibleNodeIds.size} node{nmVisibleNodeIds.size === 1 ? "" : "s"} on map</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                  onClick={() => { setNmVisibleNodeIds(new Set()); setNmSelectedNode(null); }}>
                  <X className="h-3 w-3 mr-1" /> Clear map
                </Button>
              </div>
            )}
            <Card>
              <CardContent className="p-2 max-h-[65vh] overflow-y-auto space-y-0.5">
                {nmByBuilding.map(([building, bNodes]) => {
                  const expanded = nmExpandedBuildings.has(building);
                  const visCount = bNodes.filter(n => nmVisibleNodeIds.has(n.id)).length;
                  const ROLE_DOT: Record<string,string> = { core:"#ef4444", distribution:"#f97316", access:"#3b82f6", firewall:"#f59e0b", edge:"#8b5cf6", controller:"#10b981" };
                  return (
                    <div key={building}>
                      <button
                        onClick={() => {
                          const next = new Set(nmExpandedBuildings);
                          if (next.has(building)) next.delete(building); else next.add(building);
                          setNmExpandedBuildings(next);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-muted/50 flex items-center gap-2 text-xs font-semibold"
                      >
                        <span className="text-muted-foreground">{expanded ? "▾" : "▸"}</span>
                        <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{building}</span>
                        <span className="text-muted-foreground font-normal">{bNodes.length}</span>
                        {visCount > 0 && <Badge className="text-[9px] px-1 py-0 h-4 bg-emerald-800 text-emerald-200">{visCount}</Badge>}
                      </button>
                      {expanded && bNodes.map(n => {
                        const visible = nmVisibleNodeIds.has(n.id);
                        const dot = ROLE_DOT[n.role] ?? "#64748b";
                        return (
                          <button key={n.id}
                            onClick={() => visible ? removeNodeFromView(n.id) : addNodeToView(n.id)}
                            className={`w-full text-left pl-7 pr-2 py-1 rounded text-xs flex items-center gap-2 hover:bg-muted/50 ${visible ? "bg-emerald-950/50" : ""}`}
                          >
                            <span style={{ width:6, height:6, borderRadius:"50%", background:dot, display:"inline-block", flexShrink:0 }} />
                            <span className={`font-mono flex-1 truncate ${visible ? "text-emerald-300" : ""}`}>{n.hostname}</span>
                            {visible
                              ? <span className="text-emerald-500 text-[10px]">●</span>
                              : <span className="text-muted-foreground text-[10px]">+</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {nmByBuilding.length === 0 && (
                  <p className="text-xs text-muted-foreground p-4 text-center">
                    {nmNodes.length === 0 ? "Loading…" : "No matches."}
                  </p>
                )}
              </CardContent>
            </Card>
          </>) : (<>
          {/* ── Manual topology inventory tabs ── */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter list..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{totalSelected} item{totalSelected === 1 ? "" : "s"} on diagram</span>
            {totalSelected > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setSelectedSwitchIds(new Set());
                  setSelectedVlanIds(new Set());
                  setSelectedVmIds(new Set());
                }}
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>

          <Tabs defaultValue="buildings">
            <TabsList className="w-full">
              <TabsTrigger value="buildings" className="flex-1">
                <Building2 className="h-3 w-3 mr-1" /> Buildings
              </TabsTrigger>
              <TabsTrigger value="switches" className="flex-1">
                <Server className="h-3 w-3 mr-1" /> Switches
              </TabsTrigger>
              <TabsTrigger value="vlans" className="flex-1">
                <NetIcon className="h-3 w-3 mr-1" /> VLANs
              </TabsTrigger>
              <TabsTrigger value="azure" className="flex-1">
                <Cloud className="h-3 w-3 mr-1" /> Azure
              </TabsTrigger>
            </TabsList>

            <TabsContent value="buildings" className="mt-3">
              <Card>
                <CardContent className="p-2 max-h-[60vh] overflow-y-auto">
                  {buildingOptions.map((b) => {
                    const total = b.switchIds.length + b.vlanIds.length;
                    const selectedHere =
                      b.switchIds.filter((id) => selectedSwitchIds.has(id)).length +
                      b.vlanIds.filter((id) => selectedVlanIds.has(id)).length;
                    const allSelected = total > 0 && selectedHere === total;
                    const partial = selectedHere > 0 && !allSelected;
                    return (
                      <button
                        key={b.name}
                        onClick={() => toggleBuilding(b)}
                        className={`w-full text-left p-2 rounded text-xs hover:bg-muted/50 flex items-start gap-2 ${
                          allSelected ? "bg-primary/10" : partial ? "bg-primary/5" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = partial;
                          }}
                          readOnly
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{b.name}</div>
                          <div className="text-muted-foreground truncate">
                            {b.switchIds.length} switch{b.switchIds.length === 1 ? "" : "es"} ·{" "}
                            {b.vlanIds.length} VLAN{b.vlanIds.length === 1 ? "" : "s"}
                          </div>
                        </div>
                        {selectedHere > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {selectedHere}/{total}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                  {buildingOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground p-4 text-center">No matches.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="switches" className="mt-3">
              <Card>
                <CardContent className="p-2 max-h-[60vh] overflow-y-auto">
                  {filteredSwitches.map((s) => {
                    const checked = selectedSwitchIds.has(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSwitchIds(toggle(selectedSwitchIds, s.id))}
                        className={`w-full text-left p-2 rounded text-xs hover:bg-muted/50 flex items-start gap-2 ${
                          checked ? "bg-primary/10" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono font-medium truncate">{s.hostname}</div>
                          <div className="text-muted-foreground truncate">
                            {s.building} · {s.ipAddress}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0"
                          style={{ borderColor: statusFill[s.status ?? "unknown"] }}
                        >
                          {s.status}
                        </Badge>
                      </button>
                    );
                  })}
                  {filteredSwitches.length === 0 && (
                    <p className="text-xs text-muted-foreground p-4 text-center">No matches.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="vlans" className="mt-3">
              <Card>
                <CardContent className="p-2 max-h-[60vh] overflow-y-auto">
                  {filteredVlans.map((v) => {
                    const checked = selectedVlanIds.has(v.id);
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVlanIds(toggle(selectedVlanIds, v.id))}
                        className={`w-full text-left p-2 rounded text-xs hover:bg-muted/50 flex items-start gap-2 ${
                          checked ? "bg-primary/10" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">
                            <span className="font-mono text-primary">VLAN {v.vlanId}</span>{" "}
                            <span className="truncate">{v.name}</span>
                          </div>
                          <div className="text-muted-foreground truncate">
                            {v.building} · {v.type}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {filteredVlans.length === 0 && (
                    <p className="text-xs text-muted-foreground p-4 text-center">No matches.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="azure" className="mt-3">
              <Card>
                <CardContent className="p-2 max-h-[60vh] overflow-y-auto">
                  {filteredVms.map((vm) => {
                    const checked = selectedVmIds.has(vm.id);
                    const status = (vm.status ?? "unknown").toLowerCase();
                    const dot =
                      status === "running"
                        ? "#10b981"
                        : status === "stopped"
                          ? "#ef4444"
                          : "#0ea5e9";
                    return (
                      <button
                        key={vm.id}
                        onClick={() => setSelectedVmIds((prev) => toggle(prev, vm.id))}
                        className={`w-full text-left p-2 rounded text-xs hover:bg-muted/50 flex items-start gap-2 ${
                          checked ? "bg-primary/10" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{vm.name}</div>
                          <div className="text-muted-foreground truncate">
                            {vm.privateIp ?? vm.publicIp ?? "—"}
                            {vm.resourceGroup ? ` · ${vm.resourceGroup}` : ""}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0"
                          style={{ borderColor: dot }}
                        >
                          {vm.status}
                        </Badge>
                      </button>
                    );
                  })}
                  {filteredVms.length === 0 && (
                    <p className="text-xs text-muted-foreground p-4 text-center">
                      {azureVms.length === 0 ? (
                        <>
                          No Azure VMs yet.{" "}
                          <Link href="/azure-vms" className="underline">
                            Add some
                          </Link>
                          .
                        </>
                      ) : (
                        "No matches."
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          </>)}
        </div>

        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Diagram
              {dataSource === "inventory" && savedById.size > 0 && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  Custom layout · {savedById.size} saved
                </Badge>
              )}
              {dataSource === "netmap" && (
                <Badge className="text-[10px] font-normal bg-emerald-900 text-emerald-200 border-emerald-700">
                  Network Map source · {nmNodes.length} nodes · {nmLinks.length} links
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {/* Source toggle */}
              <div className="flex rounded-md border border-border text-xs overflow-hidden">
                <button
                  className={`px-2 py-1 transition-colors ${dataSource === "inventory" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  onClick={() => setDataSource("inventory")}
                >Manual Topology</button>
                <button
                  className={`px-2 py-1 transition-colors ${dataSource === "netmap" ? "bg-emerald-700 text-white" : "hover:bg-muted"}`}
                  onClick={() => { setDataSource("netmap"); setNmSelectedNode(null); }}
                >Network Map</button>
              </div>
              {lockedByOther && (
                <Badge variant="destructive" className="text-[10px] font-normal gap-1">
                  <Lock className="h-3 w-3" />
                  {lock?.lockedByName ?? "Someone"} is editing
                </Badge>
              )}
              {isCIO && (
                <DropdownMenu onOpenChange={(o) => o && refetchEvents()}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                      <History className="h-3 w-3" /> Layout history
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    {layoutEvents.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                        No reset or restore history yet.
                      </div>
                    ) : (
                      layoutEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-medium capitalize">
                              {ev.action} · {ev.nodeCount} node(s)
                            </div>
                            <div className="text-muted-foreground truncate">
                              {ev.actorName ?? "Unknown"} ·{" "}
                              {new Date(ev.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {ev.nodeCount > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs gap-1 shrink-0"
                              onClick={() => handleRestoreLayout(ev)}
                            >
                              <Undo2 className="h-3 w-3" /> Restore
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleResetLayout}
                disabled={savedById.size === 0 || clearLayoutMutation.isPending}
                title="Restore the auto-layout for everyone"
              >
                <RotateCcw className="h-3 w-3" /> Reset layout
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={totalSelected === 0}
                  >
                    <Download className="h-3 w-3" /> Export
                  </Button>
                </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => exportImage("png")}>
                  PNG image (.png)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportImage("svg")}>
                  SVG vector (.svg) — editable
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportDrawio}>
                  draw.io / diagrams.net (.drawio)
                </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {dataSource === "netmap" ? (
              <div className="flex" style={{ height: "70vh" }}>
                {/* ── ReactFlow canvas ── */}
                <div ref={flowWrapperRef} className="flex-1 bg-slate-950 rounded-bl-lg" style={{ minWidth: 0 }}>
                  {nmFlowNodes.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                      <NetIcon className="h-8 w-8 opacity-20" />
                      <span>Click a switch in the list to add it to the map</span>
                      <span className="text-xs opacity-60">Each switch shows its direct neighbours</span>
                    </div>
                  ) : (
                    <ReactFlow
                      nodes={nmFlowNodes}
                      edges={nmFlowEdges}
                      onNodesChange={onNmNodesChange}
                      onEdgesChange={onNmEdgesChange}
                      onNodeClick={(_evt, node) => {
                        const nmNode = (node.data as any)?.nmNode as NMNode | undefined;
                        if (nmNode) { setNmSelectedNode(nmNode); void handleNmUpstreamPath(nmNode); }
                      }}
                      fitView
                      fitViewOptions={{ padding: 0.15 }}
                      minZoom={0.1}
                      maxZoom={2}
                      nodesDraggable={false}
                    >
                      <Background color="#334155" gap={20} />
                      <Controls />
                      <MiniMap
                        nodeColor={(n) => n.id.startsWith("nm-") ? "#3b82f6" : "transparent"}
                        maskColor="rgba(15,23,42,0.7)"
                      />
                    </ReactFlow>
                  )}
                </div>

                {/* NM Node detail sidebar */}
                {nmSelectedNode && (
                  <div className="w-72 border-l border-border bg-card overflow-y-auto p-4 rounded-br-lg text-sm space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold text-base break-all">{nmSelectedNode.hostname}</div>
                      <button className="text-muted-foreground hover:text-foreground mt-0.5" onClick={() => setNmSelectedNode(null)}>✕</button>
                    </div>

                    {nmSelectedNode.displayName && nmSelectedNode.displayName !== nmSelectedNode.hostname && (
                      <div className="text-muted-foreground text-xs">{nmSelectedNode.displayName}</div>
                    )}

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Role</span>
                      <span className="capitalize font-medium">{nmSelectedNode.role}</span>
                      <span className="text-muted-foreground">Kind</span>
                      <span>{nmSelectedNode.nodeKind}</span>
                      {nmSelectedNode.vendor && <><span className="text-muted-foreground">Vendor</span><span>{nmSelectedNode.vendor}</span></>}
                      {nmSelectedNode.model && <><span className="text-muted-foreground">Model</span><span>{nmSelectedNode.model}</span></>}
                      <span className="text-muted-foreground">Building</span>
                      <span>{nmSelectedNode.building}</span>
                      {nmSelectedNode.location && <><span className="text-muted-foreground">Location</span><span>{nmSelectedNode.location}</span></>}
                      {nmSelectedNode.mgmtIp && <><span className="text-muted-foreground">Mgmt IP</span><span className="font-mono">{nmSelectedNode.mgmtIp}</span></>}
                      {nmSelectedNode.criticality && <><span className="text-muted-foreground">Criticality</span><span className="capitalize">{nmSelectedNode.criticality}</span></>}
                      {nmSelectedNode.status && <><span className="text-muted-foreground">Status</span><span className={nmSelectedNode.status === "online" ? "text-emerald-400" : "text-red-400"}>{nmSelectedNode.status}</span></>}
                    </div>

                    {nmSelectedNode.notes && (
                      <div className="text-xs text-muted-foreground border rounded p-2">{nmSelectedNode.notes}</div>
                    )}

                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Upstream Path</div>
                      {nmUpstreamLoading && <div className="text-xs text-muted-foreground">Computing…</div>}
                      {!nmUpstreamLoading && nmUpstream && (
                        nmUpstream.path.length === 0
                          ? <div className="text-xs text-muted-foreground">No upstream path found (may be core)</div>
                          : <div className="space-y-1">
                              {nmUpstream.path.map((seg, i) => (
                                <div key={i} className="text-xs">
                                  <span className="font-mono text-blue-400">{seg.fromHostname}</span>
                                  <span className="text-muted-foreground"> {seg.fromPort}→{seg.toPort} </span>
                                  <span className="font-mono text-emerald-400">{seg.toHostname}</span>
                                  {seg.speedMbps && <span className="text-muted-foreground ml-1 text-[10px]">{seg.speedMbps >= 10000 ? (seg.speedMbps / 1000) + "G" : seg.speedMbps + "M"}</span>}
                                </div>
                              ))}
                              {nmUpstream.reachedCore && (
                                <Badge className="text-[10px] bg-emerald-900 text-emerald-200 mt-1">Reached core</Badge>
                              )}
                            </div>
                      )}
                    </div>

                    {/* Links for this node */}
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Connected Links</div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {nmLinks
                          .filter(l => l.aNodeId === nmSelectedNode.id || l.bNodeId === nmSelectedNode.id)
                          .map(l => {
                            const isA = l.aNodeId === nmSelectedNode.id;
                            const peerNode = nmNodeById.get(isA ? l.bNodeId : l.aNodeId);
                            const myPort = isA ? l.aPort : l.bPort;
                            const peerPort = isA ? l.bPort : l.aPort;
                            return (
                              <div key={l.id} className="text-xs flex items-start gap-1">
                                <span className="font-mono text-slate-400 shrink-0">{myPort}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className="font-mono text-blue-400">{peerNode?.hostname ?? l.bNodeId}</span>
                                <span className="font-mono text-slate-400">:{peerPort}</span>
                                <span className={`ml-auto text-[10px] shrink-0 ${l.confidence === "confirmed_lldp" || l.confidence === "confirmed_manual" ? "text-emerald-400" : l.confidence === "inferred" ? "text-amber-400" : "text-slate-500"}`}>
                                  {l.confidence.replace("confirmed_", "")}
                                </span>
                              </div>
                            );
                          })
                        }
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
            <div ref={flowWrapperRef} style={{ height: "70vh" }} className="bg-slate-950 rounded-b-lg">
              {totalSelected === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Select switches, VLANs, or Azure VMs from the left to draw them here.
                </div>
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDragStop={handleNodeDragStop}
                  nodesDraggable={!lockedByOther}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  minZoom={0.2}
                  maxZoom={2}
                >
                  <Background color="#334155" gap={20} />
                  <Controls />
                  <MiniMap
                    nodeColor={(n) =>
                      n.id.startsWith("b-") && !n.id.endsWith("-label")
                        ? "#475569"
                        : n.id.startsWith("v-")
                        ? "#6366f1"
                        : n.id.startsWith("s-")
                        ? "#10b981"
                        : "transparent"
                    }
                    maskColor="rgba(15,23,42,0.7)"
                  />
                </ReactFlow>
              )}
            </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
