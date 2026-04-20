import { useGetDashboardSummary, useGetRecentActivity, useGetWeekStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Activity, ShieldAlert, CheckCircle2, XCircle, Clock, Server, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { QuoteOfDay } from "@/components/QuoteOfDay";
import { ZendeskResolved } from "@/components/ZendeskResolved";
import QuickAddItemDialog from "@/components/QuickAddItemDialog";

export default function Dashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: recentActivity } = useGetRecentActivity({ limit: 10 });
  const { data: weekStatus } = useGetWeekStatus();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-3">
          <QuickAddItemDialog />
          {weekStatus && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Week of {format(new Date(weekStatus.weekOf), 'MMM d, yyyy')}</span>
              <Badge variant={weekStatus.isFinalized ? "default" : "secondary"}>
                {weekStatus.isFinalized ? "Finalized" : "Draft"}
              </Badge>
            </div>
          )}
        </div>
      </div>

      <QuoteOfDay />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week's Entries</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.thisWeekEntries || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              From {summary?.thisWeekContributors || 0} contributors
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Risks</CardTitle>
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.openRisks || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.criticalRisks || 0} critical
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Network Status</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.onlineSwitches || 0} / {summary?.totalSwitches || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Switches online
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">After Action Reports</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.openAfterActions || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Open incidents
            </p>
          </CardContent>
        </Card>
      </div>

      <ZendeskResolved />

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Team Submission Status</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
