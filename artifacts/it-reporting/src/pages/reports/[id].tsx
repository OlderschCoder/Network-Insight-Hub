import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetReport,
  useUpdateReport,
  useFinalizeReport,
  useSendReportToZendesk,
  useGetAggregateReport,
  useListLogItems,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { ArrowLeft, Lock, Send, Download, Save } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function ReportDetail() {
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

  const updateMutation = useUpdateReport();
  const finalizeMutation = useFinalizeReport();
  const zendeskMutation = useSendReportToZendesk();

  const [draft, setDraft] = useState({
    title: "",
    summary: "",
    accomplishments: "",
    challenges: "",
    strategicProgress: "",
    nextWeekPlans: "",
  });
  const [dirty, setDirty] = useState(false);

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
      setDirty(false);
    }
  }, [r?.id, r?.updatedAt]);

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
    if (!confirm("Finalize this report? This locks it from further edits.")) return;
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
      await zendeskMutation.mutateAsync({ id });
      toast({ title: "Sent to Zendesk" });
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleExport = async (type: "docx" | "xlsx" | "pdf") => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/export/report/${id}/${type}`, {
        credentials: "include",
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
      </div>

      {/* At-a-glance metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Weekly Logs" value={agg.totalEntries ?? 0} />
        <MetricCard label="Contributors" value={agg.contributorCount ?? 0} />
        <MetricCard label="Items Logged" value={items.length} />
        <MetricCard label="Tickets Resolved" value={agg.totalTickets ?? 0} />
      </div>

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

      {/* Open risks */}
      {risks.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Open Risks &amp; Issues ({risks.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {risks.map((rk: any) => (
                <li key={rk.id} className="border rounded p-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{rk.type}</Badge>
                    <Badge variant="outline" className="text-[10px]">{rk.severity}</Badge>
                    <span className="font-medium">{rk.title}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{rk.userName}</span>
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
