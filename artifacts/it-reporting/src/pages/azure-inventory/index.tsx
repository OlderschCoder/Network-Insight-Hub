import { useEffect, useMemo, useState } from "react";
import {
  useListAzureResources,
  useSyncAzureResources,
  type AzureResource,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Cloud, Search, Download, ChevronLeft, ChevronRight, RefreshCw, Boxes } from "lucide-react";

const PAGE_SIZE = 25;

const CSV_COLUMNS: { key: keyof AzureResource; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "resourceGroup", label: "Resource Group" },
  { key: "location", label: "Location" },
  { key: "kind", label: "Kind" },
  { key: "sku", label: "SKU" },
  { key: "subscription", label: "Subscription" },
  { key: "status", label: "Status" },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: AzureResource[]) {
  const header = CSV_COLUMNS.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((r) =>
    CSV_COLUMNS.map((c) => csvCell((r as any)[c.key])).join(","),
  );
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `azure-inventory-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Microsoft.Compute/virtualMachines" -> "Virtual Machines" (provider dropped). */
function prettyType(type: string): string {
  const tail = type.includes("/") ? type.split("/").slice(1).join("/") : type;
  return tail
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  deleted: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function AzureInventoryPage() {
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: resources = [], isLoading, refetch } = useListAzureResources({});
  const syncMut = useSyncAzureResources();

  const handleSync = async () => {
    try {
      const result = await syncMut.mutateAsync();
      toast({
        title: "Synced from Azure",
        description: `${result.created} added · ${result.updated} updated · ${result.removed} marked deleted (${result.total} total).`,
      });
      refetch();
    } catch (err: any) {
      const body = err?.response?.data ?? err?.data;
      const code = body?.error;
      toast({
        title: code === "AZURE_NOT_CONFIGURED" ? "Azure not connected" : "Sync failed",
        description: body?.message ?? err?.message ?? "Could not reach Azure. Try again.",
        variant: "destructive",
      });
    }
  };

  // Distinct resource types with counts, for the dropdown.
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of resources) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count, label: prettyType(type) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [resources]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (!q) return true;
      return [r.name, r.type, r.resourceGroup, r.location, r.kind, r.sku]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q));
    });
  }, [resources, search, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    setPage(0);
  }, [search, typeFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cloud className="h-7 w-7" /> Azure Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full inventory of every Azure resource across the subscription. Sync pulls the latest
            from Azure, stores it, and refreshes on each run. Filter by resource type below.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Boxes className="h-5 w-5" /> {filtered.length} resource{filtered.length === 1 ? "" : "s"}
                {typeFilter !== "all" && (
                  <span className="text-sm font-normal text-muted-foreground">
                    of {resources.length} total
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                {types.length} resource type{types.length === 1 ? "" : "s"} in this subscription.
                {!isCIO && " Read-only — only the CIO can sync."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-64 max-w-full">
                  <SelectValue placeholder="All resource types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All resource types ({resources.length})</SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t.type} value={t.type}>
                      {t.label} ({t.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-64 max-w-full">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, type, RG, location…"
                  className="pl-8"
                />
              </div>
              {isCIO && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncMut.isPending}
                  title="Pull the latest full inventory from Azure"
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
                title={`Export ${filtered.length} resource${filtered.length === 1 ? "" : "s"} to CSV`}
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
              {resources.length === 0
                ? isCIO
                  ? "No resources yet. Click “Sync from Azure” to pull your inventory."
                  : "No resources yet."
                : "No resources match your filters."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Resource Group</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>SKU / Kind</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm">
                        <div>{prettyType(r.type)}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.type}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.resourceGroup ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.location ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div>{r.sku ?? "—"}</div>
                        {r.kind && <div className="text-xs text-muted-foreground">{r.kind}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[r.status] ?? STATUS_COLORS.active}>
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
                  <div>
                    Showing {safePage * PAGE_SIZE + 1}–
                    {Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE)} of {filtered.length}
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
    </div>
  );
}
