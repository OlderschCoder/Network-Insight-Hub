import { useState } from "react";
import { useListSwitches, useListVlans } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Server, Network as NetworkIcon, Workflow } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const statusColor: Record<string, string> = {
  online: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  offline: "bg-red-500/20 text-red-300 border-red-500/30",
  unknown: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const vlanTypeColor: Record<string, string> = {
  data: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  voice: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  management: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  security: "bg-red-500/20 text-red-300 border-red-500/30",
  ospf: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  other: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

export default function Network() {
  const [search, setSearch] = useState("");
  const { data: switches, isLoading: switchesLoading } = useListSwitches({});
  const { data: vlans, isLoading: vlansLoading } = useListVlans({});

  const filteredSwitches = (switches ?? []).filter((s) => {
    const q = search.toLowerCase();
    return (
      s.hostname?.toLowerCase().includes(q) ||
      s.building?.toLowerCase().includes(q) ||
      s.ipAddress?.toLowerCase().includes(q) ||
      s.model?.toLowerCase().includes(q)
    );
  });

  const filteredVlans = (vlans ?? []).filter((v) => {
    const q = search.toLowerCase();
    return (
      String(v.vlanId).includes(q) ||
      v.name?.toLowerCase().includes(q) ||
      v.description?.toLowerCase().includes(q) ||
      v.building?.toLowerCase().includes(q) ||
      v.subnet?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Network Reference</h1>
        <Link href="/network/visualize">
          <Button variant="outline" size="sm">
            <Workflow className="h-4 w-4 mr-2" />
            Visualizer
          </Button>
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by hostname, IP, building, VLAN ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="switches">
        <TabsList>
          <TabsTrigger value="switches">
            <Server className="h-4 w-4 mr-2" />
            Switches ({(switches ?? []).length})
          </TabsTrigger>
          <TabsTrigger value="vlans">
            <NetworkIcon className="h-4 w-4 mr-2" />
            VLANs ({(vlans ?? []).length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="switches" className="mt-4">
          {switchesLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading...</div>
          ) : filteredSwitches.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No switches found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredSwitches.map((sw) => (
                <Card key={sw.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono font-medium text-sm">{sw.hostname}</p>
                        <p className="text-xs text-muted-foreground">{sw.building}</p>
                        <p className="font-mono text-xs text-primary mt-1">{sw.ipAddress}</p>
                        {sw.model && (
                          <p className="text-xs text-muted-foreground mt-1">{sw.model}</p>
                        )}
                        {sw.notes && (
                          <p className="text-xs italic text-muted-foreground/70 mt-1">{sw.notes}</p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={statusColor[sw.status ?? "unknown"] ?? ""}
                      >
                        {sw.status ?? "unknown"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="vlans" className="mt-4">
          {vlansLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading...</div>
          ) : filteredVlans.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No VLANs found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredVlans.map((vlan) => (
                <Card key={vlan.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-primary">
                            VLAN {vlan.vlanId}
                          </span>
                          <span className="font-medium text-sm truncate">{vlan.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{vlan.building}</p>
                        {vlan.description && (
                          <p className="text-xs text-muted-foreground mt-1">{vlan.description}</p>
                        )}
                        {vlan.subnet && (
                          <p className="font-mono text-xs text-emerald-400 mt-1">
                            {vlan.subnet}
                            {vlan.gateway && ` via ${vlan.gateway}`}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`ml-2 shrink-0 ${vlanTypeColor[vlan.type ?? "other"] ?? ""}`}
                      >
                        {vlan.type ?? "other"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
