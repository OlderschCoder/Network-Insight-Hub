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

    // Group switches by building → produce a building hub for each unique building
    const buildings = Array.from(
      new Set([
        ...selSwitches.map((s) => s.building ?? "Unknown"),
        ...selVlans.map((v) => v.building ?? "Unknown"),
      ])
    );

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const buildingY = 40;
    const buildingSpacing = 280;
    buildings.forEach((b, i) => {
      nodes.push({
        id: `b-${b}`,
        position: { x: i * buildingSpacing + 60, y: buildingY },
        data: { label: b },
        style: {
          background: "#1e293b",
          color: "#f8fafc",
          border: "2px solid #475569",
          borderRadius: 8,
          padding: 12,
          fontWeight: 600,
          width: 200,
          textAlign: "center" as const,
        },
        draggable: true,
      });
    });

    // Switches grouped under buildings
    const switchesByBuilding: Record<string, typeof selSwitches> = {};
    for (const s of selSwitches) {
      const b = s.building ?? "Unknown";
      (switchesByBuilding[b] ||= []).push(s);
    }

    Object.entries(switchesByBuilding).forEach(([b, list]) => {
      const bIdx = buildings.indexOf(b);
      list.forEach((s, j) => {
        const id = `s-${s.id}`;
        nodes.push({
          id,
          position: {
            x: bIdx * buildingSpacing + 30 + (j % 2) * 120,
            y: 180 + Math.floor(j / 2) * 110,
          },
          data: {
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3 }}>
                <div style={{ fontWeight: 600 }}>{s.hostname}</div>
                <div style={{ opacity: 0.8, fontFamily: "monospace" }}>{s.ipAddress}</div>
                {s.model && <div style={{ opacity: 0.6, fontSize: 10 }}>{s.model}</div>}
              </div>
            ),
          },
          style: {
            background: "#0f172a",
            color: "#f8fafc",
            border: `2px solid ${statusFill[s.status ?? "unknown"]}`,
            borderRadius: 6,
            padding: 8,
            width: 170,
          },
          draggable: true,
        });
        edges.push({
          id: `e-${b}-${s.id}`,
          source: `b-${b}`,
          target: id,
          style: { stroke: "#64748b" },
          animated: false,
        });
      });
    });

    // VLANs grouped under buildings
    const vlansByBuilding: Record<string, typeof selVlans> = {};
    for (const v of selVlans) {
      const b = v.building ?? "Unknown";
      (vlansByBuilding[b] ||= []).push(v);
    }

    Object.entries(vlansByBuilding).forEach(([b, list]) => {
      const bIdx = buildings.indexOf(b);
      const offsetRows = Math.ceil((switchesByBuilding[b]?.length ?? 0) / 2);
      list.forEach((v, j) => {
        const id = `v-${v.id}`;
        nodes.push({
          id,
          position: {
            x: bIdx * buildingSpacing + 30 + (j % 2) * 120,
            y: 180 + offsetRows * 110 + 40 + Math.floor(j / 2) * 90,
          },
          data: {
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3 }}>
                <div style={{ fontWeight: 600 }}>VLAN {v.vlanId}</div>
                <div style={{ opacity: 0.85 }}>{v.name}</div>
                {v.subnet && (
                  <div style={{ opacity: 0.7, fontFamily: "monospace", fontSize: 10 }}>
                    {v.subnet}
                  </div>
                )}
              </div>
            ),
          },
          style: {
            background: "#1e1b4b",
            color: "#e0e7ff",
            border: "2px dashed #6366f1",
            borderRadius: 6,
            padding: 8,
            width: 170,
          },
          draggable: true,
        });
        edges.push({
          id: `e-${b}-v-${v.id}`,
          source: `b-${b}`,
          target: id,
          style: { stroke: "#6366f1", strokeDasharray: "4 4" },
        });
      });
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
                      n.id.startsWith("b-")
                        ? "#475569"
                        : n.id.startsWith("v-")
                        ? "#6366f1"
                        : "#10b981"
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
