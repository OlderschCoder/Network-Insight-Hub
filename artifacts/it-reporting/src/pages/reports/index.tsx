import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListReports, useCreateReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format, startOfISOWeek } from "date-fns";
import { Plus, FileText, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { todayCentral } from "@/lib/dates";

const weekStartFor = (dateStr: string) =>
  format(startOfISOWeek(new Date(dateStr + "T00:00:00")), "yyyy-MM-dd");

export default function Reports() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const { data: reports, isLoading } = useListReports({});
  const createMutation = useCreateReport();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [weekOf, setWeekOf] = useState<string>(weekStartFor(todayCentral()));

  const handleCreate = async () => {
    try {
      const report: any = await createMutation.mutateAsync({ data: { weekOf } });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      setDialogOpen(false);
      // Jump straight into editing the new report
      setLocation(`/reports/${report.id}`);
    } catch (e: any) {
      toast({
        title: "Could not create report",
        description: e?.message,
        variant: "destructive",
      });
    }
  };

  const list = reports ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Weekly Reports</h1>
          <p className="text-sm text-muted-foreground">
            CIO-curated summaries of team activity per week.
          </p>
        </div>
        {isCIO && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Report
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading…</div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No reports yet. {isCIO && "Click \"New Report\" to start one for this week."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((report: any) => (
            <Link key={report.id} href={`/reports/${report.id}`}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {report.title || `Week of ${format(new Date(report.weekOf + "T00:00:00"), "MMM d, yyyy")}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Week of {format(new Date(report.weekOf + "T00:00:00"), "MMM d, yyyy")}
                        {report.createdByName ? ` • ${report.createdByName}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={report.status === "finalized" ? "default" : "secondary"}>
                      {report.status === "finalized" ? "Finalized" : "Draft"}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Weekly Report</DialogTitle>
            <DialogDescription>
              Pick the week this report covers. The report will auto-aggregate every
              team member's weekly logs, items, and open risks for that week.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="weekOf">Week of (Monday)</Label>
            <Input
              id="weekOf"
              type="date"
              value={weekOf}
              onChange={(e) => {
                if (e.target.value) setWeekOf(weekStartFor(e.target.value));
              }}
            />
            <p className="text-xs text-muted-foreground">
              Auto-snapped to that week's Monday: {format(new Date(weekOf + "T00:00:00"), "EEEE, MMM d, yyyy")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create &amp; Edit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
