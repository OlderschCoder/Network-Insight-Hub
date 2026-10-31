import {
  Gauge,
  ExternalLink,
  Info,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonitoringDashboard } from "@/components/monitoring/MonitoringDashboard";

const GRAFANA_URL =
  (import.meta.env.VITE_GRAFANA_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://10.0.0.22:3000";

/**
 * Opens the real Grafana board in a separate browser window docked to the right
 * half of the screen. This always shows live, correct data because it loads the
 * actual Grafana instance directly in the user's browser (which must be on the
 * SCCC network) — nothing is cached or reconstructed by this app.
 */
function openToSide() {
  const availW = window.screen.availWidth || window.innerWidth;
  const availH = window.screen.availHeight || window.innerHeight;
  const width = Math.floor(availW / 2);
  const height = availH;
  const left = availW - width;
  const features = `left=${left},top=0,width=${width},height=${height},noopener`;
  const win = window.open(GRAFANA_URL, "grafana_board", features);
  // Popup blocked → fall back to a normal new tab so the user still gets the data.
  if (!win) window.open(GRAFANA_URL, "_blank", "noopener,noreferrer");
}

export default function Monitoring() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Gauge className="h-7 w-7" /> Monitoring
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Native live monitoring rendered by the Hub on APP_Server2, with Grafana still available as a raw fallback.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/monitoring/embed" target="_blank" rel="noreferrer">
              <Gauge className="h-4 w-4 mr-2" /> Public embed page
            </a>
          </Button>
          <Button variant="default" size="sm" onClick={openToSide}>
            <PanelRightOpen className="h-4 w-4 mr-2" /> Open to the side
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
          The live board below is rendered directly by the Hub from InfluxDB, so it avoids the iframe and mixed-content problems that were hitting the raw Grafana view. The Grafana board at{" "}
          <code className="font-mono">{GRAFANA_URL}</code> is still available if you want the original panels.
        </span>
      </div>

      <MonitoringDashboard />
    </div>
  );
}
