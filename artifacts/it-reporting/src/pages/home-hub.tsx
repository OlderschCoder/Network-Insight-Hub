import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Activity,
  ArrowRight,
  BarChart3,
  LayoutGrid,
  LifeBuoy,
  Map,
  Search,
  Sparkles,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  useGetDashboardSummary,
  useGetRecentActivity,
  useGetWeekStatus,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import {
  StatusDot,
  type PortalHealth,
  SectionEyebrow,
} from "@/components/portal-ui";

function appHealth(issueCount: number): PortalHealth {
  return issueCount > 0 ? "degraded" : "operational";
}

export const HOME_WORKSPACE_HREFS = {
  status: "/status",
  network: "/network",
  apps: "/it-apps",
  support: "/support",
} as const;

export default function HomeHub() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [question, setQuestion] = useState("");
  const { data: summary, isError: summaryError } = useGetDashboardSummary();
  const { data: recentActivity = [] } = useGetRecentActivity({ limit: 4 });
  const { data: weekStatus } = useGetWeekStatus();
  const callSummary = summary as
    | (typeof summary & {
        itHuntGroupExtension?: string;
        itHuntGroupUnanswered?: number;
        itHuntGroupAnswerRate?: number;
      })
    | undefined;

  const pending =
    weekStatus?.submissions?.filter((submission) => !submission.isSubmitted)
      .length ??
    summary?.pendingSubmissions ??
    0;
  const offline =
    summary?.offlineSwitches ??
    Math.max(0, (summary?.totalSwitches ?? 0) - (summary?.onlineSwitches ?? 0));
  const urgent = useMemo(() => {
    if (summaryError)
      return "I couldn't refresh the operational pulse. Want me to help check the source systems?";
    if (offline > 0)
      return `${offline} monitored network object${offline === 1 ? " is" : "s are"} offline. Want me to pull the freshest network evidence?`;
    if ((summary?.criticalRisks ?? 0) > 0)
      return `${summary?.criticalRisks} critical risk${summary?.criticalRisks === 1 ? " needs" : "s need"} attention. Want a concise risk brief?`;
    if (pending > 0)
      return `${pending} team submission${pending === 1 ? " is" : "s are"} still pending. Want me to summarize what is missing?`;
    return "The current operational pulse has no critical exceptions. I can still help you investigate anything suspicious.";
  }, [offline, pending, summary?.criticalRisks, summaryError]);

  const askFred = (event: React.FormEvent) => {
    event.preventDefault();
    const prompt = question.trim();
    navigate(
      `/ai-report?from=%2F&prompt=${encodeURIComponent(prompt || urgent)}`,
    );
  };

  const firstName = user?.name?.split(/\s+/)[0] || "team";

  return (
    <div className="min-h-full bg-background">
      <section className="grid gap-8 bg-[linear-gradient(135deg,var(--portal-sidebar-bg),var(--portal-primary))] px-6 py-8 text-white lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:px-10">
        <div className="flex flex-col justify-center">
          <p className="text-sm font-semibold text-white/65">
            Good{" "}
            {new Date().getHours() < 12
              ? "morning"
              : new Date().getHours() < 18
                ? "afternoon"
                : "evening"}
            , {firstName}
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
            SCCC IT <span className="text-emerald-300">Command Center</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
            One clear starting point for reporting, campus technology,
            applications, and troubleshooting across the IT department.
          </p>
        </div>

        <div className="rounded-2xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold">Fred</p>
              <StatusDot
                status="operational"
                label="Online"
                className="[&>span:last-child]:text-emerald-200"
              />
            </div>
          </div>
          <p className="mt-3 rounded-xl bg-black/15 px-3 py-2.5 text-xs leading-5 text-white/85">
            {urgent}
          </p>
          <form onSubmit={askFred} className="mt-3 flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask Fred anything…"
                className="h-10 w-full rounded-lg border border-white/15 bg-white/10 pl-9 pr-3 text-xs text-white outline-none placeholder:text-white/40 focus:border-emerald-300"
              />
            </label>
            <button className="h-10 rounded-lg bg-white px-4 text-xs font-bold text-[var(--portal-primary)] transition-colors hover:bg-emerald-50">
              Ask
            </button>
          </form>
        </div>
      </section>

      <section
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-card px-6 py-3 lg:px-10"
        aria-label="Current service status"
      >
        <StatusDot
          service="Network"
          status={appHealth(offline)}
          label={offline ? `${offline} offline` : "Operational"}
        />
        <span className="hidden text-border sm:inline">|</span>
        <StatusDot
          service="Risks"
          status={appHealth(summary?.criticalRisks ?? 0)}
          label={
            (summary?.criticalRisks ?? 0)
              ? `${summary?.criticalRisks} critical`
              : "No critical risks"
          }
        />
        <span className="hidden text-border sm:inline">|</span>
        <StatusDot
          service="Reporting"
          status={appHealth(pending)}
          label={pending ? `${pending} pending` : "Current"}
        />
        <span className="ml-auto text-xs font-semibold text-muted-foreground">
          Help Desk ext. {callSummary?.itHuntGroupExtension ?? "1200"}
        </span>
      </section>

      <section className="px-6 py-6 lg:px-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <SectionEyebrow>Your workspace</SectionEyebrow>
            <h2 className="mt-1 text-xl font-bold">
              Choose the job you need to do
            </h2>
          </div>
          <p className="hidden text-xs text-muted-foreground md:block">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
          <HomeAppCard
            href={HOME_WORKSPACE_HREFS.status}
            eyebrow="Status & reporting"
            title="Operational reporting"
            description="KPIs, team submissions, weekly reports, projects, and risk activity."
            icon={BarChart3}
            iconClass="bg-[linear-gradient(135deg,var(--app-status-soft),var(--app-status-strong))] text-emerald-800"
            stats={[
              [String(summary?.thisWeekEntries ?? "—"), "Weekly entries"],
              [String(summary?.openRisks ?? "—"), "Open risks"],
              [String(summary?.openAfterActions ?? "—"), "Reviews"],
            ]}
            rows={recentActivity
              .slice(0, 4)
              .map((item) => `${item.userName}: ${item.action} ${item.type}`)}
            status={
              <StatusDot
                status={appHealth(pending)}
                label={pending ? `${pending} pending` : "Team current"}
              />
            }
          />
          <HomeAppCard
            href={HOME_WORKSPACE_HREFS.network}
            eyebrow="IT tools & network"
            title="Campus technology"
            description="Buildings, live monitoring, switching, VLANs, telephony, and Azure."
            icon={Map}
            iconClass="bg-[linear-gradient(135deg,var(--app-network-soft),var(--app-network-strong))] text-blue-800"
            stats={[
              [String(summary?.onlineSwitches ?? "—"), "Online"],
              [String(summary?.totalSwitches ?? "—"), "Monitored"],
              [String(offline), "Offline"],
            ]}
            rows={[
              "Campus building inventory",
              "Switch and VLAN reference",
              "Grafana monitoring",
              "Cisco Webex and Azure",
            ]}
            status={
              <StatusDot
                status={appHealth(offline)}
                label={offline ? `${offline} need review` : "Operational"}
              />
            }
          />
          <HomeAppCard
            href={HOME_WORKSPACE_HREFS.apps}
            eyebrow="IT Apps"
            title="Applications"
            description="One launchpad for operational systems, reports, academic continuity, and student access."
            icon={LayoutGrid}
            iconClass="bg-[linear-gradient(135deg,#ede9fe,#c4b5fd)] text-violet-800"
            stats={[
              ["12", "Listed tools"],
              ["4", "ACR apps"],
              ["3", "Student tools"],
            ]}
            rows={[
              "Cisco Webex Phones",
              "Banner and EUP operations",
              "Call and identity reports",
              "ACR and student systems",
            ]}
            status={
              <StatusDot status="operational" label="Directory available" />
            }
          />
          <HomeAppCard
            href={HOME_WORKSPACE_HREFS.support}
            eyebrow="Troubleshooting"
            title="Support center"
            description="Zendesk activity, diagnostics, incident response, guided learning, and Fred."
            icon={LifeBuoy}
            iconClass="bg-[linear-gradient(135deg,var(--app-support-soft),var(--app-support-strong))] text-amber-800"
            stats={[
              [String(summary?.totalTickets ?? "—"), "Tickets"],
              [
                String(callSummary?.itHuntGroupUnanswered ?? "—"),
                "Missed calls",
              ],
              [String(callSummary?.itHuntGroupAnswerRate ?? "—"), "Answer %"],
            ]}
            rows={[
              "Open Zendesk activity",
              "Network diagnostics",
              "Incident rooms",
              "Process library and Learn",
            ]}
            status={
              <StatusDot
                status={appHealth(callSummary?.itHuntGroupUnanswered ?? 0)}
                label={
                  (callSummary?.itHuntGroupUnanswered ?? 0)
                    ? `${callSummary?.itHuntGroupUnanswered} calls missed`
                    : "Ready"
                }
              />
            }
          />
        </div>
      </section>
    </div>
  );
}

