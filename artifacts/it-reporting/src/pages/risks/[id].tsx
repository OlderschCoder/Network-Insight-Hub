import { Link, useLocation, useParams } from "wouter";
import {
  useGetRisk,
  useUpdateRisk,
  useDeleteRisk,
  useArchiveRisk,
  useUnarchiveRisk,
  useListProjects,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Pencil, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { format } from "date-fns";
import { RISK_CATEGORIES } from "@/components/RiskForm";

const severityColor: Record<string, string> = {
  critical: "bg-red-600/20 text-red-300 border-red-500/30",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  low: "bg-green-500/20 text-green-300 border-green-500/30",
};

const typeColor: Record<string, string> = {
  risk: "bg-red-500/10 text-red-400 border-red-400/20",
  issue: "bg-amber-500/10 text-amber-400 border-amber-400/20",
  suggestion: "bg-blue-500/10 text-blue-400 border-blue-400/20",
};

const probabilityColor: Record<string, string> = {
  critical: "bg-purple-600/20 text-purple-300 border-purple-500/30",
  high: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
  medium: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  low: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const catLabel = (val?: string) =>
  RISK_CATEGORIES.find((c) => c.value === val)?.label || val || "Other";

export default function RiskDetail() {
  const params = useParams();
  const id = Number(params.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [, setLocation] = useLocation();

  const { data: risk, isLoading } = useGetRisk(id);
  const { data: projects } = useListProjects();
  const updateMutation = useUpdateRisk();
  const deleteMutation = useDeleteRisk();
  const archiveMutation = useArchiveRisk();
  const unarchiveMutation = useUnarchiveRisk();

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading…</div>;
  }
  if (!risk) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Risk not found.</p>
        <Link href="/risks"><Button variant="ghost" className="mt-4">Back</Button></Link>
      </div>
    );
  }

  const r: any = risk;
  const isAuthor = user?.id === r.userId;
  const canEdit = isAuthor || user?.role === "cio";
  const canDelete = isAuthor || user?.role === "cio";
  const isArchived = !!r.archivedAt;

  const project =
    r.projectId && projects
      ? ((projects as any[]).find((p: any) => p.id === r.projectId) ?? null)
      : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/risks"] });
    qc.invalidateQueries({ queryKey: [`/api/risks/${id}`] });
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete "${r.title}"?`,
      description:
        "This permanently removes the item from the register. To keep the audit trail, archive it instead.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync({ id });
      invalidate();
      toast({ title: "Deleted" });
      setLocation("/risks");
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const onArchiveToggle = async () => {
    if (isArchived) {
      try {
        await unarchiveMutation.mutateAsync({ id });
        invalidate();
        toast({ title: "Restored" });
      } catch (e: any) {
        toast({ title: "Restore failed", description: e?.message, variant: "destructive" });
      }
      return;
    }
    const ok = await confirm({
      title: `Archive "${r.title}"?`,
      description:
        "Archived items are hidden from the main list but still searchable and recoverable.",
      confirmText: "Archive",
    });
    if (!ok) return;
    try {
      await archiveMutation.mutateAsync({ id });
      invalidate();
      toast({ title: "Archived" });
      setLocation("/risks");
    } catch (e: any) {
      toast({ title: "Archive failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleStatusToggle = async () => {
    const next = r.status === "open" ? "mitigated" : "open";
    try {
      await updateMutation.mutateAsync({ id, data: { status: next as any } });
      invalidate();
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/risks">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{r.title}</h1>
          <p className="text-xs text-muted-foreground">
            Reported by {r.userName ?? "Unknown"} · {format(new Date(r.createdAt), "MMM d, yyyy")}
            {isArchived && ` · archived ${format(new Date(r.archivedAt), "MMM d, yyyy")}`}
          </p>
        </div>
        {canEdit && (
          <Link href={`/risks/${id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil className="h-4 w-4 mr-2" /> Edit
            </Button>
          </Link>
        )}
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={onArchiveToggle}
            disabled={archiveMutation.isPending || unarchiveMutation.isPending}
          >
            {isArchived ? (
              <><ArchiveRestore className="h-4 w-4 mr-2" /> Restore</>
            ) : (
              <><Archive className="h-4 w-4 mr-2" /> Archive</>
            )}
          </Button>
        )}
        {canDelete && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={onDelete}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={typeColor[r.type] ?? ""}>{r.type}</Badge>
            {r.category && <Badge variant="outline">{catLabel(r.category)}</Badge>}
            {r.severity && (
              <Badge variant="outline" className={severityColor[r.severity] ?? ""}>
                impact: {r.severity}
              </Badge>
            )}
            {r.probability && (
              <Badge variant="outline" className={probabilityColor[r.probability] ?? ""}>
                prob: {r.probability}
              </Badge>
            )}
            <Badge variant={r.status === "open" ? "outline" : "secondary"}>{r.status}</Badge>
            {isArchived && <Badge variant="secondary">archived</Badge>}
            {project && (
              <Link href={`/projects/${project.id}`}>
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 text-amber-300 border-amber-400/30 hover:bg-amber-500/20 cursor-pointer"
                >
                  Blocking: {project.title}
                </Badge>
              </Link>
            )}
          </div>
          {r.description && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</h3>
              <p className="text-sm whitespace-pre-wrap">{r.description}</p>
            </div>
          )}
          {r.impact && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Impact</h3>
              <p className="text-sm whitespace-pre-wrap">{r.impact}</p>
            </div>
          )}
          {r.mitigation && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Mitigation</h3>
              <p className="text-sm whitespace-pre-wrap">{r.mitigation}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {(r.relatedBuilding || r.relatedDevice) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Where</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {r.relatedBuilding && <div><span className="text-muted-foreground">Building:</span> {r.relatedBuilding}</div>}
            {r.relatedDevice && <div><span className="text-muted-foreground">Device:</span> {r.relatedDevice}</div>}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleStatusToggle}
          disabled={updateMutation.isPending}
        >
          {r.status === "open" ? "Mark as mitigated" : "Reopen"}
        </Button>
      </div>
    </div>
  );
}
