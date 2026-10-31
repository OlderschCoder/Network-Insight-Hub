import { useState } from "react";
import { Link } from "wouter";
import { useConfirm } from "@/components/ConfirmDialog";
import { useListProjects, useDeleteProject } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, Briefcase, Trash2, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const statusColor: Record<string, string> = {
  planning: "bg-blue-500/10 text-blue-700 border-blue-200",
  in_progress: "bg-amber-500/10 text-amber-700 border-amber-200",
  on_hold: "bg-muted text-muted-foreground border-border",
  completed: "bg-green-500/10 text-green-700 border-green-200",
  cancelled: "bg-red-500/10 text-red-700 border-red-200",
};

const statusLabel: Record<string, string> = {
  planning: "Planning",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function ProjectsIndex() {
  const confirm = useConfirm();
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: projects, isLoading } = useListProjects();
  const deleteMutation = useDeleteProject();

  const list = (projects ?? []) as any[];
  const filtered = list.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.title?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  });

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!(await confirm({
      title: "Delete this project?",
      description: "This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
    }))) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Track major IT initiatives, assignees, progress, and target dates.
          </p>
        </div>
        {isCIO && (
          <Link href="/projects/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" /> New Project
            </Button>
          </Link>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects…"
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {list.length === 0
              ? isCIO
                ? "No projects yet. Click \"New Project\" to start one."
                : "No projects yet."
              : "No projects match your search."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Briefcase className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{p.title}</p>
                        {p.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {p.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap mt-1.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${statusColor[p.status] ?? ""}`}
                          >
                            {statusLabel[p.status] ?? p.status}
                          </Badge>
                          {p.targetDate && (
                            <span className="text-xs text-muted-foreground">
                              Target: {format(new Date(p.targetDate + "T00:00:00"), "MMM d, yyyy")}
                            </span>
                          )}
                          {Array.isArray(p.assignees) && p.assignees.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {p.assignees.length} assignee{p.assignees.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isCIO && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => handleDelete(p.id, e)}
                          disabled={deleteMutation.isPending}
                          aria-label="Delete project"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={p.progress ?? 0} className="h-2 flex-1" />
                    <span className="text-xs text-muted-foreground w-10 text-right">
                      {p.progress ?? 0}%
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
