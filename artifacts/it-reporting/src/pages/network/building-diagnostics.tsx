import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, RefreshCw, Shuffle } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DIAGNOSTICS_SSO_ATTEMPT_KEY, diagnosticGuid, diagnosticIneligibility } from "@/lib/diagnosticsEntry";

type Result = {
  id: string; recordedAt: string; downloadMbps: number | null; uploadMbps: number | null;
  latencyMs: number | null; requestLossPercent: number | null; error: string | null; targetLabel: string;
  external?: { type: string; targetOrigin: string; path: string; dnsMs: number | null; dnsAddresses?: string[]; remoteAddress?: string; tcpConnectMs: number | null; tlsMs: number | null; ttfbMs?: number | null; httpStatus: number | null; bytesReceived: number; elapsedMs: number; mbps: number | null; timestamp: string; failure?: string; activeAdapter?: { interfaceAlias?: string; kind?: string; mac?: string; localIp?: string; subnetPrefixLength?: number; gateway?: string; ssid?: string; bssid?: string } };
};
type Device = {
  deviceId: string | null; adObjectGuid: string; adDomain: string; enrolled: boolean; revoked?: boolean; computerName: string; adVerified: boolean; adEnabled?: boolean | null; online: boolean;
  lastCheckIn: string | null; agentVersion: string | null; loggedOnUser: string | null;
  capabilities?: string[];
  directory?: { source: string; observedAt: string; distinguishedName: string; canonicalName: string; location: string | null; memberOf: { objectGuid: string; name: string; distinguishedName: string }[] } | null;
  location: { building: string | null; kind: string; source: string | null; observedAt: string | null };
  lastResult: Result | null;
  portTelemetry?: { source: string; observedAt: string; switchName: string; port: string; operStatus?: string; linkMbps?: number; inBitsPerSecond?: number; outBitsPerSecond?: number; inErrors?: number; outErrors?: number; inDiscards?: number; outDiscards?: number } | null;
};
type Settings = { schedulerArmed: boolean; rotationIntervalMinutes: number; revision: number; updatedAt: string | null; updatedBy: string | null; persisted: boolean; deploymentSchedulerEnabled: boolean; effectiveSchedulerEnabled: boolean };
type Overview = {
  enabled: boolean; schedulerEnabled: boolean; targetLabel: string; inventoryUpdatedAt: string | null; adObservedAt?: string | null;
  externalProbe?: { configured: boolean; origin: string | null; quickBytes: number; sustainedEnabled: boolean; dailyBudgetBytes: number };
  devices: Device[];
  buildings: { building: string; onlineDevices: number; eligibleDevices: number; lastResult: Result | null; noCurrentMeasurement: boolean }[];
  jobs: { id: string; computerName: string; building: string | null; status: string; createdAt: string; scheduledAt?: string | null; requestedBy: string; type?: string }[];
  settings?: Settings;
  readiness?: {
    featureEnabled: boolean; workerConfigured: boolean;
    worker: { state: string; lastSeenAt: string | null };
    inventory: { state: string; importedAt: string | null; adObservedAt: string | null; networkObservedAt: string | null };
    collector: { state: string; lastSeenAt: string | null; status: string | null; switchesObserved: number | null; portObservations: number | null; wifiObservations: number | null };
    counts: { inventory: number; enrolled: number; online: number; adTrusted: number; eligible: number; unlocated: number };
  };
  audit?: { id: string; deviceId: string | null; computerName: string | null; action: string; actor: string; reason: string; createdAt: string }[];
};
type EnrollmentBatch = { requestId: string; status: "queued" | "running" | "completed"; requested: number;
  counts: Record<"queued" | "claimed" | "installing" | "installed" | "online" | "skipped" | "unreachable" | "failed", number>;
  worker: { ready: boolean; lastSeenAt: string | null };
  items: { adObjectGuid: string; computerName: string; status: string; reason?: string; updatedAt?: string | null }[] };
type BuildingAssignments = {
  buildings: string[];
  assignments: { adObjectGuid: string; building: string; source: "manual" | "active-directory-group"; updatedAt: string; updatedBy: string; reason: string; directoryObservedAt?: string; groups?: { groupObjectGuid: string; name: string; distinguishedName: string }[] }[];
  groups?: { groupObjectGuid: string; name: string; distinguishedName: string; computerCount: number }[];
  groupMappings?: { groupObjectGuid: string; building: string; updatedAt: string; updatedBy: string; reason: string }[];
  groupConflicts?: { adObjectGuid: string; reason: string; buildings: string[] }[];
  directory?: { observedAt: string; current: boolean };
};

const API = `${import.meta.env.VITE_API_URL || "/api"}/building-diagnostics`;
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "Not reported";
const metric = (value: number | null | undefined, unit: string) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : "—";
const locationLabels: Record<string, string> = {
  "network-confirmed": "Network confirmed", assigned: "Assigned office", stale: "Stale evidence",
  unknown: "Unknown", ambiguous: "Conflicting evidence",
};

async function readOverview(): Promise<Overview> {
  const response = await authFetch(`${API}/overview`);
  if (!response.ok) throw new Error(response.status === 403 ? "Network administrator access is required." : `Could not load building diagnostics (${response.status}).`);
  return response.json();
}

