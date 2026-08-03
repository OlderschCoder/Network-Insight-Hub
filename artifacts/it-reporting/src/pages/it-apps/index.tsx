import { ExternalLink, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";

const EMBED_URL = "https://unified-project-view.replit.app/organizations";

const ACR_APPS = [
  { name: "Continuity LMS", description: "Courses, rosters, student records, and outage continuity", href: "/acr/continuity/" },
  { name: "ACR Analytics Dashboard", description: "Continuity dashboard, enrollment, retention, and GPA analytics", href: "/acr/analytics/" },
  { name: "Board Docs", description: "Governance documents and meeting records", href: "/acr/board-docs/" },
  { name: "ACR Data Overview", description: "Academic master-data and integration overview", href: "/acr/overview/" },
];

export default function ITApps() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <LayoutGrid className="h-7 w-7" />
            IT Apps
          </h1>
          <p className="text-muted-foreground mt-1">
            Unified view of the apps and projects built for the IT department.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={EMBED_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open in new tab
          </a>
        </Button>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">SCCC Academic Continuity Repository</h2>
          <p className="text-sm text-muted-foreground">Direct links to each ACR application on App-Server2.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ACR_APPS.map((app) => (
            <a
              key={app.name}
              href={app.href}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{app.name}</h3>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{app.description}</p>
              <p className="mt-3 text-xs font-medium text-primary">Open {app.name}</p>
            </a>
          ))}
        </div>
      </section>

      <div>
        <h2 className="text-xl font-semibold">Unified Project View</h2>
        <p className="text-sm text-muted-foreground">External catalog of additional IT applications and projects.</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <iframe
          src={EMBED_URL}
          title="IT Apps — Unified Project View"
          className="w-full h-[calc(100vh-220px)]"
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        If the view above stays blank, the external app may block embedding — use “Open in new tab” to view it directly.
      </p>
    </div>
  );
}
