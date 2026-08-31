import { useMemo, useState } from "react";
import {
  useGetNetworkWhitelist,
  useWhitelistWebsite,
  getGetNetworkWhitelistQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ShieldCheck, Globe, Loader2, AlertTriangle, ArrowLeft, Printer, Laptop, Trash2, PhoneCall, ExternalLink, Building2, Server, Pencil, Users, MapPin } from "lucide-react";
import { Link } from "wouter";
import { InstallPrinterTool } from "./script-tools/install-printer";
import { AddLaptopTool } from "./script-tools/add-laptop";
import { RemoveEquipmentTool } from "./script-tools/remove-equipment";
import { authFetch } from "@/lib/authFetch";
import { useAuth } from "@/context/AuthContext";

const actionColor: Record<string, string> = {
  exempt: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  allow: "bg-blue-500/10 text-blue-700 border-blue-200",
  monitor: "bg-amber-500/10 text-amber-700 border-amber-200",
  block: "bg-red-500/10 text-red-700 border-red-200",
};

const API = import.meta.env.VITE_API_URL || "/api";

type CallingSupportSnapshot = {
  configured: boolean;
  queryError: string | null;
  phoneDirectoryQueryError: string | null;
  links: {
    controlHubOverview: string;
    devicesReference: string;
    serviceAppsGuide: string;
    auditEventsReference: string;
    emergencyCallingGuide: string;
  };
  e911Range: {
    start: number;
    end: number;
    present: number[];
    missing: number[];
  };
  summary: {
    totalWebexDevices: number;
    onlineWebexDevices: number;
    offlineWebexDevices: number;
    unknownWebexDevices: number;
    totalCallingPeople: number;
    assignedCallingPeople: number;
    unassignedCallingPeople: number;
    totalCallingBuildings: number;
    healthyCallingBuildings: number;
    attentionCallingBuildings: number;
    unknownCallingBuildings: number;
  };
  buildingOptions: string[];
  buildings: Array<{
    name: string;
    healthColor: "green" | "amber" | "red" | "gray";
    monitoringStrategy: string;
    nodeCount: number;
    switchCount: number;
    onlineSwitchCount: number;
    offlineSwitchCount: number;
    e911Vlans: Array<{
      id: number;
      vlanId: number;
      name: string;
      description: string | null;
      subnet: string | null;
      gateway: string | null;
    }>;
  }>;
  people: Array<{
    id: string;
    name: string;
    phoneNumber: string | null;
    extension: string | null;
    webexLocation: string | null;
    building: string | null;
    buildingAssigned: boolean;
  }>;
  devices: Array<{
    name: string;
    product: string;
    status: "online" | "offline" | "unknown";
  }>;
};

const healthBadgeClass: Record<CallingSupportSnapshot["buildings"][number]["healthColor"], string> = {
  green: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  amber: "bg-amber-500/10 text-amber-700 border-amber-200",
  red: "bg-red-500/10 text-red-700 border-red-200",
  gray: "bg-slate-500/10 text-slate-700 border-slate-200",
};

const healthLabel: Record<CallingSupportSnapshot["buildings"][number]["healthColor"], string> = {
  green: "Network healthy",
  amber: "Attention needed",
  red: "Likely building issue",
  gray: "No live data",
};

const deviceBadgeClass: Record<CallingSupportSnapshot["devices"][number]["status"], string> = {
  online: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  offline: "bg-red-500/10 text-red-700 border-red-200",
  unknown: "bg-slate-500/10 text-slate-700 border-slate-200",
};

