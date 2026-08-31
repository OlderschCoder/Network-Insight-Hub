import { useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CollectorInterface = Record<string, unknown> & { port?: string };
type CollectorNeighbor = Record<string, unknown>;
type CollectorSwitch = {
  switch_name: string;
  switch_ip: string;
  building?: string | null;
  device_type?: string | null;
  device?: Record<string, unknown> | null;
  polled_at: string;
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  interfaces?: CollectorInterface[];
  lldp_neighbors?: CollectorNeighbor[];
  mac_counts?: Array<{ port: string; count: number }>;
};
type CollectorAggregate = {
  schema: string;
  run_id: string;
  generated_at: string;
  switches: CollectorSwitch[];
};
type TelemetryPreview = {
  dryRun: boolean;
  skipped: boolean;
  metadataOnly?: boolean;
  reason?: string;
  sourceHostname: string;
  switchIp: string;
  matchedNodeId: string | null;
  matchedNodeHostname: string | null;
  matchedNodeMgmtIp: string | null;
  building: string | null;
  nodeWillBeCreated: boolean;
  physicalInterfaces: number;
  logicalInterfacesIgnored: number;
  lldpNeighborsSeen: number;
  infrastructureNeighborsResolved: number;
  endpointNeighborsIgnored: number;
  linksUpserted: number;
};
type PlanEntry = {
  source: CollectorSwitch;
  preview?: TelemetryPreview;
  error?: string;
  selected: boolean;
};

const INTERFACE_KEYS = [
  "port",
  "description",
  "name",
  "admin_status",
  "oper_status",
  "status",
  "reason",
  "mode",
  "native_vlan",
  "vlan",
  "duplex",
  "speed_mbps",
  "speed",
  "media_type",
  "type",
  "is_physical",
] as const;
const NEIGHBOR_KEYS = [
  "local_port",
  "system_name",
  "management_addresses",
  "port_id",
  "chassis_id",
] as const;

function pickKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

function compactSwitch(source: CollectorSwitch) {
  return {
    switch_name: source.switch_name,
    switch_ip: source.switch_ip,
    building: source.building ?? null,
    device_type: source.device_type ?? null,
    device: source.device ?? null,
    polled_at: source.polled_at,
    interfaces: (source.interfaces ?? [])
      .filter((iface): iface is CollectorInterface & { port: string } => typeof iface.port === "string" && iface.port.length > 0)
      .map((iface) => pickKeys(iface, INTERFACE_KEYS)),
    lldp_neighbors: (source.lldp_neighbors ?? []).map((neighbor) => pickKeys(neighbor, NEIGHBOR_KEYS)),
    mac_counts: source.mac_counts ?? [],
  };
}

async function postSwitch(aggregate: CollectorAggregate, source: CollectorSwitch, dryRun: boolean) {
  const response = await authFetch("/api/network-map/import/telemetry/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema: aggregate.schema,
      runId: aggregate.run_id,
      generatedAt: aggregate.generated_at,
      dryRun,
      switch: compactSwitch(source),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
  return body as TelemetryPreview;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function chooseOneRecordPerNode(entries: PlanEntry[]): PlanEntry[] {
  const selected = new Map<string, PlanEntry>();
  for (const entry of entries) {
    if (entry.error || entry.preview?.skipped) continue;
    const preview = entry.preview!;
    const key = preview.matchedNodeId ?? `new:${preview.sourceHostname}`;
    const current = selected.get(key);
    const isAuthoritativeIp = preview.switchIp === preview.matchedNodeMgmtIp;
    const currentIsAuthoritative = current?.preview?.switchIp === current?.preview?.matchedNodeMgmtIp;
    if (!current || (isAuthoritativeIp && !currentIsAuthoritative)) selected.set(key, entry);
  }
  return entries.map((entry) => ({ ...entry, selected: [...selected.values()].includes(entry) }));
}

export function TelemetryImportButton({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [aggregate, setAggregate] = useState<CollectorAggregate | null>(null);
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState(false);

  const readFile = async (file: File) => {
    setPreviewing(true);
    try {
      const parsed = JSON.parse(await file.text()) as CollectorAggregate;
      if (parsed.schema !== "sccc.network.switchport_telemetry.v1" || !Array.isArray(parsed.switches)) {
        throw new Error("This is not an sccc.network.switchport_telemetry.v1 aggregate.");
      }
      const entries = await mapWithConcurrency(parsed.switches, 4, async (source): Promise<PlanEntry> => {
        if (source.ok !== true) {
          return {
            source,
            error: `Collector failed: ${source.errors?.join("; ") || "no successful poll"}`,
            selected: false,
          };
        }
        if (!Array.isArray(source.interfaces) || source.interfaces.length === 0) {
          return { source, error: "Collector returned no interfaces", selected: false };
        }
        try {
          return { source, preview: await postSwitch(parsed, source, true), selected: false };
        } catch (error) {
          return { source, error: error instanceof Error ? error.message : String(error), selected: false };
        }
      });
      setAggregate(parsed);
      setPlan(chooseOneRecordPerNode(entries));
      setOpen(true);
    } catch (error) {
      toast({
        title: "Telemetry preview failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setPreviewing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const apply = async () => {
    if (!aggregate) return;
    setApplying(true);
    const selected = plan.filter((entry) => entry.selected && !entry.error && !entry.preview?.skipped);
    const failures: string[] = [];
    let applied = 0;
    let interfaces = 0;
    let links = 0;
    // Apply one switch at a time so opposite LLDP observations cannot race and
    // create duplicate links before either request sees the other's insert.
    await mapWithConcurrency(selected, 1, async (entry) => {
      try {
        const result = await postSwitch(aggregate, entry.source, false);
        applied++;
        interfaces += result.physicalInterfaces;
        links += result.linksUpserted;
      } catch (error) {
        failures.push(`${entry.source.switch_name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    setApplying(false);
    if (failures.length) {
      setPlan((current) => current.map((entry) => {
        const failure = failures.find((value) => value.startsWith(`${entry.source.switch_name}:`));
        return failure ? { ...entry, error: failure } : entry;
      }));
      toast({
        title: `Imported ${applied} switches; ${failures.length} failed`,
        description: failures[0],
        variant: "destructive",
      });
      onImported();
      return;
    }
    toast({ title: `Imported ${interfaces.toLocaleString()} interfaces and refreshed ${links} links on ${applied} switches` });
    setOpen(false);
    setPlan([]);
    onImported();
  };

  const selected = plan.filter((entry) => entry.selected);
  const errors = plan.filter((entry) => entry.error);
  const skipped = plan.filter((entry) => entry.preview?.skipped);
  const totals = selected.reduce(
    (sum, entry) => ({
      interfaces: sum.interfaces + (entry.preview?.physicalInterfaces ?? 0),
      logical: sum.logical + (entry.preview?.logicalInterfacesIgnored ?? 0),
      resolved: sum.resolved + (entry.preview?.infrastructureNeighborsResolved ?? 0),
      endpoints: sum.endpoints + (entry.preview?.endpointNeighborsIgnored ?? 0),
    }),
    { interfaces: 0, logical: 0, resolved: 0, endpoints: 0 },
  );

  return (
    <>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".json,application/json"
        onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])}
      />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={previewing}>
        {previewing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
        {previewing ? "Checking Telemetry…" : "Import Telemetry JSON"}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !applying && setOpen(next)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collector telemetry preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Switches</p><p className="text-xl font-bold">{selected.length}</p></div>
              <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Physical interfaces</p><p className="text-xl font-bold">{totals.interfaces.toLocaleString()}</p></div>
              <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Infrastructure LLDP</p><p className="text-xl font-bold">{totals.resolved.toLocaleString()}</p></div>
              <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Endpoint port evidence</p><p className="text-xl font-bold">{totals.endpoints.toLocaleString()}</p></div>
            </div>

            <div className="rounded border bg-muted/30 p-3 space-y-1">
              <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Management IP wins when hostname and IP disagree.</p>
              <p className="text-xs text-muted-foreground">Duplicate management/SVI polls are collapsed to one physical chassis. Logical interfaces are retained in the JSON but not drawn as switch ports.</p>
              <p className="text-xs text-muted-foreground">Phones, computers, access points, printers, and other endpoints keep their ports visibly connected from oper-status, LLDP, and MAC evidence; they are not added as infrastructure nodes.</p>
            </div>

            {(errors.length > 0 || skipped.length > 0) && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-1">
                <p className="flex items-center gap-2 font-medium text-amber-900"><AlertTriangle className="h-4 w-4" /> {errors.length} conflicts/unmatched · {skipped.length} logical aliases skipped</p>
                {[...errors, ...skipped].slice(0, 12).map((entry) => (
                  <p key={`${entry.source.switch_name}-${entry.source.switch_ip}`} className="text-xs text-amber-900">
                    <span className="font-mono">{entry.source.switch_name} ({entry.source.switch_ip})</span>: {entry.error ?? entry.preview?.reason}
                  </p>
                ))}
              </div>
            )}

            <div className="border rounded max-h-64 overflow-auto">
              {selected.map((entry) => (
                <div key={`${entry.source.switch_name}-${entry.source.switch_ip}`} className="grid grid-cols-[1fr_auto] gap-3 border-b last:border-b-0 px-3 py-2 text-xs">
                  <div><span className="font-mono font-medium">{entry.preview?.matchedNodeHostname ?? entry.source.switch_name}</span><span className="text-muted-foreground"> · {entry.preview?.building ?? "Unassigned"} · {entry.source.switch_ip}</span></div>
                  <div>{entry.preview?.metadataOnly ? "metadata only" : `${entry.preview?.physicalInterfaces} ports · ${entry.preview?.infrastructureNeighborsResolved} infra neighbors`}</div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={applying}>Cancel</Button>
            <Button onClick={() => void apply()} disabled={applying || selected.length === 0}>
              {applying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {applying ? "Applying…" : `Apply ${selected.length} Switches`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
