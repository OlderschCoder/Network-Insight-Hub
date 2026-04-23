import { Link } from "wouter";
import { useListAfterActionReports } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Plus, ChevronRight, FileText } from "lucide-react";

const outcomeColor: Record<string, string> = {
  success: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  partial: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  failure: "bg-red-500/20 text-red-300 border-red-500/30",
};

export default function AfterAction() {
  const { data: reports, isLoading } = useListAfterActionReports({});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Post-Incident Reviews</h1>
        <Link href="/after-action/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Review
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : (reports ?? []).length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No post-incident reviews yet.
        </div>
      ) : (
        <div className="space-y-3">
          {(reports ?? []).map((report) => (
            <Link key={report.id} href={`/after-action/${report.id}`}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="font-medium">{report.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(report.incidentDate ?? report.createdAt ?? Date.now()), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {(report as any).outcome && (
                      <Badge variant="outline" className={outcomeColor[(report as any).outcome] ?? ""}>
                        {(report as any).outcome}
                      </Badge>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
