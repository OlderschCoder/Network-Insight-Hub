import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Gauge,
  GraduationCap,
  KeyRound,
  LifeBuoy,
  Map,
  Network,
  PhoneCall,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Wifi,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { authFetch } from "@/lib/authFetch";
import {
  SectionEyebrow,
  StatusDot,
  UserAvatar,
  type PortalHealth,
} from "@/components/portal-ui";

interface ZendeskActivityItem {
  id: number;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

interface ZendeskActivityResponse {
  configured: boolean;
  items: ZendeskActivityItem[];
}

const quickIssues = [
  { label: "Account locked", icon: KeyRound },
  { label: "No WiFi", icon: Wifi },
  { label: "Network outage", icon: Network },
  { label: "Phone issue", icon: PhoneCall },
];

const diagnosticTools = [
  {
    label: "Live monitoring",
    description: "Open Grafana dashboards",
    href: "/monitoring",
    icon: Gauge,
  },
  {
    label: "Network reference",
    description: "Search buildings and devices",
    href: "/network",
    icon: Network,
  },
  {
    label: "Network tools",
    description: "Run approved network workflows",
    href: "/network/tools",
    icon: ShieldCheck,
  },
  {
    label: "Building health",
    description: "Narrow an issue by location",
    href: "/network/buildings",
    icon: Map,
  },
  {
    label: "Cisco Webex",
    description: "Check calling and E-911",
    href: "/it-apps/cisco-calling",
    icon: PhoneCall,
  },
  {
    label: "Student access",
    description: "Review identity workflows",
    href: "/student-access",
    icon: GraduationCap,
  },
];

function statusHealth(status: string): PortalHealth {
  return ["open", "new", "urgent", "pending"].includes(status.toLowerCase())
    ? "degraded"
    : "operational";
}

export default function SupportCenter() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState<ZendeskActivityItem[]>([]);
  const [ticketsConfigured, setTicketsConfigured] = useState<boolean | null>(
    null,
  );
  const { data: summary } = useGetDashboardSummary();
  const callSummary = summary as
    | (typeof summary & {
        itHuntGroupUnanswered?: number;
        itHuntGroupAnswerRate?: number;
        itHuntGroupExtension?: string;
      })
    | undefined;

