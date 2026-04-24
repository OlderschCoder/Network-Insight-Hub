import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetProject,
  useUpdateProject,
  useDeleteProject,
  useListUsers,
  useListStrategicObjectives,
  useListReports,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Trash2, Plus, X, Link as LinkIcon, ExternalLink } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useLocation } from "wouter";

const statusLabel: Record<string, string> = {
  planning: "Planning",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function ProjectDetail() {
  const params = useParams();
  const id = Number(params.id);
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: project, isLoading } = useGetProject(id);
  const { data: users } = useListUsers();
  const { data: objectives } = useListStrategicObjectives();
  const { data: allReports } = useListReports({});
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  const p = project as any;

  const [draft, setDraft] = useState({
    title: "",
    description: "",
    status: "planning" as "planning" | "in_progress" | "on_hold" | "completed" | "cancelled",
    progress: 0,
    targetDate: "",
    newEstimatedDate: "",
  });
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [strategicObjectiveIds, setStrategicObjectiveIds] = useState<number[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; url: string; addedAt?: string }[]>([]);
  const [decisions, setDecisions] = useState<{
    id: string; title: string; description?: string;
    status: "pending" | "decided"; decidedBy?: string; decidedAt?: string; createdAt?: string;
  }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [newAttName, setNewAttName] = useState("");
  const [newAttUrl, setNewAttUrl] = useState("");
  const [newDecTitle, setNewDecTitle] = useState("");
  const [newDecDesc, setNewDecDesc] = useState("");

  useEffect(() => {
    if (p) {
      setDraft({
        title: p.title ?? "",
        description: p.description ?? "",
        status: p.status ?? "planning",
        progress: p.progress ?? 0,
        targetDate: p.targetDate ?? "",
        newEstimatedDate: p.newEstimatedDate ?? "",
      });
      setAssigneeIds((p.assignees ?? []).map((a: any) => a.userId));
      setStrategicObjectiveIds(Array.isArray(p.strategicObjectiveIds) ? p.strategicObjectiveIds : []);
      setAttachments(Array.isArray(p.attachments) ? p.attachments : []);
      setDecisions(Array.isArray(p.pendingDecisions) ? p.pendingDecisions : []);
      setDirty(false);
    }
  }, [p?.id, p?.updatedAt]);

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading…</div>;
  }
  if (!project) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Project not found.</p>
        <Link href="/projects"><Button variant="ghost" className="mt-4">Back</Button></Link>
      </div>
    );
  }

  const update = (field: keyof typeof draft, value: any) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
  };
  const toggleObjective = (objId: number, checked: boolean) => {
    setStrategicObjectiveIds((ids) =>
      checked ? Array.from(new Set([...ids, objId])) : ids.filter((x) => x !== objId),
    );
    setDirty(true);
  };

  const toggleAssignee = (userId: number, checked: boolean) => {
    setAssigneeIds((ids) =>
      checked ? Array.from(new Set([...ids, userId])) : ids.filter((x) => x !== userId),
    );
    setDirty(true);
  };
  const addAttachment = () => {
    if (!newAttName.trim() || !newAttUrl.trim()) return;
    setAttachments((a) => [...a, { name: newAttName.trim(), url: newAttUrl.trim() }]);
    setNewAttName("");
    setNewAttUrl("");
    setDirty(true);
  };
  const removeAttachment = (idx: number) => {
    setAttachments((a) => a.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const addDecision = () => {
    if (!newDecTitle.trim()) return;
    setDecisions((d) => [
      ...d,
      {
        id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: newDecTitle.trim(),
        description: newDecDesc.trim() || undefined,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ]);
    setNewDecTitle("");
    setNewDecDesc("");
    setDirty(true);
  };
  const toggleDecisionStatus = (id: string) => {
    setDecisions((d) =>
      d.map((x) =>
        x.id === id
          ? x.status === "pending"
            ? { ...x, status: "decided", decidedAt: new Date().toISOString() }
            : { ...x, status: "pending", decidedAt: undefined }
          : x,
      ),
    );
    setDirty(true);
  };
  const removeDecision = (id: string) => {
    setDecisions((d) => d.filter((x) => x.id !== id));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          ...draft,
          targetDate: draft.targetDate || null,
          strategicObjectiveIds,
          newEstimatedDate: draft.newEstimatedDate || null,
          assigneeIds,
          attachments,
          pendingDecisions: decisions,
        } as any,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project saved" });
      setDirty(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted" });
      setLocation("/projects");
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const userList = (users ?? []) as any[];
  const risks: any[] = p.risks ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/projects">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight truncate">{p.title}</h1>
          {p.createdByName && (
            <p className="text-sm text-muted-foreground">Created by {p.createdByName}</p>
          )}
        </div>
        <Badge variant="outline">{statusLabel[p.status] ?? p.status}</Badge>
      </div>

      {isCIO && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={updateMutation.isPending || !dirty}>
            <Save className="h-4 w-4 mr-2" />
            {dirty ? "Save Changes" : "Saved"}
          </Button>
          <Button
            variant="outline"
            className="text-destructive"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </Button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
              disabled={!isCIO}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={4}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
              disabled={!isCIO}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={draft.status}
                onValueChange={(v: any) => update("status", v)}
                disabled={!isCIO}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="progress">Progress (%)</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="progress"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.progress}
                  onChange={(e) =>
                    update("progress", Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                  }
                  disabled={!isCIO}
                  className="w-24"
                />
                <Progress value={draft.progress} className="h-2 flex-1" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="targetDate">Target Completion Date</Label>
              <Input
                id="targetDate"
                type="date"
                value={draft.targetDate ?? ""}
                onChange={(e) => update("targetDate", e.target.value)}
                disabled={!isCIO}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newEstimatedDate">New Estimated Date</Label>
              <Input
                id="newEstimatedDate"
                type="date"
                value={draft.newEstimatedDate ?? ""}
                onChange={(e) => update("newEstimatedDate", e.target.value)}
                disabled={!isCIO}
              />
              <p className="text-xs text-muted-foreground">
                Use when target slips; original target is preserved above.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Strategic Objectives</CardTitle></CardHeader>
        <CardContent>
          {(() => {
            const objList = (objectives ?? []) as any[];
            const visible = objList.filter(
              (o: any) => o.status !== "archived" || strategicObjectiveIds.includes(o.id),
            );
            if (visible.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  No strategic objectives yet. Add them on the Strategic Objectives page first.
                </p>
              );
            }
            return (
              <div className="space-y-1.5">
                {visible.map((o: any) => (
                  <label
                    key={o.id}
                    className="flex items-start gap-2 text-sm cursor-pointer p-1"
                  >
                    <Checkbox
                      checked={strategicObjectiveIds.includes(o.id)}
                      onCheckedChange={(v) => toggleObjective(o.id, v === true)}
                      disabled={!isCIO}
                      className="mt-0.5"
                    />
                    <span>
                      {o.title}
                      {o.status === "archived" && (
                        <span className="text-xs text-muted-foreground ml-2">(archived)</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Assignees</CardTitle></CardHeader>
        <CardContent>
          {userList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading team…</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-1.5">
              {userList.map((u: any) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 text-sm cursor-pointer p-1"
                >
                  <Checkbox
                    checked={assigneeIds.includes(u.id)}
                    onCheckedChange={(v) => toggleAssignee(u.id, v === true)}
                    disabled={!isCIO}
                  />
                  <span>
                    {u.name || u.email}{" "}
                    <span className="text-xs text-muted-foreground">({u.role})</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attachments yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {attachments.map((a, i) => (
                <li key={i} className="flex items-center gap-2 text-sm border rounded p-2">
                  <LinkIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate hover:underline"
                  >
                    {a.name}
                  </a>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {isCIO && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeAttachment(i)}
                      aria-label="Remove"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isCIO && (
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t">
              <Input
                placeholder="Link name (e.g. Project plan)"
                value={newAttName}
                onChange={(e) => setNewAttName(e.target.value)}
              />
              <Input
                placeholder="https://…"
                value={newAttUrl}
                onChange={(e) => setNewAttUrl(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={addAttachment}
                disabled={!newAttName.trim() || !newAttUrl.trim()}
              >
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Paste links to SharePoint, Google Drive, or other shared documents.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pending Decisions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions tracked yet.</p>
          ) : (
            <ul className="space-y-2">
              {decisions.map((d) => (
                <li
                  key={d.id}
                  className={`border rounded p-2 text-sm ${
                    d.status === "decided" ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={d.status === "decided"}
                      onCheckedChange={() => isCIO && toggleDecisionStatus(d.id)}
                      disabled={!isCIO}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-medium ${
                            d.status === "decided" ? "line-through" : ""
                          }`}
                        >
                          {d.title}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {d.status === "decided" ? "Decided" : "Pending"}
                        </Badge>
                        {d.decidedAt && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(d.decidedAt), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                      {d.description && (
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                          {d.description}
                        </p>
                      )}
                    </div>
                    {isCIO && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeDecision(d.id)}
                        aria-label="Remove decision"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {isCIO && (
            <div className="space-y-2 pt-2 border-t">
              <Input
                placeholder="Decision needed (e.g. Pick vendor for switches)"
                value={newDecTitle}
                onChange={(e) => setNewDecTitle(e.target.value)}
              />
              <Textarea
                rows={2}
                placeholder="Optional context…"
                value={newDecDesc}
                onChange={(e) => setNewDecDesc(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addDecision}
                disabled={!newDecTitle.trim()}
              >
                <Plus className="h-4 w-4 mr-2" /> Add decision
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(() => {
        const linkedReports = ((allReports ?? []) as any[]).filter(
          (r) => Array.isArray(r.projectIds) && r.projectIds.includes(id),
        );
        if (linkedReports.length === 0) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle>Included in Reports ({linkedReports.length})</CardTitle>
              <p className="text-xs text-muted-foreground">
                Weekly reports that reference this project.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {linkedReports.map((r: any) => (
                  <li key={r.id}>
                    <Link href={`/reports/${r.id}`}>
                      <span className="text-sm hover:underline cursor-pointer">
                        Week of {r.weekOf}
                        {r.title ? ` — ${r.title}` : ""}
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {r.status}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })()}

      {risks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Linked Risks &amp; Issues ({risks.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {risks.map((rk: any) => (
                <li key={rk.id} className="border rounded p-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{rk.type}</Badge>
                    <Badge variant="outline" className="text-[10px]">{rk.severity}</Badge>
                    <Link href={`/risks/${rk.id}/edit`}>
                      <span className="font-medium hover:underline cursor-pointer">{rk.title}</span>
                    </Link>
                    {rk.userName && (
                      <span className="text-xs text-muted-foreground ml-auto">{rk.userName}</span>
                    )}
                  </div>
                  {rk.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{rk.description}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-center">
        {p.createdAt && `Created ${format(new Date(p.createdAt), "MMM d, yyyy")}`}
        {p.updatedAt && ` • Updated ${format(new Date(p.updatedAt), "MMM d, yyyy")}`}
      </p>
    </div>
  );
}
