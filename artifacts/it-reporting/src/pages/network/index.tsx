import { useMemo, useRef, useState, useEffect } from "react";
import {
  useListSwitches,
  useListVlans,
  useAddSwitchMaintenanceLogEntry,
  useUpdateSwitchMaintenanceLogEntry,
  useDeleteSwitchMaintenanceLogEntry,
  useAddVlanMaintenanceLogEntry,
  useUpdateVlanMaintenanceLogEntry,
  useDeleteVlanMaintenanceLogEntry,
  getListSwitchesQueryKey,
  getListVlansQueryKey,
} from "@workspace/api-client-react";
import type { NetworkSwitch, Vlan, MaintenanceLogEntry } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Server, Network as NetworkIcon, Workflow, Building2,
  Sparkles, Send, Map as MapIcon, Loader2, Cloud, Radio,
  Activity, Wrench, Save, Pencil, Trash2, X, History, Download, FileDown, ShieldCheck,
} from "lucide-react";
import { Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InventoryHistory } from "./inventory-history";
import { InventoryHealth } from "./inventory-health";
import {
  PendingInventoryChanges,
  type PendingNetworkChange,
} from "@/components/network/pending-inventory-changes";

const statusColor: Record<string, string> = {
  online: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  offline: "bg-red-500/10 text-red-700 border-red-200",
  unknown: "bg-muted text-muted-foreground border-border",
};

const vlanTypeColor: Record<string, string> = {
  data: "bg-blue-500/10 text-blue-700 border-blue-200",
  voice: "bg-purple-500/10 text-purple-700 border-purple-200",
  management: "bg-amber-500/10 text-amber-700 border-amber-200",
  security: "bg-red-500/10 text-red-700 border-red-200",
  ospf: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  other: "bg-muted text-muted-foreground border-border",
};

const matchSwitch = (s: NetworkSwitch, q: string) =>
  !q ||
  s.hostname?.toLowerCase().includes(q) ||
  s.building?.toLowerCase().includes(q) ||
  s.ipAddress?.toLowerCase().includes(q) ||
  (s.model ?? "").toLowerCase().includes(q);

const matchVlan = (v: Vlan, q: string) =>
  !q ||
  String(v.vlanId).includes(q) ||
  v.name?.toLowerCase().includes(q) ||
  (v.description ?? "").toLowerCase().includes(q) ||
  v.building?.toLowerCase().includes(q) ||
  (v.subnet ?? "").toLowerCase().includes(q);

function switchPostIncidentHref(sw: NetworkSwitch): string {
  const today = new Date().toISOString().slice(0, 10);
  const title = `Incident on ${sw.hostname}${sw.building ? ` (${sw.building})` : ""}`;
  const summary = [
    `Device: ${sw.hostname} (${sw.ipAddress})`,
    sw.model && `Model: ${sw.model}`,
    sw.building && `Building: ${sw.building}`,
    sw.location && `Location: ${sw.location}`,
    sw.notes && `Existing notes: ${sw.notes}`,
  ].filter(Boolean).join("\n");
  const params = new URLSearchParams({
    title,
    summary,
    incidentDate: today,
    outcome: "partial",
    source: "/network",
    sourceLabel: `Switch ${sw.hostname}`,
  });
  return `/after-action/new?${params.toString()}`;
}

function vlanPostIncidentHref(vlan: Vlan): string {
  const today = new Date().toISOString().slice(0, 10);
  const title = `Incident on VLAN ${vlan.vlanId} — ${vlan.name}`;
  const summary = [
    `VLAN: ${vlan.vlanId} (${vlan.name})`,
    `Type: ${vlan.type}`,
    vlan.building && `Building: ${vlan.building}`,
    vlan.subnet && `Subnet: ${vlan.subnet}${vlan.gateway ? ` via ${vlan.gateway}` : ""}`,
    vlan.description && `Description: ${vlan.description}`,
    vlan.notes && `Existing notes: ${vlan.notes}`,
  ].filter(Boolean).join("\n");
  const params = new URLSearchParams({
    title,
    summary,
    incidentDate: today,
    outcome: "partial",
    source: "/network",
    sourceLabel: `VLAN ${vlan.vlanId} (${vlan.name})`,
  });
  return `/after-action/new?${params.toString()}`;
}

function buildSwitchAIPrompt(sw: NetworkSwitch): string {
  return `Tell me about switch ${sw.hostname} (${sw.ipAddress})${sw.building ? ` in ${sw.building}` : ""}. ` +
    `What does it serve, what is its uplink path, and what should I check first if a user on it reports an issue?`;
}

function buildVlanAIPrompt(vlan: Vlan): string {
  return `Tell me about VLAN ${vlan.vlanId} (${vlan.name})${vlan.building ? ` in ${vlan.building}` : ""}. ` +
    `What is it used for, which switches and buildings rely on it, and what should I check first if users on it report issues?`;
}

function formatLogTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const MAINTENANCE_EDIT_ROLES = new Set(["cio", "network", "network_engineer"]);

function canManageEntry(user: { id?: number; role?: string } | null, entry: MaintenanceLogEntry) {
  if (!user) return false;
  if (entry.authorId != null && entry.authorId === user.id) return true;
  return !!user.role && MAINTENANCE_EDIT_ROLES.has(user.role);
}

type MaintenanceOwner = {
  kind: "switch" | "vlan";
  id: number;
  // Short identifier used in toast titles, dialog headers, etc. (e.g. "sw-aa144-a48", "VLAN 773 — EpworthBuilding").
  displayName: string;
  // Filename-safe slug for CSV / Markdown exports.
  fileSlug: string;
  // Optional second line shown in the history dialog (e.g. IP / building or subnet / building).
  subtitle?: string;
};

