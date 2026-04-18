import { useParams, Link } from "wouter";
import {
  useGetReport,
  useFinalizeReport,
  useSendReportToZendesk,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ArrowLeft, Lock, Send, Download } from "lucide-react";
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
  const finalizeMutation = useFinalizeReport();
  const zendeskMutation = useSendReportToZendesk();

  const handleFinalize = async () => {
    if (!confirm("Finalize this report? This action cannot be undone.")) return;
    try {
      await finalizeMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({ title: "Report finalized" });
    } catch {
      toast({ title: "Failed to finalize", variant: "destructive" });
    }
  };

  const handleZendesk = async () => {
    try {
      await zendeskMutation.mutateAsync({ id });
      toast({ title: "Sent to Zendesk" });
    } catch {
      toast({ title: "Failed to send to Zendesk", variant: "destructive" });
    }
  };

  const handleExport = (type: "docx" | "xlsx") => {
    window.open(`/api/export/report/${id}/${type}`, "_blank");
  };

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  if (!report) return (
    <div className="text-center py-8">
      <p className="text-muted-foreground">Report not found.</p>
      <Link href="/reports"><Button variant="ghost" className="mt-4">Back</Button></Link>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Week of {format(new Date(report.weekOf), "MMMM d, yyyy")}
          </h1>
        </div>
        <Badge variant={report.isFinalized ? "default" : "secondary"}>
          {report.isFinalized ? "Finalized" : "Draft"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {isCIO && !report.isFinalized && (
          <Button variant="outline" onClick={handleFinalize} disabled={finalizeMutation.isPending}>
            <Lock className="h-4 w-4 mr-2" />
            Finalize Report
          </Button>
        )}
        <Button variant="outline" onClick={() => handleExport("docx")}>
          <Download className="h-4 w-4 mr-2" />
          Export DOCX
        </Button>
        <Button variant="outline" onClick={() => handleExport("xlsx")}>
          <Download className="h-4 w-4 mr-2" />
          Export XLSX
        </Button>
        {isCIO && (
          <Button variant="outline" onClick={handleZendesk} disabled={zendeskMutation.isPending}>
            <Send className="h-4 w-4 mr-2" />
            Send to Zendesk
          </Button>
        )}
      </div>

      {report.summary && (
        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{report.summary}</p>
          </CardContent>
        </Card>
      )}

      {report.entries && report.entries.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Entries ({report.entries.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.entries.map((entry: any) => (
                <div key={entry.id} className="border-l-2 border-primary/30 pl-3 py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {format(new Date(entry.entryDate), "MMM d")}
                    </span>
                    {entry.category && (
                      <Badge variant="outline" className="text-xs">{entry.category}</Badge>
                    )}
                  </div>
                  {entry.workDescription && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {entry.workDescription}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
