import { useState } from "react";
import { format } from "date-fns";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Network,
  PhoneIncoming,
  RefreshCw,
  Send,
  Server,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetRecentActivity,
  useGetWeekStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QuoteOfDay } from "@/components/QuoteOfDay";
import { ZendeskResolved } from "@/components/ZendeskResolved";
import QuickAddItemDialog from "@/components/QuickAddItemDialog";
import { HowToUse } from "@/components/HowToUse";
import { useAuth } from "@/context/AuthContext";
import MyWork from "@/components/MyWork";
import { SectionEyebrow, StatusDot, UserAvatar } from "@/components/portal-ui";

export default function Dashboard() {
  const { isCIO } = useAuth();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
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
    isSummaryError ? "—" : (value ?? 0);
  const callSummary = summary as
    | (typeof summary & {
        itHuntGroupExtension?: string;
        itHuntGroupAnswered?: number;
        itHuntGroupCalls?: number;
        itHuntGroupUnanswered?: number;
        itHuntGroupAnswerRate?: number;
      })
    | undefined;
  const overdue =
    weekStatus?.submissions?.filter((submission) => !submission.isSubmitted)
      .length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionEyebrow>Status & reporting</SectionEyebrow>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
            Department dashboard
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Live reporting, operational workload, and team follow-through.
          </p>
        </div>
        {weekStatus ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              Week of {format(new Date(weekStatus.weekOf), "MMM d, yyyy")}
            </span>
            <Badge variant={weekStatus.isFinalized ? "default" : "secondary"}>
              {weekStatus.isFinalized ? "Finalized" : "Draft"}
            </Badge>
          </div>
        ) : null}
      </div>

      {isSummaryError ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Couldn't load the current dashboard summary.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchSummary()}
            disabled={isSummaryFetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isSummaryFetching ? "animate-spin" : ""}`}
            />
            Retry
          </Button>
        </div>
      ) : null}

      <section
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label="Status metrics and quick actions"
      >
        <MetricCard
          title="This week's entries"
          value={summaryValue(summary?.thisWeekEntries)}
          detail={`${summary?.thisWeekContributors ?? 0} contributors`}
          icon={FileText}
        />
        <MetricCard
          title="Open risks"
          value={summaryValue(summary?.openRisks)}
          detail={`${summary?.criticalRisks ?? 0} critical`}
          icon={ShieldAlert}
          tone="warning"
        />
        <MetricCard
          title="Monitored network objects"
          value={
            isSummaryError
              ? "—"
              : `${summary?.onlineSwitches ?? 0} / ${summary?.totalSwitches ?? 0}`
          }
          detail="Online across switches, management IPs, and SVIs"
          icon={Server}
        />
        <MetricCard
          title="Post-incident reviews"
          value={summaryValue(summary?.openAfterActions)}
          detail="Open reviews"
          icon={Activity}
        />
        <MetricCard
          title={`IT calls · ext. ${callSummary?.itHuntGroupExtension ?? "1200"}`}
          value={
            isSummaryError
              ? "—"
              : `${callSummary?.itHuntGroupAnswered ?? 0} / ${callSummary?.itHuntGroupCalls ?? 0}`
          }
          detail={`${callSummary?.itHuntGroupUnanswered ?? 0} unanswered · ${callSummary?.itHuntGroupAnswerRate ?? 0}% answer rate`}
          icon={PhoneIncoming}
          href="/it-apps/webex-calling"
        />
        <Card className="border-0 bg-[linear-gradient(135deg,var(--portal-sidebar-bg),var(--portal-primary))] text-white shadow-lg">
          <CardHeader className="pb-2">
            <SectionEyebrow>
              <span className="text-emerald-300">Quick actions</span>
            </SectionEyebrow>
            <CardTitle className="text-base text-white">
              Move the work forward
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="quick-action"
            >
              <Zap className="h-4 w-4" />
              Quick add item
              <ArrowRight className="ml-auto h-3.5 w-3.5" />
            </button>
            <Link href="/reports" className="quick-action">
              <Send className="h-4 w-4" />
              Submit report
              <ArrowRight className="ml-auto h-3.5 w-3.5" />
            </Link>
            <Link href="/entries" className="quick-action">
              <Sparkles className="h-4 w-4" />
              Request review
              <ArrowRight className="ml-auto h-3.5 w-3.5" />
            </Link>
            <Link href="/reports" className="quick-action">
              <Download className="h-4 w-4" />
              Export data
              <ArrowRight className="ml-auto h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </section>
      <QuickAddItemDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        trigger={<span className="hidden" />}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
            <div>
              <SectionEyebrow>Team</SectionEyebrow>
              <CardTitle className="mt-1 text-base">
                Submission status
              </CardTitle>
            </div>
            {overdue > 0 ? (
              <Link href="/entries">
                <Badge className="bg-amber-100 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800 hover:bg-amber-200">
                  Action needed
                </Badge>
              </Link>
            ) : (
              <StatusDot status="operational" label="Current" />
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isWeekStatusError ? (
              <ErrorRow
                message="Couldn't load team submission status."
                retry={() => refetchWeekStatus()}
                busy={isWeekStatusFetching}
              />
            ) : null}
            {weekStatus?.submissions?.map((submission) => (
              <div
                key={submission.userId}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <UserAvatar name={submission.userName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">
                    {submission.userName}
                  </p>
                  <p className="text-[10px] capitalize text-muted-foreground">
                    {submission.userRole}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {submission.entryCount} entries
                </span>
                {submission.isSubmitted ? (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    Submitted
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="gap-1 border-amber-300 text-[10px] text-amber-700"
                  >
                    <Clock className="h-3 w-3" />
                    Pending
                  </Badge>
                )}
              </div>
            ))}
            {!isWeekStatusError && !weekStatus?.submissions?.length ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                No submissions yet for this week.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
            <div>
              <SectionEyebrow>Live feed</SectionEyebrow>
              <CardTitle className="mt-1 text-base">Recent activity</CardTitle>
            </div>
            <Link href="/entries" className="text-xs font-bold text-primary">
              See all
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {isActivityError ? (
              <ErrorRow
                message="Couldn't load recent activity."
                retry={() => refetchActivity()}
                busy={isActivityFetching}
              />
            ) : null}
            {recentActivity?.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <UserAvatar name={item.userName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">
                    <strong>{item.userName}</strong> {item.action} {item.type}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {item.title}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="hidden text-[9px] uppercase sm:inline-flex"
                >
                  {item.type}
                </Badge>
                <time className="text-[10px] text-muted-foreground">
                  {format(new Date(item.createdAt), "MMM d, HH:mm")}
                </time>
              </div>
            ))}
            {!isActivityError && !recentActivity?.length ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                No recent activity.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ZendeskResolved />
      <div className={`grid gap-4 ${isCIO ? "lg:grid-cols-2" : ""}`}>
        <LearnHomeCard />
        {isCIO ? <EnterpriseArchitectureHomeCard /> : null}
      </div>
      <MyWork />
      <HowToUse />
      <QuoteOfDay />
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone,
  href,
}: {
  title: string;
  value: React.ReactNode;
  detail: string;
  icon: typeof Activity;
  tone?: "warning";
  href?: string;
}) {
  const card = (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="max-w-[80%] text-xs font-semibold text-muted-foreground">
          {title}
        </CardTitle>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-extrabold tracking-tight">{value}</p>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          {detail}
        </p>
        {href ? (
          <p className="mt-3 text-[10px] font-bold text-primary">
            Open report →
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
    >
      {card}
    </Link>
  ) : (
    card
  );
}

function ErrorRow({
  message,
  retry,
  busy,
}: {
  message: string;
  retry: () => unknown;
  busy: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 p-4 text-xs text-destructive"
    >
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={retry} disabled={busy}>
        <RefreshCw
          className={`mr-2 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
        />
        Retry
      </Button>
    </div>
  );
}

function EnterpriseArchitectureHomeCard() {
  return (
    <Card className="h-full border-emerald-300 bg-gradient-to-r from-emerald-50 to-slate-50 dark:from-emerald-950/30 dark:to-slate-950/30">
      <CardContent className="flex h-full flex-col gap-4 pt-6 sm:justify-between">
        <div className="flex gap-3">
          <div className="rounded-full bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
            <Network className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-bold">
              SCCC Enterprise Architecture
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Capture the as-is report and update Fred's queryable architecture
              database.
            </p>
          </div>
        </div>
        <Button asChild className="self-start">
          <Link href="/ai-report?tab=architecture">
            Run Enterprise Architecture
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function LearnHomeCard() {
  return (
    <Card className="border-blue-300 bg-gradient-to-r from-blue-50 to-emerald-50 dark:from-blue-950/30 dark:to-emerald-950/30">
      <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <div className="rounded-full bg-blue-100 p-3 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
            <BookOpenCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-bold">
              Learn through real IT situations
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Practice desk and onsite simulations while Fred teaches the
              diagnostic questions.
            </p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/learn">
            Open Learn
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
