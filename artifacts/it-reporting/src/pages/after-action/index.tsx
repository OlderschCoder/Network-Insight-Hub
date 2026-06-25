import { useState } from "react";
import { Link } from "wouter";
import {
  useListAfterActionReports,
  useUpdateAfterActionReport,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTimelineRefresh } from "@/hooks/useTimelineRefresh";
import { format } from "date-fns";
import { Plus, ChevronRight, FileText, Ticket, X, RefreshCw } from "lucide-react";

const outcomeColor: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  partial: "bg-amber-500/10 text-amber-700 border-amber-200",
  failure: "bg-red-500/10 text-red-700 border-red-200",
};

export default function AfterAction() {
  const [ticketInput, setTicketInput] = useState("");
  const parsedTicketId = parseInt(ticketInput.trim(), 10);
  const hasFilter = ticketInput.trim() !== "" && !Number.isNaN(parsedTicketId);
  const { data: reports, isLoading, refetch } = useListAfterActionReports(
    hasFilter ? { zendeskTicketId: parsedTicketId } : {},
  );
  const updateMutation = useUpdateAfterActionReport();
  const { isRefreshing, isRefreshingAll, activeKey, refresh, refreshMany } =
    useTimelineRefresh();

  const applyTimeline = (report: any) => async (timeline: string) => {
    await updateMutation.mutateAsync({
      id: report.id,
      data: { timeline } as any,
    });
  };

  const handleRefreshTimeline = async (report: any) => {
    const ok = await refresh({
      ticketId: report.zendeskTicketId,
      currentTimeline: report.timeline,
      apply: applyTimeline(report),
      key: report.id,
    });
    if (ok) await refetch();
  };

  const handleRefreshAll = async () => {
    const linked = (reports ?? []).filter((r) => (r as any).zendeskTicketId);
    await refreshMany(
      linked.map((report) => ({
        ticketId: (report as any).zendeskTicketId,
        apply: applyTimeline(report),
      })),
    );
    if (linked.length > 0) await refetch();
  };

  const linkedCount = (reports ?? []).filter(
    (r) => (r as any).zendeskTicketId,
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Post-Incident Reviews</h1>
        <div className="flex items-center gap-2">
          {linkedCount > 0 && (
            <Button
              variant="outline"
              onClick={handleRefreshAll}
              disabled={isRefreshing}
              data-testid="button-refresh-all-timelines"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isRefreshingAll ? "animate-spin" : ""}`}
              />
              {isRefreshingAll ? "Refreshing all…" : "Refresh all from Zendesk"}
            </Button>
          )}
          <Link href="/after-action/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Review
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Filter by Zendesk ticket #"
            value={ticketInput}
            onChange={(e) => setTicketInput(e.target.value)}
            className="pl-9"
          />
        </div>
        {ticketInput.trim() !== "" && (
          <Button variant="ghost" size="sm" onClick={() => setTicketInput("")}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : (reports ?? []).length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          {hasFilter
            ? `No post-incident reviews for Zendesk #${parsedTicketId}.`
            : "No post-incident reviews yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {(reports ?? []).map((report) => {
            const isRowRefreshing = activeKey === report.id;
            return (
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
                      {report.zendeskTicketId && (
                        <>
                          <Badge variant="outline" className="bg-sky-500/20 text-sky-300 border-sky-500/30">
                            <Ticket className="h-3 w-3 mr-1" />
                            Zendesk #{report.zendeskTicketId}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isRefreshing}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRefreshTimeline(report);
                            }}
                            data-testid={`button-refresh-timeline-${report.id}`}
                          >
                            <RefreshCw
                              className={`h-4 w-4 mr-1 ${isRowRefreshing ? "animate-spin" : ""}`}
                            />
                            {isRowRefreshing ? "Refreshing…" : "Refresh from Zendesk"}
                          </Button>
                        </>
                      )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
