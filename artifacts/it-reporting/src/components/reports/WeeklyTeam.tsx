import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListReports, useCreateReport, useDeleteReport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { Plus, FileText, ChevronRight, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { todayCentral, isoMondayCentral } from "@/lib/dates";

export default function WeeklyTeam() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { isCIO } = useAuth();
  const { toast } = useToast();
  const { data: reports, isLoading } = useListReports({});
  const createMutation = useCreateReport();
  const deleteMutation = useDeleteReport();

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this report? This cannot be undone.")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({ title: "Report deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [weekOf, setWeekOf] = useState<string>(isoMondayCentral(todayCentral()));

  const handleCreate = async () => {
    try {
      const report: any = await createMutation.mutateAsync({ data: { weekOf } });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      setDialogOpen(false);
      setLocation(`/reports/${report.id}`);
    } catch (e: any) {
      toast({ title: "Could not create report", description: e?.message, variant: "destructive" });
    }
  };

  const list = (reports ?? []) as any[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          CIO-curated weekly summaries that aggregate every team member's logs and items.
        </p>
        {isCIO && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Report
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading…</div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No team reports yet. {isCIO && "Click \"New Report\" to start one."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((report) => (
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
                  <div className="flex items-center gap-2">
                    <Badge variant={report.status === "finalized" ? "default" : "secondary"}>
                      {report.status === "finalized" ? "Finalized" : "Draft"}
                    </Badge>
                    {isCIO && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => handleDelete(report.id, e)}
                        disabled={deleteMutation.isPending}
                        aria-label="Delete report"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
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
            <DialogTitle>New Weekly Team Report</DialogTitle>
            <DialogDescription>
              Pick the week. The report auto-aggregates every team member's logs, items,
              and open risks for that week.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="weekOf">Week of (Monday)</Label>
            <Input
              id="weekOf"
              type="date"
              value={weekOf}
              onChange={(e) => e.target.value && setWeekOf(isoMondayCentral(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              {format(new Date(weekOf + "T00:00:00"), "EEEE, MMM d, yyyy")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create & Edit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
