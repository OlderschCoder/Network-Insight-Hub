import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Circle,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TodoStatus = "open" | "in_progress" | "completed";
type TodoPriority = "low" | "normal" | "high" | "urgent";

type TeamTodo = {
  id: number;
  assigneeId: number;
  assigneeName: string;
  createdById: number;
  createdByName: string;
  title: string;
  details: string | null;
  dueDate: string | null;
  priority: TodoPriority;
  status: TodoStatus;
  completedAt: string | null;
};

type Assignee = { id: number; name: string; role: string };

type TodoDraft = {
  id?: number;
  title: string;
  details: string;
  assigneeId: number;
  dueDate: string;
  priority: TodoPriority;
  status: TodoStatus;
};

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await authFetch(path, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error || body.message || `Request failed (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

const priorityStyle: Record<TodoPriority, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  normal: "border-slate-200 bg-slate-50 text-slate-700",
  high: "border-amber-200 bg-amber-50 text-amber-800",
  urgent: "border-red-200 bg-red-50 text-red-700",
};

export default function TodosPage() {
  const { user } = useAuth();
  const manager =
    user?.role === "cio" ||
    (user as typeof user & { canManageTodos?: boolean })?.canManageTodos === true;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useState("active");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [draft, setDraft] = useState<TodoDraft | null>(null);

  const { data: assignees = [] } = useQuery<Assignee[]>({
    queryKey: ["/api/todos/assignees"],
    queryFn: () => requestJson("/api/todos/assignees"),
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (manager && assigneeFilter !== "all") {
      params.set("assigneeId", assigneeFilter);
    }
    if (["open", "in_progress", "completed"].includes(statusFilter)) {
      params.set("status", statusFilter);
    }
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [assigneeFilter, manager, statusFilter]);

  const { data: todos = [], isLoading } = useQuery<TeamTodo[]>({
    queryKey: ["/api/todos", queryString],
    queryFn: () => requestJson(`/api/todos${queryString}`),
  });

  const visibleTodos =
    statusFilter === "active"
      ? todos.filter((todo) => todo.status !== "completed")
      : todos;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/todos"] });

  const saveMutation = useMutation({
    mutationFn: async (value: TodoDraft) => {
      const body = {
        title: value.title.trim(),
        details: value.details.trim() || null,
        assigneeId: value.assigneeId,
        dueDate: value.dueDate || null,
        priority: value.priority,
        ...(value.id ? { status: value.status } : {}),
      };
      return requestJson<TeamTodo>(
        value.id ? `/api/todos/${value.id}` : "/api/todos",
        {
          method: value.id ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: () => {
      refresh();
      setDraft(null);
      toast({ title: "To-do saved" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save to-do",
        description: error.message,
        variant: "destructive",
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TodoStatus }) =>
      requestJson(`/api/todos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: refresh,
    onError: (error: Error) =>
      toast({
        title: "Could not update to-do",
        description: error.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      requestJson(`/api/todos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast({ title: "To-do deleted" });
    },
  });

  const newTodo = () =>
    setDraft({
      title: "",
      details: "",
      assigneeId: user?.id ?? assignees[0]?.id ?? 0,
      dueDate: "",
      priority: "normal",
      status: "open",
    });

  const editTodo = (todo: TeamTodo) =>
    setDraft({
      id: todo.id,
      title: todo.title,
      details: todo.details ?? "",
      assigneeId: todo.assigneeId,
      dueDate: todo.dueDate ?? "",
      priority: todo.priority,
      status: todo.status,
    });

  const removeTodo = async (todo: TeamTodo) => {
    if (
      await confirm({
        title: `Delete “${todo.title}”?`,
        description: "This removes the assignment from the team to-do list.",
        confirmText: "Delete",
        destructive: true,
      })
    ) {
      deleteMutation.mutate(todo.id);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
            My Work
          </p>
          <h1 className="mt-1 text-2xl font-extrabold">
            {manager ? "Team To-do List" : "My To-do List"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {manager
              ? "Create assignments for any team member and see the complete department list."
              : "Create, update, and complete your own assignments. Other team members’ lists stay private."}
          </p>
        </div>
        <Button onClick={newTodo}>
          <Plus className="mr-2 h-4 w-4" /> New to-do
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {manager ? (
            <div className="space-y-1.5">
              <Label>Team member</Label>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All team members</SelectItem>
                  {assignees.map((person) => (
                    <SelectItem key={person.id} value={String(person.id)}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Badge variant="secondary" className="mb-2 ml-auto">
            {visibleTodos.length} item{visibleTodos.length === 1 ? "" : "s"}
          </Badge>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading to-dos…
          </CardContent>
        </Card>
      ) : visibleTodos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-14 text-center">
            <ClipboardList className="mb-3 h-8 w-8 text-primary" />
            <p className="font-semibold">Nothing waiting here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a to-do or change the current filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleTodos.map((todo) => (
            <Card
              key={todo.id}
              className={todo.status === "completed" ? "opacity-70" : ""}
            >
              <CardContent className="flex flex-wrap items-start gap-3 py-4">
                <button
                  type="button"
                  onClick={() =>
                    statusMutation.mutate({
                      id: todo.id,
                      status:
                        todo.status === "completed" ? "open" : "completed",
                    })
                  }
                  className="mt-0.5 text-primary"
                  aria-label={
                    todo.status === "completed"
                      ? "Reopen to-do"
                      : "Complete to-do"
                  }
                >
                  {todo.status === "completed" ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </button>
                <div className="min-w-[220px] flex-1">
                  <button
                    type="button"
                    onClick={() => editTodo(todo)}
                    className={`text-left font-semibold text-primary hover:underline ${todo.status === "completed" ? "line-through" : ""}`}
                  >
                    {todo.title}
                  </button>
                  {todo.details ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {todo.details}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {manager ? (
                      <span>
                        Assigned to{" "}
                        <strong className="text-foreground">
                          {todo.assigneeName}
                        </strong>
                      </span>
                    ) : null}
                    {todo.dueDate ? <span>Due {todo.dueDate}</span> : null}
                    <span>Created by {todo.createdByName}</span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={priorityStyle[todo.priority]}
                >
                  {todo.priority}
                </Badge>
                <Badge variant="secondary">
                  {todo.status.replace("_", " ")}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Edit to-do"
                  onClick={() => editTodo(todo)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete to-do"
                  onClick={() => removeTodo(todo)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Edit to-do" : "Create to-do"}
            </DialogTitle>
            <DialogDescription>
              {manager
                ? "Assign the work to any active team member."
                : "This item will be added to your private to-do list."}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="todo-title">Title</Label>
                <Input
                  id="todo-title"
                  autoFocus
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="todo-details">Details</Label>
                <Textarea
                  id="todo-details"
                  rows={4}
                  value={draft.details}
                  onChange={(event) =>
                    setDraft({ ...draft, details: event.target.value })
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {manager ? (
                  <div className="space-y-2">
                    <Label>Assigned to</Label>
                    <Select
                      value={String(draft.assigneeId)}
                      onValueChange={(value) =>
                        setDraft({ ...draft, assigneeId: Number(value) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {assignees.map((person) => (
                          <SelectItem key={person.id} value={String(person.id)}>
                            {person.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="todo-due">Due date</Label>
                  <Input
                    id="todo-due"
                    type="date"
                    value={draft.dueDate}
                    onChange={(event) =>
                      setDraft({ ...draft, dueDate: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={draft.priority}
                    onValueChange={(value: TodoPriority) =>
                      setDraft({ ...draft, priority: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draft.id ? (
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={draft.status}
                      onValueChange={(value: TodoStatus) =>
                        setDraft({ ...draft, status: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => draft && saveMutation.mutate(draft)}
              disabled={
                !draft?.title.trim() ||
                !draft?.assigneeId ||
                saveMutation.isPending
              }
            >
              {saveMutation.isPending ? "Saving…" : "Save to-do"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
