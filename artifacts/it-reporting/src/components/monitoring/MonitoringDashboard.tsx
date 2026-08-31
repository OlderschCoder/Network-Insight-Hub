import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  Activity,
  Building2,
  Gauge,
  Radar,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/authFetch";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { CampusStatusMap, getCampusMapDisplayEntries } from "@/pages/network/buildings";

const API = "/api";
const AUTH_MONITORING_API = `${API}/network/monitoring/summary`;
const PUBLIC_MONITORING_API = `${API}/network/public/monitoring/summary`;
const REFRESH_MS = 30000;
const ERROR_RETRY_MS = 5000;
const GREEN_SWITCH_THRESHOLD = 40;

type HealthColor = "green" | "amber" | "red" | "unknown";
type LiveStatus = "up" | "degraded" | "down" | "unknown";

interface MonitoringBuildingSummary {
  name: string;
  nodeCount: number;
  vlanCount: number;
  healthColor: HealthColor;
  category?: string;
  monitoringStrategy?: string;
}

interface MonitoringSnapshot {
  configured: boolean;
  reachable: boolean;
  lastUpdatedAt: string | null;
  overview: {
    totalDevices: number;
    monitoredDevices: number;
    upDevices: number;
    degradedDevices: number;
    downDevices: number;
    unknownDevices: number;
    totalBuildings: number;
    healthyBuildings: number;
    degradedBuildings: number;
    downBuildings: number;
    unknownBuildings: number;
    totalVlans: number;
  };
  traffic: {
    campusBackboneLoadBps: number | null;
    firewallThroughputBps: number | null;
    firewallUploadBps: number | null;
    firewallDownloadBps: number | null;
  };
  trend: Array<{
    time: string;
    averageResponseMs: number | null;
    percentPacketLoss: number | null;
  }>;
  vendors: Array<{
    vendor: string;
    total: number;
    up: number;
    degraded: number;
    down: number;
    unknown: number;
  }>;
  deviceKinds: Array<{
    kind: string;
    total: number;
  }>;
  buildings: MonitoringBuildingSummary[];
  alertingDevices: Array<{
    id: string;
    hostname: string;
    displayName: string;
    building: string;
    vendor: string | null;
    role: string | null;
    kind: string;
    liveStatus: LiveStatus;
    lastSeen: string | null;
  }>;
}

async function monitoringResponseError(response: Response) {
  const statusMessage = `Live monitoring is temporarily unavailable (HTTP ${response.status}).`;
  const contentType = response.headers.get("content-type") ?? "";

  // Never place an HTML proxy error page into the application UI. JSON errors
  // from our own API may contain a useful, intentionally user-facing message.
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === "string" && body.error.trim()) {
      return `${statusMessage} ${body.error.trim()} Retrying automatically.`;
    }
  }

  return `${statusMessage} Retrying automatically.`;
}

function getCampusMapBuildings(snapshot: MonitoringSnapshot | null) {
  if (!snapshot) return [];
  return getCampusMapDisplayEntries(snapshot.buildings).map((entry) => ({
    code: entry.code,
    healthColor: entry.match?.healthColor ?? "unknown",
  }));
}

function snapshotMode(snapshot: MonitoringSnapshot | null) {
  if (!snapshot?.configured) return "not-configured";
  if (!snapshot.reachable) return "telemetry-unreachable";
  const campusMapBuildings = getCampusMapBuildings(snapshot);
  const campusMapAllGreen =
    campusMapBuildings.length > 0 &&
    campusMapBuildings.every((building) => building.healthColor === "green");
  if (snapshot.overview.upDevices >= GREEN_SWITCH_THRESHOLD && campusMapAllGreen) return "healthy";
  if (campusMapBuildings.some((building) => building.healthColor === "red") || snapshot.overview.upDevices < GREEN_SWITCH_THRESHOLD) {
    return "attention";
  }
  if (
    campusMapBuildings.some((building) => building.healthColor === "amber" || building.healthColor === "unknown") ||
    snapshot.overview.degradedDevices > 0
  ) {
    return "degraded";
  }
  return "healthy";
}

