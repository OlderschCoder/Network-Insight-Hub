import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  useGetReport,
  useUpdateReport,
  useFinalizeReport,
  useSendReportToZendesk,
  useGetAggregateReport,
  useListLogItems,
  useListReportTickets,
  useListProjects,
  useGetReportExtras,
  useEmailReport,
} from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { ArrowLeft, Lock, Send, Download, Save, Plus, X, Briefcase, Mail, AlertTriangle, Wrench, Target } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ReportDetail() {
  const confirm = useConfirm();
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");
  const { isCIO } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: report, isLoading } = useGetReport(id);
  const r = report as any;

  const { data: aggregate } = useGetAggregateReport(
    { weekOf: r?.weekOf ?? "" },
    { query: { enabled: !!r?.weekOf } } as any,
  );
  const { data: weekItems } = useListLogItems(
    { weekOf: r?.weekOf ?? "" },
    { query: { enabled: !!r?.weekOf } } as any,
  );
  const { data: ticketsResponse } = useListReportTickets(id, {
    query: { enabled: !!r?.id },
  } as any);
  const { data: allProjects } = useListProjects();
  const { data: extras } = useGetReportExtras(id, {
    query: { enabled: !!r?.id },
  } as any);

  const updateMutation = useUpdateReport();
  const finalizeMutation = useFinalizeReport();
  const zendeskMutation = useSendReportToZendesk();
  const emailMutation = useEmailReport();

  const [draft, setDraft] = useState({
    title: "",
    summary: "",
    accomplishments: "",
    challenges: "",
    strategicProgress: "",
    nextWeekPlans: "",
  });
  const [dirty, setDirty] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<number[] | null>(null);
  const [customTasks, setCustomTasks] = useState<{ title: string; userName?: string }[]>([]);
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [selectedAarIds, setSelectedAarIds] = useState<number[] | null>(null);
  const [selectedMaintenanceIds, setSelectedMaintenanceIds] = useState<string[] | null>(null);
  const [selectedRiskIds, setSelectedRiskIds] = useState<number[] | null>(null);
  const [includeGoalProgress, setIncludeGoalProgress] = useState(true);
  const [includeOpenRisks, setIncludeOpenRisks] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskUser, setNewTaskUser] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailRecipientsText, setEmailRecipientsText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailFormat, setEmailFormat] = useState<"pdf" | "docx">("pdf");

  useEffect(() => {
    if (r) {
      setDraft({
        title: r.title ?? "",
        summary: r.summary ?? "",
        accomplishments: r.accomplishments ?? "",
        challenges: r.challenges ?? "",
        strategicProgress: r.strategicProgress ?? "",
        nextWeekPlans: r.nextWeekPlans ?? "",
      });
      setSelectedItemIds(Array.isArray(r.selectedItemIds) ? r.selectedItemIds : null);
      setCustomTasks(Array.isArray(r.customTasks) ? r.customTasks : []);
      setProjectIds(Array.isArray(r.projectIds) ? r.projectIds : []);
      setSelectedAarIds(Array.isArray(r.selectedAfterActionIds) ? r.selectedAfterActionIds : null);
      setSelectedMaintenanceIds(Array.isArray(r.selectedMaintenanceIds) ? r.selectedMaintenanceIds : null);
      setSelectedRiskIds(Array.isArray(r.selectedRiskIds) ? r.selectedRiskIds : null);
      setIncludeGoalProgress(r.includeGoalProgress !== false);
      setIncludeOpenRisks(r.includeOpenRisks !== false);
      setEmailRecipientsText(Array.isArray(r.emailRecipients) ? r.emailRecipients.join(", ") : "");
      setDirty(false);
    }
  }, [r?.id, r?.updatedAt]);

  const persist = async (patch: Record<string, unknown>) => {
    try {
      await updateMutation.mutateAsync({ id, data: patch as any });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  const addCustomTask = async () => {
    if (!newTaskTitle.trim()) return;
    const next = [
      ...customTasks,
      { title: newTaskTitle.trim(), userName: newTaskUser.trim() || undefined },
    ];
    setCustomTasks(next);
    setNewTaskTitle("");
    setNewTaskUser("");
    await persist({ customTasks: next });
  };
  const removeCustomTask = async (idx: number) => {
    const next = customTasks.filter((_, i) => i !== idx);
    setCustomTasks(next);
    await persist({ customTasks: next });
  };
  const toggleProject = async (pid: number, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...projectIds, pid]))
      : projectIds.filter((x) => x !== pid);
    setProjectIds(next);
    await persist({ projectIds: next });
  };

  const toggleAar = async (aarId: number, checked: boolean, allIds: number[]) => {
    const current = selectedAarIds ?? allIds;
    const next = checked
      ? Array.from(new Set([...current, aarId]))
      : current.filter((x) => x !== aarId);
    setSelectedAarIds(next);
    await persist({ selectedAfterActionIds: next });
  };
  const toggleMaint = async (mId: string, checked: boolean, allIds: string[]) => {
    const current = selectedMaintenanceIds ?? allIds;
    const next = checked
      ? Array.from(new Set([...current, mId]))
      : current.filter((x) => x !== mId);
    setSelectedMaintenanceIds(next);
    await persist({ selectedMaintenanceIds: next });
  };
  const toggleRisk = async (riskId: number, checked: boolean, allIds: number[]) => {
    const current = selectedRiskIds ?? allIds;
    const next = checked
      ? Array.from(new Set([...current, riskId]))
      : current.filter((x) => x !== riskId);
    setSelectedRiskIds(next);
    await persist({ selectedRiskIds: next });
  };
  const toggleIncludeGoals = async (v: boolean) => {
    setIncludeGoalProgress(v);
    await persist({ includeGoalProgress: v });
  };
  const toggleIncludeRisks = async (v: boolean) => {
    setIncludeOpenRisks(v);
    await persist({ includeOpenRisks: v });
  };

  const handleSendEmail = async () => {
    const recipients = emailRecipientsText
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && /\S+@\S+\.\S+/.test(s));
    if (recipients.length === 0) {
      toast({ title: "Add at least one recipient", variant: "destructive" });
      return;
    }
    try {
      await emailMutation.mutateAsync({
        id,
        data: {
          recipients,
          subject: emailSubject.trim() || undefined,
          message: emailMessage.trim() || undefined,
          format: emailFormat,
        },
      });
      toast({ title: "Report emailed", description: `Sent to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}` });
      setEmailOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.message || e?.message;
      if (status === 503) {
        toast({
          title: "Email is not configured",
          description: msg || "Ask an admin to add SMTP credentials (SMTP_HOST/PORT/USER/PASS/FROM).",
          variant: "destructive",
        });
      } else {
        toast({ title: "Email failed", description: msg, variant: "destructive" });
      }
    }
  };

  const toggleItem = async (itemId: number, checked: boolean) => {
    const allIds = ((weekItems ?? []) as any[]).map((it: any) => it.id as number);
    const current = selectedItemIds ?? allIds;
    const next = checked
      ? Array.from(new Set([...current, itemId]))
      : current.filter((x) => x !== itemId);
    setSelectedItemIds(next);
    try {
      await updateMutation.mutateAsync({ id, data: { selectedItemIds: next } });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    } catch (e: any) {
      toast({ title: "Could not save selection", description: e?.message, variant: "destructive" });
    }
  };

  const isFinalized = r?.status === "finalized";
  const canEdit = isCIO && !isFinalized;

  const update = (field: keyof typeof draft, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ id, data: draft });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({ title: "Report saved" });
      setDirty(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleFinalize = async () => {
    if (!(await confirm({
      title: "Finalize this report?",
      description: "This locks it from further edits.",
      confirmText: "Finalize",
    }))) return;
    try {
      if (dirty) await updateMutation.mutateAsync({ id, data: draft });
      await finalizeMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({ title: "Report finalized" });
    } catch (e: any) {
      toast({ title: "Finalize failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleZendesk = async () => {
    try {
      await zendeskMutation.mutateAsync({ id, data: {} as any });
      toast({ title: "Sent to Zendesk" });
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleExport = async (type: "docx" | "xlsx" | "pdf") => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${import.meta.env.BASE_URL}api/export/report/${id}/${type}`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `it-report-${(report as any)?.weekOf ?? id}.${type}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading…</div>;
  }
  if (!report) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Report not found.</p>
        <Link href="/reports"><Button variant="ghost" className="mt-4">Back</Button></Link>
      </div>
    );
  }

  const agg: any = aggregate ?? {};
  const entries: any[] = agg.entrySummaries ?? [];
  const risks: any[] = agg.risks ?? [];
  const items: any[] = (weekItems ?? []) as any[];

  // Group items per user for the per-contributor breakdown
  const itemsByUser: Record<number, any[]> = {};
  for (const it of items) (itemsByUser[it.userId] ||= []).push(it);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/reports">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">
            Week of {format(new Date(r.weekOf + "T00:00:00"), "MMMM d, yyyy")}
          </h1>
          {r.createdByName && (
            <p className="text-sm text-muted-foreground">Created by {r.createdByName}</p>
          )}
        </div>
        <Badge variant={isFinalized ? "default" : "secondary"}>
          {isFinalized ? "Finalized" : "Draft"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button onClick={handleSave} disabled={updateMutation.isPending || !dirty}>
            <Save className="h-4 w-4 mr-2" />
            {dirty ? "Save Changes" : "Saved"}
          </Button>
        )}
        {isCIO && !isFinalized && (
          <Button variant="outline" onClick={handleFinalize} disabled={finalizeMutation.isPending}>
            <Lock className="h-4 w-4 mr-2" />
            Finalize
          </Button>
        )}
        <Button variant="outline" onClick={() => handleExport("pdf")}>
          <Download className="h-4 w-4 mr-2" /> Export PDF
        </Button>
        <Button variant="outline" onClick={() => handleExport("docx")}>
          <Download className="h-4 w-4 mr-2" /> Export Word
        </Button>
        <Button variant="outline" onClick={() => handleExport("xlsx")}>
          <Download className="h-4 w-4 mr-2" /> Export Excel
        </Button>
        {isCIO && (
          <Button variant="outline" onClick={handleZendesk} disabled={zendeskMutation.isPending}>
            <Send className="h-4 w-4 mr-2" /> Send to Zendesk
          </Button>
        )}
        {isCIO && (
          <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Mail className="h-4 w-4 mr-2" /> Email Report
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Email Report</DialogTitle>
                <DialogDescription>
                  Send a copy of this report to one or more recipients with the chosen file attached.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Recipients (comma-separated)</Label>
                  <Textarea
                    value={emailRecipientsText}
                    onChange={(e) => setEmailRecipientsText(e.target.value)}
                    placeholder="alice@sccc.edu, bob@sccc.edu"
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Subject (optional)</Label>
                  <Input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder={`IT Department Weekly Report — Week of ${r.weekOf}`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Message (optional)</Label>
                  <Textarea
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    placeholder="Optional intro for the email body…"
                    rows={3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Attachment format</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={emailFormat === "pdf" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEmailFormat("pdf")}
                    >PDF</Button>
                    <Button
                      type="button"
                      variant={emailFormat === "docx" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEmailFormat("docx")}
                    >Word (.docx)</Button>
                  </div>
                </div>
                {r.lastEmailedAt && (
                  <p className="text-xs text-muted-foreground">
                    Last emailed {format(new Date(r.lastEmailedAt), "PPp")}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEmailOpen(false)}>Cancel</Button>
                <Button onClick={handleSendEmail} disabled={emailMutation.isPending}>
                  <Mail className="h-4 w-4 mr-2" />
                  {emailMutation.isPending ? "Sending…" : "Send Email"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* At-a-glance metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Weekly Logs" value={agg.totalEntries ?? 0} />
        <MetricCard label="Contributors" value={agg.contributorCount ?? 0} />
        <MetricCard label="Tasks Completed" value={items.length} />
        <MetricCard label="Tickets Resolved" value={agg.totalTickets ?? 0} />
      </div>

      {/* Included in this export — preview */}
      {(() => {
        const tasksIncluded = (selectedItemIds === null ? items.length : selectedItemIds.length)
          + customTasks.length;
        const ticketsList = (ticketsResponse as { tickets?: unknown[] } | undefined)?.tickets;
        const ticketsIncluded = Array.isArray(ticketsList) ? ticketsList.length : 0;
        const projectsIncluded = projectIds.length;
        const aarsIncluded =
          selectedAarIds === null
            ? extras?.afterActionReports?.length ?? 0
            : selectedAarIds.length;
        const maintIncluded =
          selectedMaintenanceIds === null
            ? extras?.maintenance?.length ?? 0
            : selectedMaintenanceIds.length;
        const goalCount = includeGoalProgress ? extras?.goalProgress?.length ?? 0 : 0;
        const risksIncluded = includeOpenRisks
          ? (selectedRiskIds ? selectedRiskIds.length : risks.length)
          : 0;
        const Item = ({ label, n, on = true }: { label: string; n: number; on?: boolean }) => (
          <div className={`flex items-center justify-between text-sm py-1 ${on ? "" : "opacity-50"}`}>
            <span>{label}</span>
            <span className="font-mono">{on ? n : "—"}</span>
          </div>
        );
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Included in this Export</CardTitle>
              <p className="text-xs text-muted-foreground">
                What will appear when you download a PDF/Word/Excel or email this report.
              </p>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-x-6">
              <Item label="Tasks" n={tasksIncluded} />
              <Item label="Helpdesk tickets resolved" n={ticketsIncluded} />
              <Item label="Projects" n={projectsIncluded} />
              <Item label="Post-Incident Reviews" n={aarsIncluded} />
              <Item label="Network maintenance windows" n={maintIncluded} />
              <Item label="Department goals" n={goalCount} on={includeGoalProgress} />
              <Item label="Open risks &amp; issues" n={risksIncluded} on={includeOpenRisks} />
            </CardContent>
          </Card>
        );
      })()}

      {/* CIO narrative */}
      <Card>
        <CardHeader><CardTitle>Executive Summary</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Title" value={draft.title} onChange={(v) => update("title", v)}
            disabled={!canEdit} placeholder={`Weekly IT report – ${format(new Date(r.weekOf + "T00:00:00"), "MMM d")}`} />
          <Field label="Summary" multiline value={draft.summary} onChange={(v) => update("summary", v)}
            disabled={!canEdit} placeholder="Top-line summary of the week..." />
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Accomplishments" multiline value={draft.accomplishments} onChange={(v) => update("accomplishments", v)} disabled={!canEdit} />
            <Field label="Challenges" multiline value={draft.challenges} onChange={(v) => update("challenges", v)} disabled={!canEdit} />
            <Field label="Strategic Progress" multiline value={draft.strategicProgress} onChange={(v) => update("strategicProgress", v)} disabled={!canEdit} />
            <Field label="Plans for Next Week" multiline value={draft.nextWeekPlans} onChange={(v) => update("nextWeekPlans", v)} disabled={!canEdit} />
          </div>
        </CardContent>
      </Card>

      {/* Per-contributor breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Team Activity ({entries.length} weekly log{entries.length !== 1 ? "s" : ""})</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">No weekly logs submitted for this week.</p>
          )}
          <div className="space-y-4">
            {entries.map((e) => {
              const userItems = itemsByUser[e.userId] ?? [];
              return (
                <div key={e.id} className="border rounded p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{e.userName}</span>
                      <Badge variant="outline" className="text-[10px]">{e.userRole}</Badge>
                      {e.category && (
                        <Badge variant="outline" className="text-[10px]">{e.category}</Badge>
                      )}
                    </div>
                    <Link href={`/entries/${e.id}`}>
                      <Button variant="ghost" size="sm">View log</Button>
                    </Link>
                  </div>
                  {e.title && !e.title.startsWith("Weekly Log") && (
                    <p className="text-sm font-medium">{e.title}</p>
                  )}
                  {e.description &&
                    e.description !== "(See completed items list)" &&
                    e.description !== "(Quick-added items)" && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{e.description}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                    <span>{userItems.length} item{userItems.length !== 1 ? "s" : ""}</span>
                    <span>{(e.zendeskTicketIds?.length ?? e.ticketCount ?? 0)} ticket{(e.zendeskTicketIds?.length ?? e.ticketCount ?? 0) !== 1 ? "s" : ""}</span>
                  </div>
                  {userItems.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground list-disc list-inside">
                      {userItems.slice(0, 5).map((it) => (
                        <li key={it.id}>{it.title}</li>
                      ))}
                      {userItems.length > 5 && <li>…and {userItems.length - 5} more</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Task selection */}
      <Card>
        <CardHeader>
          <CardTitle>Tasks Completed This Week ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks logged for this week.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {canEdit
                  ? "Uncheck any task you don't want included in this report."
                  : "Tasks included in this report."}
              </p>
              <ul className="space-y-1.5">
                {items.map((it: any) => {
                  const allIds = items.map((x: any) => x.id);
                  const current = selectedItemIds ?? allIds;
                  const checked = current.includes(it.id);
                  return (
                    <li key={it.id} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        id={`item-${it.id}`}
                        checked={checked}
                        disabled={!canEdit}
                        onCheckedChange={(v) => toggleItem(it.id, v === true)}
                        className="mt-0.5"
                      />
                      <label htmlFor={`item-${it.id}`} className="flex-1 cursor-pointer">
                        <span className="font-medium">{it.title}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {it.userName}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* Additional / custom tasks */}
      <Card>
        <CardHeader>
          <CardTitle>Additional Tasks ({customTasks.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {customTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No additional tasks. Use this to add work that wasn't logged in the system.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {customTasks.map((t, i) => (
                <li key={i} className="flex items-center gap-2 text-sm border rounded p-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{t.title}</span>
                    {t.userName && (
                      <span className="text-xs text-muted-foreground ml-2">
                        {t.userName}
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeCustomTask(i)}
                      aria-label="Remove task"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t">
              <Input
                placeholder="Task description"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Assignee (optional)"
                value={newTaskUser}
                onChange={(e) => setNewTaskUser(e.target.value)}
                className="sm:w-48"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addCustomTask}
                disabled={!newTaskTitle.trim()}
              >
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Closed Zendesk tickets — per-user totals */}
      {(() => {
        const tickets: any[] = (ticketsResponse as any)?.tickets ?? [];
        const counts = new Map<string, number>();
        let unassigned = 0;
        for (const t of tickets) {
          const name = t.assigneeName as string | null | undefined;
          if (!name) unassigned++;
          else counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        return (
          <Card>
            <CardHeader>
              <CardTitle>Closed Helpdesk Tickets ({tickets.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No solved Zendesk tickets for this week.
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {rows.map(([name, n]) => (
                    <li key={name} className="flex items-center justify-between gap-2 border rounded p-2">
                      <span className="font-medium truncate">{name}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {n} ticket{n !== 1 ? "s" : ""}
                      </Badge>
                    </li>
                  ))}
                  {unassigned > 0 && (
                    <li className="flex items-center justify-between gap-2 border rounded p-2 text-muted-foreground">
                      <span>Unassigned</span>
                      <Badge variant="outline" className="shrink-0">
                        {unassigned}
                      </Badge>
                    </li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Linked Projects */}
      {(() => {
        const projects: any[] = (allProjects ?? []) as any[];
        const linked = projects.filter((p: any) => projectIds.includes(p.id));
        return (
          <Card>
            <CardHeader>
              <CardTitle>Projects in this Report ({linked.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {linked.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {canEdit ? "Pick projects below to include in this report." : "No projects linked."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {linked.map((p: any) => (
                    <li key={p.id} className="border rounded p-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Link href={`/projects/${p.id}`}>
                          <span className="font-medium hover:underline cursor-pointer">{p.title}</span>
                        </Link>
                        <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                        {p.targetDate && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            Target: {format(new Date(p.targetDate + "T00:00:00"), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <Progress value={p.progress ?? 0} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground w-10 text-right">
                          {p.progress ?? 0}%
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && projects.length > 0 && (
                <div className="pt-2 border-t space-y-1.5">
                  <p className="text-xs text-muted-foreground">Available projects</p>
                  <div className="grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-auto">
                    {projects.map((p: any) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 text-sm cursor-pointer p-1"
                      >
                        <Checkbox
                          checked={projectIds.includes(p.id)}
                          onCheckedChange={(v) => toggleProject(p.id, v === true)}
                        />
                        <span className="truncate">{p.title}</span>
                        <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                          {p.status}
                        </Badge>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Post-Incident Reviews this week */}
      {(() => {
        type AarItem = {
          id: number;
          title: string;
          severity: string;
          status: string;
          building?: string | null;
          authorName: string;
          incident?: string | null;
        };
        const aars = (extras?.afterActionReports ?? []) as unknown as AarItem[];
        if (aars.length === 0) return null;
        const allIds = aars.map((a) => a.id);
        const current = selectedAarIds ?? allIds;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Post-Incident Reviews ({aars.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {canEdit && (
                <p className="text-xs text-muted-foreground mb-2">
                  Uncheck reviews you don't want included in this report.
                </p>
              )}
              <ul className="space-y-2">
                {aars.map((a) => {
                  const checked = current.includes(a.id);
                  return (
                    <li key={a.id} className="border rounded p-2">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={checked}
                          disabled={!canEdit}
                          onCheckedChange={(v) => toggleAar(a.id, v === true, allIds)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">{a.severity}</Badge>
                            <Badge variant="outline" className="text-[10px]">{a.status}</Badge>
                            <Link href={`/after-action/${a.id}`}>
                              <span className="font-medium hover:underline cursor-pointer">{a.title}</span>
                            </Link>
                            {a.building && (
                              <span className="text-xs text-muted-foreground">· {a.building}</span>
                            )}
                            <span className="text-xs text-muted-foreground ml-auto">
                              {a.authorName}
                            </span>
                          </div>
                          {a.incident && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.incident}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })()}

      {/* Network Maintenance windows this week */}
      {(() => {
        type MaintItem = {
          id: string;
          body: string;
          authorName: string;
          createdAt?: string | null;
          windowStart?: string | null;
          windowEnd?: string | null;
          switchHostname: string;
          switchBuilding: string;
        };
        const maint = (extras?.maintenance ?? []) as unknown as MaintItem[];
        if (maint.length === 0) return null;
        const allIds = maint.map((m) => m.id);
        const current = selectedMaintenanceIds ?? allIds;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-blue-500" />
                Network Maintenance ({maint.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {canEdit && (
                <p className="text-xs text-muted-foreground mb-2">
                  Uncheck maintenance windows you don't want included.
                </p>
              )}
              <ul className="space-y-2">
                {maint.map((m) => {
                  const checked = current.includes(m.id);
                  const when = m.windowStart
                    ? `${m.windowStart}${m.windowEnd ? ` → ${m.windowEnd}` : ""}`
                    : (m.createdAt ?? "").slice(0, 16).replace("T", " ");
                  return (
                    <li key={m.id} className="border rounded p-2">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={checked}
                          disabled={!canEdit}
                          onCheckedChange={(v) => toggleMaint(m.id, v === true, allIds)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{m.switchHostname}</span>
                            <Badge variant="outline" className="text-[10px]">{m.switchBuilding}</Badge>
                            <span className="text-xs text-muted-foreground ml-auto">{m.authorName}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{when}</p>
                          {m.body && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.body}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })()}

      {/* Goal Progress */}
      {(() => {
        type GoalProject = {
          id: number;
          title: string;
          status: string;
          progress: number;
          weekStartProgress: number;
          weekDelta: number;
        };
        type GoalItem = {
          id: number;
          title: string;
          status: string;
          projectCount: number;
          activeProjectCount: number;
          avgProgress: number;
          avgWeekDelta: number;
          sumWeekDelta: number;
          projects: GoalProject[];
        };
        const goals = (extras?.goalProgress ?? []) as unknown as GoalItem[];
        if (goals.length === 0) return null;
        const fmtDelta = (n: number) => `${n > 0 ? "+" : ""}${n}`;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-green-600" />
                  Department Goals — Progress this week ({goals.length})
                </span>
                {canEdit && (
                  <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    <Checkbox
                      checked={includeGoalProgress}
                      onCheckedChange={(v) => toggleIncludeGoals(v === true)}
                    />
                    Include in this report
                  </label>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {goals.map((g) => (
                  <li key={g.id} className="border rounded p-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{g.title}</span>
                      <Badge variant="outline" className="text-[10px]">{g.status}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {g.activeProjectCount} active / {g.projectCount} project{g.projectCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <Progress value={g.avgProgress} className="h-2 flex-1" />
                      <span className="text-xs text-muted-foreground w-16 text-right">
                        {g.avgProgress}% avg
                      </span>
                    </div>
                    <div className="text-xs mt-1">
                      <span
                        className={
                          g.sumWeekDelta > 0
                            ? "text-green-600 font-medium"
                            : g.sumWeekDelta < 0
                              ? "text-red-600 font-medium"
                              : "text-muted-foreground"
                        }
                      >
                        This week: {fmtDelta(g.sumWeekDelta)} pts (avg {fmtDelta(g.avgWeekDelta)}%)
                      </span>
                    </div>
                    {g.projects.some((p) => p.weekDelta !== 0) && (
                      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground border-t pt-2">
                        {g.projects
                          .filter((p) => p.weekDelta !== 0)
                          .map((p) => (
                            <li key={p.id} className="flex items-center gap-2">
                              <span className="flex-1 truncate">{p.title}</span>
                              <span className="font-mono">
                                {p.weekStartProgress}% → {p.progress}%
                              </span>
                              <span
                                className={
                                  p.weekDelta > 0
                                    ? "text-green-600 font-medium w-12 text-right"
                                    : "text-red-600 font-medium w-12 text-right"
                                }
                              >
                                {fmtDelta(p.weekDelta)}%
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })()}

      {/* Open risks */}
      {risks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>Open Risks &amp; Issues ({risks.length})</span>
              {canEdit && (
                <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  <Checkbox
                    checked={includeOpenRisks}
                    onCheckedChange={(v) => toggleIncludeRisks(v === true)}
                  />
                  Include in this report
                </label>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {risks.map((rk: any) => {
                const proj = rk.projectId
                  ? ((allProjects ?? []) as any[]).find((p) => p.id === rk.projectId)
                  : null;
                const allRiskIds = risks.map((x: any) => x.id);
                const effectiveSelected = selectedRiskIds ?? allRiskIds;
                const checked = effectiveSelected.includes(rk.id);
                return (
                  <li key={rk.id} className="border rounded p-2 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      {canEdit && includeOpenRisks && (
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleRisk(rk.id, v === true, allRiskIds)}
                        />
                      )}
                      <Badge variant="outline" className="text-[10px]">{rk.type}</Badge>
                      <Badge variant="outline" className="text-[10px]">{rk.severity}</Badge>
                      <span className="font-medium">{rk.title}</span>
                      {proj && (
                        <Link href={`/projects/${proj.id}`}>
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-200 hover:bg-amber-500/10 cursor-pointer"
                          >
                            Blocking: {proj.title}
                          </Badge>
                        </Link>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">{rk.userName}</span>
                    </div>
                    {rk.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{rk.description}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({
  label, value, onChange, disabled, multiline, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
