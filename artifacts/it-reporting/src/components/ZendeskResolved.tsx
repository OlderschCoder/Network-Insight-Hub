import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ticket } from "lucide-react";

interface Row {
  zendeskUserId: number | null;
  name: string;
  email: string | null;
  resolvedCount: number;
  isTeamMember: boolean;
  teamRole?: string | null;
}

interface Resp {
  sinceDate: string;
  days: number;
  totalResolved: number;
  breakdown: Row[];
}

const roleLabel: Record<string, string> = {
  cio: "CIO",
  helpdesk: "Help Desk",
  network_engineer: "Network Engineer",
  security_engineer: "Security Engineer",
  network: "Network",
  security: "Security",
  staff: "Staff",
};

export function ZendeskResolved() {
  const [data, setData] = useState<Resp | null>(null);
  const [errorKind, setErrorKind] = useState<"auth" | "generic" | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("7");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorKind(null);
    const token = localStorage.getItem("auth_token");
    fetch(`${import.meta.env.BASE_URL}api/zendesk/resolved-by-user?days=${days}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) {
          const code = body?.code;
          setErrorKind(
            code === "ZENDESK_AUTH" || code === "ZENDESK_NOT_CONFIGURED" ? "auth" : "generic",
          );
          setData(null);
        } else {
          setData(body);
        }
      })
      .catch(() => !cancelled && setErrorKind("generic"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const max = Math.max(1, ...(data?.breakdown.map((r) => r.resolvedCount) ?? []));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            Zendesk Tickets Resolved
          </CardTitle>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.totalResolved} total in Onsite_it group since {data.sinceDate}
            </p>
          )}
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {loading && <div className="text-sm text-muted-foreground py-4">Loading from Zendesk...</div>}
        {errorKind === "auth" && (
          <div className="text-sm text-muted-foreground py-3">
            <p className="font-medium text-foreground">Zendesk isn't connected right now.</p>
            <p className="mt-0.5">
              Ticket stats are unavailable until the Zendesk API credentials are verified — an admin
              needs to confirm API token access is enabled and the agent email/subdomain are correct.
            </p>
          </div>
        )}
        {errorKind === "generic" && (
          <div className="text-sm text-muted-foreground py-3">
            Couldn't load Zendesk ticket stats right now. Please try again later.
          </div>
        )}
        {data && data.breakdown.length === 0 && !loading && (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No resolved tickets in this period.
          </div>
        )}
        {data && data.breakdown.length > 0 && (
          <div className="space-y-3">
            {data.breakdown.map((row, i) => (
              <div key={`${row.zendeskUserId ?? "team"}-${i}`} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{row.name}</span>
                      {row.isTeamMember && row.teamRole && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {roleLabel[row.teamRole] ?? row.teamRole}
                        </Badge>
                      )}
                      {!row.isTeamMember && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-muted-foreground">
                          External
                        </Badge>
                      )}
                    </div>
                    {row.email && (
                      <span className="text-xs text-muted-foreground truncate">{row.email}</span>
                    )}
                  </div>
                  <Badge variant={row.resolvedCount > 0 ? "secondary" : "outline"} className="ml-2">
                    {row.resolvedCount}
                  </Badge>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      row.isTeamMember ? "bg-emerald-500" : "bg-slate-400"
                    }`}
                    style={{ width: `${(row.resolvedCount / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
