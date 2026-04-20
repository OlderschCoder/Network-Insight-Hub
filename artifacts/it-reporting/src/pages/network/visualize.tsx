import { useMemo, useState } from "react";
import { useListSwitches, useListVlans } from "@workspace/api-client-react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Network as NetIcon, Search, X } from "lucide-react";
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

  const { nodes, edges } = useMemo(() => {
    const selSwitches = switches.filter((s) => selectedSwitchIds.has(s.id));
    const selVlans = vlans.filter((v) => selectedVlanIds.has(v.id));

    // Normalize building names so e.g. "Hobble (A Building)", "Hobble (AA-158)",
    // and "Hobble (AA105)" all collapse into a single "Hobble" container.
    const normalizeBuilding = (raw?: string | null) => {
      if (!raw) return "Unknown";
      // Strip a trailing parenthetical room/code like " (AA-158)" or " (A Building)".
      return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
    };

    // Group selected items by normalized building
    const switchesByBuilding: Record<string, typeof selSwitches> = {};
    for (const s of selSwitches) {
      const b = normalizeBuilding(s.building);
      (switchesByBuilding[b] ||= []).push(s);
    }
    const vlansByBuilding: Record<string, typeof selVlans> = {};
    for (const v of selVlans) {
      const b = normalizeBuilding(v.building);
      (vlansByBuilding[b] ||= []).push(v);
    }

    const buildings = Array.from(
      new Set([
        ...Object.keys(switchesByBuilding),
        ...Object.keys(vlansByBuilding),
      ])
    ).sort((a, b) => {
      // Hobble first so the core sits visually near it
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

    // Spine layout (Internet → FortiGate → Hobble Cisco 9K core)
    const SPINE_X_W = 240;
    const INTERNET_Y = 0;
    const FORTIGATE_Y = 110;
    const CORE_Y = 220;
    const BUILDINGS_Y = 360;

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // First pass: compute building widths so we can center the spine over them.
    const buildingDims: Record<string, { w: number; h: number }> = {};
    buildings.forEach((b) => {
      const sws = switchesByBuilding[b] ?? [];
      const vls = vlansByBuilding[b] ?? [];
      const swRows = Math.ceil(sws.length / COLS) || 0;
      const vlRows = Math.ceil(vls.length / COLS) || 0;
      const swHeight = swRows ? swRows * NODE_H + (swRows - 1) * ROW_GAP : 0;
      const vlHeight = vlRows ? vlRows * NODE_H + (vlRows - 1) * ROW_GAP : 0;
      const innerColCount = Math.min(COLS, Math.max(sws.length, vls.length, 1));
      const innerWidth = innerColCount * NODE_W + (innerColCount - 1) * COL_GAP;
      const w = innerWidth + PADDING_X * 2;
      const h =
        PADDING_TOP +
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

    const fortigateId = "spine-fortigate";
    nodes.push({
      id: fortigateId,
      position: { x: spineCenterX - SPINE_X_W / 2, y: FORTIGATE_Y },
      data: {
        label: (
          <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "center" }}>
            <div style={{ fontWeight: 700 }}>🛡 FortiGate Edge Firewall</div>
            <div style={{ opacity: 0.85, fontSize: 10 }}>Hobble · AA-158</div>
          </div>
        ),
      },
      style: {
        width: SPINE_X_W,
        background: "#7f1d1d",
        color: "#fee2e2",
        border: "2px solid #dc2626",
        borderRadius: 8,
        padding: 10,
      },
      draggable: true,
    });

    const coreId = "spine-core";
    nodes.push({
      id: coreId,
      position: { x: spineCenterX - SPINE_X_W / 2, y: CORE_Y },
      data: {
        label: (
          <div style={{ fontSize: 11, lineHeight: 1.3, textAlign: "center" }}>
            <div style={{ fontWeight: 700 }}>⚡ Cisco 9500 Core</div>
            <div style={{ opacity: 0.85, fontSize: 10 }}>Hobble · OSPF Area 0</div>
          </div>
        ),
      },
      style: {
        width: SPINE_X_W,
        background: "#1e3a8a",
        color: "#dbeafe",
        border: "2px solid #3b82f6",
        borderRadius: 8,
        padding: 10,
      },
      draggable: true,
    });

    edges.push({
      id: "e-internet-fortigate",
      source: internetId,
      target: fortigateId,
      animated: true,
      style: { stroke: "#38bdf8", strokeWidth: 2 },
      label: "WAN",
      labelStyle: { fill: "#94a3b8", fontSize: 10 },
      labelBgStyle: { fill: "#020617" },
    });
    edges.push({
      id: "e-fortigate-core",
      source: fortigateId,
      target: coreId,
      animated: true,
      style: { stroke: "#f87171", strokeWidth: 2 },
      label: "inside",
      labelStyle: { fill: "#94a3b8", fontSize: 10 },
      labelBgStyle: { fill: "#020617" },
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
        data: { label: "" },
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

      // Spine → building edge (campus uplink to Cisco 9K core)
      edges.push({
        id: `e-core-${b}`,
        source: coreId,
        target: buildingId,
        animated: false,
        style: {
          stroke: b === "Hobble" ? "#3b82f6" : "#64748b",
          strokeWidth: 1.5,
          strokeDasharray: b === "Hobble" ? undefined : "6 4",
        },
        label: b === "Hobble" ? "local" : "OSPF uplink",
        labelStyle: { fill: "#94a3b8", fontSize: 10 },
        labelBgStyle: { fill: "#020617" },
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
            y: PADDING_TOP + row * (NODE_H + ROW_GAP),
          },
          data: {
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
      const vlanYStart = PADDING_TOP + swHeight + (swHeight ? SECTION_GAP : 0);
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

  const totalSelected = selectedSwitchIds.size + selectedVlanIds.size;

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

          <Tabs defaultValue="switches">
            <TabsList className="w-full">
              <TabsTrigger value="switches" className="flex-1">
                <Server className="h-3 w-3 mr-1" /> Switches
              </TabsTrigger>
              <TabsTrigger value="vlans" className="flex-1">
                <NetIcon className="h-3 w-3 mr-1" /> VLANs
              </TabsTrigger>
            </TabsList>

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
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Diagram</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div style={{ height: "70vh" }} className="bg-slate-950 rounded-b-lg">
              {totalSelected === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Select switches or VLANs from the left to draw them here.
                </div>
              ) : (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
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
