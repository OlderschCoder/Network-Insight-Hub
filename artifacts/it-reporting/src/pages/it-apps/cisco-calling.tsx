import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  PhoneCall,
  Server,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authFetch";

const API = import.meta.env.VITE_API_URL || "/api";

type CallingPerson = {
  id: string;
  name: string;
  ownerType: "PEOPLE" | "PLACE";
  phoneNumber: string | null;
  extension: string | null;
  webexLocation: string | null;
  building: string | null;
  buildingAssigned: boolean;
};

type WebexDevice = {
  id: string;
  name: string;
  product: string;
  status: "online" | "offline" | "unknown";
  personId: string | null;
  workspaceId: string | null;
};

type CallingSupportSnapshot = {
  configured: boolean;
  queryError: string | null;
  phoneDirectoryQueryError: string | null;
  links: {
    controlHubOverview: string;
    serviceAppsGuide: string;
    auditEventsReference: string;
    emergencyCallingGuide: string;
  };
  e911Range: { start: number; end: number; present: number[]; missing: number[] };
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
  people: CallingPerson[];
  devices: WebexDevice[];
};

type InventoryRow = {
  key: string;
  name: string;
  person: CallingPerson | null;
  devices: WebexDevice[];
};

const healthBadgeClass: Record<CallingSupportSnapshot["buildings"][number]["healthColor"], string> = {
  green: "border-emerald-200 bg-emerald-500/10 text-emerald-700",
  amber: "border-amber-200 bg-amber-500/10 text-amber-700",
  red: "border-red-200 bg-red-500/10 text-red-700",
  gray: "border-slate-200 bg-slate-500/10 text-slate-700",
};

const healthLabel: Record<CallingSupportSnapshot["buildings"][number]["healthColor"], string> = {
  green: "Network healthy",
  amber: "Attention needed",
  red: "Likely building issue",
  gray: "No live data",
};

const deviceBadgeClass: Record<WebexDevice["status"], string> = {
  online: "border-emerald-200 bg-emerald-500/10 text-emerald-700",
  offline: "border-red-200 bg-red-500/10 text-red-700",
  unknown: "border-slate-200 bg-slate-500/10 text-slate-700",
};

function removePhoneModel(value: string): string {
  return value
    .replace(/\s+(?:(?:CP|DP)[- ]?)?\d{4}[A-Z]?(?:\s+phone)?$/i, "")
    .trim();
}

function personNameKey(value: string): string {
  const tokens = removePhoneModel(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length > 1);
  if (tokens.length < 2) return "";
  return `${tokens[0]}|${tokens[tokens.length - 1]}`;
}

