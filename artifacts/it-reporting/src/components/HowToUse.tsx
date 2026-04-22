import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ListChecks,
  FileText,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  X,
  HelpCircle,
  Users,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

type Step = {
  num: number;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  cta?: { href: string; label: string };
};

const HELPDESK_STEPS: Step[] = [
  {
    num: 1,
    icon: <ListChecks className="h-4 w-4" />,
    title: "Throughout the week — log every completed item",
    body: (
      <>
        Each time you finish a ticket, project task, install, or piece of
        research, click <strong>Quick Add Item</strong> at the top of the page
        (or open <Link href="/items" className="underline">My Items</Link>).
        Give it a short title, pick a category (Task, Research, Documentation,
        Incident…), and add notes. Resolved Zendesk tickets are pulled in
        automatically — you do not need to re-enter them.
      </>
    ),
    cta: { href: "/items", label: "Go to My Items" },
  },
  {
    num: 2,
    icon: <FileText className="h-4 w-4" />,
    title: "Friday — turn your items into a Weekly Log",
    body: (
      <>
        On Friday open <Link href="/entries/new" className="underline">Generate
        Weekly Log</Link>. The page auto-loads everything you logged this week
        plus your resolved Zendesk tickets. Add a one-line headline, a short
        summary, and note any blockers or help you need. Save as draft anytime;
        submit when you're done. The CIO sees who has and hasn't submitted on
        the dashboard.
      </>
    ),
    cta: { href: "/entries/new", label: "Generate this week's log" },
  },
  {
    num: 3,
    icon: <ShieldAlert className="h-4 w-4" />,
    title: "As things come up — risks, incidents, processes",
    body: (
      <>
        Found a security or operational risk? Add it under{" "}
        <Link href="/risks" className="underline">Risks &amp; Issues</Link>.
        Just finished an incident or major change? File an{" "}
        <Link href="/after-action" className="underline">After-Action Report</Link>.
        Documenting a recurring procedure? Drop it in the{" "}
        <Link href="/processes" className="underline">Process Library</Link>{" "}
        so the rest of the team can use it.
      </>
    ),
  },
];

const CIO_STEPS: Step[] = [
  {
    num: 1,
    icon: <Users className="h-4 w-4" />,
    title: "Monitor the team's weekly submissions",
    body: (
      <>
        The <strong>Team Submission Status</strong> card below shows who has
        submitted their weekly log and who is still in draft. Open{" "}
        <Link href="/entries" className="underline">Weekly Logs</Link> to read
        any individual submission, edit, or add comments.
      </>
    ),
    cta: { href: "/entries", label: "Open Weekly Logs" },
  },
  {
    num: 2,
    icon: <FileText className="h-4 w-4" />,
    title: "Review reports and generate AI summaries",
    body: (
      <>
        The <Link href="/reports" className="underline">Reports</Link> hub
        rolls up Individual, Team, Monthly Achievements and Open Items views.
        Use <Link href="/ai-report" className="underline">AI Reports</Link> to
        generate a finished status report from the week's data, or export any
        log as DOCX / XLSX from its detail page.
      </>
    ),
    cta: { href: "/reports", label: "Open Reports hub" },
  },
  {
    num: 3,
    icon: <CheckCircle2 className="h-4 w-4" />,
    title: "Finalize the week and manage users",
    body: (
      <>
        Once everyone has submitted, finalize the week from the Weekly Logs
        page — that locks the period for reporting. Add or deactivate staff
        from <Link href="/admin" className="underline">Admin</Link>.
      </>
    ),
    cta: { href: "/admin", label: "User management" },
  },
];

export function HowToUse() {
  const { user, isCIO } = useAuth();
  const storageKey = `sccc-howto-dismissed-v1-${isCIO ? "cio" : "staff"}`;
  const [dismissed, setDismissed] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  const dismiss = () => {
    window.localStorage.setItem(storageKey, "1");
    setDismissed(true);
  };
  const restore = () => {
    window.localStorage.removeItem(storageKey);
    setDismissed(false);
    setCollapsed(false);
  };

  if (!user) return null;

  if (dismissed) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={restore}
        className="text-xs text-muted-foreground gap-1"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Show "How to use this system"
      </Button>
    );
  }

  const steps = isCIO ? CIO_STEPS : HELPDESK_STEPS;
  const firstName = user.name?.split(" ")[0];
  const greeting = isCIO
    ? `Welcome${firstName ? `, ${firstName}` : ""} — here's the CIO workflow`
    : `Welcome${firstName ? `, ${firstName}` : ""} — here's how this system works`;

  return (
    <Card className="border-primary/40 bg-primary/[0.03]">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{greeting}</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed((c) => !c)}
            className="h-7 w-7 p-0"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            className="h-7 w-7 p-0"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="pt-2">
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((s) => (
              <div
                key={s.num}
                className="rounded-lg border bg-background p-4 flex flex-col"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                    {s.num}
                  </div>
                  <div className="text-primary">{s.icon}</div>
                </div>
                <div className="font-semibold text-sm leading-snug mb-2">
                  {s.title}
                </div>
                <div className="text-sm text-muted-foreground leading-relaxed flex-1">
                  {s.body}
                </div>
                {s.cta && (
                  <div className="pt-3">
                    <Link href={s.cta.href}>
                      <Button size="sm" variant="outline" className="text-xs">
                        {s.cta.label}
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            You can hide this guide with the X above and bring it back any time
            from the link that appears in its place.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

export default HowToUse;
