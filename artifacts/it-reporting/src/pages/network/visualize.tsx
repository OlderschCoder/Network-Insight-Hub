import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  useListSwitches,
  useListVlans,
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
} from "lucide-react";
import { Link } from "wouter";

const statusFill: Record<string, string> = {
  online: "#10b981",
  offline: "#ef4444",
  unknown: "#64748b",
};

export default function NetworkVisualize() {
  const { data: switches = [] } = useListSwitches({});
  const { data: vlans = [] } = useListVlans({});
  const [search, setSearch] = useState("");
  const [selectedSwitchIds, setSelectedSwitchIds] = useState<Set<number>>(new Set());
  const [selectedVlanIds, setSelectedVlanIds] = useState<Set<number>>(new Set());

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

    return { nodes, edges };
  }, [switches, vlans, selectedSwitchIds, selectedVlanIds]);

  // ---- Layout persistence -------------------------------------------------
  // Saved per-node positions (shared across users) override the auto-layout
  // so the diagram remembers manual arrangement between visits.
  const { toast } = useToast();
  const { data: savedLayout = [], refetch: refetchLayout } = useGetNetworkLayout();
  const saveLayoutMutation = useSaveNetworkLayout();
  const clearLayoutMutation = useClearNetworkLayout();

  const savedById = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width?: number | null; height?: number | null }>();
    for (const p of savedLayout as any[]) {
      map.set(p.nodeId, { x: p.x, y: p.y, width: p.width, height: p.height });
    }
    return map;
  }, [savedLayout]);

  // Apply saved positions on top of the auto-layout.
  const hydratedNodes = useMemo<Node[]>(() => {
    return computed.nodes.map((n) => {
      const saved = savedById.get(n.id);
      if (!saved) return n;
      const next: Node = { ...n, position: { x: saved.x, y: saved.y } };
      if (saved.width != null || saved.height != null) {
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
  const handleNodeDragStop = useCallback<NodeDragHandler>(
    (_evt, node) => {
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
            toast({
              title: "Couldn't save layout",
              description: err?.message ?? "Try again in a moment.",
              variant: "destructive",
            });
          },
        },
      );
    },
    [saveLayoutMutation, toast],
  );

  const handleResetLayout = useCallback(async () => {
    if (!confirm("Reset the diagram to the automatic layout? This affects everyone.")) return;
    try {
      await clearLayoutMutation.mutateAsync({ data: {} });
      await refetchLayout();
      toast({ title: "Layout reset", description: "Auto-layout restored." });
    } catch (err: any) {
      toast({
        title: "Reset failed",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    }
  }, [clearLayoutMutation, refetchLayout, toast]);

  const totalSelected = selectedSwitchIds.size + selectedVlanIds.size;

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
        Pick switches and VLANs from the lists below — they'll appear in the diagram, grouped by
        building. Drag nodes to reposition. The diagram shows what's selected; it doesn't pull live
        link data, so use it to compose a quick logical view.
      </p>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-3">
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
          </Tabs>
        </div>

        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Diagram
              {savedById.size > 0 && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  Custom layout · {savedById.size} saved
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
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
            <div ref={flowWrapperRef} style={{ height: "70vh" }} className="bg-slate-950 rounded-b-lg">
              {totalSelected === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Select switches or VLANs from the left to draw them here.
                </div>
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeDragStop={handleNodeDragStop}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