function modeCopy(
  snapshot: MonitoringSnapshot | null,
  options: { loading: boolean; error: string | null },
) {
  if (!snapshot && options.loading) {
    return {
      title: "Loading live monitoring",
      detail: "Pulling the latest monitoring snapshot from APP_Server2 and InfluxDB now.",
      badge: "Connecting",
      tone: "from-slate-950 via-slate-900 to-slate-800",
    };
  }
  if (!snapshot && options.error) {
    return {
      title: "Monitoring snapshot unavailable",
      detail: "The live board could not load its current monitoring snapshot yet.",
      badge: "Retrying",
      tone: "from-amber-950 via-amber-900 to-slate-900",
    };
  }
  const mode = snapshotMode(snapshot);
  if (mode === "not-configured") {
    return {
      title: "Monitoring not configured",
      detail: "Set the InfluxDB environment variables on APP_Server2 to light up the live board.",
      badge: "Configuration needed",
      tone: "from-slate-950 via-slate-900 to-slate-800",
    };
  }
  if (mode === "telemetry-unreachable") {
    return {
      title: "Telemetry feed unavailable",
      detail: "Inventory is still available, but the live InfluxDB stream did not return current data.",
      badge: "Live feed offline",
      tone: "from-amber-950 via-amber-900 to-slate-900",
    };
  }
  if (mode === "attention") {
    return {
      title: "Attention needed",
      detail: `The campus-map buildings are not all green yet or the live switch count is below the ${GREEN_SWITCH_THRESHOLD}-switch green threshold.`,
      badge: "Active outage",
      tone: "from-red-950 via-red-900 to-slate-900",
    };
  }
  if (mode === "degraded") {
    return {
      title: "Minor degradation detected",
      detail: "The green threshold is close, but at least one campus-map building still needs monitoring or is not fully healthy.",
      badge: "Degraded",
      tone: "from-amber-950 via-slate-900 to-slate-800",
    };
  }
  return {
    title: "All monitored systems go",
    detail: `Operational green is met: at least ${GREEN_SWITCH_THRESHOLD} switches are up and every campus-map building is green.`,
    badge: "Healthy",
    tone: "from-emerald-950 via-slate-900 to-slate-800",
  };
}

function statusDotClass(status: LiveStatus) {
  return {
    up: "bg-emerald-500",
    degraded: "bg-amber-400",
    down: "bg-red-500",
    unknown: "bg-slate-300",
  }[status];
}

function compactDate(iso: string | null) {
  if (!iso) return "No live data";
  try {
    return format(new Date(iso), "MMM d, h:mm a");
  } catch {
    return iso;
  }
}

function formatBps(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "No live data";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gb/s`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mb/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} kb/s`;
  return `${Math.round(value)} b/s`;
}

function OverviewCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-full border bg-background/80 p-3 text-primary shadow-sm">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