function deviceGroupKey(device: WebexDevice): string {
  return removePhoneModel(device.name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildUnifiedRows(people: CallingPerson[], devices: WebexDevice[]): InventoryRow[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const peopleByKey = new Map<string, CallingPerson[]>();
  people.forEach((person) => {
    const key = personNameKey(person.name);
    if (!key) return;
    peopleByKey.set(key, [...(peopleByKey.get(key) ?? []), person]);
  });

  const deviceMatches = new Map<string, WebexDevice[]>();
  const unmatchedDevices: WebexDevice[] = [];
  devices.forEach((device) => {
    const directOwner = peopleById.get(device.personId ?? device.workspaceId ?? "");
    const candidates = directOwner
      ? [directOwner]
      : (peopleByKey.get(personNameKey(device.name)) ?? []);
    if (candidates.length === 1) {
      const personId = candidates[0].id;
      deviceMatches.set(personId, [...(deviceMatches.get(personId) ?? []), device]);
    } else {
      unmatchedDevices.push(device);
    }
  });

  const rows: InventoryRow[] = people.map((person) => ({
    key: `person-${person.id}`,
    name: person.name,
    person,
    devices: deviceMatches.get(person.id) ?? [],
  }));

  const unmatchedGroups = new Map<string, WebexDevice[]>();
  unmatchedDevices.forEach((device) => {
    const key = deviceGroupKey(device) || `${device.name}-${device.product}`.toLowerCase();
    unmatchedGroups.set(key, [...(unmatchedGroups.get(key) ?? []), device]);
  });
  unmatchedGroups.forEach((group, key) => {
    rows.push({ key: `device-${key}`, name: removePhoneModel(group[0].name), person: null, devices: group });
  });

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export default function CiscoCalling() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [deviceStatus, setDeviceStatus] = useState<"all" | "online" | "offline" | "unknown" | "unlinked">("all");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [editingPerson, setEditingPerson] = useState<CallingPerson | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState("__unassigned__");
  const [savingBuilding, setSavingBuilding] = useState(false);

  const canEditPhoneBuildings = ["cio", "network", "network_engineer"].includes((user as any)?.role ?? "");
  const supportQuery = useQuery<CallingSupportSnapshot>({
    queryKey: ["network-calling-support"],
    queryFn: async () => {
      const response = await authFetch(`${API}/network/calling/support`);
      if (!response.ok) throw new Error(`Support view failed (${response.status})`);
      return response.json();
    },
  });

  const unifiedRows = useMemo(
    () => buildUnifiedRows(supportQuery.data?.people ?? [], supportQuery.data?.devices ?? []),
    [supportQuery.data?.people, supportQuery.data?.devices],
  );
  const linkedPeople = useMemo(() => unifiedRows.filter((row) => row.person && row.devices.length > 0).length, [unifiedRows]);
  const standaloneDevices = useMemo(
    () => unifiedRows.filter((row) => !row.person).reduce((count, row) => count + row.devices.length, 0),
    [unifiedRows],
  );
  const buildingRollups = useMemo(() => {
    const counts = new Map<string, { assigned: number; online: number; offline: number; unknown: number; noDevice: number }>();
    (supportQuery.data?.buildingOptions ?? []).forEach((building) => {
      counts.set(building, { assigned: 0, online: 0, offline: 0, unknown: 0, noDevice: 0 });
    });

    unifiedRows.forEach((row) => {
      const building = row.person?.building;
      if (!building) return;
      const current = counts.get(building) ?? { assigned: 0, online: 0, offline: 0, unknown: 0, noDevice: 0 };
      current.assigned += 1;
      if (row.devices.length === 0) current.noDevice += 1;
      else if (row.devices.some((device) => device.status === "online")) current.online += 1;
      else if (row.devices.some((device) => device.status === "offline")) current.offline += 1;
      else current.unknown += 1;
      counts.set(building, current);
    });

    return Array.from(counts.entries())
      .map(([building, stats]) => ({ building, ...stats }))
      .filter((row) => row.assigned > 0)
      .sort((a, b) => a.building.localeCompare(b.building));
  }, [supportQuery.data?.buildingOptions, unifiedRows]);
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return unifiedRows.filter((row) => {
      if (buildingFilter === "assigned" && !row.person?.buildingAssigned) return false;
      if (buildingFilter === "unassigned" && row.person?.buildingAssigned) return false;
      if (!['all', 'assigned', 'unassigned'].includes(buildingFilter) && row.person?.building !== buildingFilter) return false;
      if (deviceStatus === "unlinked" && row.devices.length > 0) return false;
      if (deviceStatus !== "all" && deviceStatus !== "unlinked" && !row.devices.some((device) => device.status === deviceStatus)) return false;
      if (!needle) return true;
      const haystack = [
        row.name,
        row.person?.phoneNumber,
        row.person?.extension,
        row.person?.building,
        ...row.devices.flatMap((device) => [device.name, device.product, device.status]),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [unifiedRows, query, buildingFilter, deviceStatus]);

  const openBuildingEditor = (person: CallingPerson) => {
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

  const data = supportQuery.data;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <Link href="/it-apps" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to IT Apps
        </Link>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <PhoneCall className="h-7 w-7" /> Cisco Calling
        </h1>
        <p className="text-muted-foreground">
          Phone numbers, device state, building assignments, and E-911 network health in one support view.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><PhoneCall className="h-5 w-5" /> Calling support</CardTitle>
          <CardDescription>Live Webex data combined with the campus building and voice-VLAN inventory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><a href={data?.links.controlHubOverview ?? "https://admin.webex.com/overview"} target="_blank" rel="noreferrer">Open Control Hub <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild variant="outline" size="sm"><a href={data?.links.serviceAppsGuide ?? "https://developer.webex.com/create/docs/service-apps"} target="_blank" rel="noreferrer">Service App Guide <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>
            <Button asChild variant="outline" size="sm"><a href={data?.links.emergencyCallingGuide ?? "https://help.webex.com/en-us/article/av6oo3/Enhanced-Emergency-Calling-for-Webex-Calling"} target="_blank" rel="noreferrer">E-911 Guide <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>
          </div>

          {!supportQuery.isLoading && !data?.configured ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Webex is not configured in Insights yet. Building and E-911 data remain available, but live directory and device status need the Webex service-app credentials.
            </div>
          ) : null}
          {data?.queryError ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{data.queryError}</div> : null}
          {data?.phoneDirectoryQueryError ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{data.phoneDirectoryQueryError}</div> : null}

          {supportQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Cisco Calling data…</div>
          ) : supportQuery.isError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {(supportQuery.error as Error)?.message ?? "Could not load the Cisco Calling support view."}
            </div>
          ) : data ? (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card><CardHeader className="pb-2"><CardDescription>Webex devices</CardDescription><CardTitle className="text-2xl">{data.summary.onlineWebexDevices} / {data.summary.totalWebexDevices}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{data.summary.offlineWebexDevices} offline • {data.summary.unknownWebexDevices} unknown</CardContent></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Directory entries</CardDescription><CardTitle className="text-2xl">{data.summary.assignedCallingPeople} / {data.summary.totalCallingPeople}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{data.summary.unassignedCallingPeople} without a building</CardContent></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Calling buildings</CardDescription><CardTitle className="text-2xl">{data.summary.healthyCallingBuildings} / {data.summary.totalCallingBuildings}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{data.summary.attentionCallingBuildings} attention • {data.summary.unknownCallingBuildings} unknown</CardContent></Card>
                <Card><CardHeader className="pb-2"><CardDescription>E-911 VLAN range</CardDescription><CardTitle className="text-2xl">{data.e911Range.present.length} / {data.e911Range.end - data.e911Range.start + 1}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">VLANs {data.e911Range.start}-{data.e911Range.end}</CardContent></Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Phones by building</CardTitle>
                  <CardDescription>
                    Quick building rollup so Fred can immediately see how many assigned phones are online without counting directory rows one by one.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {buildingRollups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No building-assigned phone entries are available yet.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {buildingRollups.map((row) => (
                        <div key={row.building} className="rounded-xl border p-3">
                          <div className="font-medium">{row.building}</div>
                          <div className="mt-1 text-2xl font-semibold">{row.online} / {row.assigned}</div>
                          <div className="text-sm text-muted-foreground">Phones with an online matched device</div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary">{row.offline} offline</Badge>
                            <Badge variant="secondary">{row.unknown} unknown</Badge>
                            <Badge variant="secondary">{row.noDevice} no matched device</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Phone directory & device status</CardTitle>
                  <CardDescription>
                    Each person or shared phone appears once with its number, building, and matching device status. Exact name matches are combined; uncertain devices remain separate so the table never invents an owner.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_190px]">
                    <Input placeholder="Search person, number, extension, building, phone, or model" value={query} onChange={(event) => setQuery(event.target.value)} />
                    <Select value={buildingFilter} onValueChange={setBuildingFilter}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All buildings</SelectItem>
                        <SelectItem value="assigned">Assigned only</SelectItem>
                        <SelectItem value="unassigned">Unassigned only</SelectItem>
                        {data.buildingOptions.map((building) => <SelectItem key={building} value={building}>{building}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={deviceStatus} onValueChange={(value) => setDeviceStatus(value as typeof deviceStatus)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All device states</SelectItem>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="offline">Offline</SelectItem>
                        <SelectItem value="unknown">Unknown</SelectItem>
                        <SelectItem value="unlinked">No matched device</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{data.summary.totalCallingPeople} directory entries</Badge>
                    <Badge variant="outline">{linkedPeople} with matched devices</Badge>
                    <Badge variant="outline">{standaloneDevices} shared or unmatched devices</Badge>
                    <Badge variant="outline">{filteredRows.length} visible rows</Badge>
                  </div>

                  {filteredRows.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No directory or device entries match the current filters.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border">
                      <div className="hidden grid-cols-[minmax(150px,1.1fr)_minmax(150px,.9fr)_minmax(220px,1.4fr)_minmax(150px,.9fr)_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
                        <div>Name</div><div>Phone number</div><div>Device & status</div><div>Building</div><div className="w-20 text-right">Action</div>
                      </div>
                      <div className="divide-y">
                        {filteredRows.slice(0, 250).map((row) => (
                          <div key={row.key} className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(150px,1.1fr)_minmax(150px,.9fr)_minmax(220px,1.4fr)_minmax(150px,.9fr)_auto] md:items-center">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{row.name}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {row.person
                                  ? `${row.person.ownerType === "PLACE" ? "Shared phone" : "Person"}${row.person.webexLocation ? ` · Webex location: ${row.person.webexLocation}` : ""}`
                                  : "Unmatched Webex device"}
                              </div>
                            </div>
                            <div>
                              <div className="font-mono text-sm">{row.person?.phoneNumber ?? (row.person ? "No direct number" : "—")}</div>
                              {row.person?.extension ? <div className="text-xs text-muted-foreground">Extension {row.person.extension}</div> : null}
                            </div>
                            <div className="space-y-1.5">
                              {row.devices.length ? row.devices.map((device, index) => (
                                <div key={`${device.name}-${device.product}-${index}`} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
                                  <span className="min-w-0 truncate text-xs" title={`${device.name} · ${device.product}`}>{device.product}</span>
                                  <Badge variant="outline" className={`shrink-0 ${deviceBadgeClass[device.status]}`}>{device.status}</Badge>
                                </div>
                              )) : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">No matched device</Badge>}
                            </div>
                            <div>
                              {row.person?.building ? <Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" /> {row.person.building}</Badge> : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Unassigned</Badge>}
                            </div>
                            <div className="md:w-20 md:text-right">
                              {row.person && canEditPhoneBuildings ? <Button variant="outline" size="sm" onClick={() => openBuildingEditor(row.person!)}><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button> : <span className="text-xs text-muted-foreground">{row.person ? "View only" : "—"}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Building E-911 matrix</CardTitle>
                  <CardDescription>Use building health and voice VLANs to separate local network issues from Webex service or device problems.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {data.buildings.map((building) => (
                    <div key={building.name} className="rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div><div className="font-medium">{building.name}</div><div className="text-xs text-muted-foreground">{building.onlineSwitchCount}/{building.switchCount} switches online • {building.nodeCount} monitored nodes</div></div>
                        <Badge variant="outline" className={healthBadgeClass[building.healthColor]}>{healthLabel[building.healthColor]}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {building.e911Vlans.length ? building.e911Vlans.map((vlan) => (
                          <Badge key={vlan.id} variant="secondary" className="h-auto whitespace-normal px-2 py-1 text-left">VLAN {vlan.vlanId} {vlan.name}{vlan.subnet ? ` • ${vlan.subnet}` : ""}{vlan.gateway ? ` • gw ${vlan.gateway}` : ""}</Badge>
                        )) : <Badge variant="outline">No E-911 VLAN mapped yet</Badge>}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">Monitoring strategy: {building.monitoringStrategy}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={!!editingPerson} onOpenChange={(open) => !open && setEditingPerson(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign phone to a building</DialogTitle>
            <DialogDescription>{editingPerson ? `${editingPerson.name} • ${editingPerson.phoneNumber ?? `Extension ${editingPerson.extension ?? "not listed"}`}` : "Choose the campus building for this person."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium">Building</label>
            <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__unassigned__">Unassigned</SelectItem>{data?.buildingOptions.map((building) => <SelectItem key={building} value={building}>{building}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">This changes the Insights directory label only. It does not move the user or number in Webex Control Hub.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPerson(null)} disabled={savingBuilding}>Cancel</Button>
            <Button onClick={savePhoneBuilding} disabled={savingBuilding}>{savingBuilding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save building</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="flex items-center gap-1 text-xs text-muted-foreground"><Server className="h-3.5 w-3.5" /> Device status is live and read-only from Webex Control Hub.</p>
    </div>
  );
}
