import {
  BarChart3,
  ExternalLink,
  GraduationCap,
  KeyRound,
  LayoutGrid,
  PhoneCall,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const EMBED_URL = "https://unified-project-view.replit.app/organizations";

type AppLink = {
  name: string;
  description: string;
  href: string;
  external?: boolean;
  newFeature?: boolean;
};

const OPERATIONS_APPS: AppLink[] = [
  {
    name: "Cisco Webex Phones",
    description: "One combined phone directory and device-status table, plus building and E-911 health.",
    href: "/it-apps/cisco-calling",
    newFeature: true,
  },
  {
    name: "Banner",
    description: "Provisioning status, operating procedures, and the complete change history.",
    href: "/banner",
  },
];

const REPORT_APPS: AppLink[] = [
  {
    name: "IT Calls (1200)",
    description: "Answered and missed calls, answer rate, ring time, and call volume from Webex Calling.",
    href: "/it-apps/webex-calling",
  },
  {
    name: "ETHOS EUP Audit",
    description: "Administrative audit view for automated Ethos EUP account provisioning.",
    href: "https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning",
    external: true,
  },
  {
    name: "Student Password Reset",
    description: "Successful, failed, denied, and assisted student password-reset activity.",
    href: "/password-reset-activity",
  },
];

const STUDENT_SYSTEMS_APPS: AppLink[] = [
  {
    name: "My Saints / Student Login",
    description: "Ellucian Experience portal for student-facing sign-in and campus access.",
    href: "https://experience.elluciancloud.com/scccats/",
    external: true,
  },
  {
    name: "High School Student Access",
    description: "Student self-service and faculty-assisted temporary access for high-school partners.",
    href: "https://app-server2.centralus.cloudapp.azure.com:8443/student-start",
    external: true,
  },
  {
    name: "OnlineKiosk",
    description: "Internal online password reset for eligible regular students; limited to one successful reset every 30 days.",
    href: "/online-kiosk",
  },
];

const ACR_APPS: AppLink[] = [
  { name: "Continuity LMS", description: "Courses, rosters, student records, and outage continuity", href: "/acr/continuity/" },
  { name: "ACR Analytics Dashboard", description: "Continuity dashboard, enrollment, retention, and GPA analytics", href: "/acr/analytics/" },
  { name: "Board Docs", description: "Governance documents and meeting records", href: "/acr/board-docs/" },
  { name: "ACR Data Overview", description: "Academic master-data and integration overview", href: "/acr/overview/" },
];

function AppCard({ app, icon: Icon }: { app: AppLink; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <a
      href={app.href}
      target={app.external ? "_blank" : undefined}
      rel={app.external ? "noopener noreferrer" : undefined}
      className="group rounded-lg border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="h-5 w-5 shrink-0 text-primary" /> : null}
          <h3 className="font-semibold">{app.name}</h3>
          {app.newFeature ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">New Feature</span> : null}
        </div>
        {app.external ? <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{app.description}</p>
      <p className="mt-3 text-xs font-medium text-primary">Open {app.name}</p>
    </a>
  );
}

export default function ITApps() {
  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <LayoutGrid className="h-7 w-7" />
            IT Apps
          </h1>
          <p className="mt-1 text-muted-foreground">
            IT operations, institutional systems, and reports in one organized workspace.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={EMBED_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Project catalog
          </a>
        </Button>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">IT Operations</h2>
          <p className="text-sm text-muted-foreground">Administrative applications used to operate and support campus services.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <AppCard app={OPERATIONS_APPS[0]} icon={PhoneCall} />
          <AppCard app={OPERATIONS_APPS[1]} icon={GraduationCap} />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Reports</h2>
          <p className="text-sm text-muted-foreground">The three operational reports are grouped here for quick access.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <AppCard app={REPORT_APPS[0]} icon={PhoneCall} />
          <AppCard app={REPORT_APPS[1]} icon={BarChart3} />
          <AppCard app={REPORT_APPS[2]} icon={KeyRound} />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">SCCC Academic Continuity Repository</h2>
          <p className="text-sm text-muted-foreground">Direct links to each ACR application on App-Server2.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ACR_APPS.map((app) => <AppCard key={app.name} app={app} />)}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Identity & Student Systems</h2>
          <p className="text-sm text-muted-foreground">Student sign-in and account-access workflows.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STUDENT_SYSTEMS_APPS.map((app) => <AppCard key={app.name} app={app} />)}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Unified Project View</h2>
          <p className="text-sm text-muted-foreground">External catalog of additional IT applications and projects.</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <iframe
            src={EMBED_URL}
            title="IT Apps — Unified Project View"
            className="h-[calc(100vh-220px)] w-full"
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          If the view stays blank, the external app may block embedding — use “Project catalog” above.
        </p>
      </section>
    </div>
  );
}
