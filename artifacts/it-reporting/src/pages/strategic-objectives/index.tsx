import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  useListStrategicObjectives,
  useCreateStrategicObjective,
  useUpdateStrategicObjective,
  useDeleteStrategicObjective,
  useListProjects,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, Check, X, Target, Archive, ArchiveRestore } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type SO = {
  id: number;
  title: string;
  description?: string | null;
  status: "active" | "archived";
  createdByName?: string | null;
};

export default function StrategicObjectivesIndex() {
  const confirm = useConfirm();
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: objectivesData, isLoading } = useListStrategicObjectives();
  const { data: projectsData } = useListProjects();
  const createMutation = useCreateStrategicObjective();
  const updateMutation = useUpdateStrategicObjective();
  const deleteMutation = useDeleteStrategicObjective();

  const objectives: SO[] = (objectivesData ?? []) as SO[];
  const projects: any[] = (projectsData ?? []) as any[];

  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/strategic-objectives"] });
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: {
          title: newTitle.trim(),
          description: newDesc.trim() || null,
        } as any,
      });
      invalidate();
      setNewTitle("");
      setNewDesc("");
      setShowForm(false);
      toast({ title: "Strategic objective added" });
    } catch (err: any) {
      toast({ title: "Create failed", description: err?.message, variant: "destructive" });
    }
  };

  const startEdit = (o: SO) => {
    setEditingId(o.id);
    setEditTitle(o.title);
    setEditDesc(o.description ?? "");
  };

  const saveEdit = async (id: number) => {
    if (!editTitle.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id,
        data: { title: editTitle.trim(), description: editDesc.trim() || null } as any,
      });
      invalidate();
      setEditingId(null);
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    }
  };

  const toggleArchive = async (o: SO) => {
    try {
      await updateMutation.mutateAsync({
        id: o.id,
        data: { status: o.status === "active" ? "archived" : "active" } as any,
      });
      invalidate();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    const linked = projects.filter((p: any) => (p.strategicObjectiveIds ?? []).includes(id));
    const msg = linked.length > 0
      ? `Delete this objective? It is currently linked to ${linked.length} project${linked.length === 1 ? "" : "s"}; those projects will keep working but lose this alignment.`
      : "Delete this objective?";
    if (!(await confirm({
      title: "Delete this objective?",
      description: linked.length > 0
        ? `It is currently linked to ${linked.length} project${linked.length === 1 ? "" : "s"}; those projects will keep working but lose this alignment.`
        : undefined,
      confirmText: "Delete",
      destructive: true,
    }))) return;
    try {
      await deleteMutation.mutateAsync({ id });
      invalidate();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
    }
  };

  const linkedCount = (id: number) =>
    projects.filter((p: any) => (p.strategicObjectiveIds ?? []).includes(id)).length;

  const active = objectives.filter((o) => o.status === "active");
  const archived = objectives.filter((o) => o.status === "archived");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6" /> Department Goals
          </h1>
          <p className="text-sm text-muted-foreground">
            Department-wide goals that projects align with.
          </p>
        </div>
        {isCIO && !showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Objective
          </Button>
        )}
      </div>

      {isCIO && showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New Strategic Objective</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="so-title">Title *</Label>
              <Input
                id="so-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Modernize campus network infrastructure"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-desc">Description</Label>
              <Textarea
                id="so-desc"
                rows={3}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What success looks like…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowForm(false); setNewTitle(""); setNewDesc(""); }}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving…" : "Add Objective"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : objectives.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No department goals yet.
            {isCIO && " Click 'New Objective' to add one."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {active.map((o) => (
              <Card key={o.id}>
                <CardContent className="py-3">
                  {editingId === o.id ? (
                    <div className="space-y-2">
                      <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                      <Textarea rows={2} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          <X className="h-4 w-4 mr-1" /> Cancel
                        </Button>
                        <Button size="sm" onClick={() => saveEdit(o.id)}>
                          <Check className="h-4 w-4 mr-1" /> Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{o.title}</h3>
                          <Badge variant="secondary">
                            {linkedCount(o.id)} project{linkedCount(o.id) === 1 ? "" : "s"}
                          </Badge>
                        </div>
                        {o.description && (
                          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                            {o.description}
                          </p>
                        )}
                      </div>
                      {isCIO && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(o)} aria-label="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => toggleArchive(o)} aria-label="Archive">
                            <Archive className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(o.id)} aria-label="Delete">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {archived.length > 0 && (
            <div className="space-y-2 pt-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Archived
              </h2>
              {archived.map((o) => (
                <Card key={o.id} className="opacity-70">
                  <CardContent className="py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{o.title}</h3>
                        <Badge variant="outline">Archived</Badge>
                      </div>
                      {o.description && (
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                          {o.description}
                        </p>
                      )}
                    </div>
                    {isCIO && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => toggleArchive(o)} aria-label="Restore">
                          <ArchiveRestore className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(o.id)} aria-label="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
