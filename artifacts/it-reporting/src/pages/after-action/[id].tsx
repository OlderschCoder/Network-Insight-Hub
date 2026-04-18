import { useParams, Link } from "wouter";
import { useGetAfterActionReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";

const outcomeColor: Record<string, string> = {
  success: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  partial: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  failure: "bg-red-500/20 text-red-300 border-red-500/30",
};

function Section({ title, content }: { title: string; content?: string | null }) {
  if (!content) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-muted-foreground mb-1">{title}</p>
      <p className="whitespace-pre-wrap text-sm">{content}</p>
    </div>
  );
}

export default function AfterActionDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");
  const { data: report, isLoading } = useGetAfterActionReport(id);

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  if (!report) return (
    <div className="text-center py-8">
      <p className="text-muted-foreground">Report not found.</p>
      <Link href="/after-action"><Button variant="ghost" className="mt-4">Back</Button></Link>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/after-action">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Incident date: {format(new Date(report.incidentDate), "MMMM d, yyyy")}
          </p>
        </div>
        {report.outcome && (
          <Badge variant="outline" className={outcomeColor[report.outcome] ?? ""}>
            {report.outcome}
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-5">
          <Section title="Executive Summary" content={report.summary} />
          <Section title="Timeline" content={report.timeline} />
          <Section title="What Went Well" content={report.whatWentWell} />
          <Section title="What Went Poorly" content={report.whatWentPoorly} />
          <Section title="Action Items" content={report.actionItems} />
        </CardContent>
      </Card>
    </div>
  );
}
