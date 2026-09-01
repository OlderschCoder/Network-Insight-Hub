import { useGetDashboardSummary, useGetRecentActivity, useGetWeekStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Activity, ShieldAlert, CheckCircle2, XCircle, Clock, Server, FileText, AlertCircle, RefreshCw, BookOpenCheck, ArrowRight, Network } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { QuoteOfDay } from "@/components/QuoteOfDay";
import { ZendeskResolved } from "@/components/ZendeskResolved";
import QuickAddItemDialog from "@/components/QuickAddItemDialog";
import { HowToUse } from "@/components/HowToUse";
import { useAuth } from "@/context/AuthContext";
import MyWork from "@/components/MyWork";
import ItHuntGroupCard from "@/components/ItHuntGroupCard";

export default function Dashboard() {
  const { isCIO } = useAuth();
  return <SharedHome isCIO={isCIO} />;
}

function EnterpriseArchitectureHomeCard() {
  return <Card className="h-full border-emerald-300 bg-gradient-to-r from-emerald-50 to-slate-50">
    <CardContent className="flex h-full flex-col gap-4 pt-6 sm:justify-between">
      <div className="flex gap-3"><div className="rounded-full bg-emerald-100 p-3"><Network className="h-6 w-6 text-emerald-700" /></div><div><h2 className="text-xl font-semibold">SCCC Enterprise Architecture</h2><p className="mt-1 text-sm text-muted-foreground">Capture the as-is report and update Fred’s queryable architecture database.</p></div></div>
      <Button asChild className="self-start"><Link href="/ai-report?tab=architecture">Run Enterprise Architecture<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
    </CardContent>
  </Card>;
}

function LearnHomeCard() {
  return <Card className="border-blue-300 bg-gradient-to-r from-blue-50 to-emerald-50">
    <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3"><div className="rounded-full bg-blue-100 p-3"><BookOpenCheck className="h-6 w-6 text-blue-700" /></div><div><h2 className="text-xl font-semibold">Learn through real IT situations</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Practice At My Desk and Onsite simulations. Fred teaches the diagnostic questions, but you work the checks and identify the predetermined outcome.</p></div></div>
      <Button asChild className="shrink-0"><Link href="/learn">Open Learn<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
    </CardContent>
  </Card>;
}

function SharedHome({ isCIO }: { isCIO: boolean }) {
  const {
    data: summary,
    isError: isSummaryError,
    refetch: refetchSummary,
    isFetching: isSummaryFetching,
  } = useGetDashboardSummary();
  const {
    data: recentActivity,
    isError: isActivityError,
    refetch: refetchActivity,
    isFetching: isActivityFetching,
  } = useGetRecentActivity({ limit: 10 });
  const {
    data: weekStatus,
    isError: isWeekStatusError,
    refetch: refetchWeekStatus,
    isFetching: isWeekStatusFetching,
  } = useGetWeekStatus();

  const summaryValue = (value: number | undefined) =>
    isSummaryError ? "—" : value ?? 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">IT Home</h1>
        <div className="flex items-center gap-3">
          <QuickAddItemDialog />
          {weekStatus ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Week of {format(new Date(weekStatus.weekOf), 'MMM d, yyyy')}</span>
              <Badge variant={weekStatus.isFinalized ? "default" : "secondary"}>
                {weekStatus.isFinalized ? "Finalized" : "Draft"}
              </Badge>
            </div>
          ) : isWeekStatusError ? (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Week status unavailable</span>
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold">Current operational pulse</h2>
        <p className="text-sm text-muted-foreground">Live service health, workload, and team response indicators.</p>
      </div>

      {isSummaryError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Couldn't load stats. The dashboard summary is temporarily unavailable.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchSummary()}
            disabled={isSummaryFetching}
            className="self-start sm:self-auto"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isSummaryFetching ? "animate-spin" : ""}`} />
            {isSummaryFetching ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week's Entries</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryValue(summary?.thisWeekEntries)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isSummaryError
                ? "Couldn't load stats"
                : `From ${summary?.thisWeekContributors || 0} contributors`}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Risks</CardTitle>
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryValue(summary?.openRisks)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isSummaryError
                ? "Couldn't load stats"
                : `${summary?.criticalRisks || 0} critical`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monitored Network Objects</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isSummaryError
                ? "—"
                : `${summary?.onlineSwitches || 0} / ${summary?.totalSwitches || 0}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isSummaryError ? "Couldn't load stats" : "Online · includes switches, management IPs, and SVIs"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Post-Incident Reviews</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryValue(summary?.openAfterActions)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isSummaryError ? "Couldn't load stats" : "Open incidents"}
            </p>
          </CardContent>
        </Card>

        <ItHuntGroupCard summary={summary} isError={isSummaryError} />
      </div>

      <ZendeskResolved />

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Team Submission Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isWeekStatusError ? (
              <div
                role="alert"
                className="flex flex-col items-center gap-3 py-6 text-center text-sm"
              >
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Couldn't load team submission status.</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchWeekStatus()}
                  disabled={isWeekStatusFetching}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isWeekStatusFetching ? "animate-spin" : ""}`} />
                  {isWeekStatusFetching ? "Retrying…" : "Retry"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {weekStatus?.submissions?.map((sub) => (
                  <div key={sub.userId} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{sub.userName}</span>
                      <span className="text-xs text-muted-foreground">{sub.userRole}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm">{sub.entryCount} entries</span>
                      {sub.isSubmitted ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <Clock className="h-5 w-5 text-amber-500" />
                      )}
                    </div>
                  </div>
                ))}
                {!weekStatus?.submissions?.length && (
                  <div className="text-sm text-muted-foreground py-4 text-center">No submissions yet for this week</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {isActivityError ? (
              <div
                role="alert"
                className="flex flex-col items-center gap-3 py-6 text-center text-sm"
              >
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Couldn't load recent activity.</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchActivity()}
                  disabled={isActivityFetching}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isActivityFetching ? "animate-spin" : ""}`} />
                  {isActivityFetching ? "Retrying…" : "Retry"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {recentActivity?.map((item) => (
                  <div key={item.id} className="flex flex-col border-l-2 border-primary pl-4 py-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{item.action} {item.type}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(item.createdAt), 'MMM d, HH:mm')}
                      </span>
                    </div>
                    <span className="text-sm mt-1">{item.title}</span>
                    <span className="text-xs text-muted-foreground mt-1">By {item.userName}</span>
                  </div>
                ))}
                {!recentActivity?.length && (
                  <div className="text-sm text-muted-foreground py-4 text-center">No recent activity</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={`grid gap-4 ${isCIO ? "lg:grid-cols-2" : ""}`}>
        <LearnHomeCard />
        {isCIO && <EnterpriseArchitectureHomeCard />}
      </div>

      <MyWork />

      <HowToUse />

      <QuoteOfDay />
    </div>
  );
}