export function MonitoringDashboard({ publicMode = false }: { publicMode?: boolean }) {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = publicMode
        ? await fetch(PUBLIC_MONITORING_API)
        : await authFetch(AUTH_MONITORING_API, { credentials: "include" });
      if (!response.ok) throw new Error(await monitoringResponseError(response));
      const next = await response.json() as MonitoringSnapshot;
      setSnapshot(next);
      setError(null);
      return true;
    } catch (err: any) {
      setError(err?.message ?? "Unable to load the monitoring snapshot.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [publicMode]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    const refresh = async () => {
      const succeeded = await load();
      if (!cancelled) {
        timeoutId = window.setTimeout(
          refresh,
          succeeded ? REFRESH_MS : ERROR_RETRY_MS,
        );
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [load]);

  const copy = useMemo(
    () => modeCopy(snapshot, { loading, error }),
    [error, loading, snapshot],
  );

  const vendorRows = useMemo(
    () => (snapshot?.vendors ?? []).slice(0, 6),
    [snapshot?.vendors],
  );

  const kindRows = useMemo(
    () => (snapshot?.deviceKinds ?? []).slice(0, 6),
    [snapshot?.deviceKinds],
  );

  const pendingBuildings = useMemo(
    () => (snapshot?.buildings ?? []).filter((building) => building.healthColor === "unknown"),
    [snapshot?.buildings],
  );

  const campusMapBuildings = useMemo(
    () => getCampusMapBuildings(snapshot),
    [snapshot],
  );

  const campusMapGreenCount = useMemo(
    () => campusMapBuildings.filter((building) => building.healthColor === "green").length,
    [campusMapBuildings],
  );

  return (
    <div className="space-y-6">
      <Card className={`overflow-hidden border-0 bg-gradient-to-br ${copy.tone} text-white shadow-xl`}>
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/80">
                <Radar className="h-3.5 w-3.5" />
                SCCC live monitoring
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{copy.title}</h1>
              <p className="mt-3 max-w-2xl text-sm text-white/75 md:text-base">{copy.detail}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-black/15 px-4 py-3 text-right backdrop-blur">
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">Last refresh</p>
              <p className="mt-2 text-lg font-semibold">{compactDate(snapshot?.lastUpdatedAt ?? null)}</p>
              <Badge variant="secondary" className="mt-3 border-white/15 bg-white/10 text-white">
                {copy.badge}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Monitoring snapshot unavailable</p>
              <p className="text-sm">{error}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-400 bg-white/60 hover:bg-white"
              onClick={() => void load()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry now
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !snapshot ? (
        <Card>
          <CardContent className="flex min-h-[240px] items-center justify-center text-muted-foreground">
            Loading monitoring snapshot…
          </CardContent>
        </Card>
      ) : snapshot ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OverviewCard
              title="Devices up"
              value={`${snapshot.overview.upDevices} / ${snapshot.overview.totalDevices}`}
              detail={`${snapshot.overview.upDevices >= GREEN_SWITCH_THRESHOLD ? `Green threshold met (${GREEN_SWITCH_THRESHOLD})` : `${GREEN_SWITCH_THRESHOLD - snapshot.overview.upDevices} more needed for green`} • ${snapshot.overview.downDevices} maintenance/down • ${snapshot.overview.unknownDevices} pending configuration`}
              icon={<Wifi className="h-5 w-5" />}
            />
            <OverviewCard
              title="Campus Map Green"
              value={`${campusMapGreenCount} / ${campusMapBuildings.length}`}
              detail={`${campusMapBuildings.every((building) => building.healthColor === "green") ? "All mapped buildings green" : "One or more mapped buildings still need attention"} • ${snapshot.overview.unknownBuildings} non-map/pending entries`}
              icon={<Building2 className="h-5 w-5" />}
            />
            <OverviewCard
              title="Monitored endpoints"
              value={`${snapshot.overview.monitoredDevices}`}
              detail={`${snapshot.overview.unknownDevices} pending configuration right now`}
              icon={<Server className="h-5 w-5" />}
            />
            <OverviewCard
              title="Tracked VLANs"
              value={`${snapshot.overview.totalVlans}`}
              detail="Inventory-backed network reference"
              icon={<Gauge className="h-5 w-5" />}
            />
          </div>

          <div className="space-y-6">
            <CampusStatusMap buildings={snapshot.buildings} publicMode={publicMode} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Network Traffic</CardTitle>
                <CardDescription>Live throughput pulled from the same InfluxDB telemetry that powers the operations dashboards.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Campus Backbone Load</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight">{formatBps(snapshot.traffic.campusBackboneLoadBps)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Aggregate campus backbone throughput from interface counters.
                  </p>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">ISP Throughput</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight">{formatBps(snapshot.traffic.firewallThroughputBps)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    FortiGate ISP total across Ideatek and United. Up: {formatBps(snapshot.traffic.firewallUploadBps)} • Down: {formatBps(snapshot.traffic.firewallDownloadBps)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Vendor Health Mix</CardTitle>
                <CardDescription>Inventory distribution blended with current live device state.</CardDescription>
              </CardHeader>
              <CardContent>
                {vendorRows.length === 0 ? (
                  <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
                    No vendor inventory found.
                  </div>
                ) : (
                  <ChartContainer
                    className="h-[280px] w-full"
                    config={{
                      up: { label: "Up", color: "#22c55e" },
                      degraded: { label: "Degraded", color: "#f59e0b" },
                      down: { label: "Down", color: "#ef4444" },
                      unknown: { label: "Unknown", color: "#cbd5e1" },
                    }}
                  >
                    <BarChart data={vendorRows} layout="vertical" margin={{ left: 10, right: 8 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis dataKey="vendor" type="category" width={88} />
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Bar dataKey="up" stackId="status" fill="var(--color-up)" radius={[4, 0, 0, 4]} />
                      <Bar dataKey="degraded" stackId="status" fill="var(--color-degraded)" />
                      <Bar dataKey="down" stackId="status" fill="var(--color-down)" />
                      <Bar dataKey="unknown" stackId="status" fill="var(--color-unknown)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Node Roles in Inventory</CardTitle>
                <CardDescription>Current shape of the modeled network on APP_Server2.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {kindRows.map((kind) => (
                  <div key={kind.kind} className="flex items-center justify-between rounded-xl border bg-muted/20 px-3 py-2">
                    <span className="text-sm capitalize text-foreground">{kind.kind.replace(/_/g, " ")}</span>
                    <Badge variant="outline">{kind.total}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Pending Configuration</CardTitle>
                <CardDescription>
                  Buildings using the same campus-map feed that still have unknown live status and need monitoring coverage or inventory cleanup.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingBuildings.length === 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-900">
                    No buildings are waiting on monitoring configuration right now.
                  </div>
                ) : (
                  <>
                    {pendingBuildings.map((building) => (
                      <div key={building.name} className="rounded-xl border bg-background px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{building.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {building.nodeCount} devices
                              {` • ${building.vlanCount} VLANs`}
                              {building.category ? ` • ${building.category.replace(/-/g, " ")}` : ""}
                            </p>
                          </div>
                          <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium text-slate-600">
                            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                            pending
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Monitoring strategy: {building.monitoringStrategy?.replace(/-/g, " ") ?? "not set"}
                        </p>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Device-level pending count: {snapshot.overview.unknownDevices}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {!publicMode && (
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle>Needs Attention</CardTitle>
                  <CardDescription>Top monitored devices that are down, degraded, or missing live telemetry.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {snapshot.alertingDevices.length === 0 ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-900">
                      No active device-level exceptions right now.
                    </div>
                  ) : (
                    snapshot.alertingDevices.map((device) => (
                      <div key={device.id} className="rounded-xl border bg-background px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {device.displayName || device.hostname}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {device.building}
                              {device.kind ? ` • ${device.kind === "svi" ? "SVI" : device.kind === "endpoint" ? "monitored endpoint" : device.kind}` : ""}
                              {device.role && device.role !== device.kind ? ` • ${device.role}` : ""}
                              {device.vendor ? ` • ${device.vendor}` : ""}
                            </p>
                          </div>
                          <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(device.liveStatus)}`} />
                            {device.liveStatus}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Last seen: {compactDate(device.lastSeen)}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}

            {publicMode && (
              <Card className="border-border/60">
                <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
                  <Activity className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    Public embed mode stays read-only and summarizes live health, building status, and trend telemetry without exposing the full authenticated workspace.
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>Status Legend</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><Wifi className="h-4 w-4 text-emerald-600" /> Up</div>
                <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Degraded</div>
                <div className="flex items-center gap-2"><WifiOff className="h-4 w-4 text-red-600" /> Down</div>
                <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-slate-400" /> Unknown / no recent live data</div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
