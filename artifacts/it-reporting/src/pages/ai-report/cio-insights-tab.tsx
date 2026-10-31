import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import {
  Loader2,
  Flag,
  Copy,
  ClipboardList,
  Bell,
  Plus,
  Check,
  X,
  Trash2,
  Save,
  Pencil,
} from "lucide-react";
import { CaptureDialog } from "./capture-dialog";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

interface RedFlag {
  title: string;
  detail: string;
  severity: "low" | "medium" | "high" | "critical";
  source: string;
}

interface RedFlagResult {
  weekOf: string;
  flags: RedFlag[];
  narrative: string;
  alertNote: string;
  riskEntry: { type: string; severity: string; title: string; description: string } | null;
}

interface ShadowNote {
  id: number;
  weekOf: string | null;
  category: string;
  content: string;
  status: "open" | "approved" | "dismissed";
  source: string;
  createdByName: string | null;
  createdAt: string;
}

const SEV_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function isoWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  const monday = new Date(dt.getTime() - (dow - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}

function RedFlagsPanel({ weekOf }: { weekOf: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RedFlagResult | null>(null);
  const [creatingRisk, setCreatingRisk] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/status-report/red-flags`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ weekOf }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (e: any) {
      toast({ title: "Could not generate red flags", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const createRisk = async () => {
    if (!result?.riskEntry) return;
    setCreatingRisk(true);
    try {
      const res = await fetch(`${API_BASE}/risks`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(result.riskEntry),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Risks & Issues entry created", description: result.riskEntry.title });
    } catch (e: any) {
      toast({ title: "Could not create entry", description: e.message, variant: "destructive" });
    } finally {
      setCreatingRisk(false);
    }
  };

  const saveAlertAsNote = async () => {
    if (!result?.alertNote) return;
    setSavingNote(true);
    try {
      const res = await fetch(`${API_BASE}/cio-shadow-notes`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          content: result.alertNote,
          category: "red_flag",
          weekOf: result.weekOf,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Alert saved to shadow memory" });
    } catch (e: any) {
      toast({ title: "Could not save alert", description: e.message, variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" /> Weekly AI Red Flags
          </CardTitle>
          <CardDescription>
            Scans this week's tasks, entries, risks, incidents, and projects for items worth calling
            out. Output is offered in three ready-to-use formats.
          </CardDescription>
        </div>
        <Button onClick={generate} disabled={loading} className="shrink-0">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...
            </>
          ) : (
            <>
              <Flag className="h-4 w-4 mr-2" /> Generate
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {!result && !loading && (
          <div className="border-2 border-dashed border-border rounded-md py-12 text-center text-muted-foreground text-sm">
            Pick a week above and click Generate to surface red flags.
          </div>
        )}

        {result && result.flags.length === 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            No red flags identified for the week of {result.weekOf}. A quiet week.
          </div>
        )}

        {result && result.flags.length > 0 && (
          <>
            <div className="space-y-2">
              {result.flags.map((f, i) => (
                <div key={i} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Badge className={SEV_COLORS[f.severity] ?? SEV_COLORS.medium}>
                      {f.severity}
                    </Badge>
                    <span className="font-medium text-sm">{f.title}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5">{f.detail}</p>
                  {f.source && (
                    <p className="text-xs text-muted-foreground/80 mt-1 italic">Source: {f.source}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-1.5">
                    <ClipboardList className="h-4 w-4" /> Report narrative
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copy(result.narrative, "Narrative")}
                    disabled={!result.narrative}
                  >
                    <Copy className="h-4 w-4 mr-1" /> Copy
                  </Button>
                </div>
                <Textarea readOnly rows={8} value={result.narrative} className="text-xs" />
                <p className="text-xs text-muted-foreground">
                  Paste into the weekly report under a "Risks & Red Flags" heading.
                </p>
              </div>

              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-1.5">
                    <Flag className="h-4 w-4" /> Risks & Issues entry
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={createRisk}
                    disabled={creatingRisk || !result.riskEntry}
                  >
                    {creatingRisk ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1" />
                    )}
                    Create
                  </Button>
                </div>
                <Textarea
                  readOnly
                  rows={8}
                  value={result.riskEntry?.description ?? ""}
                  className="text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Creates one issue ({result.riskEntry?.severity}) on the Risks & Issues board.
                </p>
              </div>

              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-1.5">
                    <Bell className="h-4 w-4" /> Alert note
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copy(result.alertNote, "Alert note")}
                      disabled={!result.alertNote}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={saveAlertAsNote}
                      disabled={savingNote || !result.alertNote}
                    >
                      {savingNote ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <Textarea readOnly rows={8} value={result.alertNote} className="text-xs" />
                <p className="text-xs text-muted-foreground">
                  Save to your private shadow memory below, or copy as an at-a-glance alert.
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ShadowNotesPanel({ weekOf }: { weekOf: string }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState<ShadowNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterWeek, setFilterWeek] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: number; content: string; category: string } | null>(
    null,
  );
  const [savingEdit, setSavingEdit] = useState(false);
  const [capture, setCapture] = useState<{ open: boolean; text: string }>({
    open: false,
    text: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterWeek) params.set("weekOf", weekOf);
      const res = await fetch(`${API_BASE}/cio-shadow-notes?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotes(await res.json());
    } catch (e: any) {
      toast({ title: "Could not load notes", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterWeek, weekOf]);

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/cio-shadow-notes`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: draft.trim(), weekOf }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      toast({ title: "Note added" });
      load();
    } catch (e: any) {
      toast({ title: "Could not add note", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: number, status: ShadowNote["status"]) => {
    try {
      const res = await fetch(`${API_BASE}/cio-shadow-notes/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, status } : n)));
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.content.trim()) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`${API_BASE}/cio-shadow-notes/${editing.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          content: editing.content.trim(),
          category: editing.category.trim() || "general",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setNotes((prev) =>
        prev.map((n) =>
          n.id === editing.id
            ? { ...n, content: editing.content.trim(), category: editing.category.trim() || "general" }
            : n,
        ),
      );
      setEditing(null);
      toast({ title: "Note updated" });
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/cio-shadow-notes/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      toast({ title: "Note deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shadow Memory</CardTitle>
        <CardDescription>
          Your private staging area — observations and suggestions visible only to you (CIO). Review
          them at reporting time and promote the useful ones into a tracked record. Nothing here is
          shared with staff or added to any report automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-start">
          <Textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Jot a private note for this week..."
            className="text-sm"
          />
          <Button onClick={add} disabled={saving || !draft.trim()} className="shrink-0">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={filterWeek ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterWeek((v) => !v)}
          >
            {filterWeek ? `Week of ${weekOf}` : "All weeks"}
          </Button>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {notes.length === 0 && !loading && (
          <div className="border-2 border-dashed border-border rounded-md py-10 text-center text-muted-foreground text-sm">
            No shadow notes yet.
          </div>
        )}

        <div className="space-y-2">
          {notes.map((n) => (
            <div
              key={n.id}
              className={`rounded-md border p-3 ${
                n.status === "dismissed"
                  ? "border-border/60 opacity-60"
                  : n.status === "approved"
                    ? "border-emerald-300 dark:border-emerald-800"
                    : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {n.category}
                    </Badge>
                    {n.source === "ai" && (
                      <Badge variant="secondary" className="text-xs">
                        AI
                      </Badge>
                    )}
                    <Badge
                      className={`text-xs ${
                        n.status === "approved"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : n.status === "dismissed"
                            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {n.status}
                    </Badge>
                    {n.weekOf && (
                      <span className="text-xs text-muted-foreground">week {n.weekOf}</span>
                    )}
                  </div>
                  {editing?.id === n.id ? (
                    <div className="mt-2 space-y-2">
                      <Input
                        value={editing.category}
                        onChange={(e) =>
                          setEditing((prev) => (prev ? { ...prev, category: e.target.value } : prev))
                        }
                        placeholder="Category"
                        className="h-8 text-xs"
                      />
                      <Textarea
                        rows={3}
                        value={editing.content}
                        onChange={(e) =>
                          setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))
                        }
                        className="text-sm"
                      />
                    </div>
                  ) : (
                    <p className="text-sm mt-2 whitespace-pre-wrap">{n.content}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {n.createdByName ?? "Unknown"} · {new Date(n.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {editing?.id === n.id ? (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={saveEdit}
                      disabled={savingEdit || !editing.content.trim()}
                    >
                      {savingEdit ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5 mr-1" />
                      )}
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCapture({ open: true, text: n.content })}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Capture
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditing({ id: n.id, content: n.content, category: n.category })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    {n.status !== "approved" && (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(n.id, "approved")}>
                        <Check className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                    )}
                    {n.status !== "dismissed" && (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(n.id, "dismissed")}>
                        <X className="h-3.5 w-3.5 mr-1" /> Dismiss
                      </Button>
                    )}
                    {n.status !== "open" && (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(n.id, "open")}>
                        Reopen
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => remove(n.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <CaptureDialog
        open={capture.open}
        onOpenChange={(v) => setCapture((c) => ({ ...c, open: v }))}
        sourceText={capture.text}
        sourceLabel="CIO Insights shadow memory"
      />
    </Card>
  );
}

export function CIOInsightsTab() {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [weekInput, setWeekInput] = useState(today);
  const weekOf = isoWeekStart(weekInput);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div>
            <Label>Week</Label>
            <Input
              type="date"
              value={weekInput}
              onChange={(e) => setWeekInput(e.target.value)}
              className="w-44"
            />
          </div>
          <p className="text-sm text-muted-foreground pb-2">
            Analyzing the week beginning <span className="font-medium">{weekOf}</span> (Monday).
          </p>
        </CardContent>
      </Card>

      <RedFlagsPanel weekOf={weekOf} />
      <ShadowNotesPanel weekOf={weekOf} />
    </div>
  );
}
