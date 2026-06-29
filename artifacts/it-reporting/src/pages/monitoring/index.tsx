import { useEffect, useRef, useState } from "react";
import {
  Gauge,
  ExternalLink,
  RefreshCw,
  Info,
  AlertTriangle,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const GRAFANA_URL =
  (import.meta.env.VITE_GRAFANA_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://10.0.0.22:3000";

const isMixedContent =
  typeof window !== "undefined" &&
  window.location.protocol === "https:" &&
  GRAFANA_URL.startsWith("http://");

// If the embedded board hasn't reported a successful load within this window we
// assume it was blocked (mixed-content, X-Frame-Options/CSP, or off-network) and
// surface the "open to the side" fallback so the user still sees live data.
const LOAD_TIMEOUT_MS = 8000;

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
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // (Re)start the load watchdog whenever we (re)mount the iframe.
  useEffect(() => {
    if (isMixedContent) return; // We already know it can't load; no need to wait.
    setLoaded(false);
    setTimedOut(false);
    timerRef.current = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reloadKey]);

  const handleIframeLoad = () => {
    // Note: for cross-origin frames this fires on successful navigation but we
    // can't read the document. It does NOT fire when the request is blocked.
    setLoaded(true);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  // Blocked = we know it's mixed content, or it never confirmed a load in time.
  const blocked = isMixedContent || (timedOut && !loaded);

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
          <Button variant="default" size="sm" onClick={openToSide}>
            <PanelRightOpen className="h-4 w-4 mr-2" /> Open to the side
          </Button>
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

      {blocked && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p>
              {isMixedContent ? (
                <>
                  This app is served over <span className="font-semibold">HTTPS</span>, but Grafana
                  runs over plain <span className="font-semibold">HTTP</span> (
                  <code className="font-mono">{GRAFANA_URL}</code>). Browsers block insecure content
                  inside a secure page, so the board can&apos;t embed here.
                </>
              ) : (
                <>
                  The board didn&apos;t load in the embedded view — Grafana may be blocking embedding,
                  or you may be off the SCCC network.
                </>
              )}{" "}
              Open it in a window to the side instead — that loads the{" "}
              <span className="font-semibold">live, correct data</span> straight from Grafana.
            </p>
            <Button variant="default" size="sm" onClick={openToSide}>
              <PanelRightOpen className="h-4 w-4 mr-2" /> Open board to the side
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          The dashboard loads directly from <code className="font-mono">{GRAFANA_URL}</code> in your
          browser, so you must be on the SCCC network (or VPN) to see it. If the embed below is blank,
          use <span className="font-medium">Open to the side</span> — it shows the same live Grafana
          data in its own window.
        </span>
      </div>

      {!isMixedContent && (
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <iframe
            key={reloadKey}
            src={GRAFANA_URL}
            title="Grafana Dashboard"
            onLoad={handleIframeLoad}
            className="w-full h-[calc(100vh-15rem)] min-h-[480px] border-0"
          />
        </div>
      )}
    </div>
  );
}