function switchOwner(sw: NetworkSwitch): MaintenanceOwner {
  return {
    kind: "switch",
    id: sw.id,
    displayName: sw.hostname,
    fileSlug: sw.hostname.replace(/[^a-z0-9._-]+/gi, "_"),
    subtitle: [sw.ipAddress, sw.building].filter(Boolean).join(" · ") || undefined,
  };
}

function vlanOwner(vlan: Vlan): MaintenanceOwner {
  const display = `VLAN ${vlan.vlanId} — ${vlan.name}`;
  return {
    kind: "vlan",
    id: vlan.id,
    displayName: display,
    fileSlug: `vlan-${vlan.vlanId}-${vlan.name}`.replace(/[^a-z0-9._-]+/gi, "_"),
    subtitle: [vlan.subnet, vlan.building].filter(Boolean).join(" · ") || undefined,
  };
}

function useOwnerMaintenanceMutations(kind: MaintenanceOwner["kind"]) {
  const addSwitch = useAddSwitchMaintenanceLogEntry();
  const updateSwitch = useUpdateSwitchMaintenanceLogEntry();
  const deleteSwitch = useDeleteSwitchMaintenanceLogEntry();
  const addVlan = useAddVlanMaintenanceLogEntry();
  const updateVlan = useUpdateVlanMaintenanceLogEntry();
  const deleteVlan = useDeleteVlanMaintenanceLogEntry();
  return kind === "switch"
    ? { add: addSwitch, update: updateSwitch, remove: deleteSwitch }
    : { add: addVlan, update: updateVlan, remove: deleteVlan };
}

function ownerListQueryKey(kind: MaintenanceOwner["kind"]) {
  // Drop the params element so we invalidate every variation of the list query.
  return kind === "switch"
    ? getListSwitchesQueryKey().slice(0, 1)
    : getListVlansQueryKey().slice(0, 1);
}

