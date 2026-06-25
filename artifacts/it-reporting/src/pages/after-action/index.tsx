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
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  const refreshOneTimeline = async (report: any) => {
    const ticketId = report.zendeskTicketId;
    const token = localStorage.getItem("auth_token");
    const res = await fetch(
      `${import.meta.env.BASE_URL}api/zendesk/ticket/${encodeURIComponent(
        String(ticketId),
      )}/timeline`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.timeline) {
      throw new Error(
        (body && (body.error || body.message)) ||
          "Zendesk did not return a timeline for this ticket.",
      );
    }
    await updateMutation.mutateAsync({
      id: report.id,
      data: { timeline: body.timeline } as any,
    });
  };

  const handleRefreshTimeline = async (report: any) => {
    const ticketId = report.zendeskTicketId;
    if (!ticketId || refreshingId !== null || isRefreshingAll) return;
    const current = (report.timeline || "").trim();
    if (current.length > 0) {
      const ok = window.confirm(
        "This will replace the current Timeline with the latest comments from Zendesk. Any edits you've made will be lost. Continue?",
      );
      if (!ok) return;
    }
    setRefreshingId(report.id);
    try {
      await refreshOneTimeline(report);
      await refetch();
      toast({
        title: "Timeline refreshed",
        description: `Pulled the latest comments from Zendesk ticket #${ticketId}.`,
      });
    } catch (e: any) {
      toast({
        title: "Couldn't refresh timeline",
        description: e?.message ?? "Network request failed.",
        variant: "destructive",
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRefreshAll = async () => {
    if (refreshingId !== null || isRefreshingAll) return;
    const linked = (reports ?? []).filter((r) => (r as any).zendeskTicketId);
    if (linked.length === 0) {
      toast({
        title: "Nothing to refresh",
        description: "No post-incident reviews have a linked Zendesk ticket.",
      });
      return;
    }
    const ok = window.confirm(
      `This will replace the Timeline on ${linked.length} review${
        linked.length === 1 ? "" : "s"
      } with the latest comments from Zendesk. Any edits you've made will be lost. Continue?`,
    );
    if (!ok) return;
    setIsRefreshingAll(true);
    let refreshed = 0;
    let failed = 0;
    try {
      for (const report of linked) {
        try {
          await refreshOneTimeline(report);
          refreshed += 1;
        } catch {
          failed += 1;
        }
      }
      await refetch();
      toast({
        title: "Timelines refreshed",
        description: `Refreshed ${refreshed} timeline${
          refreshed === 1 ? "" : "s"
        }${failed > 0 ? `, ${failed} failed` : ""}.`,
        variant: failed > 0 ? "destructive" : undefined,
      });
    } finally {
      setIsRefreshingAll(false);
    }
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
              disabled={isRefreshingAll || refreshingId !== null}
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
            const isRefreshing = refreshingId === report.id;
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
                            disabled={refreshingId !== null}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRefreshTimeline(report);
                            }}
                            data-testid={`button-refresh-timeline-${report.id}`}
                          >
                            <RefreshCw
                              className={`h-4 w-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`}
                            />
                            {isRefreshing ? "Refreshing…" : "Refresh from Zendesk"}
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