export default function NetworkTools() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [action, setAction] = useState<"exempt" | "allow" | "monitor">("exempt");
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceStatus, setDeviceStatus] = useState<"all" | "online" | "offline">("all");
  const [personQuery, setPersonQuery] = useState("");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [editingPerson, setEditingPerson] = useState<CallingSupportSnapshot["people"][number] | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState("__unassigned__");
  const [savingBuilding, setSavingBuilding] = useState(false);

  const canEditPhoneBuildings = ["cio", "network", "network_engineer"].includes((user as any)?.role ?? "");

  const { data, isLoading, error } = useGetNetworkWhitelist({
    query: { retry: false } as any,
  });

  const mutation = useWhitelistWebsite({
    mutation: {
      onSuccess: (result: { added: boolean; url: string; tableName: string; action: string }) => {
        toast({
          title: result.added ? "Website whitelisted" : "Already whitelisted",
          description: result.added
            ? `${result.url} added to "${result.tableName}" (${result.action}).`
            : `${result.url} was already present in "${result.tableName}".`,
        });
        setUrl("");
        queryClient.invalidateQueries({ queryKey: getGetNetworkWhitelistQueryKey() });
      },
      onError: (err: any) => {
        toast({
          title: "Whitelist failed",
          description: err?.data?.message ?? err?.message ?? "Could not reach the FortiGate. Try again.",
          variant: "destructive",
        });
      },
    } as any,
  });

  const configured = data?.configured ?? false;
  const entries = data?.entries ?? [];
  // A 502 (FortiGate reachable-but-errored) surfaces as a query error.
  const loadErrorMsg = (error as any)?.data?.message ?? (error ? "Could not read the whitelist from the FortiGate." : null);

  const callingSupportQuery = useQuery<CallingSupportSnapshot>({
    queryKey: ["network-calling-support"],
    queryFn: async () => {
      const response = await authFetch(`${API}/network/calling/support`);
      if (!response.ok) {
        throw new Error(`Support view failed (${response.status})`);
      }
      return response.json();
    },
  });

  const filteredDevices = useMemo(() => {
    const devices = callingSupportQuery.data?.devices ?? [];
    const needle = deviceQuery.trim().toLowerCase();
    return devices.filter((device) => {
      if (deviceStatus !== "all" && device.status !== deviceStatus) return false;
      if (!needle) return true;
      return `${device.name} ${device.product}`.toLowerCase().includes(needle);
    });
  }, [callingSupportQuery.data?.devices, deviceQuery, deviceStatus]);

  const filteredPeople = useMemo(() => {
    const people = callingSupportQuery.data?.people ?? [];
    const needle = personQuery.trim().toLowerCase();
    return people.filter((person) => {
      if (buildingFilter === "assigned" && !person.buildingAssigned) return false;
      if (buildingFilter === "unassigned" && person.buildingAssigned) return false;
      if (!["all", "assigned", "unassigned"].includes(buildingFilter) && person.building !== buildingFilter) return false;
      if (!needle) return true;
      return `${person.name} ${person.phoneNumber ?? ""} ${person.extension ?? ""} ${person.building ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [callingSupportQuery.data?.people, personQuery, buildingFilter]);

  const openBuildingEditor = (person: CallingSupportSnapshot["people"][number]) => {
    setEditingPerson(person);
    setSelectedBuilding(person.building ?? "__unassigned__");
  };

  const savePhoneBuilding = async () => {
    if (!editingPerson) return;
    setSavingBuilding(true);
    try {
      const response = await authFetch(`${API}/network/calling/people/${encodeURIComponent(editingPerson.id)}/building`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building: selectedBuilding === "__unassigned__" ? null : selectedBuilding }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Update failed (${response.status})`);
      await queryClient.invalidateQueries({ queryKey: ["network-calling-support"] });
      toast({
        title: "Building updated",
        description: selectedBuilding === "__unassigned__"
          ? `${editingPerson.name} is now unassigned.`
          : `${editingPerson.name} is assigned to ${selectedBuilding}.`,
      });
      setEditingPerson(null);
    } catch (err: any) {
      toast({
        title: "Building update failed",
        description: err?.message || "Could not save the phone building assignment.",
        variant: "destructive",
      });
    } finally {
      setSavingBuilding(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast({ title: "Enter a URL or domain", variant: "destructive" });
      return;
    }
    mutation.mutate({ data: { url: url.trim(), action } });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="space-y-1">
        <Link href="/network" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Network
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ShieldCheck className="h-6 w-6 text-emerald-600" /> Network Tools
        </h1>
        <p className="text-muted-foreground">
          Firewall whitelisting plus ready-to-run PowerShell for common on-site tasks.
        </p>
      </div>

      <Tabs defaultValue="whitelist" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="whitelist" className="gap-1.5"><Globe className="h-4 w-4" /> Website Whitelist</TabsTrigger>
          <TabsTrigger value="printer" className="gap-1.5"><Printer className="h-4 w-4" /> Install Printer</TabsTrigger>
          <TabsTrigger value="laptop" className="gap-1.5"><Laptop className="h-4 w-4" /> Add Laptop</TabsTrigger>
          <TabsTrigger value="remove" className="gap-1.5"><Trash2 className="h-4 w-4" /> Remove Equipment</TabsTrigger>
        </TabsList>

        <TabsContent value="calling" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <PhoneCall className="h-5 w-5" /> Cisco Calling Support
              </CardTitle>
              <CardDescription>
                One support window for Webex Control Hub device state plus your building-by-building E-911 VLAN layout.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={callingSupportQuery.data?.links.controlHubOverview ?? "https://admin.webex.com/overview"} target="_blank" rel="noreferrer">
                    Open Control Hub <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={callingSupportQuery.data?.links.serviceAppsGuide ?? "https://developer.webex.com/create/docs/service-apps"} target="_blank" rel="noreferrer">
                    Service App Guide <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={callingSupportQuery.data?.links.emergencyCallingGuide ?? "https://help.webex.com/en-us/article/av6oo3/Enhanced-Emergency-Calling-for-Webex-Calling"} target="_blank" rel="noreferrer">
                    E-911 Guide <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={callingSupportQuery.data?.links.auditEventsReference ?? "https://developer.webex.com/admin/docs/api/v1/admin-audit-events"} target="_blank" rel="noreferrer">
                    Audit Events API <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>

              {!callingSupportQuery.isLoading && !callingSupportQuery.data?.configured && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Webex is not configured in the hub yet. The building/E-911 side of this view still works, but live Webex device inventory needs
                  <span className="mx-1 font-mono">WEBEX_ACCESS_TOKEN</span>
                  or
                  <span className="mx-1 font-mono">WEBEX_REFRESH_TOKEN</span>,
                  <span className="mx-1 font-mono">WEBEX_CLIENT_ID</span>,
                  and
                  <span className="mx-1 font-mono">WEBEX_CLIENT_SECRET</span>.
                </div>
              )}

              {callingSupportQuery.data?.queryError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {callingSupportQuery.data.queryError}
                </div>
              )}

              {callingSupportQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading Cisco Calling support data…
                </div>
              ) : callingSupportQuery.isError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {(callingSupportQuery.error as Error)?.message ?? "Could not load the Cisco Calling support view."}
                </div>
              ) : callingSupportQuery.data ? (
                <div className="space-y-6">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Webex devices</CardDescription>
                        <CardTitle className="text-2xl">{callingSupportQuery.data.summary.onlineWebexDevices} / {callingSupportQuery.data.summary.totalWebexDevices}</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        {callingSupportQuery.data.summary.offlineWebexDevices} offline • {callingSupportQuery.data.summary.unknownWebexDevices} unknown
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Calling buildings</CardDescription>
                        <CardTitle className="text-2xl">{callingSupportQuery.data.summary.healthyCallingBuildings} / {callingSupportQuery.data.summary.totalCallingBuildings}</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        {callingSupportQuery.data.summary.attentionCallingBuildings} attention • {callingSupportQuery.data.summary.unknownCallingBuildings} unknown
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>E-911 VLAN range</CardDescription>
                        <CardTitle className="text-2xl">{callingSupportQuery.data.e911Range.present.length} / {callingSupportQuery.data.e911Range.end - callingSupportQuery.data.e911Range.start + 1}</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        VLANs {callingSupportQuery.data.e911Range.start}-{callingSupportQuery.data.e911Range.end}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Operator logic</CardDescription>
                        <CardTitle className="text-base leading-tight">Network first, cloud second</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        If a building is red here, treat that as a site issue before blaming Webex.
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Users className="h-4 w-4" /> Phone directory
                      </CardTitle>
                      <CardDescription>
                        People and numbers from Webex Calling, with campus building assignments maintained in the Insight Hub.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {callingSupportQuery.data.phoneDirectoryQueryError ? (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                          {callingSupportQuery.data.phoneDirectoryQueryError}
                        </div>
                      ) : (
                        <>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                            <Input
                              placeholder="Search by person, phone number, extension, or building"
                              value={personQuery}
                              onChange={(e) => setPersonQuery(e.target.value)}
                            />
                            <Select value={buildingFilter} onValueChange={setBuildingFilter}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All buildings</SelectItem>
                                <SelectItem value="assigned">Assigned only</SelectItem>
                                <SelectItem value="unassigned">Unassigned only</SelectItem>
                                {callingSupportQuery.data.buildingOptions.map((building) => (
                                  <SelectItem key={building} value={building}>{building}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary">{callingSupportQuery.data.summary.totalCallingPeople} people</Badge>
                            <Badge variant="outline">{callingSupportQuery.data.summary.assignedCallingPeople} assigned</Badge>
                            <Badge variant="outline">{callingSupportQuery.data.summary.unassignedCallingPeople} unassigned</Badge>
                          </div>

                          {filteredPeople.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No phone-directory entries match the current filter.</p>
                          ) : (
                            <div className="overflow-hidden rounded-xl border">
                              <div className="hidden grid-cols-[minmax(0,1.35fr)_minmax(180px,1fr)_minmax(170px,1fr)_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
                                <div>Person</div>
                                <div>Phone number</div>
                                <div>Building</div>
                                <div className="w-20 text-right">Action</div>
                              </div>
                              <div className="divide-y">
                                {filteredPeople.map((person) => (
                                  <div key={person.id} className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1.35fr)_minmax(180px,1fr)_minmax(170px,1fr)_auto] md:items-center">
                                    <div className="min-w-0">
                                      <div className="truncate font-medium">{person.name}</div>
                                      {person.webexLocation && (
                                        <div className="truncate text-xs text-muted-foreground">Webex location: {person.webexLocation}</div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="font-mono text-sm">{person.phoneNumber ?? "No direct number"}</div>
                                      {person.extension && <div className="text-xs text-muted-foreground">Extension {person.extension}</div>}
                                    </div>
                                    <div>
                                      {person.building ? (
                                        <Badge variant="outline" className="gap-1">
                                          <MapPin className="h-3 w-3" /> {person.building}
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Unassigned</Badge>
                                      )}
                                    </div>
                                    <div className="md:w-20 md:text-right">
                                      {canEditPhoneBuildings ? (
                                        <Button variant="outline" size="sm" onClick={() => openBuildingEditor(person)}>
                                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                                        </Button>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">View only</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Dialog open={!!editingPerson} onOpenChange={(open) => !open && setEditingPerson(null)}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Assign phone to a building</DialogTitle>
                        <DialogDescription>
                          {editingPerson
                            ? `${editingPerson.name} • ${editingPerson.phoneNumber ?? `Extension ${editingPerson.extension ?? "not listed"}`}`
                            : "Choose the campus building for this person."}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2 py-2">
                        <label className="text-sm font-medium">Building</label>
                        <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__unassigned__">Unassigned</SelectItem>
                            {callingSupportQuery.data.buildingOptions.map((building) => (
                              <SelectItem key={building} value={building}>{building}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          This changes the Insight Hub directory label only. It does not move the user or number in Webex Control Hub.
                        </p>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingPerson(null)} disabled={savingBuilding}>Cancel</Button>
                        <Button onClick={savePhoneBuilding} disabled={savingBuilding}>
                          {savingBuilding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Save building
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Building2 className="h-4 w-4" /> Building E-911 matrix
                      </CardTitle>
                      <CardDescription>
                        Buildings with calling-related VLANs. Use this to decide whether a phone/service problem is local to a building or more likely in Webex Control Hub.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid gap-3">
                        {callingSupportQuery.data.buildings.map((building) => (
                          <div key={building.name} className="rounded-xl border p-3">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div className="space-y-1">
                                <div className="font-medium">{building.name}</div>
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <span>{building.switchCount} switches</span>
                                  <span>{building.onlineSwitchCount} online</span>
                                  <span>{building.offlineSwitchCount} offline</span>
                                  <span>{building.nodeCount} monitored nodes</span>
                                </div>
                              </div>
                              <Badge variant="outline" className={healthBadgeClass[building.healthColor]}>
                                {healthLabel[building.healthColor]}
                              </Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {building.e911Vlans.length > 0 ? building.e911Vlans.map((vlan) => (
                                <Badge key={vlan.id} variant="secondary" className="h-auto whitespace-normal px-2 py-1 text-left">
                                  VLAN {vlan.vlanId} {vlan.name}
                                  {vlan.subnet ? ` • ${vlan.subnet}` : ""}
                                  {vlan.gateway ? ` • gw ${vlan.gateway}` : ""}
                                </Badge>
                              )) : (
                                <Badge variant="outline">No E-911 VLAN mapped yet</Badge>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              Monitoring strategy: {building.monitoringStrategy}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Server className="h-4 w-4" /> Webex device inventory
                      </CardTitle>
                      <CardDescription>
                        Live read-only device state from Webex. This helps separate Control Hub/device issues from building transport issues.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-col gap-3 md:flex-row">
                        <Input
                          placeholder="Filter devices by name or product"
                          value={deviceQuery}
                          onChange={(e) => setDeviceQuery(e.target.value)}
                        />
                        <Select value={deviceStatus} onValueChange={(value) => setDeviceStatus(value as "all" | "online" | "offline")}>
                          <SelectTrigger className="w-full md:w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All statuses</SelectItem>
                            <SelectItem value="online">Online</SelectItem>
                            <SelectItem value="offline">Offline</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {filteredDevices.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No Webex devices match the current filter.</p>
                      ) : (
                        <div className="grid gap-2">
                          {filteredDevices.slice(0, 150).map((device) => (
                            <div key={`${device.name}-${device.product}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{device.name}</div>
                                <div className="text-sm text-muted-foreground">{device.product}</div>
                              </div>
                              <Badge variant="outline" className={deviceBadgeClass[device.status]}>
                                {device.status}
                              </Badge>
                            </div>
                          ))}
                          {filteredDevices.length > 150 && (
                            <p className="text-xs text-muted-foreground">
                              Showing the first 150 matches. Narrow the filter to zero in on a specific device.
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whitelist" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5" /> Whitelist a website
          </CardTitle>
          <CardDescription>
            Enter a domain (e.g. <span className="font-mono">example.com</span>) or full URL. Bare domains
            are wrapped as wildcards (<span className="font-mono">*example.com*</span>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isLoading && !configured && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">FortiGate is not configured.</p>
                <p>
                  Set <span className="font-mono">FORTIGATE_HOST</span> and{" "}
                  <span className="font-mono">FORTIGATE_API_TOKEN</span> (optionally{" "}
                  <span className="font-mono">FORTIGATE_VDOM</span> /{" "}
                  <span className="font-mono">FORTIGATE_WEBFILTER_PROFILE</span>) to enable this tool.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="wl-url" className="text-sm font-medium">
                URL or domain
              </label>
              <Input
                id="wl-url"
                placeholder="example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!configured || mutation.isPending}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Action</label>
              <Select value={action} onValueChange={(v) => setAction(v as any)} disabled={!configured || mutation.isPending}>
                <SelectTrigger className="w-full sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exempt">Exempt</SelectItem>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="monitor">Monitor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!configured || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Whitelist
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current whitelist</CardTitle>
          <CardDescription>
            {configured && data?.host
              ? `Entries in ${data.profile ?? "the"} web-filter profile on ${data.host}.`
              : "Entries appear here once the FortiGate is configured and reachable."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : loadErrorMsg && configured ? (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadErrorMsg}</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {configured ? "No whitelist entries yet." : "Nothing to show."}
            </p>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => (
                <li key={String(entry.id)} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono text-sm break-all">{entry.url}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className={actionColor[entry.action] ?? ""}>
                      {entry.action}
                    </Badge>
                    {entry.status !== "enable" && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {entry.status}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="printer">
          <InstallPrinterTool />
        </TabsContent>

        <TabsContent value="laptop">
          <AddLaptopTool />
        </TabsContent>

        <TabsContent value="remove">
          <RemoveEquipmentTool />
        </TabsContent>
      </Tabs>
    </div>
  );
}
