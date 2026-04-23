import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateProject, useListUsers, useListStrategicObjectives } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function NewProject() {
  const { isCIO } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateProject();
  const { data: users } = useListUsers();
  const { data: objectives } = useListStrategicObjectives();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<
    "planning" | "in_progress" | "on_hold" | "completed" | "cancelled"
  >("planning");
  const [progress, setProgress] = useState(0);
  const [targetDate, setTargetDate] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [strategicObjectiveIds, setStrategicObjectiveIds] = useState<number[]>([]);

  if (!isCIO) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Only the CIO can create projects.</p>
        <Link href="/projects"><Button variant="ghost" className="mt-4">Back</Button></Link>
      </div>
    );
  }

  const toggleAssignee = (userId: number, checked: boolean) => {
    setAssigneeIds((ids) =>
      checked ? Array.from(new Set([...ids, userId])) : ids.filter((x) => x !== userId),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      const project: any = await createMutation.mutateAsync({
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          progress,
          targetDate: targetDate || null,
          assigneeIds,
          strategicObjectiveIds,
        } as any,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project created" });
      setLocation(`/projects/${project.id}`);
    } catch (err: any) {
      toast({ title: "Create failed", description: err?.message, variant: "destructive" });
    }
  };

  const userList = (users ?? []) as any[];
  const objectiveList = ((objectives ?? []) as any[]).filter(
    (o: any) => o.status !== "archived",
  );

  const toggleObjective = (id: number, checked: boolean) => {
    setStrategicObjectiveIds((ids) =>
      checked ? Array.from(new Set([...ids, id])) : ids.filter((x) => x !== id),
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/projects">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Network refresh – Phase 2"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Goals, scope, success criteria…"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                  <SelectTrigger id="status"><SelectValue /></SelectTrigger>
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
                <Input
                  id="progress"
                  type="number"
                  min={0}
                  max={100}
                  value={progress}
                  onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="targetDate">Target Completion Date</Label>
              <Input
                id="targetDate"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Strategic Objectives</Label>
              {objectiveList.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active strategic objectives yet. Add some on the Strategic Objectives page.
                </p>
              ) : (
                <div className="space-y-1.5 border rounded p-3 max-h-56 overflow-auto">
                  {objectiveList.map((o: any) => (
                    <label key={o.id} className="flex items-start gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={strategicObjectiveIds.includes(o.id)}
                        onCheckedChange={(v) => toggleObjective(o.id, v === true)}
                        className="mt-0.5"
                      />
                      <span>{o.title}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Assignees</Label>
              {userList.length === 0 ? (
                <p className="text-xs text-muted-foreground">Loading team…</p>
              ) : (
                <div className="space-y-1.5 border rounded p-3 max-h-56 overflow-auto">
                  {userList.map((u: any) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={assigneeIds.includes(u.id)}
                        onCheckedChange={(v) => toggleAssignee(u.id, v === true)}
                      />
                      <span>
                        {u.name || u.email}{" "}
                        <span className="text-xs text-muted-foreground">({u.role})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 mt-4">
          <Link href="/projects">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create Project"}
          </Button>
        </div>
      </form>
    </div>
  );
}
