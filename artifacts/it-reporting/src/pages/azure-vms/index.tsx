import { useEffect, useMemo, useState } from "react";
import {
  useListAzureVms,
  useCreateAzureVm,
  useUpdateAzureVm,
  useDeleteAzureVm,
  useSyncAzureVms,
  useGetAzureSyncStatus,
  useGetAzureVmRisks,
  type AzureVm,
  type AzureVmRiskFlag,
  type AzureSyncDiff,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Cloud, Plus, Pencil, Trash2, Search, Server, Download, ChevronLeft, ChevronRight, RefreshCw, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 25;

const CSV_COLUMNS: { key: keyof AzureVm; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "resourceGroup", label: "Resource Group" },
  { key: "subscription", label: "Subscription" },
  { key: "location", label: "Location" },
  { key: "size", label: "Size" },
  { key: "os", label: "OS" },
  { key: "privateIp", label: "Private IP" },
  { key: "publicIp", label: "Public IP" },
  { key: "vnet", label: "VNet" },
  { key: "subnet", label: "Subnet" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "purpose", label: "Purpose" },
  { key: "notes", label: "Notes" },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: AzureVm[]) {
  const header = CSV_COLUMNS.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((vm) =>
    CSV_COLUMNS.map((c) => csvCell((vm as any)[c.key])).join(","),
  );
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `azure-vms-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type VmFormState = {
  name: string;
  resourceGroup: string;
  subscription: string;
  location: string;
  size: string;
  os: string;
  privateIp: string;
  publicIp: string;
  vnet: string;
  subnet: string;
  status: string;
  purpose: string;
  notes: string;
  owner: string;
};

const EMPTY_FORM: VmFormState = {
  name: "",
  resourceGroup: "",
  subscription: "",
  location: "",
  size: "",
  os: "",
  privateIp: "",
  publicIp: "",
  vnet: "",
  subnet: "",
  status: "running",
  purpose: "",
  notes: "",
  owner: "",
};

const STATUS_COLORS: Record<string, string> = {
  running: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  stopped: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  deallocated: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
  unknown: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
};

function vmToForm(v: AzureVm): VmFormState {
  return {
    name: v.name ?? "",
    resourceGroup: v.resourceGroup ?? "",
    subscription: v.subscription ?? "",
    location: v.location ?? "",
    size: v.size ?? "",
    os: v.os ?? "",
    privateIp: v.privateIp ?? "",
    publicIp: v.publicIp ?? "",
    vnet: v.vnet ?? "",
    subnet: v.subnet ?? "",
    status: v.status ?? "unknown",
    purpose: v.purpose ?? "",
    notes: v.notes ?? "",
    owner: v.owner ?? "",
  };
}

function formToPayload(f: VmFormState) {
  const trim = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    name: f.name.trim(),
    resourceGroup: trim(f.resourceGroup),
    subscription: trim(f.subscription),
    location: trim(f.location),
    size: trim(f.size),
    os: trim(f.os),
    privateIp: trim(f.privateIp),
    publicIp: trim(f.publicIp),
    vnet: trim(f.vnet),
    subnet: trim(f.subnet),
    status: f.status.trim() || "unknown",
    purpose: trim(f.purpose),
    notes: trim(f.notes),
    owner: trim(f.owner),
  };
}

export default function AzureVmsPage() {
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AzureVm | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<VmFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AzureVm | null>(null);
  const [page, setPage] = useState(0);
  const [syncDiff, setSyncDiff] = useState<AzureSyncDiff | null>(null);

  const { data: vms = [], isLoading, refetch } = useListAzureVms({});
  const { data: syncStatus, refetch: refetchStatus } = useGetAzureSyncStatus();
  const { data: riskData, refetch: refetchRisks } = useGetAzureVmRisks();
  const createMut = useCreateAzureVm();
  const updateMut = useUpdateAzureVm();
  const deleteMut = useDeleteAzureVm();
  const syncMut = useSyncAzureVms();

  const riskByVm = useMemo(() => {
    const m = new Map<number, AzureVmRiskFlag[]>();
    for (const item of riskData?.items ?? []) m.set(item.id, item.flags);
    return m;
  }, [riskData]);

  const handleSync = async () => {
    try {
      const result = await syncMut.mutateAsync();
      toast({
        title: "Synced from Azure",
        description: `${result.created} added · ${result.updated} updated · ${result.removed} marked deleted (${result.total} total).`,
      });
      if (result.diff) setSyncDiff(result.diff);
      refetch();
      refetchStatus();
      refetchRisks();
    } catch (err: any) {
      const body = err?.response?.data ?? err?.data;
      const code = body?.error;
      toast({
        title:
          code === "AZURE_NOT_CONFIGURED"
            ? "Azure not connected"
            : "Sync failed",
        description:
          body?.message ?? err?.message ?? "Could not reach Azure. Try again.",
        variant: "destructive",
      });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vms;
    return vms.filter((v) =>
      [v.name, v.resourceGroup, v.location, v.privateIp, v.publicIp, v.purpose, v.owner]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q)),
    );
  }, [vms, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    setPage(0);
  }, [search]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (vm: AzureVm) => {
    setForm(vmToForm(vm));
    setEditing(vm);
    setCreating(false);
  };

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const data = formToPayload(form);
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data });
        toast({ title: "VM updated", description: data.name });
      } else {
        await createMut.mutateAsync({ data });
        toast({ title: "VM added", description: data.name });
      }
      closeDialog();
      refetch();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync({ id: deleteTarget.id });
      toast({ title: "VM removed", description: deleteTarget.name });
      setDeleteTarget(null);
      refetch();
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cloud className="h-7 w-7" /> Azure Virtual Machines
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inventory of Azure VMs that route through the FortiGate edge firewall. These VMs can be
            placed into the network diagram from the visualizer.
          </p>
        </div>
        {isCIO && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Add VM
          </Button>
        )}
      </div>

      {(() => {
        const run = syncStatus?.vm;
        const summary = riskData?.summary;
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="py-3 flex items-center gap-3">
                {!run ? (
                  <>
                    <RefreshCw className="h-5 w-5 text-muted-foreground" />
                    <div className="text-sm text-muted-foreground">
                      No Azure sync recorded yet.
                      {isCIO ? " Use “Sync from Azure” to pull inventory." : ""}
                    </div>
                  </>
                ) : run.status === "success" ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    <div className="text-sm">
                      <div className="font-medium">
                        Last sync {format(new Date(run.createdAt), "MMM d, h:mm a")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {run.createdCount ?? 0} added · {run.changedCount ?? 0} changed ·{" "}
                        {run.removedCount ?? 0} removed · {run.totalCount ?? 0} total
                        {run.actorName ? ` · by ${run.actorName}` : ""}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                    <div className="text-sm">
                      <div className="font-medium text-red-700">
                        Last sync failed {format(new Date(run.createdAt), "MMM d, h:mm a")}
                      </div>
                      {run.error && (
                        <div className="text-xs text-muted-foreground line-clamp-2">{run.error}</div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 flex items-center gap-3">
                <ShieldAlert
                  className={`h-5 w-5 shrink-0 ${summary && summary.flaggedVms > 0 ? "text-amber-600" : "text-green-600"}`}
                />
                <div className="text-sm">
                  {summary && summary.flaggedVms > 0 ? (
                    <>
                      <div className="font-medium">
                        {summary.flaggedVms} VM{summary.flaggedVms === 1 ? "" : "s"} flagged
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {summary.publicIp} public-IP · {summary.unhealthy} unhealthy ·{" "}
                        {summary.retiringSize} retiring series
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">No VM risk flags.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" /> {filtered.length} VM{filtered.length === 1 ? "" : "s"}
              </CardTitle>
              <CardDescription>
                {isCIO
                  ? "Click Edit to update fields. Use the network visualizer to add VMs to the diagram."
                  : "Read-only — only the CIO can add or edit VMs."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-72 max-w-full">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, RG, IP, owner…"
                  className="pl-8"
                />
              </div>
              {isCIO && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMut.isPending}
                  title="Pull the latest VM inventory from Azure"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncMut.isPending ? "animate-spin" : ""}`} />
                  {syncMut.isPending ? "Syncing…" : "Sync from Azure"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCsv(filtered)}
                disabled={filtered.length === 0}
                title={`Export ${filtered.length} VM${filtered.length === 1 ? "" : "s"} to CSV`}
              >
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              {vms.length === 0
                ? "No Azure VMs yet."
                : "No VMs match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Resource Group</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Size / OS</TableHead>
                    <TableHead>Private IP</TableHead>
                    <TableHead>Public IP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Owner</TableHead>
                    {isCIO && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((vm) => (
                    <TableRow key={vm.id}>
                      <TableCell>
                        <div className="font-medium">{vm.name}</div>
                        {vm.purpose && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{vm.purpose}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{vm.resourceGroup ?? "—"}</TableCell>
                      <TableCell className="text-sm">{vm.location ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div>{vm.size ?? "—"}</div>
                        {vm.os && <div className="text-xs text-muted-foreground">{vm.os}</div>}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{vm.privateIp ?? "—"}</TableCell>
                      <TableCell className="text-sm font-mono">{vm.publicIp ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[vm.status] ?? STATUS_COLORS.unknown}>
                          {vm.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const flags = riskByVm.get(vm.id) ?? [];
                          if (flags.length === 0)
                            return <span className="text-xs text-muted-foreground">—</span>;
                          return (
                            <div className="flex flex-wrap gap-1">
                              {flags.map((f) => (
                                <Badge
                                  key={f.code}
                                  variant="outline"
                                  title={f.detail}
                                  className={`text-[10px] ${
                                    f.severity === "high"
                                      ? "bg-red-500/10 text-red-700 border-red-200"
                                      : "bg-amber-500/10 text-amber-700 border-amber-200"
                                  }`}
                                >
                                  {f.label}
                                </Badge>
                              ))}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm">{vm.owner ?? "—"}</TableCell>
                      {isCIO && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(vm)}
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(vm)}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
                  <div>
                    Showing {safePage * PAGE_SIZE + 1}–
                    {Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE)} of{" "}
                    {filtered.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                    </Button>
                    <span>
                      Page {safePage + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                    >
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating || !!editing} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Azure VM" : "Add Azure VM"}</DialogTitle>
            <DialogDescription>
              VMs route through the FortiGate edge firewall. Fill in only what you know — fields are
              optional except Name.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} placeholder="running, stopped, deallocated" />
            <Field label="Resource Group" value={form.resourceGroup} onChange={(v) => setForm({ ...form, resourceGroup: v })} />
            <Field label="Subscription" value={form.subscription} onChange={(v) => setForm({ ...form, subscription: v })} />
            <Field label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="eastus, centralus…" />
            <Field label="Size" value={form.size} onChange={(v) => setForm({ ...form, size: v })} placeholder="Standard_B2s…" />
            <Field label="OS" value={form.os} onChange={(v) => setForm({ ...form, os: v })} placeholder="Windows Server 2022, Ubuntu 22.04…" />
            <Field label="Owner" value={form.owner} onChange={(v) => setForm({ ...form, owner: v })} />
            <Field label="Private IP" value={form.privateIp} onChange={(v) => setForm({ ...form, privateIp: v })} />
            <Field label="Public IP" value={form.publicIp} onChange={(v) => setForm({ ...form, publicIp: v })} />
            <Field label="VNet" value={form.vnet} onChange={(v) => setForm({ ...form, vnet: v })} />
            <Field label="Subnet" value={form.subnet} onChange={(v) => setForm({ ...form, subnet: v })} />
          </div>
          <div className="grid gap-2">
            <Label>Purpose</Label>
            <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="What does this VM do?" />
          </div>
          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {editing ? "Save changes" : "Add VM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!syncDiff} onOpenChange={(open) => { if (!open) setSyncDiff(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>What changed in this sync</DialogTitle>
            <DialogDescription>
              Differences between the previous inventory and the latest Azure pull.
            </DialogDescription>
          </DialogHeader>
          {syncDiff && (
            <div className="space-y-4 text-sm">
              <div>
                <div className="font-medium flex items-center gap-2">
                  <Plus className="h-4 w-4 text-green-600" /> Added ({syncDiff.added?.length ?? 0})
                </div>
                {(syncDiff.added?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground mt-1">None</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {syncDiff.added!.map((a) => (
                      <li key={a.name} className="text-xs">
                        <span className="font-medium">{a.name}</span>
                        {a.resourceGroup ? ` · ${a.resourceGroup}` : ""}
                        {a.status ? ` · ${a.status}` : ""}
                        {a.publicIp ? ` · public ${a.publicIp}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="font-medium flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-red-600" /> Removed ({syncDiff.removed?.length ?? 0})
                </div>
                {(syncDiff.removed?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground mt-1">None</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {syncDiff.removed!.map((rm) => (
                      <li key={rm.name} className="text-xs">
                        <span className="font-medium">{rm.name}</span>
                        {rm.resourceGroup ? ` · ${rm.resourceGroup}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="font-medium flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-amber-600" /> Changed ({syncDiff.changed?.length ?? 0})
                </div>
                {(syncDiff.changed?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground mt-1">None</p>
                ) : (
                  <ul className="mt-1 space-y-1.5">
                    {syncDiff.changed!.map((c) => (
                      <li key={c.name} className="text-xs border rounded p-2">
                        <div className="font-medium">{c.name}</div>
                        <ul className="mt-0.5 space-y-0.5">
                          {c.changes?.map((ch) => (
                            <li key={ch.field} className="font-mono">
                              {ch.field}: {ch.from ?? "∅"} → {ch.to ?? "∅"}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSyncDiff(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this VM?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{deleteTarget?.name}</strong> from the inventory. The VM in Azure
              itself is not affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMut.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
