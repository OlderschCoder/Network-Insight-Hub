import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAiKnowledge,
  useCreateAiKnowledge,
  useUpdateAiKnowledge,
  useDeleteAiKnowledge,
  getListAiKnowledgeQueryKey,
  type AiKnowledge,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Brain, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";

const CATEGORIES = [
  "organization", "environment", "network", "wireless", "azure", "identity",
  "applications", "endpoints", "monitoring", "security", "helpdesk", "general",
] as const;

const SOURCE_LABEL: Record<string, { label: string; className: string }> = {
  seed: { label: "Seeded", className: "bg-secondary text-secondary-foreground" },
  manual: { label: "Manual", className: "bg-primary/10 text-primary" },
  ai: { label: "AI-saved", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
};

interface EditorState {
  id?: number;
  category: string;
  title: string;
  content: string;
}

export function MemoryTab() {
  const { toast } = useToast();
  const { isCIO } = useAuth();
  const queryClient = useQueryClient();
  const { data: entries, isLoading } = useListAiKnowledge();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListAiKnowledgeQueryKey() });

  const createMutation = useCreateAiKnowledge({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditor(null);
        toast({ title: "Memory saved", description: "The AI will use this from now on." });
      },
      onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateAiKnowledge({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditor(null);
      },
      onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteAiKnowledge({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteId(null);
        toast({ title: "Memory deleted" });
      },
      onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
    },
  });

  const filtered = useMemo(() => {
    const list = entries ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((e) => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    });
  }, [entries, search, categoryFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, AiKnowledge[]>();
    for (const e of filtered) {
      if (!map.has(e.category)) map.set(e.category, []);
      map.get(e.category)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const activeCount = (entries ?? []).filter((e) => e.isActive).length;

  const handleSave = () => {
    if (!editor) return;
    const title = editor.title.trim();
    const content = editor.content.trim();
    if (!title || !content) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }
    const body = { category: editor.category as (typeof CATEGORIES)[number], title, content };
    if (editor.id != null) {
      updateMutation.mutate({ id: editor.id, data: body });
    } else {
      createMutation.mutate({ data: body });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" /> AI Memory
              </CardTitle>
              <CardDescription>
                Persistent knowledge about the SCCC environment. Every active entry is loaded into
                the AI's context for troubleshooting and reports. The AI can also save new memories
                itself when you tell it something worth remembering.
              </CardDescription>
            </div>
            <Button onClick={() => setEditor({ category: "general", title: "", content: "" })}>
              <Plus className="h-4 w-4 mr-1" /> Add memory
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search memories..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {activeCount} active / {(entries ?? []).length} total
            </span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No memories match. Add one to teach the AI about the environment.
            </p>
          ) : (
            <div className="space-y-6">
              {grouped.map(([category, items]) => (
                <div key={category}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {category} <span className="font-normal">({items.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {items.map((e) => {
                      const src = SOURCE_LABEL[e.source] ?? SOURCE_LABEL.manual;
                      const expanded = expandedId === e.id;
                      return (
                        <div
                          key={e.id}
                          className={`rounded-md border p-3 ${e.isActive ? "" : "opacity-55"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              className="text-left flex-1 min-w-0"
                              onClick={() => setExpandedId(expanded ? null : e.id)}
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{e.title}</span>
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border-0 ${src.className}`}>
                                  {src.label}
                                </Badge>
                                {!e.isActive && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                                )}
                              </div>
                              <p className={`text-xs text-muted-foreground mt-1 whitespace-pre-wrap ${expanded ? "" : "line-clamp-2"}`}>
                                {e.content}
                              </p>
                              {expanded && e.updatedByName && (
                                <p className="text-[10px] text-muted-foreground mt-2">
                                  Last updated by {e.updatedByName}
                                </p>
                              )}
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <Switch
                                checked={e.isActive}
                                onCheckedChange={(checked) =>
                                  updateMutation.mutate({ id: e.id, data: { isActive: checked } })
                                }
                                title={e.isActive ? "Active — used by the AI" : "Inactive — ignored by the AI"}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                  setEditor({ id: e.id, category: e.category, title: e.title, content: e.content })
                                }
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {isCIO && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => setDeleteId(e.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editor != null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editor?.id != null ? "Edit memory" : "Add memory"}</DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={editor.category}
                    onValueChange={(v) => setEditor({ ...editor, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input
                    value={editor.title}
                    onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                    placeholder="e.g. Epworth site uplink details"
                    maxLength={300}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Content</Label>
                <Textarea
                  value={editor.content}
                  onChange={(e) => setEditor({ ...editor, content: e.target.value })}
                  placeholder="The fact, procedure, or environment detail the AI should remember. Do not store passwords or secrets."
                  rows={10}
                  maxLength={20000}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Never store passwords, API keys, or other secrets in AI memory.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will permanently forget this entry. If you just want the AI to stop using it,
              toggle it inactive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId != null && deleteMutation.mutate({ id: deleteId })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