export default function BuildingDiagnostics() {
  const { user } = useAuth();
  const canManage = ["cio", "network", "network_engineer"].includes(user?.role || "");
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [building, setBuilding] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrollmentSelected, setEnrollmentSelected] = useState<Set<string>>(new Set());
  const [buildingSelected, setBuildingSelected] = useState<Set<string>>(new Set());
  const [assignmentBuilding, setAssignmentBuilding] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("Administrator confirmed the computer's building");
  const [assignmentGroup, setAssignmentGroup] = useState("");
  const [groupBuilding, setGroupBuilding] = useState("");
  const [enrollmentRequestId, setEnrollmentRequestId] = useState(() => diagnosticGuid(new URLSearchParams(window.location.search).get("enrollmentRequest")));
  const enrollmentStartedAt = useRef(Date.now());
  const enrollmentCheckInDeadlines = useRef(new Map<string, number>());
  const [notice, setNotice] = useState("");
  const [entrySelection] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const single = params.get("adObjectGuid"), multiple = params.get("adObjectGuids");
    const invalid = { guids: [] as string[], multiple: false, error: "The selected receivers did not include a valid selection of up to 100 AD identities. Select computers from the verified inventory below." };
    if (single !== null && multiple !== null) return invalid;
    if (single === null && multiple === null) return { guids: [] as string[], multiple: false, error: null };
    const parts = multiple !== null ? multiple.split(",") : [single!];
    if (!parts.length || parts.length > 100) return invalid;
    const validated = parts.map(diagnosticGuid);
    if (multiple === null && !validated[0]) return { ...invalid, error: "The selected receiver did not include a valid AD computer identity. Select a computer from the verified inventory below." };
    if (validated.some(guid => !guid)) return invalid;
    return { guids: [...new Set(validated as string[])], multiple: multiple !== null, error: null };
  });
  const appliedEntry = useRef(false);
  const [schedulerArmed, setSchedulerArmed] = useState(false);
  const [rotationIntervalMinutes, setRotationIntervalMinutes] = useState(360);
  const [credentialAction, setCredentialAction] = useState<{ device: Device; action: "enroll" | "rotate" | "revoke" } | null>(null);
  const [credentialReason, setCredentialReason] = useState("");
  const [measurementType, setMeasurementType] = useState("auto");
  const [sustainedMiB, setSustainedMiB] = useState(64);
  const [sustainedConfirmed, setSustainedConfirmed] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  const query = useQuery({ queryKey: ["building-diagnostics"], queryFn: readOverview, enabled: canManage, retry: false, refetchInterval: 30_000 });
  const data = canManage ? query.data : undefined;
  const assignmentsQuery = useQuery({ queryKey: ["building-diagnostics-assignments"], enabled: canManage && !!data?.enabled, retry: false,
    queryFn: async (): Promise<BuildingAssignments> => {
      const response = await authFetch(`${API}/building-assignments`);
      if (!response.ok) throw new Error(`Could not load building assignments (${response.status}).`);
      const result = await response.json();
      if (!Array.isArray(result.buildings) || !Array.isArray(result.assignments)) throw new Error("Building assignments are unavailable. Enrollment and measurement controls remain available.");
      return result;
    }, refetchInterval: 30_000 });
  const uniqueDevices = useMemo(() => [...new Map((data?.devices || []).map(d => [d.adObjectGuid.toLowerCase(), d])).values()], [data?.devices]);
  const assignments = useMemo(() => new Map((assignmentsQuery.data?.assignments || []).map(a => [a.adObjectGuid.toLowerCase(), a])), [assignmentsQuery.data]);
  const assignmentGroups = useMemo(() => {
    const groups = assignmentsQuery.data?.groups || [];
    const known = new Set(groups.map(g => g.groupObjectGuid));
    return [...groups, ...(assignmentsQuery.data?.groupMappings || []).filter(m => !known.has(m.groupObjectGuid)).map(m => ({ groupObjectGuid: m.groupObjectGuid, name: `Saved mapping ${m.groupObjectGuid} (no current members)`, distinguishedName: "", computerCount: 0 }))];
  }, [assignmentsQuery.data]);
  const currentAssignmentGroup = assignmentsQuery.data?.groups?.some(g => g.groupObjectGuid === assignmentGroup) ?? false;
  const assignedBuilding = (d: Device) => assignments.get(d.adObjectGuid.toLowerCase())?.building || null;
  const groupingBuilding = (d: Device) => assignedBuilding(d);
  const buildingChoices = useMemo(() => [...new Set([...(assignmentsQuery.data?.buildings || []), ...(data?.buildings || []).map(b => b.building)])].sort((a, b) => a.localeCompare(b)), [assignmentsQuery.data, data?.buildings]);
  const jobType = measurementType === "auto" ? (data?.externalProbe?.configured ? "external-quick" : "fred") : measurementType;
  const isSustained = jobType === "external-sustained";
  const devices = useMemo(() => uniqueDevices.filter(d =>
    (!entrySelection.multiple || !entrySelection.guids.length || entrySelection.guids.includes(d.adObjectGuid.toLowerCase())) &&
    (!building || (building === "__unassigned__" ? !groupingBuilding(d) : groupingBuilding(d) === building)) &&
    `${d.computerName} ${d.loggedOnUser || ""} ${assignedBuilding(d) || ""} ${d.location.building || ""} ${(d.directory?.memberOf || []).map(g => g.name).join(" ")}`.toLowerCase().includes(search.toLowerCase())), [uniqueDevices, assignments, building, search, entrySelection]);
  const eligible = (d: Device): d is Device & { deviceId: string } => diagnosticIneligibility(d, jobType) === null;
  const selectedEligible = uniqueDevices.filter(eligible).filter(d => selected.has(d.deviceId));
  const visibleMeasurements = devices.filter(eligible);
  const visibleMeasurementCount = visibleMeasurements.filter(d => selected.has(d.deviceId)).length;
  const allVisibleMeasurementsSelected = visibleMeasurements.length > 0 && visibleMeasurementCount === visibleMeasurements.length;
  const directoryAge = data?.adObservedAt ? Date.now() - Date.parse(data.adObservedAt) : Number.NaN;
  const enrollmentEligible = (d: Device) => !!data?.enabled && Number.isFinite(directoryAge) && directoryAge >= -60_000 && directoryAge <= 24 * 60 * 60_000 &&
    d.adVerified && d.adEnabled === true && !d.enrolled && !d.revoked && !!diagnosticGuid(d.adObjectGuid) && !!d.adDomain;
  const visibleEnrollment = devices.filter(enrollmentEligible);
  const selectedEnrollment = uniqueDevices.filter(enrollmentEligible).filter(d => enrollmentSelected.has(d.adObjectGuid.toLowerCase()));
  const visibleEnrollmentCount = visibleEnrollment.filter(d => enrollmentSelected.has(d.adObjectGuid.toLowerCase())).length;
  const allVisibleEnrollmentSelected = visibleEnrollment.length > 0 && visibleEnrollmentCount === visibleEnrollment.length;
  const buildingEligible = (d: Device) => !!data?.enabled && d.adVerified && d.adEnabled === true && !!diagnosticGuid(d.adObjectGuid);
  const visibleBuilding = devices.filter(buildingEligible);
  const selectedBuildingDevices = uniqueDevices.filter(buildingEligible).filter(d => buildingSelected.has(d.adObjectGuid.toLowerCase()));
  const visibleBuildingCount = visibleBuilding.filter(d => buildingSelected.has(d.adObjectGuid.toLowerCase())).length;
  const allVisibleBuildingsSelected = visibleBuilding.length > 0 && visibleBuildingCount === visibleBuilding.length;
  const assignBuilding = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`${API}/building-assignments`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true, adObjectGuids: selectedBuildingDevices.map(d => d.adObjectGuid.toLowerCase()), building: assignmentBuilding === "__clear__" ? null : assignmentBuilding, reason: assignmentReason.trim() }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `Could not save building assignments (${response.status}).`); }
      return response.json();
    },
    onSuccess: result => { setNotice(`Building assignment saved for ${result.updated} unique computers.`); setBuildingSelected(new Set()); client.invalidateQueries({ queryKey: ["building-diagnostics-assignments"] }); },
  });
  const assignGroup = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`${API}/building-group-mappings`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true, groupObjectGuid: assignmentGroup, building: groupBuilding === "__clear__" ? null : groupBuilding, reason: assignmentReason.trim() }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `Could not save the AD group mapping (${response.status}).`); }
      return response.json();
    },
    onSuccess: () => { setNotice("AD group building mapping saved. Current group members use this building unless a computer has a manual override."); client.invalidateQueries({ queryKey: ["building-diagnostics-assignments"] }); },
  });

  function selectVisibleBuildings(checked: boolean) {
    setBuildingSelected(previous => { const next = new Set(previous); for (const d of visibleBuilding) checked ? next.add(d.adObjectGuid.toLowerCase()) : next.delete(d.adObjectGuid.toLowerCase()); return next; });
  }
  useEffect(() => {
    if (data?.settings) { setSchedulerArmed(data.settings.schedulerArmed); setRotationIntervalMinutes(data.settings.rotationIntervalMinutes); }
  }, [data?.settings?.revision]);
  useEffect(() => {
    if (!data || appliedEntry.current) return;
    appliedEntry.current = true;
    sessionStorage.removeItem(DIAGNOSTICS_SSO_ATTEMPT_KEY);
    if (entrySelection.error) { setNotice(entrySelection.error); return; }
    if (!entrySelection.guids.length) return;
    if (!entrySelection.multiple) {
      const match = data.devices.find(d => diagnosticGuid(d.adObjectGuid) === entrySelection.guids[0]);
      if (!match) { setNotice("This AD computer is not in the current diagnostics inventory. Refresh the central AD inventory before enrolling it."); return; }
      setSearch(match.computerName);
      const reason = diagnosticIneligibility(match, jobType);
      if (!data.enabled || reason) { setNotice(`${match.computerName}: ${!data.enabled ? "reporting is not enabled" : reason}. No measurement was started.`); return; }
      setSelected(new Set([match.deviceId!]));
      setNotice(`${match.computerName} selected using its verified AD identity. Choose a measurement and review the selection; no test has started.`);
      return;
    }
    const requested = new Set(entrySelection.guids);
    const matches = data.devices.filter(d => requested.has(diagnosticGuid(d.adObjectGuid) || ""));
    const available = data.enabled ? matches.filter(d => diagnosticIneligibility(d, jobType) === null) : [];
    setSelected(new Set(available.map(d => d.deviceId!)));
    const missing = requested.size - new Set(matches.map(d => d.adObjectGuid.toLowerCase())).size;
    setNotice(`${available.length} of ${requested.size} unique AD computers selected for measurement; ${matches.length - available.length} currently ineligible and ${missing} absent from the diagnostics inventory. Review the selection and choose Measure selected; no test has started.`);
  }, [data, entrySelection, jobType]);
  const saveSettings = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedulerArmed, rotationIntervalMinutes }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `Could not save schedule (${response.status}).`); }
      return response.json() as Promise<Settings>;
    },
    onSuccess: result => { setNotice(result.effectiveSchedulerEnabled ? "Automatic Fred-path rotation enabled. External downloads still require an explicit request." : "Schedule saved. Automatic measurements are paused or unavailable in this deployment."); client.invalidateQueries({ queryKey: ["building-diagnostics"] }); },
  });
  const changeCredential = useMutation({
    mutationFn: async () => {
      if (!credentialAction) throw new Error("Select a credential action first.");
      const { device, action } = credentialAction;
      const endpoint = action === "enroll" ? "devices/provision" : `devices/${encodeURIComponent(device.deviceId!)}/${action}`;
      const body = action === "enroll" ? { adObjectGuid: device.adObjectGuid, computerName: device.computerName, domain: device.adDomain } : { reason: credentialReason.trim() };
      const response = await authFetch(`${API}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `Could not ${action} this computer (${response.status}).`); }
      const result = await response.json();
      let computerName = device.computerName;
      if (action !== "revoke") {
        if (!diagnosticGuid(result.deviceId) || typeof result.deviceToken !== "string" || !/^sccc-diag\.[A-Za-z0-9_-]{43}$/.test(result.deviceToken)) throw new Error("The server credential response could not be verified. Do not retry enrollment; refresh the inventory and rotate the credential if needed.");
        computerName = result.computerName || (device.adVerified ? device.computerName : "");
        const domain = result.domain || (device.adVerified ? device.adDomain : "");
        if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(computerName) || typeof domain !== "string" || !domain.trim() || domain.length > 120) throw new Error("The server did not confirm the current AD computer name and domain. Refresh the directory before replacing this credential.");
        const content = { serverUrl: "https://insights.sccc.edu", deviceId: result.deviceId, deviceToken: result.deviceToken, computerName, domain };
        const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `${computerName}-diagnostics-provisioning.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      return { action, computerName };
    },
    onSuccess: ({ action, computerName }) => { setCredentialAction(null); setCredentialReason(""); setNotice(action === "revoke" ? `${computerName}: diagnostic credential revoked. Alert reception is unchanged.` : `${computerName}: provisioning file downloaded once. Move this secret file into the protected deployment workflow. Enrollment is not installation; wait for an authenticated agent check-in.`); client.invalidateQueries({ queryKey: ["building-diagnostics"] }); },
  });
  const enrollBatch = useMutation({
    retry: false,
    mutationFn: async ({ requestId, adObjectGuids }: { requestId: string; adObjectGuids: string[] }) => {
      const response = await authFetch(`${API}/devices/bulk-enrollment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, adObjectGuids }) });
      if (!response.ok) throw new Error(`Enrollment request could not be confirmed (${response.status}). Check this request's status before starting another.`);
      const result: EnrollmentBatch = await response.json();
      if (result.requestId !== requestId) throw new Error("The enrollment request identity could not be confirmed. Check its status before retrying.");
      return result;
    },
    onSuccess: result => { setNotice(`Enrollment request accepted for ${result.requested} computers; ${result.counts.queued} queued for installation and reporting. No measurements were selected or started.`); client.invalidateQueries({ queryKey: ["building-diagnostics"] }); },
  });
  const enrollmentStatus = useQuery<EnrollmentBatch>({
    queryKey: ["diagnostic-bulk-enrollment", enrollmentRequestId], enabled: canManage && !!enrollmentRequestId && !enrollBatch.isPending, retry: false,
    queryFn: async () => {
      const response = await authFetch(`${API}/devices/bulk-enrollment/${enrollmentRequestId}`);
      if (!response.ok) throw new Error("Enrollment status is unavailable. Keep this request ID for IT; do not submit the same computers again.");
      const result: EnrollmentBatch = await response.json();
      if (result.requestId !== enrollmentRequestId) throw new Error("Enrollment status identity does not match this request.");
      return result;
    },
    refetchInterval: query => {
      if (!["completed", "partial", "failed", "cancelled"].includes(query.state.data?.status || "")) return 5_000;
      const now = Date.now();
      return query.state.data?.items.some(item => {
        if (item.status !== "installed" || item.reason !== "installed-awaiting-check-in") return false;
        const key = `${query.state.data!.requestId}:${item.adObjectGuid}`;
        if (!enrollmentCheckInDeadlines.current.has(key)) {
          const updated = Date.parse(item.updatedAt || "");
          const started = Number.isFinite(updated) && updated <= now ? updated : enrollmentStartedAt.current;
          enrollmentCheckInDeadlines.current.set(key, started + 15 * 60_000);
        }
        return now < enrollmentCheckInDeadlines.current.get(key)!;
      }) ? 5_000 : false;
    },
  });
  const enrollmentBusy = enrollBatch.isPending || (!!enrollmentRequestId && !["completed", "partial", "failed", "cancelled"].includes(enrollmentStatus.data?.status || ""));
  function selectVisibleEnrollment(value: boolean) {
    setEnrollmentSelected(previous => { const next = new Set(previous); for (const device of visibleEnrollment) { const id = device.adObjectGuid.toLowerCase(); value ? next.add(id) : next.delete(id); } return next; });
  }
  function selectVisibleMeasurements(value: boolean) {
    setSelected(previous => { const next = new Set(previous); for (const device of visibleMeasurements) { value ? next.add(device.deviceId) : next.delete(device.deviceId); } return next; });
  }
  function enrollSelected() {
    if (!selectedEnrollment.length || selectedEnrollment.length > 1000 || enrollmentBusy) return;
    const requestId = crypto.randomUUID(); const url = new URL(window.location.href); url.searchParams.set("enrollmentRequest", requestId);
    window.history.replaceState(null, "", url); enrollmentStartedAt.current = Date.now(); enrollmentCheckInDeadlines.current.clear(); setEnrollmentRequestId(requestId); enrollBatch.reset();
    enrollBatch.mutate({ requestId, adObjectGuids: selectedEnrollment.map(d => d.adObjectGuid.toLowerCase()) });
  }
  const queue = useMutation({
    mutationFn: async (deviceIds: string[]) => {
      const body = { deviceIds, type: jobType, ...(isSustained ? { maxBytes: sustainedMiB * 1024 * 1024, scheduledAt: new Date(scheduledAt).toISOString(), sustainedConfirmed } : {}) };
      const response = await authFetch(`${API}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Could not queue measurements (${response.status}).`);
      }
      return response.json();
    },
    onSuccess: result => { setNotice(`${result.queued} measurements queued. Computers run one bounded test at a time.`); setSelected(new Set()); client.invalidateQueries({ queryKey: ["building-diagnostics"] }); },
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(`${API}/jobs/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Cancelled from network diagnostics portal" }) });
      if (!response.ok) throw new Error(`Could not request cancellation (${response.status}).`);
    },
    onSuccess: () => { setNotice("Cancellation requested. The probe keeps its test slot until it acknowledges or expires."); client.invalidateQueries({ queryKey: ["building-diagnostics"] }); },
  });
  const sustainedReady = !isSustained || (!!data?.externalProbe?.sustainedEnabled && selectedEligible.length === 1 && sustainedConfirmed && Date.parse(scheduledAt) > Date.now() + 60_000 && Date.parse(scheduledAt) < Date.now() + 24 * 60 * 60_000);

  function chooseBuildingSamples() {
    const groups = new Map<string, (Device & { deviceId: string })[]>();
    for (const device of devices) {
      const name = groupingBuilding(device);
      if (!eligible(device) || !name) continue;
      const group = groups.get(name) || [];
      group.push(device); groups.set(name, group);
    }
    const next = new Set<string>();
    for (const group of groups.values()) next.add(group[Math.floor(Math.random() * group.length)].deviceId);
    setSelected(next); setNotice(`Checked ${next.size} unique computers, one per assigned building. Click Measure selected to start.`);
  }

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/network/buildings" className="text-sm text-muted-foreground hover:underline">Campus buildings</Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold"><Activity className="h-6 w-6" /> Building speed & computers</h1>
        <p className="mt-1 text-sm text-muted-foreground">AD computer presence, current building evidence, and measured HTTPS performance.</p></div>
      <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching || !canManage}><RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    {!canManage && <p role="alert">Network administrator access is required.</p>}
    {query.isPending && canManage && <p role="status">Loading computer reports…</p>}
    {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {data && <>
      <div className="flex flex-wrap gap-2"><Badge variant={data.enabled ? "default" : "secondary"}>Reporting {data.enabled ? "enabled" : "staged"}</Badge>
        <Badge variant="outline">Automatic Fred-path measurements {data.schedulerEnabled ? "enabled" : "paused"}</Badge>
        <Badge variant="outline">{uniqueDevices.filter(d => d.online).length} reporting online / {uniqueDevices.length} unique computers</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Inventory updated {time(data.inventoryUpdatedAt)}. Online means a recent authenticated check-in; AD membership is verified centrally. External probes measure end-to-end HTTPS download performance. Endpoint hardware, Wi-Fi, hosting and the Internet path can limit the result; these measurements do not certify a 10 Gb link.</p>
      <Card><CardHeader><CardTitle>Reporting readiness</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        {data.readiness ? <><div className="grid gap-3 md:grid-cols-3">
          <div><strong>AD inventory · {data.readiness.inventory.state}</strong><p>Directory observed {time(data.readiness.inventory.adObservedAt)}</p><p>Network evidence {time(data.readiness.inventory.networkObservedAt)}</p></div>
          <div><strong>Central worker · {data.readiness.worker.state}</strong><p>{data.readiness.workerConfigured ? "Credential configured" : "Worker credential not configured"}</p><p>Authenticated request {time(data.readiness.worker.lastSeenAt)}</p></div>
          <div><strong>Switch collector · {data.readiness.collector.state}</strong><p>Observed {time(data.readiness.collector.lastSeenAt)}</p><p>{data.readiness.collector.switchesObserved ?? "—"} switches · {data.readiness.collector.portObservations ?? "—"} port observations · {data.readiness.collector.wifiObservations ?? "—"} wireless observations</p></div>
        </div><p>{data.readiness.counts.enrolled} enrolled · {data.readiness.counts.online} online · {data.readiness.counts.adTrusted} AD trusted · {data.readiness.counts.eligible} measurement eligible · {data.readiness.counts.unlocated} without a current building.</p></> : <p>Detailed collector readiness has not been reported by this server.</p>}
        <p className="text-muted-foreground">SNMP credentials remain on the central collector. Switch counters and endpoint throughput are separate measurements. A worker request alone does not prove a successful switch collection.</p>
      </CardContent></Card>
      {data.settings && <Card><CardHeader><CardTitle>Automatic building rotation</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p>One eligible computer per building with current network evidence. The rotation measures the Fred HTTPS path; external and sustained downloads remain explicit requests.</p>
        <label className="flex items-center gap-2"><input type="checkbox" aria-label="Enable automatic building rotation" checked={schedulerArmed} disabled={user?.role !== "cio" || saveSettings.isPending} onChange={event => setSchedulerArmed(event.target.checked)} />Enable automatic building rotation</label>
        <label className="flex items-center gap-3">Rotation interval <select aria-label="Rotation interval" className="rounded-md border bg-background p-2" value={rotationIntervalMinutes} disabled={user?.role !== "cio" || saveSettings.isPending} onChange={event => setRotationIntervalMinutes(Number(event.target.value))}>{[60, 180, 360, 720, 1440].map(minutes => <option key={minutes} value={minutes}>{minutes / 60} hour{minutes > 60 ? "s" : ""}</option>)}</select></label>
        {user?.role === "cio" ? <Button onClick={() => saveSettings.mutate()} disabled={!data.enabled || saveSettings.isPending}>Save rotation schedule</Button> : <p className="text-muted-foreground">The CIO controls automatic rotation. Network administrators can request measurements below.</p>}
        <p>Effective state: {data.settings.effectiveSchedulerEnabled ? "running" : "paused"}. Deployment scheduler {data.settings.deploymentSchedulerEnabled ? "enabled" : "disabled"}. Saved {time(data.settings.updatedAt)}{data.settings.updatedBy ? ` by ${data.settings.updatedBy}` : ""}.</p>
        {saveSettings.error && <p role="alert" className="text-destructive">{saveSettings.error.message}</p>}
      </CardContent></Card>}
      <Card><CardHeader><CardTitle>Building measurements</CardTitle></CardHeader><CardContent>
        {data.buildings.length === 0 ? <p>No building evidence has been imported yet.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Building</TableHead><TableHead>Online / eligible</TableHead><TableHead>Download</TableHead><TableHead>Upload</TableHead><TableHead>Latency / request loss</TableHead><TableHead>Measured</TableHead></TableRow></TableHeader><TableBody>
          {data.buildings.map(b => <TableRow key={b.building}><TableCell className="font-medium">{b.building}</TableCell><TableCell>{b.onlineDevices} / {b.eligibleDevices}</TableCell><TableCell>{metric(b.lastResult?.downloadMbps, "Mbps")}<div className="text-xs text-muted-foreground">{b.lastResult?.external ? `${b.lastResult.external.type} · ${b.lastResult.external.targetOrigin}` : b.lastResult?.targetLabel}</div></TableCell><TableCell>{metric(b.lastResult?.uploadMbps, "Mbps")}</TableCell><TableCell>{metric(b.lastResult?.latencyMs, "ms")} / {metric(b.lastResult?.requestLossPercent, "%")}</TableCell><TableCell>{b.noCurrentMeasurement ? "No current measurement" : time(b.lastResult?.recordedAt)}{b.lastResult?.error && <p className="text-destructive">{b.lastResult.error}</p>}</TableCell></TableRow>)}
        </TableBody></Table></div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Computer inventory</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="space-y-3 rounded-md border p-3">
          <label className="flex flex-wrap items-center gap-3 text-sm">Measurement
            <select aria-label="Measurement type" className="rounded-md border bg-background p-2" value={jobType} onChange={e => { setMeasurementType(e.target.value); setSustainedConfirmed(false); setSelected(new Set()); }}>
              <option value="external-quick" disabled={!data.externalProbe?.configured}>External quick download · 5 MiB</option>
              <option value="external-sustained" disabled={!data.externalProbe?.sustainedEnabled}>Scheduled external download</option>
              <option value="fred">Fred HTTPS download and upload · 8 MiB each</option>
            </select>
          </label>
          {jobType !== "fred" && <p className="text-sm text-muted-foreground">Target: {data.externalProbe?.origin || "Not configured"}. External probes run only on selected computers. Automatic Fred-path rotation does not schedule external downloads.</p>}
          {isSustained && <div className="space-y-3 text-sm">
            <p>Select exactly one computer and schedule at least one minute ahead. Tests are serialized and subject to the daily data limit.</p>
            <div className="flex flex-wrap gap-3"><label>Data limit <select aria-label="Sustained data limit" className="rounded-md border bg-background p-2" value={sustainedMiB} onChange={e => { setSustainedMiB(Number(e.target.value)); setSustainedConfirmed(false); }}>{[64, 128, 256, 512, 1024].map(size => <option key={size} value={size}>{size} MiB</option>)}</select></label>
              <label>Scheduled local time <input aria-label="Scheduled local time" className="rounded-md border bg-background p-2" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></label></div>
            <label className="flex items-start gap-2"><input type="checkbox" aria-label="Approve sustained data use" checked={sustainedConfirmed} onChange={e => setSustainedConfirmed(e.target.checked)} />I approve a download of up to {sustainedMiB} MiB from the 1 GiB object on this selected computer.</label>
          </div>}
        </div>
        <div className="flex flex-wrap gap-3"><Input className="max-w-sm" aria-label="Search computers or users" placeholder="Computer, user, or building" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="rounded-md border bg-background px-3 text-sm" aria-label="Filter building" value={building} onChange={e => setBuilding(e.target.value)}><option value="">All buildings</option><option value="__unassigned__">Building not assigned</option>{buildingChoices.map(name => <option key={name}>{name}</option>)}</select>
          <Button variant="outline" onClick={chooseBuildingSamples} disabled={!data.enabled}><Shuffle className="mr-2 h-4 w-4" />Choose one per building</Button>
          <Button onClick={() => { setNotice(""); queue.mutate(selectedEligible.map(d => d.deviceId)); }} disabled={!data.enabled || !selectedEligible.length || selectedEligible.length > 100 || !sustainedReady || queue.isPending}>Measure selected ({selectedEligible.length})</Button>
        </div>
        {selectedEligible.length > 100 && <p className="text-sm">A measurement request supports up to 100 computers. Narrow the speed-test selection before measuring.</p>}
        <p className="text-sm">Showing {devices.length} unique computers. Check the boxes for the action you want, then click its button. Clicking a row does not select a computer.</p>
        <div className="flex flex-wrap gap-4 rounded-md border p-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" aria-label="Check all shown eligible computers for enrollment" checked={allVisibleEnrollmentSelected} ref={element => { if (element) element.indeterminate = visibleEnrollmentCount > 0 && !allVisibleEnrollmentSelected; }} disabled={!visibleEnrollment.length || enrollmentBusy} onChange={event => selectVisibleEnrollment(event.target.checked)} />Enroll: select all eligible shown ({visibleEnrollmentCount}/{visibleEnrollment.length})</label>
          <label className="flex items-center gap-2"><input type="checkbox" aria-label="Check all shown eligible computers for measurement" checked={allVisibleMeasurementsSelected} ref={element => { if (element) element.indeterminate = visibleMeasurementCount > 0 && !allVisibleMeasurementsSelected; }} disabled={!data.enabled || !visibleMeasurements.length || queue.isPending} onChange={event => selectVisibleMeasurements(event.target.checked)} />Measure: select all eligible shown ({visibleMeasurementCount}/{visibleMeasurements.length})</label>
        </div>
        <section aria-label="Bulk diagnostic enrollment" className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={enrollSelected} disabled={!selectedEnrollment.length || selectedEnrollment.length > 1000 || enrollmentBusy}>Enroll selected ({selectedEnrollment.length})</Button>
            <span className="text-sm">Install and enroll selected computers for diagnostic reporting. Each Select all applies only to its eligible shown computers; enrollment and speed-test selections are independent. No measurement starts until you choose Measure selected.</span></div>
          {selectedEnrollment.length > 1000 && <p className="text-sm">Select up to 1,000 computers per enrollment request.</p>}
          {!Number.isFinite(directoryAge) || directoryAge > 24 * 60 * 60_000 || directoryAge < -60_000 ? <p className="text-sm">Refresh the central AD inventory before bulk enrollment.</p> : null}
          {enrollBatch.error && <p role="alert" className="text-destructive">{enrollBatch.error.message}</p>}
          {enrollmentRequestId && <div className="text-sm"><p>Enrollment request <code>{enrollmentRequestId}</code> · {enrollmentStatus.data?.status || "Checking status"}</p>
            {enrollmentStatus.data?.worker.ready === false && <p>The central deployment worker is unavailable. No installation is confirmed until its result is reported.</p>}
            {enrollmentStatus.error && <p role="alert" className="text-destructive">{enrollmentStatus.error.message}</p>}
            {!!enrollmentStatus.data?.items?.length && <details><summary>Enrollment results ({enrollmentStatus.data.items.length})</summary><ul className="mt-2 space-y-1">{enrollmentStatus.data.items.map(item => <li key={item.adObjectGuid}>{item.computerName} · {item.status}{item.reason && !(item.status === "online" && item.reason === "installed-awaiting-check-in") ? ` · ${item.reason}` : ""}</li>)}</ul></details>}</div>}
        </section>
        <section aria-label="Assign computer buildings" className="space-y-3 rounded-md border p-3">
          <h3 className="font-semibold">Assign buildings</h3>
          <p className="text-sm text-muted-foreground">Use Fred's building names for the selected AD computers. AD groups are shown as directory evidence; current switch or Wi-Fi evidence appears separately. Assigning a building does not start a test.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Select all shown AD computers for building assignment" checked={allVisibleBuildingsSelected} ref={element => { if (element) element.indeterminate = visibleBuildingCount > 0 && !allVisibleBuildingsSelected; }} disabled={!visibleBuilding.length || assignBuilding.isPending} onChange={event => selectVisibleBuildings(event.target.checked)} />Select all eligible shown for building assignment ({visibleBuildingCount}/{visibleBuilding.length})</label>
          <div className="flex flex-wrap items-center gap-3"><label className="text-sm">Building <select aria-label="Assign building" className="ml-2 rounded-md border bg-background p-2" value={assignmentBuilding} disabled={!assignmentsQuery.data || assignBuilding.isPending} onChange={event => setAssignmentBuilding(event.target.value)}><option value="">Choose a building</option>{(assignmentsQuery.data?.buildings || []).map(name => <option key={name}>{name}</option>)}<option value="__clear__">Clear manual assignment</option></select></label>
            <Input aria-label="Building assignment reason" className="max-w-sm" maxLength={300} value={assignmentReason} onChange={event => setAssignmentReason(event.target.value)} />
            <Button onClick={() => assignBuilding.mutate()} disabled={!assignmentsQuery.data || !selectedBuildingDevices.length || selectedBuildingDevices.length > 1000 || !assignmentBuilding || assignmentReason.trim().length < 3 || assignBuilding.isPending}>Assign building ({selectedBuildingDevices.length})</Button>
          </div>
          <p className="text-xs text-muted-foreground">{assignmentsQuery.data?.assignments?.length ?? 0} unique computers have a saved assignment. Up to 1,000 per action; sign-in and network administrator access are required.</p>
          <div className="space-y-2 border-t pt-3">
            <h3 className="font-semibold">AD group buildings</h3>
            <p className="text-sm text-muted-foreground">Map an AD computer group to a Fred building once. Its current and future members inherit that building; a manual computer assignment takes priority. You can edit or clear the mapping here.</p>
            <div className="flex flex-wrap items-center gap-3"><label className="text-sm">AD group <select aria-label="AD building group" className="ml-2 max-w-sm rounded-md border bg-background p-2" value={assignmentGroup} disabled={!assignmentsQuery.data?.directory?.current || assignGroup.isPending} onChange={event => { const id = event.target.value; setAssignmentGroup(id); setGroupBuilding(assignmentsQuery.data?.groupMappings?.find(m => m.groupObjectGuid === id)?.building || ""); }}><option value="">Choose an AD group</option>{assignmentGroups.map(group => <option key={group.groupObjectGuid} value={group.groupObjectGuid}>{group.name} ({group.computerCount})</option>)}</select></label>
              <label className="text-sm">Building <select aria-label="AD group building" className="ml-2 rounded-md border bg-background p-2" value={groupBuilding} disabled={!assignmentGroup || assignGroup.isPending} onChange={event => setGroupBuilding(event.target.value)}><option value="">Choose a building</option>{(assignmentsQuery.data?.buildings || []).map(name => <option key={name}>{name}</option>)}<option value="__clear__">Clear group mapping</option></select></label>
              <Button variant="outline" onClick={() => assignGroup.mutate()} disabled={!assignmentsQuery.data?.directory?.current || !assignmentGroup || !groupBuilding || (!currentAssignmentGroup && groupBuilding !== "__clear__") || assignmentReason.trim().length < 3 || assignGroup.isPending}>Save AD group mapping</Button>
            </div>
            <p className="text-xs text-muted-foreground">{assignmentsQuery.data?.groupMappings?.length ?? 0} group mappings · {assignmentsQuery.data?.groups?.length ?? 0} unique AD groups · directory observed {time(assignmentsQuery.data?.directory?.observedAt)}{assignmentsQuery.data?.directory?.current ? "" : " · Waiting for current AD group reporting"}.</p>
            {!!assignmentsQuery.data?.groupConflicts?.length && <p role="alert" className="text-sm">{assignmentsQuery.data.groupConflicts.length} unique computers belong to groups mapped to different buildings. Give those computers a manual assignment or correct the group mappings.</p>}
            {assignGroup.error && <p role="alert" className="text-destructive">{assignGroup.error.message}</p>}
          </div>
          {assignmentsQuery.error && <p role="alert" className="text-destructive">{assignmentsQuery.error.message}</p>}{assignBuilding.error && <p role="alert" className="text-destructive">{assignBuilding.error.message}</p>}
        </section>
        {notice && <p role="status" className="text-sm">{notice}</p>}{queue.error && <p role="alert" className="text-destructive">{queue.error.message}</p>}
        {credentialAction && <section role="region" aria-label="Review diagnostic enrollment" className="space-y-3 rounded-md border bg-muted/30 p-4">
          <h3 className="font-semibold">{credentialAction.action === "enroll" ? "Enroll" : credentialAction.action === "rotate" ? "Replace diagnostic credential for" : "Revoke diagnostic access for"} {credentialAction.device.computerName}</h3>
          <p>AD object: <code>{credentialAction.device.adObjectGuid}</code></p>
          <p>{credentialAction.action === "revoke" ? "This stops diagnostic reporting and cancels its pending measurements. It does not revoke alert reception." : credentialAction.action === "rotate" ? "This invalidates the existing diagnostic credential and cancels pending measurements. A replacement secret provisioning file downloads once; deploy it through the protected workstation workflow." : "A secret provisioning file downloads once. Deploy the diagnostic agent and protected file through AD/GPO; a receiver registration alone does not install this agent."}</p>
          {credentialAction.action !== "enroll" && <label className="block text-sm">Reason <Input aria-label="Diagnostic credential change reason" maxLength={300} value={credentialReason} onChange={event => setCredentialReason(event.target.value)} /></label>}
          <div className="flex gap-2"><Button onClick={() => changeCredential.mutate()} disabled={changeCredential.isPending || (credentialAction.action !== "enroll" && credentialReason.trim().length < 3)}>Confirm {credentialAction.action}</Button><Button variant="outline" disabled={changeCredential.isPending} onClick={() => { setCredentialAction(null); setCredentialReason(""); changeCredential.reset(); }}>Cancel credential change</Button></div>
          {changeCredential.error && <p role="alert" className="text-destructive">{changeCredential.error.message}</p>}
        </section>}
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead><label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all eligible shown computers for enrollment" checked={allVisibleEnrollmentSelected} ref={element => { if (element) element.indeterminate = visibleEnrollmentCount > 0 && !allVisibleEnrollmentSelected; }} disabled={!visibleEnrollment.length || enrollmentBusy} onChange={event => selectVisibleEnrollment(event.target.checked)} />Enroll ({visibleEnrollmentCount}/{visibleEnrollment.length})</label></TableHead><TableHead><label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all eligible shown computers for speed tests" checked={allVisibleMeasurementsSelected} ref={element => { if (element) element.indeterminate = visibleMeasurementCount > 0 && !allVisibleMeasurementsSelected; }} disabled={!data.enabled || !visibleMeasurements.length || queue.isPending} onChange={event => selectVisibleMeasurements(event.target.checked)} />Measure ({visibleMeasurementCount}/{visibleMeasurements.length})</label></TableHead><TableHead>Computer / current user</TableHead><TableHead>Presence / AD</TableHead><TableHead>Building evidence</TableHead><TableHead>Switch / port</TableHead><TableHead>Last check-in / agent</TableHead><TableHead>Diagnostic enrollment</TableHead></TableRow></TableHeader><TableBody>
          {devices.map(d => <TableRow key={d.deviceId || d.adObjectGuid}><TableCell><input type="checkbox" aria-label={`Select ${d.computerName} for enrollment`} checked={enrollmentSelected.has(d.adObjectGuid.toLowerCase()) && enrollmentEligible(d)} disabled={!enrollmentEligible(d) || enrollmentBusy} onChange={event => setEnrollmentSelected(previous => { const next = new Set(previous); const id = d.adObjectGuid.toLowerCase(); event.target.checked ? next.add(id) : next.delete(id); return next; })} /></TableCell><TableCell><input type="checkbox" aria-label={`Select ${d.computerName}`} title={diagnosticIneligibility(d, jobType) || "Select for measurement"} checked={!!d.deviceId && selected.has(d.deviceId)} disabled={!data.enabled || !eligible(d)} onChange={e => { const id = d.deviceId; if (id) setSelected(previous => { const next = new Set(previous); e.target.checked ? next.add(id) : next.delete(id); return next; }); }} /></TableCell>
            <TableCell><label className="flex items-start gap-2"><input className="mt-1" type="checkbox" aria-label={`Select ${d.computerName} for building assignment`} checked={buildingSelected.has(d.adObjectGuid.toLowerCase()) && buildingEligible(d)} disabled={!buildingEligible(d) || assignBuilding.isPending} onChange={event => setBuildingSelected(previous => { const next = new Set(previous); const id = d.adObjectGuid.toLowerCase(); event.target.checked ? next.add(id) : next.delete(id); return next; })} /><span><span className="block font-medium">{d.computerName}</span><span className="block text-xs text-muted-foreground">{d.loggedOnUser || "No user reported"}</span></span></label></TableCell>
            <TableCell>{d.online ? "Online" : d.enrolled ? "No recent check-in" : "Not enrolled"}<div className="text-xs">{d.adVerified ? "AD verified" : "AD verification unavailable"}</div>{diagnosticIneligibility(d, jobType) && <div className="mt-1 max-w-52 text-xs text-muted-foreground">{diagnosticIneligibility(d, jobType)}</div>}</TableCell>
            <TableCell><div className="font-medium">{assignedBuilding(d) || "Building not assigned"}</div>{assignedBuilding(d) && <div className="text-xs text-muted-foreground">{assignments.get(d.adObjectGuid.toLowerCase())?.source === "active-directory-group" ? `AD group: ${assignments.get(d.adObjectGuid.toLowerCase())?.groups?.map(g => g.name).join(", ") || "Verified membership"}` : "Administrator assigned"} · {time(assignments.get(d.adObjectGuid.toLowerCase())?.updatedAt)}</div>}<div className="mt-1 text-xs">Connection: {d.location.building || "Unknown"} · {locationLabels[d.location.kind] || d.location.kind}{d.location.source ? ` · ${d.location.source}` : ""}</div><div className="text-xs text-muted-foreground">{time(d.location.observedAt)}</div>{d.directory ? <details className="mt-1 text-xs"><summary>AD groups ({d.directory.memberOf.length})</summary><p>{d.directory.memberOf.map(g => g.name).join(", ") || "No direct groups"}</p><p>{d.directory.canonicalName}</p><p>Directory observed {time(d.directory.observedAt)}</p></details> : <div className="text-xs text-muted-foreground">AD groups not reported yet</div>}</TableCell>
            <TableCell>{d.portTelemetry ? <><div>{d.portTelemetry.switchName} · {d.portTelemetry.port}</div><div className="text-xs">{d.portTelemetry.operStatus || "State unreported"} · link {metric(d.portTelemetry.linkMbps, "Mbps")}</div><div className="text-xs">In {metric(d.portTelemetry.inBitsPerSecond === undefined ? null : d.portTelemetry.inBitsPerSecond / 1_000_000, "Mbps")} / out {metric(d.portTelemetry.outBitsPerSecond === undefined ? null : d.portTelemetry.outBitsPerSecond / 1_000_000, "Mbps")}</div><div className="text-xs text-muted-foreground">{d.portTelemetry.source} · {time(d.portTelemetry.observedAt)}</div><details className="text-xs"><summary>Port counters</summary><p>Errors in/out: {d.portTelemetry.inErrors ?? "—"} / {d.portTelemetry.outErrors ?? "—"}</p><p>Discards in/out: {d.portTelemetry.inDiscards ?? "—"} / {d.portTelemetry.outDiscards ?? "—"}</p></details></> : <span className="text-xs text-muted-foreground">No current port evidence</span>}</TableCell>
            <TableCell>{time(d.lastCheckIn)}<div className="text-xs text-muted-foreground">{d.agentVersion || "Agent not reported"}</div></TableCell>
            <TableCell><div className="flex flex-col items-start gap-2">{!d.enrolled ? <Button size="sm" variant="outline" disabled={!data.enabled || !d.adVerified || !diagnosticGuid(d.adObjectGuid) || !d.adDomain || changeCredential.isPending} onClick={() => { changeCredential.reset(); setCredentialReason(""); setCredentialAction({ device: d, action: "enroll" }); }}>Enroll {d.computerName}</Button> : <><Button size="sm" variant="outline" disabled={!data.enabled || !diagnosticGuid(d.adObjectGuid) || changeCredential.isPending} onClick={() => { changeCredential.reset(); setCredentialReason(""); setCredentialAction({ device: d, action: "rotate" }); }}>Replace credential</Button><Button size="sm" variant="outline" disabled={!data.enabled || d.revoked || changeCredential.isPending} onClick={() => { changeCredential.reset(); setCredentialReason(""); setCredentialAction({ device: d, action: "revoke" }); }}>Revoke diagnostics</Button></>}</div></TableCell>
          </TableRow>)}
          {devices.length === 0 && <TableRow><TableCell colSpan={8}>No matching computers. AD inventory and diagnostic enrollment are separate from the alert receiver.</TableCell></TableRow>}
        </TableBody></Table></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Recent measurement jobs</CardTitle></CardHeader><CardContent>{data.jobs.length === 0 ? <p>No measurements requested.</p> : <ul className="space-y-2 text-sm">{data.jobs.slice(0, 30).map(job => <li key={job.id}><strong>{job.computerName}</strong> · {job.building || "Unlocated"} · {job.type || "fred"} · {job.status} · {time(job.createdAt)} · {job.requestedBy}{job.scheduledAt && <span> · Scheduled {time(job.scheduledAt)}</span>}{["queued", "running"].includes(job.status) && <Button className="ml-2" variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}>Cancel {job.computerName}</Button>}</li>)}</ul>}{cancel.error && <p role="alert" className="text-destructive">{cancel.error.message}</p>}</CardContent></Card>
      {!!data.audit?.length && <Card><CardHeader><CardTitle>Diagnostic administration history</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{data.audit.slice(0, 20).map(item => <li key={item.id}><strong>{item.computerName || "Reporting configuration"}</strong> · {item.action} · {item.actor} · {time(item.createdAt)}<p className="text-muted-foreground">{item.reason}</p></li>)}</ul></CardContent></Card>}
      {data.devices.some(d => d.lastResult?.external) && <Card><CardHeader><CardTitle>External probe details</CardTitle></CardHeader><CardContent className="space-y-3">{data.devices.filter(d => d.lastResult?.external).map(d => {
        const result = d.lastResult!, external = result.external!, adapter = external.activeAdapter;
        return <details key={d.deviceId || d.adObjectGuid} className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">{d.computerName} · {metric(external.mbps, "Mbps")} · {external.failure || "Completed"} · {time(external.timestamp)}</summary>
          <dl className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2"><div><dt className="text-muted-foreground">Target / HTTP status</dt><dd>{external.targetOrigin}{external.path} · {external.httpStatus ?? "No response"}</dd></div><div><dt className="text-muted-foreground">DNS answers / connected peer</dt><dd>{external.dnsAddresses?.join(", ") || "Not available"} / {external.remoteAddress || "Not connected"}</dd></div><div><dt className="text-muted-foreground">Received / elapsed</dt><dd>{external.bytesReceived.toLocaleString()} bytes / {metric(external.elapsedMs, "ms")}</dd></div><div><dt className="text-muted-foreground">DNS / TCP / TLS / first byte</dt><dd>{metric(external.dnsMs, "ms")} / {metric(external.tcpConnectMs, "ms")} / {metric(external.tlsMs, "ms")} / {metric(external.ttfbMs, "ms")}</dd></div><div><dt className="text-muted-foreground">Active interface</dt><dd>{adapter?.interfaceAlias || "Not available"} · {adapter?.kind || "unknown"} · {adapter?.localIp || "No address"}{adapter?.subnetPrefixLength !== undefined ? `/${adapter.subnetPrefixLength}` : ""} · gateway {adapter?.gateway || "Not available"}</dd></div>{adapter?.ssid && <div><dt className="text-muted-foreground">Wi-Fi</dt><dd>{adapter.ssid} · {adapter.bssid || "BSSID unavailable"}</dd></div>}</dl>
        </details>;
      })}</CardContent></Card>}
    </>}
  </div>;
}
