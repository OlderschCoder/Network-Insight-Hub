import { Link } from "wouter";
import { useListReports, useCreateReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, startOfISOWeek } from "date-fns";
import { Plus, FileText, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

export default function Reports() {
  const queryClient = useQueryClient();
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const { data: reports, isLoading } = useListReports({});
  const createMutation = useCreateReport();

  const handleNewReport = async () => {
    const weekOf = format(startOfISOWeek(new Date()), "yyyy-MM-dd");
    try {
      const report = await createMutation.mutateAsync({ data: { weekOf } });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    } catch (e: any) {
      toast({ title: "Could not create report", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Weekly Reports</h1>
        {isCIO && (
          <Button onClick={handleNewReport} disabled={createMutation.isPending}>
            <Plus className="h-4 w-4 mr-2" />
            New Report
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : (reports ?? []).length === 0 ? (
        <div className="text-center text-muted-foreground py-8">No reports yet.</div>
      ) : (
        <div className="space-y-3">
          {(reports ?? []).map((report) => (
            <Link key={report.id} href={`/reports/${report.id}`}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        Week of {format(new Date(report.weekOf), "MMM d, yyyy")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Created {format(new Date(report.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={report.isFinalized ? "default" : "secondary"}>
                      {report.isFinalized ? "Finalized" : "Draft"}
                    </Badge>
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
