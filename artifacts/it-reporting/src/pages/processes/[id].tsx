import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  useGetProcess,
  useUpdateProcess,
  useDeleteProcess,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Pencil, Save, Trash2, X, Printer, FileText, FileType2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { PROCESS_CATEGORIES } from "./index";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function downloadExport(url: string, filename: string) {
  const res = await fetch(url, { headers: authHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export default function ProcessDetail() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = parseInt(idStr ?? "0");
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user, isCIO } = useAuth();
  const confirmDialog = useConfirm();

  const { data: process, isLoading } = useGetProcess(id);
  const updateMutation = useUpdateProcess();
  const deleteMutation = useDeleteProcess();
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);

  const p = process as any;
  const canEdit = !!p && (isCIO || p.createdBy === user?.id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    category: "general",
    summary: "",
    content: "",
    tags: "",
  });

  const resetDraft = () => {
    if (!p) return;
    setDraft({
      title: p.title ?? "",
      category: p.category ?? "general",
      summary: p.summary ?? "",
      content: p.content ?? "",
      tags: (p.tags ?? []).join(", "),
    });
  };

  useEffect(() => {
    resetDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.updatedAt]);

  const startEditing = () => {
    resetDraft();
    setEditing(true);
  };
  const cancelEditing = () => {
    resetDraft();
    setEditing(false);
  };

  const save = async () => {
    if (!draft.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          title: draft.title.trim(),
          category: draft.category,
          summary: draft.summary.trim() || null,
          content: draft.content,
          tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
        },
      });
      qc.invalidateQueries({ queryKey: [`/api/processes/${id}`] });
      qc.invalidateQueries({ queryKey: ["/api/processes"] });
      toast({ title: "Process saved" });
      setEditing(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({
      title: `Delete "${p?.title ?? "this process"}"?`,
      description: "This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
    }))) return;
    try {
      await deleteMutation.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: ["/api/processes"] });
      toast({ title: "Process deleted" });
      setLocation("/processes");
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleExport = async (kind: "pdf" | "docx") => {
    setExporting(kind);
    try {
      const safe = (p?.title ?? "process").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
      await downloadExport(`${API_BASE}/export/process/${id}/${kind}`, `${safe}.${kind}`);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading…</div>;
  if (!p) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Process not found.</p>
        <Link href="/processes"><Button variant="ghost" className="mt-4">Back</Button></Link>
      </div>
    );
  }

  const catLabel = PROCESS_CATEGORIES.find((c) => c.value === p.category)?.label ?? p.category;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/processes">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="text-lg font-semibold"
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">{p.title}</h1>
          )}
          <p className="text-xs text-muted-foreground">
            {catLabel}
            {p.createdByName ? ` · created by ${p.createdByName}` : ""}
            {` · updated ${format(new Date(p.updatedAt), "MMM d, yyyy")}`}
            {p.updatedByName && p.updatedByName !== p.createdByName ? ` by ${p.updatedByName}` : ""}
          </p>
        </div>
        {!editing && (
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("pdf")}
              disabled={exporting !== null}
              className="print:hidden"
            >
              <FileText className="h-4 w-4 mr-2" /> {exporting === "pdf" ? "Exporting…" : "PDF"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("docx")}
              disabled={exporting !== null}
              className="print:hidden"
            >
              <FileType2 className="h-4 w-4 mr-2" /> {exporting === "docx" ? "Exporting…" : "Word"}
            </Button>
          </>
        )}
        {canEdit && !editing && (
          <>
            <Button variant="outline" size="sm" onClick={startEditing} className="print:hidden">
              <Pencil className="h-4 w-4 mr-2" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={remove} disabled={deleteMutation.isPending} className="print:hidden">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </Button>
          </>
        )}
        {editing && (
          <>
            <Button size="sm" onClick={save} disabled={updateMutation.isPending}>
              <Save className="h-4 w-4 mr-2" /> Save
            </Button>
            <Button variant="outline" size="sm" onClick={cancelEditing}>
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
          </>
        )}
      </div>

      {editing ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Edit Process</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROCESS_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tags (comma separated)</Label>
                <Input
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Summary</Label>
              <Textarea
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                rows={2}
              />
            </div>
            <div>
              <Label className="text-xs">Steps / Content</Label>
              <Textarea
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                rows={18}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {p.summary && (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm whitespace-pre-wrap">{p.summary}</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Steps
                {(p.tags ?? []).map((t: string) => (
                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                ))}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {p.content?.trim() ? (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{p.content}</pre>
              ) : (
                <p className="text-sm text-muted-foreground italic">No steps documented yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
