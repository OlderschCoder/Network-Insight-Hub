import {
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  ClipboardList,
  Compass,
  FileCheck2,
  LifeBuoy,
  ListChecks,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionEyebrow } from "@/components/portal-ui";

const menuGroups = [
  {
    label: "Status & Reporting",
    href: "/status",
    detail: "Campus status and weekly reports",
  },
  {
    label: "Campus Technology",
    href: "/network/buildings",
    detail: "Buildings, network, phones, monitoring, and Azure",
  },
  {
    label: "Troubleshooting",
    href: "/support",
    detail: "Zendesk, incidents, risks, reviews, training, and runbooks",
  },
  {
    label: "My Work",
    href: "/todos",
    detail: "To-dos, completed work, and weekly logs",
  },
  {
    label: "IT Apps",
    href: "/it-apps",
    detail: "Shared applications and student-access tools",
  },
  {
    label: "Administration",
    href: "/projects",
    detail: "CIO projects, goals, analytics, and access",
  },
] as const;

const firstRunSteps = [
  {
    number: "01",
    title: "Organize your work",
    icon: ClipboardList,
    body: "Keep future work in To-do List. Record finished tickets, installs, research, and project work in Completed Work so it can roll into your Weekly Log.",
    actions: [
      { label: "Open To-do List", href: "/todos" },
      { label: "Record Completed Work", href: "/items" },
    ],
  },
  {
    number: "02",
    title: "Work a support conversation",
    icon: MessagesSquare,
    body: "Open Zendesk Monitor, select a ticket, read the complete thread, and let Fred prepare a supervised draft. Edit or save it for approval; a person remains the sender.",
    actions: [
      { label: "Open Zendesk Monitor", href: "/support/zendesk" },
      { label: "Open Support Center", href: "/support" },
    ],
  },
  {
    number: "03",
    title: "Finish the weekly loop",
    icon: FileCheck2,
    body: "Generate and review your Weekly Log near week-end. The CIO uses submitted logs, risks, reviews, and resolved Zendesk work to assemble the department report.",
    actions: [
      { label: "Open Weekly Log", href: "/entries" },
      { label: "Open Reports", href: "/reports" },
    ],
  },
] as const;

export default function QuickStart() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl bg-[linear-gradient(135deg,var(--portal-sidebar-bg),var(--portal-primary))] px-6 py-8 text-white shadow-lg md:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
          <div>
            <SectionEyebrow>
              <span className="text-emerald-300">Quick Start</span>
            </SectionEyebrow>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              Your first 10 minutes in Insights
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/70">
              Learn the new top-menu layout, complete the daily work cycle, and
              use Fred without giving up human review of Zendesk replies.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/todos"
                className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-sm font-bold text-emerald-950 transition-colors hover:bg-emerald-50"
              >
                Start with My Work <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/support/zendesk"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/15"
              >
                Supervise Zendesk drafts
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-black/15 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-300/20">
                <Sparkles className="h-5 w-5 text-emerald-200" />
              </span>
              <div>
                <p className="font-bold">Fred is the persistent guide</p>
                <p className="text-xs text-white/55">
                  Available from every top bar
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/70">
              Ask where a feature lives, request a draft, or teach a durable
              SCCC fact. Fred can help do the work, but confirmation gates still
              protect ticket replies and record changes.
            </p>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader className="border-b pb-4">
          <SectionEyebrow>Navigation</SectionEyebrow>
          <CardTitle className="mt-1 flex items-center gap-2 text-xl">
            <Compass className="h-5 w-5 text-primary" /> The top menu is the map
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Select a category title to open its landing page. Select the
            separate chevron to see every destination in that category.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {menuGroups.map((group) => (
            <Link
              key={group.label}
              href={group.href}
              className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/45 hover:bg-muted/35"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold group-hover:text-primary">
                  {group.label}
                </span>
                {group.label === "Administration" ? (
                  <Badge variant="outline" className="text-[10px]">
                    CIO
                  </Badge>
                ) : (
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {group.detail}
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>

      <section>
        <div className="mb-3">
          <SectionEyebrow>Daily workflow</SectionEyebrow>
          <h2 className="mt-1 text-xl font-bold">
            Do these three things first
          </h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {firstRunSteps.map((step) => {
            const Icon = step.icon;
            return (
              <Card key={step.number} className="overflow-hidden">
                <CardHeader className="border-b pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-2xl font-black text-muted-foreground/25">
                      {step.number}
                    </span>
                  </div>
                  <CardTitle className="mt-2 text-base">{step.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex h-full flex-col p-4">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {step.body}
                  </p>
                  <div className="mt-4 space-y-2">
                    {step.actions.map((action) => (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        {action.label} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b pb-4">
            <SectionEyebrow>Supervised support</SectionEyebrow>
            <CardTitle className="mt-1 flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-primary" /> Fred and Zendesk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 text-sm">
            {[
              "Fred drafting and Zendesk replies have separate supervisor switches.",
              "Prepare open drafts saves eligible replies for review; it never sends them.",
              "Read the full thread, edit the response, then save it for approval.",
              "Messaging replies are copied into Zendesk Agent Workspace for the final human send.",
              "Use Escalate to a team member when the ticket needs another owner.",
              "For an active-student reset, verify identity independently, then ask Fred to prepare the ten-minute private OnlineKiosk link. Fred never sees the password.",
            ].map((item) => (
              <div key={item} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="leading-5 text-muted-foreground">{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <SectionEyebrow>Teach Fred</SectionEyebrow>
            <CardTitle className="mt-1 flex items-center gap-2 text-lg">
              <Brain className="h-5 w-5 text-primary" /> Memory for facts,
              processes for steps
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="rounded-lg border bg-muted/25 p-4">
              <p className="text-sm font-bold">Fred Memory</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Store durable environment facts, policies, and reply rules. An
                edited draft does not train Fred unless the correction is also
                saved to Memory.
              </p>
              <Link
                href="/ai-report?tab=memory"
                className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary"
              >
                Open Fred Memory <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="rounded-lg border bg-muted/25 p-4">
              <p className="text-sm font-bold">Process Library</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Store repeatable procedures using Symptoms, Checks, Fix,
                Validation, and Rollback. Keep actual passwords, MFA codes, API
                keys, and other secrets out of both places.
              </p>
              <Link
                href="/processes"
                className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary"
              >
                Open Process Library <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-primary" />
              <p className="font-bold">
                Current SCCC reply rules Fred should follow
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Wireless uses the requester&apos;s SCCC network username and
              password, but Fred must never ask anyone to disclose that
              password. Zendesk already provides requester identity and email,
              so Fred should not ask for them again. SCCC IT handles Microsoft
              365 license changes.
              For student password recovery, the name, username, email, and 800
              number are matching data—not proof. CIO/help-desk staff must
              independently verify the student and confirm Fred&apos;s exact
              action; the student then chooses the password privately in
              OnlineKiosk.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/learn"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              <ListChecks className="h-4 w-4" /> Practice in Learn
            </Link>
            <Link
              href="/user-guide"
              className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-4 text-xs font-bold hover:border-primary/40 hover:text-primary"
            >
              <BookOpen className="h-4 w-4" /> Full User Guide
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Stuck? Select <strong className="text-foreground">Fred</strong> in the
          top bar and ask for the exact page and click-by-click steps. Fred is
          trained on this Quick Start and the full User Guide.
        </p>
      </div>
    </div>
  );
}