function MaintenanceLogEntryRow({
  owner,
  entry,
}: {
  owner: MaintenanceOwner;
  entry: MaintenanceLogEntry;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { update: updateEntry, remove: deleteEntry } = useOwnerMaintenanceMutations(owner.kind);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toLocalInput = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const tzMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzMs).toISOString().slice(0, 16);
  };
  const [body, setBody] = useState(entry.body);
  const [windowStart, setWindowStart] = useState(toLocalInput(entry.windowStart));
  const [windowEnd, setWindowEnd] = useState(toLocalInput(entry.windowEnd));

  const allowed = canManageEntry(user, entry);

  const startEditing = () => {
    setBody(entry.body);
    setWindowStart(toLocalInput(entry.windowStart));
    setWindowEnd(toLocalInput(entry.windowEnd));
    setEditing(true);
  };

  const refreshOwners = () =>
    queryClient.invalidateQueries({ queryKey: ownerListQueryKey(owner.kind) });

  const saveEdit = async () => {
    if (!body.trim()) return;
    try {
      const toIso = (s: string) => (s ? new Date(s).toISOString() : null);
      await updateEntry.mutateAsync({
        id: owner.id,
        entryId: entry.id,
        data: {
          body: body.trim(),
          windowStart: toIso(windowStart),
          windowEnd: toIso(windowEnd),
        },
      });
      await refreshOwners();
      toast({ title: "Maintenance note updated", description: owner.displayName });
      setEditing(false);
    } catch (e: any) {
      toast({
        title: "Couldn't save changes",
        description: e?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const doDelete = async () => {
    try {
      await deleteEntry.mutateAsync({ id: owner.id, entryId: entry.id });
      await refreshOwners();
      toast({ title: "Maintenance note deleted", description: owner.displayName });
      setConfirmDelete(false);
    } catch (e: any) {
      toast({
        title: "Couldn't delete note",
        description: e?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="text-xs border-l-2 border-primary/40 pl-2 py-1 bg-muted/30 rounded-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="font-semibold text-foreground/80 normal-case tracking-normal text-xs">
          {entry.authorName}
        </span>
        <span>{formatLogTimestamp(entry.createdAt)}</span>
        {(entry.windowStart || entry.windowEnd) && !editing && (
          <span className="text-amber-700 normal-case tracking-normal">
            window: {formatLogTimestamp(entry.windowStart)}
            {entry.windowEnd ? ` → ${formatLogTimestamp(entry.windowEnd)}` : ""}
          </span>
        )}
        {entry.editedAt && (
          <span className="italic normal-case tracking-normal text-muted-foreground/70">
            edited {formatLogTimestamp(entry.editedAt)}
          </span>
        )}
        {allowed && !editing && (
          <span className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px]"
              onClick={startEditing}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px] text-red-700 hover:text-red-800"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-1 space-y-2">
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="text-xs"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Window start (optional)
              <Input
                type="datetime-local"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                className="h-7 text-xs mt-1"
              />
            </label>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Window end (optional)
              <Input
                type="datetime-local"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                className="h-7 text-xs mt-1"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={saveEdit}
              disabled={updateEntry.isPending || !body.trim()}
            >
              <Save className="h-3 w-3 mr-1" />
              {updateEntry.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground mt-0.5">{entry.body}</p>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this maintenance note?</AlertDialogTitle>
            <AlertDialogDescription>
              The note will be hidden from the maintenance log on{" "}
              <span className="font-mono">{owner.displayName}</span>. This can't be undone from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteEntry.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doDelete();
              }}
              disabled={deleteEntry.isPending}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              {deleteEntry.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function downloadBlob(filename: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | null | undefined): string {
  const s = value ?? "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function entriesToCsv(owner: MaintenanceOwner, entries: MaintenanceLogEntry[]): string {
  const header = [owner.kind, "author", "created_at", "edited_at", "window_start", "window_end", "body"];
  const rows = entries.map((e) =>
    [
      owner.displayName,
      e.authorName,
      e.createdAt ?? "",
      e.editedAt ?? "",
      e.windowStart ?? "",
      e.windowEnd ?? "",
      e.body,
    ].map((v) => csvEscape(String(v ?? ""))).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function entriesToMarkdown(owner: MaintenanceOwner, entries: MaintenanceLogEntry[]): string {
  const lines: string[] = [];
  lines.push(`# Maintenance log — ${owner.displayName}`);
  if (owner.subtitle) lines.push(`*${owner.subtitle}*`);
  lines.push("");
  if (!entries.length) {
    lines.push("_No entries match the current filters._");
    return lines.join("\n");
  }
  for (const e of entries) {
    lines.push(`## ${formatLogTimestamp(e.createdAt)} — ${e.authorName}`);
    if (e.windowStart || e.windowEnd) {
      lines.push(
        `*Window: ${formatLogTimestamp(e.windowStart)}${e.windowEnd ? ` → ${formatLogTimestamp(e.windowEnd)}` : ""}*`,
      );
    }
    if (e.editedAt) lines.push(`*Edited ${formatLogTimestamp(e.editedAt)}*`);
    lines.push("");
    lines.push(e.body);
    lines.push("");
  }
  return lines.join("\n");
}

type CombinedMaintenanceRow = {
  kind: "switch" | "vlan";
  // Identity line shown as the section header / first identifying CSV column.
  name: string;
  building: string;
  // IP for switches, subnet for VLANs.
  address: string;
  entry: MaintenanceLogEntry;
};

function collectCombinedEntries(
  switches: NetworkSwitch[],
  vlans: Vlan[],
): CombinedMaintenanceRow[] {
  const rows: CombinedMaintenanceRow[] = [];
  for (const sw of switches) {
    for (const entry of sw.maintenanceLog ?? []) {
      rows.push({
        kind: "switch",
        name: sw.hostname,
        building: sw.building ?? "",
        address: sw.ipAddress ?? "",
        entry,
      });
    }
  }
  for (const vlan of vlans) {
    for (const entry of vlan.maintenanceLog ?? []) {
      rows.push({
        kind: "vlan",
        name: `VLAN ${vlan.vlanId} — ${vlan.name}`,
        building: vlan.building ?? "",
        address: vlan.subnet ?? "",
        entry,
      });
    }
  }
  rows.sort((a, b) => {
    const at = a.entry.createdAt ? new Date(a.entry.createdAt).getTime() : 0;
    const bt = b.entry.createdAt ? new Date(b.entry.createdAt).getTime() : 0;
    return bt - at;
  });
  return rows;
}

function combinedRowsToCsv(rows: CombinedMaintenanceRow[]): string {
  const header = [
    "kind",
    "name",
    "building",
    "address",
    "author",
    "created_at",
    "edited_at",
    "window_start",
    "window_end",
    "body",
  ];
  const lines = rows.map((r) =>
    [
      r.kind,
      r.name,
      r.building,
      r.address,
      r.entry.authorName,
      r.entry.createdAt ?? "",
      r.entry.editedAt ?? "",
      r.entry.windowStart ?? "",
      r.entry.windowEnd ?? "",
      r.entry.body,
    ]
      .map((v) => csvEscape(String(v ?? "")))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function combinedRowsToMarkdown(rows: CombinedMaintenanceRow[]): string {
  const lines: string[] = [];
  lines.push(`# Maintenance log — switches & VLANs`);
  lines.push(`*${rows.length} ${rows.length === 1 ? "entry" : "entries"} · exported ${new Date().toLocaleString()}*`);
  lines.push("");
  if (!rows.length) {
    lines.push("_No entries match the current filters._");
    return lines.join("\n");
  }

  const renderGroups = (kind: "switch" | "vlan", heading: string) => {
    const kindRows = rows.filter((r) => r.kind === kind);
    if (!kindRows.length) return;
    lines.push(`# ${heading}`);
    lines.push("");
    const grouped = new Map<string, CombinedMaintenanceRow[]>();
    for (const r of kindRows) {
      if (!grouped.has(r.name)) grouped.set(r.name, []);
      grouped.get(r.name)!.push(r);
    }
    const names = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const group = grouped.get(name)!;
      const first = group[0];
      const subtitle = [first.address, first.building].filter(Boolean).join(" · ");
      lines.push(`## ${name}`);
      if (subtitle) lines.push(`*${subtitle}*`);
      lines.push("");
      for (const { entry: e } of group) {
        lines.push(`### ${formatLogTimestamp(e.createdAt)} — ${e.authorName}`);
        if (e.windowStart || e.windowEnd) {
          lines.push(
            `*Window: ${formatLogTimestamp(e.windowStart)}${e.windowEnd ? ` → ${formatLogTimestamp(e.windowEnd)}` : ""}*`,
          );
        }
        if (e.editedAt) lines.push(`*Edited ${formatLogTimestamp(e.editedAt)}*`);
        lines.push("");
        lines.push(e.body);
        lines.push("");
      }
    }
  };

  renderGroups("switch", "Switches");
  renderGroups("vlan", "VLANs");
  return lines.join("\n");
}

function ExportAllMaintenanceDialog({
  switches,
  vlans,
  open,
  onOpenChange,
}: {
  switches: NetworkSwitch[];
  vlans: Vlan[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [author, setAuthor] = useState<string>("__all__");
  const [building, setBuilding] = useState<string>("__all__");
  const [kind, setKind] = useState<string>("__all__");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const allRows = useMemo(() => collectCombinedEntries(switches, vlans), [switches, vlans]);

  const authors = useMemo(() => {
    const seen = new Set<string>();
    for (const r of allRows) seen.add(r.entry.authorName ?? "Unknown");
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const buildings = useMemo(() => {
    const seen = new Set<string>();
    for (const r of allRows) {
      const b = r.building || "Unassigned";
      seen.add(b);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const filtered = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      const e = r.entry;
      if (kind !== "__all__" && r.kind !== kind) return false;
      if (author !== "__all__" && (e.authorName ?? "Unknown") !== author) return false;
      if (building !== "__all__") {
        const b = r.building || "Unassigned";
        if (b !== building) return false;
      }
      const created = e.createdAt ? new Date(e.createdAt).getTime() : null;
      if (fromTs != null && (created == null || created < fromTs)) return false;
      if (toTs != null && (created == null || created > toTs)) return false;
      if (q) {
        const hay = [e.body, e.authorName, r.name, r.building, r.address]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, author, building, kind, from, to, search]);

  const reset = () => {
    setAuthor("__all__");
    setBuilding("__all__");
    setKind("__all__");
    setFrom("");
    setTo("");
    setSearch("");
  };

  const stamp = () => new Date().toISOString().slice(0, 10);
  const exportCsv = () =>
    downloadBlob(
      `network-maintenance-${stamp()}.csv`,
      "text/csv;charset=utf-8",
      combinedRowsToCsv(filtered),
    );
  const exportMd = () =>
    downloadBlob(
      `network-maintenance-${stamp()}.md`,
      "text/markdown;charset=utf-8",
      combinedRowsToMarkdown(filtered),
    );

  const devicesWithEntries = useMemo(() => {
    const seen = new Set<string>();
    for (const r of filtered) seen.add(`${r.kind}:${r.name}`);
    return seen.size;
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Export maintenance log — switches & VLANs</DialogTitle>
          <DialogDescription>
            {allRows.length} total {allRows.length === 1 ? "entry" : "entries"} across{" "}
            {switches.length} {switches.length === 1 ? "switch" : "switches"} and {vlans.length}{" "}
            {vlans.length === 1 ? "VLAN" : "VLANs"}. Filter, then export CSV or Markdown.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Type
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                <SelectItem value="switch">Switches</SelectItem>
                <SelectItem value="vlan">VLANs</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Building
            <Select value={building} onValueChange={setBuilding}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue placeholder="All buildings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All buildings</SelectItem>
                {buildings.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Author
            <Select value={author} onValueChange={setAuthor}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue placeholder="All authors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All authors</SelectItem>
                {authors.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            From
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 text-xs mt-1"
            />
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            To
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 text-xs mt-1"
            />
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Search
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="hostname, VLAN, body…"
              className="h-8 text-xs mt-1"
            />
          </label>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filtered.length} of {allRows.length} {allRows.length === 1 ? "entry" : "entries"}
            {filtered.length > 0 && ` · ${devicesWithEntries} ${devicesWithEntries === 1 ? "device" : "devices"}`}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>
            <X className="h-3 w-3 mr-1" /> Reset filters
          </Button>
        </div>

        <ScrollArea className="max-h-[40vh] pr-2 border rounded">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No entries match the current filters.
            </p>
          ) : (
            <div className="divide-y">
              {filtered.slice(0, 50).map((r) => (
                <div key={`${r.kind}-${r.name}-${r.entry.id}`} className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase">
                      {r.kind}
                    </Badge>
                    <span className="font-mono normal-case tracking-normal text-xs text-foreground/90">
                      {r.name}
                    </span>
                    {r.building && (
                      <span className="normal-case tracking-normal">{r.building}</span>
                    )}
                    <span className="font-semibold normal-case tracking-normal text-foreground/80">
                      {r.entry.authorName}
                    </span>
                    <span>{formatLogTimestamp(r.entry.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground mt-0.5 line-clamp-3">
                    {r.entry.body}
                  </p>
                </div>
              ))}
              {filtered.length > 50 && (
                <p className="text-[10px] text-muted-foreground italic px-2 py-1.5">
                  Showing first 50 of {filtered.length}. Export to see them all.
                </p>
              )}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={exportCsv}
            disabled={!filtered.length}
          >
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={exportMd}
            disabled={!filtered.length}
          >
            <FileDown className="h-3 w-3 mr-1" /> Export Markdown
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaintenanceHistoryDialog({
  owner,
  entries,
  open,
  onOpenChange,
}: {
  owner: MaintenanceOwner;
  entries: MaintenanceLogEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [author, setAuthor] = useState<string>("__all__");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const authors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      const key = e.authorName ?? "Unknown";
      if (!seen.has(key)) seen.set(key, key);
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filtered = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (author !== "__all__" && (e.authorName ?? "Unknown") !== author) return false;
      const created = e.createdAt ? new Date(e.createdAt).getTime() : null;
      if (fromTs != null && (created == null || created < fromTs)) return false;
      if (toTs != null && (created == null || created > toTs)) return false;
      if (q) {
        const hay = [e.body, e.authorName].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, author, from, to, search]);

  const reset = () => {
    setAuthor("__all__");
    setFrom("");
    setTo("");
    setSearch("");
  };

  const exportCsv = () =>
    downloadBlob(`${owner.fileSlug}-maintenance.csv`, "text/csv;charset=utf-8", entriesToCsv(owner, filtered));
  const exportMd = () =>
    downloadBlob(`${owner.fileSlug}-maintenance.md`, "text/markdown;charset=utf-8", entriesToMarkdown(owner, filtered));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{owner.displayName} — maintenance history</DialogTitle>
          <DialogDescription>
            {entries.length} total {entries.length === 1 ? "entry" : "entries"}. Filter, search, or export the log.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Author
            <Select value={author} onValueChange={setAuthor}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue placeholder="All authors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All authors</SelectItem>
                {authors.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            From
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs mt-1" />
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            To
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs mt-1" />
          </label>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Search body
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="text, keyword..."
              className="h-8 text-xs mt-1"
            />
          </label>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {filtered.length} of {entries.length}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>
            <X className="h-3 w-3 mr-1" /> Reset filters
          </Button>
        </div>

        <ScrollArea className="max-h-[50vh] pr-2">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No entries match the current filters.
            </p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((e) => (
                <MaintenanceLogEntryRow key={e.id} owner={owner} entry={e} />
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportMd} disabled={!filtered.length}>
            <FileDown className="h-3 w-3 mr-1" /> Export Markdown
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaintenanceLogList({
  owner,
  entries,
}: {
  owner: MaintenanceOwner;
  entries: MaintenanceLogEntry[];
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!entries?.length) return null;
  const visible = entries.slice(0, 3);
  const hiddenCount = entries.length - visible.length;
  return (
    <div className="w-full mt-2 space-y-1.5">
      {visible.map((e) => (
        <MaintenanceLogEntryRow key={e.id} owner={owner} entry={e} />
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[10px] uppercase tracking-wide text-muted-foreground/80"
        onClick={() => setHistoryOpen(true)}
      >
        <History className="h-3 w-3 mr-1" />
        View full history
        {hiddenCount > 0 && ` (${entries.length} total, ${hiddenCount} older)`}
      </Button>
      <MaintenanceHistoryDialog
        owner={owner}
        entries={entries}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}

function MaintenanceNotesEditor({
  owner,
  hasHistory,
}: {
  owner: MaintenanceOwner;
  hasHistory: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const queryClient = useQueryClient();
  const { add: addEntry } = useOwnerMaintenanceMutations(owner.kind);
  const { toast } = useToast();

  const reset = () => {
    setBody("");
    setWindowStart("");
    setWindowEnd("");
  };

  const save = async () => {
    if (!body.trim()) return;
    try {
      const toIso = (s: string) => (s ? new Date(s).toISOString() : null);
      await addEntry.mutateAsync({
        id: owner.id,
        data: {
          body: body.trim(),
          windowStart: toIso(windowStart),
          windowEnd: toIso(windowEnd),
        },
      });
      await queryClient.invalidateQueries({
        queryKey: ownerListQueryKey(owner.kind),
      });
      toast({ title: "Maintenance note added", description: owner.displayName });
      reset();
      setEditing(false);
    } catch (e: any) {
      toast({
        title: "Couldn't save note",
        description: e?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  if (!editing) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => setEditing(true)}
      >
        <Wrench className="h-3 w-3 mr-1" />
        {hasHistory ? "Add maintenance note" : "Add first maintenance note"}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 mt-1">
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What changed, why, and anything the next engineer should know..."
        className="text-xs"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Window start (optional)
          <Input
            type="datetime-local"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            className="h-7 text-xs mt-1"
          />
        </label>
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Window end (optional)
          <Input
            type="datetime-local"
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            className="h-7 text-xs mt-1"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={save}
          disabled={addEntry.isPending || !body.trim()}
        >
          <Save className="h-3 w-3 mr-1" />
          {addEntry.isPending ? "Saving…" : "Add to log"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            reset();
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SwitchRow({ sw, onAskAI }: { sw: NetworkSwitch; onAskAI?: (prompt: string) => void }) {
  const owner = switchOwner(sw);
  const log = sw.maintenanceLog ?? [];
  return (
    <div className="border-b last:border-b-0 py-2 px-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono font-medium text-sm">{sw.hostname}</p>
          <p className="font-mono text-xs text-primary mt-0.5">{sw.ipAddress}</p>
          {sw.model && <p className="text-xs text-muted-foreground mt-0.5">{sw.model}</p>}
          {sw.location && <p className="text-xs text-muted-foreground/80 mt-0.5">{sw.location}</p>}
          {sw.notes && <p className="text-xs italic text-muted-foreground/70 mt-1">{sw.notes}</p>}
        </div>
        <Badge variant="outline" className={`shrink-0 ${statusColor[sw.status ?? "unknown"] ?? ""}`}>
          {sw.status ?? "unknown"}
        </Badge>
      </div>
      <MaintenanceLogList owner={owner} entries={log} />
      <div className="flex flex-wrap gap-2 mt-2">
        <MaintenanceNotesEditor owner={owner} hasHistory={log.length > 0} />
        <Link href={switchPostIncidentHref(sw)}>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Activity className="h-3 w-3 mr-1" />
            Start Post-Incident Review
          </Button>
        </Link>
        {onAskAI && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onAskAI(buildSwitchAIPrompt(sw))}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Ask AI about this switch
          </Button>
        )}
      </div>
    </div>
  );
}

function VlanRow({ vlan, onAskAI }: { vlan: Vlan; onAskAI?: (prompt: string) => void }) {
  const owner = vlanOwner(vlan);
  const log = vlan.maintenanceLog ?? [];
  return (
    <div className="border-b last:border-b-0 py-2 px-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-primary text-sm">VLAN {vlan.vlanId}</span>
            <span className="font-medium text-sm truncate">{vlan.name}</span>
          </div>
          {vlan.description && <p className="text-xs text-muted-foreground mt-0.5">{vlan.description}</p>}
          {vlan.subnet && (
            <p className="font-mono text-xs text-emerald-700 mt-0.5">
              {vlan.subnet}{vlan.gateway && ` via ${vlan.gateway}`}
            </p>
          )}
        </div>
        <Badge variant="outline" className={`shrink-0 ${vlanTypeColor[vlan.type ?? "other"] ?? ""}`}>
          {vlan.type ?? "other"}
        </Badge>
      </div>
      <MaintenanceLogList owner={owner} entries={log} />
      <div className="flex flex-wrap gap-2 mt-2">
        <MaintenanceNotesEditor owner={owner} hasHistory={log.length > 0} />
        <Link href={vlanPostIncidentHref(vlan)}>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Activity className="h-3 w-3 mr-1" />
            Start Post-Incident Review
          </Button>
        </Link>
        {onAskAI && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onAskAI(buildVlanAIPrompt(vlan))}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Ask AI about this VLAN
          </Button>
        )}
      </div>
    </div>
  );
}

type ChatMsg = { role: "user" | "assistant"; content: string };

function AskAIPanel({
  open,
  onOpenChange,
  pendingPrompt,
  onPromptConsumed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPrompt: string | null;
  onPromptConsumed: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNetworkAdmin = ["cio", "network", "network_engineer"].includes(user?.role ?? "");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingNetworkChange[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt);
      onPromptConsumed();
    }
  }, [pendingPrompt, onPromptConsumed]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/network/ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ messages: next, previewInventory: isNetworkAdmin }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply || "(empty response)" }]);
      if (Array.isArray(data.pendingNetworkChanges) && data.pendingNetworkChanges.length > 0) {
        setPendingChanges((prev) => [...prev, ...(data.pendingNetworkChanges as PendingNetworkChange[])]);
      }
    } catch (e: any) {
      setError(e?.message || "AI request failed");
    } finally {
      setBusy(false);
    }
  };

  const suggestions = [
    "Which switch serves Cosmetology and what is its uplink?",
    "Where on the campus map is the Sharp Champion Center, and which VLAN ties it to the core?",
    "List every OSPF /30 transit VLAN and the building it connects to.",
    "If a user in Humanities reports no internet, what's the failure path I should check first?",
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Sparkles className="h-4 w-4 mr-2" /> Ask AI
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Network Engineer Assistant
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Knows the SCCC campus map and your live switch / VLAN inventory.
          </p>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="px-5 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try one of these:</p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="block text-left text-sm w-full p-2 rounded border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </div>
              </div>
            )}
            {error && (
              <div className="text-xs text-red-700 border border-red-200 bg-red-500/10 rounded p-2">
                {error}
              </div>
            )}
            {isNetworkAdmin && pendingChanges.length > 0 && (
              <PendingInventoryChanges
                changes={pendingChanges}
                onApplied={(change, message) => {
                  setPendingChanges((prev) => prev.filter((c) => c !== change));
                  toast({ title: message ?? `Applied ${change.kind} ${change.label}` });
                  queryClient.invalidateQueries({ queryKey: ["network"] });
                }}
                onFailed={(change, err) => {
                  toast({
                    variant: "destructive",
                    title: `Failed to apply ${change.kind} ${change.label}`,
                    description: err,
                  });
                }}
                onDismiss={(change) => {
                  setPendingChanges((prev) => prev.filter((c) => c !== change));
                }}
              />
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about a building, switch, VLAN, OSPF link…"
            disabled={busy}
          />
          <Button onClick={send} disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CloudRemotePanel() {
  return (
    <Card className="border-primary/30">
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="h-4 w-4 text-primary" />
          Cloud &amp; Remote Sites
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Hybrid Azure deployment and the West campus IPsec site. Switches and
          subnets below are also indexed under their building in the tabs.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion type="multiple" className="space-y-2">
          <AccordionItem value="azure" className="border rounded-md px-3 bg-card">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Cloud className="h-4 w-4 text-sky-700" />
                <span className="font-medium">Microsoft Azure — Hybrid-VNet (Central US)</span>
                <Badge variant="outline" className="ml-auto text-xs">RG-Prod-CentralUS</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3 pt-2">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VNet</p>
                  <p><span className="text-muted-foreground">Name:</span> <span className="font-mono">Hybrid-VNet</span></p>
                  <p><span className="text-muted-foreground">Region:</span> centralus</p>
                  <p><span className="text-muted-foreground">Address space:</span> <span className="font-mono text-emerald-700">10.0.0.0/24, 10.3.0.0/27</span></p>
                  <p><span className="text-muted-foreground">Peering:</span> none configured</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key subnets</p>
                  <p><span className="font-mono">GatewaySubnet</span> — <span className="font-mono text-emerald-700">10.0.0.224/27</span> (Hybrid-VPNGateway)</p>
                  <p><span className="font-mono">Hybrid_default</span> — <span className="font-mono text-emerald-700">10.0.0.0/25</span> (workloads, NAT, PEs)</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">VPN</p>
                  <p><span className="font-mono">Hybrid-VPNGateway</span> — RouteBased, Gen2, Active/Active (VpnGw2AZ)</p>
                  <p><span className="font-mono">S2S-OnPrem</span> — Connected → <span className="font-mono">OnPrem-LNG</span></p>
                  <p><span className="font-mono">OnPrem-SNAT</span>: 10.1.0.0/24 → 172.20.1.0/26 (egress)</p>
                  <p className="text-xs text-amber-700"><span className="font-mono">Azure_Ipsec</span> on VNG_NEW — <strong>NotConnected</strong> (separate path)</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Routes (RT-To-Onprem)</p>
                  <p><span className="font-mono">192.168.0.0/16</span> → VirtualNetworkGateway</p>
                  <p><span className="font-mono">10.70.0.0/16</span> → VirtualNetworkGateway</p>
                  <p><span className="font-mono">10.0.0.192/26</span> → VnetLocal (bastion)</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Local Network Gateway (OnPrem-LNG)</p>
                  <p><span className="text-muted-foreground">Public IP:</span> <span className="font-mono">207.178.111.98</span></p>
                  <p className="text-xs text-muted-foreground">Address prefixes include 172.25.0.0/21, 172.25.0.0/24…172.25.6.0/24, plus extensive 10.x, 172.16/18/20/23 and 192.168.0.0/16. Confirm in portal before edits.</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">DNS (VNet)</p>
                  <p className="font-mono text-xs">10.40.1.80, 10.40.1.82, 10.0.0.34, 10.40.1.77, 10.40.1.68 — on-prem / hybrid mix</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other VNets in subscription</p>
                  <p className="text-xs font-mono">Hybrid-TEST01-vnet · 104_VNET · vnet-prod-web · vnet_NEW · aadds-vnet (SCCC_DOMAIN_SERVICES) · test-gateway-vnet · TestVM01-vnet · test-wsus-vnet</p>
                </div>
              </div>
              <div className="rounded border border-amber-200 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                Snapshot is point-in-time from the last <span className="font-mono">azure_visualizer.ps1</span> export.
                Re-run that script (PowerShell, requires <span className="font-mono">az login</span> and the
                <span className="font-mono"> resource-graph</span> extension) to refresh.
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="west" className="border rounded-md px-3 bg-card">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Radio className="h-4 w-4 text-amber-700" />
                <span className="font-medium">West Campus — IPsec site (172.25.0.0/21)</span>
                <Badge variant="outline" className="ml-auto text-xs">VPN-only</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-3 pt-2">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Addressing</p>
                  <p><span className="font-mono text-emerald-700">172.25.0.0/21</span> — West aggregate (FortiGate Phase 2 Vlan_910_915, Azure OnPrem-LNG)</p>
                  <p><span className="font-mono">VLAN 910</span> — <span className="font-mono text-emerald-700">172.25.1.0/24</span> (West_17225_to_Azure)</p>
                  <p><span className="font-mono">West_Wired</span> — <span className="font-mono text-emerald-700">172.25.0.0/24</span></p>
                  <p><span className="font-mono">West_Wireless</span> — <span className="font-mono text-emerald-700">10.11.16.0/24</span></p>
                  <p className="text-xs text-amber-700">FortiGate <span className="font-mono">West_All</span> may exclude 172.25.1.0/24 — Vlan_910 sources can miss policies that use it.</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connectivity</p>
                  <p>Reaches main campus / Azure via <strong>IPsec</strong> through <span className="font-mono">West_FGT</span> ↔ <span className="font-mono">Fortigate1-Sccc</span>.</p>
                  <p className="text-xs text-muted-foreground">Static route <span className="font-mono">172.25.0.0/21 → West_FGT</span> on the HQ side.</p>
                  <p className="text-xs text-muted-foreground">Not extended as a campus L2 VLAN like Epworth — design is VPN-only.</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tunnel runtime (last reviewed)</p>
                  <p><span className="font-mono">West_FGT</span>: ~28 Phase 2 selectors, 14 up; <span className="text-amber-700">~240k TX errors flagged</span> — investigate MTU / path.</p>
                  <p><span className="font-mono">Azure-SCCC2</span>: 56 selectors, 33 up (not all SAs up at once is normal).</p>
                  <p>Phase 2 names: <span className="font-mono">West_17225_to_Azure</span> (172.25.1.0/24 → Azure), <span className="font-mono">Vlan_910_915</span> (172.25.0.0/21 → Azure).</p>
                </div>
                <div className="rounded border bg-background/40 p-3 space-y-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relevant FortiGate policies (Fortigate1-Sccc)</p>
                  <p className="text-xs">222/223 — West ↔ campus &nbsp;·&nbsp; 229 — campus → Azure &nbsp;·&nbsp; 244/245/246/248 — West ↔ Azure</p>
                  <p className="text-xs"><span className="font-mono">SCCC_To_WestsideFGT</span>: port3 → West_FGT (src WestFGT_Outgoing, dst WestFGT_Incoming)</p>
                  <p className="text-xs"><span className="font-mono">WestFGT_To_SCCC</span>: West_FGT → port3 (mirror direction)</p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="epworth" className="border rounded-md px-3 bg-card">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <Radio className="h-4 w-4 text-emerald-700" />
                <span className="font-medium">Epworth — dark fiber / OSPF site</span>
                <Badge variant="outline" className="ml-auto text-xs">L2/L3 extended</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm space-y-2 pt-2">
              <p>Connected to the core via <strong>dark fiber</strong> with OSPF, in contrast to West's IPsec design.</p>
              <p><span className="font-mono">VLAN 773</span> — <span className="font-mono">EpworthBuilding</span> (named on the aa144 Nexus pair).</p>
              <p><span className="font-mono">VLAN 616</span> — <span className="font-mono">OSPF10-Epworth</span> (transit /30, e.g. interface description <span className="font-mono">OSPF10-Epworth-To-Cisco9k-A48</span>).</p>
              <p><span className="font-mono">E117-E213-EpworthLabs</span> for lab segments.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function CampusMapPanel() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <MapIcon className="h-4 w-4 mr-2" /> Campus Map
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>SCCC Main Campus Map</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <img
            src={`${import.meta.env.BASE_URL}network/campus-map.png`}
            alt="SCCC campus map"
            className="w-full rounded border"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Remote sites Epworth and West are not shown on the main-campus map.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Network() {
  const searchString = useSearch();
  const { user } = useAuth();
  const isNetworkAdmin = ["cio", "network", "network_engineer"].includes(user?.role ?? "");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("buildings");
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const q = params.get("q");
    const t = params.get("tab");
    if (q !== null) setSearch(q);
    if (t && ["buildings", "switches", "vlans", "history"].includes(t)) setTab(t);
  }, [searchString]);

  const [exportAllOpen, setExportAllOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const askAI = (prompt: string) => {
    setPendingPrompt(prompt);
    setAiOpen(true);
  };
  const { data: switches, isLoading: switchesLoading } = useListSwitches({});
  const { data: vlans, isLoading: vlansLoading } = useListVlans({});

  const q = search.toLowerCase();
  const allSwitches: NetworkSwitch[] = switches ?? [];
  const allVlans: Vlan[] = vlans ?? [];
  const filteredSwitches = allSwitches.filter((s) => matchSwitch(s, q));
  const filteredVlans = allVlans.filter((v) => matchVlan(v, q));

  const buildings = useMemo(() => {
    const m: Record<string, { switches: NetworkSwitch[]; vlans: Vlan[] }> = {};
    for (const s of allSwitches) {
      const b = s.building || "Unassigned";
      (m[b] ||= { switches: [], vlans: [] }).switches.push(s);
    }
    for (const v of allVlans) {
      const b = v.building || "Unassigned";
      (m[b] ||= { switches: [], vlans: [] }).vlans.push(v);
    }
    let entries = Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
    if (q) {
      entries = entries
        .map(([name, group]) => {
          const swMatch = group.switches.filter((s) => matchSwitch(s, q));
          const vlMatch = group.vlans.filter((v) => matchVlan(v, q));
          const buildingMatches = name.toLowerCase().includes(q);
          if (buildingMatches) return [name, group] as const;
          if (swMatch.length || vlMatch.length) {
            return [name, { switches: swMatch, vlans: vlMatch }] as const;
          }
          return null;
        })
        .filter(Boolean) as [string, { switches: NetworkSwitch[]; vlans: Vlan[] }][];
    }
    return entries;
  }, [allSwitches, allVlans, q]);

  const isLoading = switchesLoading || vlansLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Network Reference</h1>
        <div className="flex gap-2 flex-wrap">
          <CampusMapPanel />
          <Link href="/network/visualize">
            <Button variant="outline" size="sm">
              <Workflow className="h-4 w-4 mr-2" /> Visualizer
            </Button>
          </Link>
          <Link href="/network/map">
            <Button variant="outline" size="sm">
              <NetworkIcon className="h-4 w-4 mr-2" /> Network Map
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExportAllOpen(true)}
            disabled={isLoading}
          >
            <FileDown className="h-4 w-4 mr-2" /> Export maintenance log
          </Button>
          <ExportAllMaintenanceDialog
            switches={allSwitches}
            vlans={allVlans}
            open={exportAllOpen}
            onOpenChange={setExportAllOpen}
          />
          <AskAIPanel
            open={aiOpen}
            onOpenChange={setAiOpen}
            pendingPrompt={pendingPrompt}
            onPromptConsumed={() => setPendingPrompt(null)}
          />
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by hostname, IP, building, VLAN ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <CloudRemotePanel />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="buildings">
            <Building2 className="h-4 w-4 mr-2" /> Buildings ({buildings.length})
          </TabsTrigger>
          <TabsTrigger value="switches">
            <Server className="h-4 w-4 mr-2" /> Switches ({allSwitches.length})
          </TabsTrigger>
          <TabsTrigger value="vlans">
            <NetworkIcon className="h-4 w-4 mr-2" /> VLANs ({allVlans.length})
          </TabsTrigger>
          {isNetworkAdmin && (
            <TabsTrigger value="health">
              <ShieldCheck className="h-4 w-4 mr-2" /> Health
            </TabsTrigger>
          )}
          {isNetworkAdmin && (
            <TabsTrigger value="history">
              <History className="h-4 w-4 mr-2" /> History
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="buildings" className="mt-4">
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : buildings.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {q ? "No buildings match your search." : "No buildings yet — add switches or VLANs to get started."}
            </div>
          ) : (
            <Accordion
              type="multiple"
              defaultValue={buildings.slice(0, 3).map(([n]) => n)}
              className="space-y-2"
            >
              {buildings.map(([name, group]) => (
                <AccordionItem
                  key={name}
                  value={name}
                  className="border rounded-md px-3 bg-card"
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 flex-1">
                      <Building2 className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">{name}</span>
                      <span className="ml-auto text-xs text-muted-foreground flex gap-3">
                        <span>{group.switches.length} switch{group.switches.length === 1 ? "" : "es"}</span>
                        <span>{group.vlans.length} VLAN{group.vlans.length === 1 ? "" : "s"}</span>
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
                          <Server className="h-3 w-3" /> Switches
                        </p>
                        {group.switches.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No switches recorded.</p>
                        ) : (
                          <div className="rounded border bg-background/40">
                            {group.switches.map((s) => <SwitchRow key={s.id} sw={s} onAskAI={askAI} />)}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
                          <NetworkIcon className="h-3 w-3" /> VLANs
                        </p>
                        {group.vlans.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No VLANs recorded.</p>
                        ) : (
                          <div className="rounded border bg-background/40">
                            {group.vlans.map((v) => <VlanRow key={v.id} vlan={v} onAskAI={askAI} />)}
                          </div>
                        )}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </TabsContent>

        <TabsContent value="switches" className="mt-4">
          {switchesLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : filteredSwitches.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No switches found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredSwitches.map((sw) => (
                <Card key={sw.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1">{sw.building}</p>
                    <SwitchRow sw={sw} onAskAI={askAI} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="vlans" className="mt-4">
          {vlansLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : filteredVlans.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No VLANs found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredVlans.map((vlan) => (
                <Card key={vlan.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-1">{vlan.building}</p>
                    <VlanRow vlan={vlan} onAskAI={askAI} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {isNetworkAdmin && (
          <TabsContent value="health" className="mt-4">
            <InventoryHealth />
          </TabsContent>
        )}

        {isNetworkAdmin && (
          <TabsContent value="history" className="mt-4">
            <InventoryHistory />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
