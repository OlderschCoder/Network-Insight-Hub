import { ExternalLink, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";

const EMBED_URL = "https://unified-project-view.replit.app/organizations";

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