function HomeAppCard({
  href,
  eyebrow,
  title,
  description,
  icon: Icon,
  iconClass,
  stats,
  rows,
  status,
}: {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Activity;
  iconClass: string;
  stats: Array<[string, string]>;
  rows: string[];
  status: React.ReactNode;
}) {
  return (
    <article className="group flex min-h-[430px] flex-col rounded-[14px] border bg-card p-5 shadow-[var(--portal-card-shadow)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClass}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <SectionEyebrow>{eyebrow}</SectionEyebrow>
          <h3 className="mt-1 text-lg font-extrabold">
            <Link
              href={href}
              className="rounded-sm hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {title}
            </Link>
          </h3>
        </div>
      </div>
      <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      <div className="mt-5 grid grid-cols-3 divide-x rounded-lg border bg-muted/35 py-3">
        {stats.map(([value, label]) => (
          <div key={label} className="px-2 text-center">
            <p className="text-xl font-extrabold">{value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex-1 border-t pt-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Live work and shortcuts
        </p>
        <ul className="divide-y text-xs">
          {rows.map((row, index) => (
            <li
              key={`${row}-${index}`}
              className="flex items-center gap-2 py-2.5"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
              <span className="line-clamp-1">{row}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 flex items-center justify-between border-t pt-4">
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-bold text-primary"
        >
          Open app{" "}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
        {status}
      </div>
    </article>
  );
}