  useEffect(() => {
    let cancelled = false;
    authFetch(`${import.meta.env.BASE_URL}api/zendesk/recent-activity`)
      .then(async (response) => {
        const body = (await response
          .json()
          .catch(() => null)) as ZendeskActivityResponse | null;
        if (cancelled || !body) return;
        setTicketsConfigured(response.ok && body.configured);
        setTickets(response.ok && body.configured ? body.items : []);
      })
      .catch(() => !cancelled && setTicketsConfigured(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const openTickets = useMemo(
    () =>
      tickets.filter(
        (ticket) => !["solved", "closed"].includes(ticket.status.toLowerCase()),
      ),
    [tickets],
  );

  const askFred = (prompt = query) => {
    const value = prompt.trim() || "Help me diagnose an IT issue";
    navigate(`/ai-report?from=%2Fsupport&prompt=${encodeURIComponent(value)}`);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-[linear-gradient(135deg,var(--portal-sidebar-bg),var(--portal-primary))] px-5 py-6 text-white shadow-lg">
        <SectionEyebrow>
          <span className="text-emerald-300">Troubleshooting</span>
        </SectionEyebrow>
        <h1 className="mt-1 text-2xl font-extrabold">
          IT Troubleshooting Center
        </h1>
        <p className="mt-2 text-sm text-white/65">
          Start with the symptom. Fred and the live operational tools will help
          you narrow it without losing the evidence trail.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            askFred();
          }}
          className="mt-5 flex gap-2"
        >
          <label className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Describe the issue, building, person, or service…"
              className="h-11 w-full rounded-lg border-0 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-300"
            />
          </label>
          <button className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-primary-foreground ring-1 ring-white/25 transition-colors hover:bg-[var(--primary-hover)]">
            <Sparkles className="h-4 w-4" /> Ask Fred
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {quickIssues.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setQuery(label);
                askFred(label);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/75 transition-colors hover:bg-white/20 hover:text-white"
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
            <div>
              <SectionEyebrow>Zendesk</SectionEyebrow>
              <CardTitle className="mt-1 flex items-center gap-2 text-base">
                <Ticket className="h-4 w-4 text-primary" /> Open ticket activity
              </CardTitle>
            </div>
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-wide"
            >
              {openTickets.length} recent
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {ticketsConfigured === null ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Loading current Zendesk activity…
              </p>
            ) : null}
            {ticketsConfigured === false ? (
              <div className="p-6 text-center">
                <p className="text-sm font-semibold">
                  Zendesk activity is unavailable
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The support hub remains usable; an administrator can restore
                  the configured feed.
                </p>
              </div>
            ) : null}
            {ticketsConfigured && openTickets.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm font-semibold">
                  No recent open ticket activity
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  That is the sort of empty state we can all enjoy.
                </p>
              </div>
            ) : null}
            {openTickets.slice(0, 6).map((ticket, index) => (
              <a
                key={ticket.id}
                href={ticket.url}
                target="_blank"
                rel="noreferrer"
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
              >
                <StatusDot
                  status={statusHealth(ticket.status)}
                  label={ticket.status}
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{ticket.subject}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    ZD-{ticket.id}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <UserAvatar
                    name={`Ticket ${index + 1}`}
                    className="h-7 w-7"
                  />
                  <span className="hidden text-[10px] text-muted-foreground md:block">
                    {new Date(ticket.updatedAt).toLocaleString()}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </a>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-3">
            <SectionEyebrow>Tools</SectionEyebrow>
            <CardTitle className="mt-1 text-base">
              Diagnostic launchpad
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 p-4">
            {diagnosticTools.map(({ label, description, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <Icon className="h-4 w-4 text-primary" />
                <p className="mt-2 text-xs font-bold">{label}</p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  {description}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-3">
            <SectionEyebrow>Respond</SectionEyebrow>
            <CardTitle className="mt-1 text-base">Common workflows</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <SupportLink
              href="/incidents"
              icon={Activity}
              label="Incident rooms"
              detail="Coordinate an active outage"
            />
            <SupportLink
              href="/after-action"
              icon={LifeBuoy}
              label="Post-incident reviews"
              detail="Document causes and lessons"
            />
            <SupportLink
              href="/items"
              icon={Ticket}
              label="My tasks"
              detail="Track follow-up work"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-3">
            <SectionEyebrow>Knowledge</SectionEyebrow>
            <CardTitle className="mt-1 text-base">
              Guides and practice
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <SupportLink
              href="/processes"
              icon={BookOpen}
              label="Process library"
              detail="Approved runbooks and procedures"
            />
            <SupportLink
              href="/learn"
              icon={GraduationCap}
              label="Learn"
              detail="Practice realistic IT situations"
            />
            <SupportLink
              href="/user-guide"
              icon={LifeBuoy}
              label="Insights guide"
              detail="How the platform works"
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b pb-3">
            <SectionEyebrow>Location</SectionEyebrow>
            <CardTitle className="mt-1 text-base">Network map</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="rounded-lg bg-[linear-gradient(135deg,var(--app-network-soft),var(--app-network-strong))] p-4">
              <Map className="h-6 w-6 text-blue-800" />
              <p className="mt-3 text-sm font-bold text-slate-900">
                Diagnose by building
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-700">
                Jump into the live building, switch, VLAN, and topology evidence
                without leaving the troubleshooting flow.
              </p>
              <Link
                href="/network"
                className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-blue-900"
              >
                Open network reference <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <section
        className="sticky bottom-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card/95 px-4 py-3 shadow-lg backdrop-blur"
        aria-label="Support service status"
      >
        <StatusDot
          service="Help Desk"
          status={
            (callSummary?.itHuntGroupUnanswered ?? 0) > 0
              ? "degraded"
              : "operational"
          }
          label={`${callSummary?.itHuntGroupAnswerRate ?? 0}% answered`}
        />
        <StatusDot
          service="Network"
          status={
            (summary?.offlineSwitches ?? 0) > 0 ? "degraded" : "operational"
          }
          label={
            (summary?.offlineSwitches ?? 0) > 0
              ? `${summary?.offlineSwitches} offline`
              : "Operational"
          }
        />
        <StatusDot service="Fred" status="operational" label="Online" />
        <span className="ml-auto text-xs font-semibold text-muted-foreground">
          Help Desk ext. {callSummary?.itHuntGroupExtension ?? "1200"}
        </span>
      </section>
    </div>
  );
}

function SupportLink({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon: typeof Activity;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold">{label}</span>
        <span className="block text-[10px] text-muted-foreground">
          {detail}
        </span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
    </Link>
  );
}
