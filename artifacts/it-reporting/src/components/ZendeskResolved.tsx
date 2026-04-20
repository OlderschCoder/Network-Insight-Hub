import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ticket } from "lucide-react";

interface Row {
  zendeskUserId: number;
  name: string;
  email: string | null;
  resolvedCount: number;
}

interface Resp {
  sinceDate: string;
  days: number;
  totalResolved: number;
  breakdown: Row[];
}

export function ZendeskResolved() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("7");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const token = localStorage.getItem("auth_token");
    fetch(`/api/zendesk/resolved-by-user?days=${days}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(body.message || body.error || "Failed to load");
          setData(null);
        } else {
          setData(body);
        }
      })
      .catch((e) => !cancelled && setError(e.message))
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
              {data.totalResolved} total since {data.sinceDate}
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
        {error && (
          <div className="text-sm text-red-500 py-2">
            {error}
          </div>
        )}
        {data && data.breakdown.length === 0 && !loading && (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No resolved tickets in this period.
          </div>
        )}
        {data && data.breakdown.length > 0 && (
          <div className="space-y-3">
            {data.breakdown.map((row) => (
              <div key={row.zendeskUserId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium truncate">{row.name}</span>
                    {row.email && (
                      <span className="text-xs text-muted-foreground truncate">{row.email}</span>
                    )}
                  </div>
                  <Badge variant="secondary" className="ml-2">{row.resolvedCount}</Badge>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
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
