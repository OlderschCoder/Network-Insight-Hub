import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Server,
  Clock,
  Unplug,
} from "lucide-react";

const NETWORK_ADMIN_ROLES = ["cio", "network", "network_engineer"];

function apiBase() {
  return `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");
}
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface BuildingNamingIssue {
  key: string;
  canonical: string;
  variants: { name: string; switches: number; vlans: number }[];
}
interface SwitchNamingIssue {
  id: number;
  hostname: string;
  building: string | null;
  reason: string;
}
interface StaleSwitch {
  id: number;
  hostname: string;
  building: string | null;
  status: string | null;
  lastSeen: string | null;
  daysStale: number;
}
interface CoverageGaps {
  vlansWithoutSwitches: { building: string; vlans: number }[];
  switchesWithoutVlans: { building: string; switches: number }[];
}
interface HealthReport {
  staleDays: number;
  generatedAt: string;
  counts: {
    switches: number;
    vlans: number;
    buildingNamingIssues: number;
    switchNamingIssues: number;
    staleSwitches: number;
    coverageGaps: number;
  };
  buildingNaming: BuildingNamingIssue[];
  switchNaming: SwitchNamingIssue[];
  staleSwitches: StaleSwitch[];
  coverage: CoverageGaps;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function SectionCard({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
          <Badge variant={count === 0 ? "secondary" : "destructive"} className="ml-auto">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function AllClear({ label }: { label: string }) {
  return (
    <p className="text-xs text-muted-foreground flex items-center gap-2 py-1">
      <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {label}
    </p>
  );
}

export function InventoryHealth() {
  const { user } = useAuth();
  const isNetworkAdmin = NETWORK_ADMIN_ROLES.includes(user?.role ?? "");
  const [staleInput, setStaleInput] = useState("");
  const [staleDays, setStaleDays] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<HealthReport>({
    queryKey: ["network", "inventory-health", staleDays],
    queryFn: async () => {
      const url = new URL(`${apiBase()}/network/inventory/health`, window.location.origin);
      if (staleDays != null) url.searchParams.set("staleDays", String(staleDays));
      const res = await fetch(url.toString().replace(window.location.origin, ""), {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: isNetworkAdmin,
  });

  if (!isNetworkAdmin) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Inventory health is available to network administrators only.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="text-center text-muted-foreground py-8 flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Analyzing inventory…
      </div>
    );
  }
  if (isError || !data) {
    return <div className="text-center text-muted-foreground py-8">Could not load inventory health.</div>;
  }

  const totalIssues =
    data.counts.buildingNamingIssues +
    data.counts.switchNamingIssues +
    data.counts.staleSwitches +
    data.counts.coverageGaps;

  const applyStale = () => {
    const n = parseInt(staleInput, 10);
    setStaleDays(Number.isFinite(n) && n > 0 ? n : null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {totalIssues === 0 ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> No data-quality issues
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {totalIssues} issue{totalIssues === 1 ? "" : "s"} found
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {data.counts.switches} switches · {data.counts.vlans} VLANs
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Stale after</span>
          <Input
            value={staleInput}
            onChange={(e) => setStaleInput(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && applyStale()}
            placeholder={String(data.staleDays)}
            className="h-7 w-16 text-xs"
          />
          <span className="text-xs text-muted-foreground">days</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyStale}>
            Apply
          </Button>
        </div>
      </div>

      <SectionCard
        icon={<Building2 className="h-4 w-4 text-primary" />}
        title="Inconsistent building names"
        count={data.buildingNaming.length}
      >
        {data.buildingNaming.length === 0 ? (
          <AllClear label="All building names are consistent." />
        ) : (
          <div className="space-y-3">
            {data.buildingNaming.map((issue) => (
              <div key={issue.key} className="text-xs space-y-1">
                <div>
                  Suggested canonical:{" "}
                  <span className="font-medium">{issue.canonical}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {issue.variants.map((v) => (
                    <Badge
                      key={v.name}
                      variant={v.name === issue.canonical ? "default" : "outline"}
                      className="font-normal"
                    >
                      {v.name} ({v.switches}s / {v.vlans}v)
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={<Server className="h-4 w-4 text-primary" />}
        title="Switch naming outliers"
        count={data.switchNaming.length}
      >
        {data.switchNaming.length === 0 ? (
          <AllClear label="Switch hostnames follow a consistent convention." />
        ) : (
          <ul className="text-xs space-y-1.5">
            {data.switchNaming.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{s.hostname}</span>
                {s.building && <span className="text-muted-foreground">· {s.building}</span>}
                <span className="text-muted-foreground">— {s.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={<Clock className="h-4 w-4 text-primary" />}
        title={`Stale switches (offline/unknown > ${data.staleDays}d)`}
        count={data.staleSwitches.length}
      >
        {data.staleSwitches.length === 0 ? (
          <AllClear label="No stale switches." />
        ) : (
          <ul className="text-xs space-y-1.5">
            {data.staleSwitches.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{s.hostname}</span>
                {s.building && <span className="text-muted-foreground">· {s.building}</span>}
                <Badge variant="outline" className="font-normal">
                  {s.status ?? "unknown"}
                </Badge>
                <span className="text-muted-foreground">
                  {s.daysStale}d stale · last seen {fmtDate(s.lastSeen)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={<Unplug className="h-4 w-4 text-primary" />}
        title="Coverage gaps"
        count={data.coverage.vlansWithoutSwitches.length + data.coverage.switchesWithoutVlans.length}
      >
        {data.coverage.vlansWithoutSwitches.length === 0 &&
        data.coverage.switchesWithoutVlans.length === 0 ? (
          <AllClear label="Every building has both switches and VLANs." />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                VLANs but no switch
              </p>
              {data.coverage.vlansWithoutSwitches.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">None.</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {data.coverage.vlansWithoutSwitches.map((b) => (
                    <li key={b.building}>
                      <span className="font-medium">{b.building}</span>{" "}
                      <span className="text-muted-foreground">— {b.vlans} VLAN(s), 0 switches</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Switches but no VLAN
              </p>
              {data.coverage.switchesWithoutVlans.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">None.</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {data.coverage.switchesWithoutVlans.map((b) => (
                    <li key={b.building}>
                      <span className="font-medium">{b.building}</span>{" "}
                      <span className="text-muted-foreground">— {b.switches} switch(es), 0 VLANs</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
