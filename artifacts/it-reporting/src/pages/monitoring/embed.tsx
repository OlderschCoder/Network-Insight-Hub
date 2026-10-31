import { Gauge } from "lucide-react";
import { MonitoringDashboard } from "@/components/monitoring/MonitoringDashboard";

export default function MonitoringEmbedPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center gap-3">
          <Gauge className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">SCCC Monitoring Board</h1>
            <p className="text-sm text-muted-foreground">
              Public read-only embed rendered by the Network Insight Hub on APP_Server2.
            </p>
          </div>
        </div>

        <MonitoringDashboard publicMode />
      </div>
    </div>
  );
}
