import { useState } from "react";
import { Gauge, ExternalLink, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

const GRAFANA_URL =
  (import.meta.env.VITE_GRAFANA_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://10.0.0.22:3000";

export default function Monitoring() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Gauge className="h-7 w-7" /> Monitoring
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live Grafana dashboards from the on-prem monitoring server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="h-4 w-4 mr-2" /> Reload
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={GRAFANA_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" /> Open in new tab
            </a>
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          The dashboard loads directly from <code className="font-mono">{GRAFANA_URL}</code> in your
          browser, so you must be on the SCCC network (or VPN) to see it. If it appears blank, Grafana
          must allow embedding (set <code className="font-mono">allow_embedding = true</code> in
          grafana.ini) and you may need to be signed in to Grafana in another tab — use{" "}
          <span className="font-medium">Open in new tab</span> as a fallback.
        </span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <iframe
          key={reloadKey}
          src={GRAFANA_URL}
          title="Grafana Dashboard"
          className="w-full h-[calc(100vh-15rem)] min-h-[480px] border-0"
        />
      </div>
    </div>
  );
}
