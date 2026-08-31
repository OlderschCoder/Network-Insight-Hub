import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authFetch } from "@/lib/authFetch";

type ResetActivity = {
  generatedUtc: string;
  sinceUtc: string;
  hours: number;
  summary: {
    total: number;
    successful: number;
    failed: number;
    denied: number;
  };
  rows: Array<{
    utc: string;
    account: string;
    outcome: string;
    kiosk: string;
    sourceIp: string;
    detail: string;
    requestId: string;
  }>;
};

function apiUrl(hours: number): string {
  return `${import.meta.env.BASE_URL}api/password-reset-activity?hours=${hours}`.replace(/\/+/g, "/");
}

function centralTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(parsed);
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "success") {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Successful</Badge>;
  }
  if (outcome === "denied") return <Badge variant="destructive">Denied</Badge>;
  return <Badge variant="secondary">Failed</Badge>;
}

export default function PasswordResetActivity() {
  const [hours, setHours] = useState(168);
  const { data, isLoading, isError, isFetching, refetch } = useQuery<ResetActivity>({
    queryKey: ["password-reset-activity", hours],
    queryFn: async () => {
      const response = await authFetch(apiUrl(hours), { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    refetchInterval: 60_000,
  });

  const metrics = [
    { label: "Total attempts", value: data?.summary.total ?? 0, icon: KeyRound },
    { label: "Successful", value: data?.summary.successful ?? 0, icon: CheckCircle2 },
    { label: "Failed", value: data?.summary.failed ?? 0, icon: AlertTriangle },
    { label: "Denied", value: data?.summary.denied ?? 0, icon: ShieldAlert },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <KeyRound className="h-7 w-7" />
            Student Password Reset Activity
          </h1>
          <p className="mt-1 text-muted-foreground">
            Successful, failed, and denied first-time account password resets from approved kiosks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(hours)} onValueChange={(value) => setHours(Number(value))}>
            <SelectTrigger className="w-[150px]" aria-label="Report period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="168">Last 7 days</SelectItem>
              <SelectItem value="720">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{value}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock3 className="h-5 w-5" /> Activity log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading password reset activity…
            </div>
          ) : isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              The password reset activity report is temporarily unavailable. Refresh to try again.
            </div>
          ) : data?.rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Central time</TableHead>
                    <TableHead>Student account</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Kiosk</TableHead>
                    <TableHead>Source IP</TableHead>
                    <TableHead>Detail / request ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row, index) => (
                    <TableRow key={`${row.utc}-${row.account}-${index}`}>
                      <TableCell className="whitespace-nowrap">{centralTime(row.utc)}</TableCell>
                      <TableCell className="font-medium">{row.account}</TableCell>
                      <TableCell><OutcomeBadge outcome={row.outcome} /></TableCell>
                      <TableCell className="max-w-[220px] truncate" title={row.kiosk}>{row.kiosk}</TableCell>
                      <TableCell className="font-mono text-xs">{row.sourceIp}</TableCell>
                      <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                        <div>{row.detail || "—"}</div>
                        {row.requestId ? <div className="mt-1 font-mono">{row.requestId}</div> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No kiosk password reset attempts were recorded during this period.
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        This audit view intentionally excludes passwords, Temporary Access Passes, authenticator secrets, and QR data.
        It refreshes automatically every minute. Last generated {data ? centralTime(data.generatedUtc) : "—"}.
      </p>
    </div>
  );
}
