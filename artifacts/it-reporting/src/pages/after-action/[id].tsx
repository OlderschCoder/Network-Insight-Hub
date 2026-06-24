import { useParams, Link } from "wouter";
import {
  useGetAfterActionReport,
  useUpdateAfterActionReport,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ArrowLeft, Download, ExternalLink, Pencil, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

const severityColor: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  medium: "bg-amber-500/10 text-amber-700 border-amber-200",
  high: "bg-orange-500/10 text-orange-700 border-orange-200",
  critical: "bg-red-500/10 text-red-700 border-red-200",
};

const FIELDS: Array<{ key: string; label: string; rows?: number }> = [
  { key: "incident", label: "Incident description", rows: 4 },
  { key: "affectedSystems", label: "Affected systems", rows: 2 },
  { key: "timeline", label: "Timeline", rows: 4 },
  { key: "rootCause", label: "Root cause", rows: 3 },
  { key: "resolution", label: "Resolution", rows: 3 },
  { key: "lessonsLearned", label: "Lessons learned", rows: 3 },
  { key: "preventionMeasures", label: "Prevention measures", rows: 3 },
];

export default function AfterActionDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");
  const { data: report, isLoading, refetch } = useGetAfterActionReport(id);
  const updateMutation = useUpdateAfterActionReport();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  useEffect(() => {
    if (report && !draft) setDraft({ ...report });
  }, [report, draft]);

  const handleExport = async (type: "docx" | "pdf") => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/export/after-action/${id}/${type}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `after-action-${id}.${type}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        title: draft.title,
        incident: draft.incident,
        building: draft.building ?? null,
        deviceType: draft.deviceType ?? null,
        affectedSystems: draft.affectedSystems ?? null,
        timeline: draft.timeline ?? null,
        rootCause: draft.rootCause ?? null,
        resolution: draft.resolution ?? null,
        lessonsLearned: draft.lessonsLearned ?? null,
        preventionMeasures: draft.preventionMeasures ?? null,
        severity: draft.severity,
        status: draft.status,
      };
      await updateMutation.mutateAsync({ id, data: payload as any });
      toast({ title: "After-action report saved" });
      setEditing(false);
      await refetch();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading…</div>;
  if (!report) return (
    <div className="text-center py-8">
      <p className="text-muted-foreground">Report not found.</p>
      <Link href="/after-action"><Button variant="ghost" className="mt-4">Back</Button></Link>
    </div>
  );

  const r: any = report;
  const d: any = draft ?? r;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/after-action">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{r.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Incident date: {r.incidentDate ? format(new Date(r.incidentDate), "MMMM d, yyyy") : "—"}
          </p>
        </div>
        <Badge variant="outline" className={severityColor[r.severity] ?? ""}>
          {r.severity}
        </Badge>
        {r.zendeskTicketId ? (
          r.zendeskTicketUrl ? (
            <a
              href={r.zendeskTicketUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-zendesk-ticket"
            >
              <Badge
                variant="outline"
                className="bg-sky-500/10 text-sky-700 border-sky-200 hover:bg-sky-500/10 cursor-pointer gap-1"
              >
                Zendesk #{r.zendeskTicketId}
                <ExternalLink className="h-3 w-3" />
              </Badge>
            </a>
          ) : (
            <Badge
              variant="outline"
              className="bg-sky-500/10 text-sky-700 border-sky-200"
              data-testid="badge-zendesk-ticket"
            >
              Zendesk #{r.zendeskTicketId}
            </Badge>
          )
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {!editing ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </Button>
        ) : (
          <>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              <Save className="h-4 w-4 mr-2" /> Save
            </Button>
            <Button variant="ghost" onClick={() => { setDraft({ ...r }); setEditing(false); }}>
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
          </>
        )}
        <Button variant="outline" onClick={() => handleExport("pdf")}>
          <Download className="h-4 w-4 mr-2" /> Export PDF
        </Button>
        <Button variant="outline" onClick={() => handleExport("docx")}>
          <Download className="h-4 w-4 mr-2" /> Export Word
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-5">
          {editing ? (
            <>
              <div>
                <Label>Title</Label>
                <Input value={d.title ?? ""} onChange={(e) => setDraft({ ...d, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Severity</Label>
                  <Select value={d.severity} onValueChange={(v) => setDraft({ ...d, severity: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["low", "medium", "high", "critical"].map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={d.status} onValueChange={(v) => setDraft({ ...d, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["open", "investigating", "resolved", "closed"].map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Building</Label>
                  <Input value={d.building ?? ""} onChange={(e) => setDraft({ ...d, building: e.target.value })} />
                </div>
                <div>
                  <Label>Device type</Label>
                  <Input value={d.deviceType ?? ""} onChange={(e) => setDraft({ ...d, deviceType: e.target.value })} />
                </div>
              </div>
              {FIELDS.map(f => (
                <div key={f.key}>
                  <Label>{f.label}</Label>
                  <Textarea
                    rows={f.rows ?? 3}
                    value={d[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...d, [f.key]: e.target.value })}
                  />
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Building</p>
                  <p>{r.building ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Device type</p>
                  <p>{r.deviceType ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p className="capitalize">{r.status}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Severity</p>
                  <p className="capitalize">{r.severity}</p>
                </div>
              </div>
              {FIELDS.map(f => {
                const v = r[f.key];
                if (!v) return null;
                return (
                  <div key={f.key}>
                    <p className="text-sm font-semibold text-muted-foreground mb-1">{f.label}</p>
                    <p className="whitespace-pre-wrap text-sm">{v}</p>
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
