import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Loader2, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authFetch } from "@/lib/authFetch";

type UsageReport = {
  generatedUtc: string;
  days: number;
  policy: { dailyLimit: number; reviewThreshold: number };
  summary: { totalPasses: number; uniqueStudents: number; reviewFlags: number; policyExceeded: number };
  rows: Array<{
    date: string;
    objectId: string;
    displayName: string;
    userPrincipalName: string;
    studentId: string;
    school: string;
    count: number;
    selfServiceCount: number;
    facultyCount: number;
    lastUtc: string;
  }>;
};

function apiUrl(days: number): string {
  return `${import.meta.env.BASE_URL}api/mfa-tap-activity?days=${days}`.replace(/\/+/g, "/");
}

function centralTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

export default function MfaTapActivity() {
  const [days, setDays] = useState(7);
  const { data, isLoading, isError, isFetching, refetch } = useQuery<UsageReport>({
    queryKey: ["mfa-tap-activity", days],
    queryFn: async () => {
      const response = await authFetch(apiUrl(days), { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    refetchInterval: 60_000,
  });

  const metrics = [
    { label: "TAPs in flagged rows", value: data?.summary.totalPasses ?? 0, icon: KeyRound },
    { label: "Flagged students", value: data?.summary.uniqueStudents ?? 0, icon: Users },
    { label: "Review flags (4–7)", value: data?.summary.reviewFlags ?? 0, icon: AlertTriangle },
    { label: "Above policy (>7)", value: data?.summary.policyExceeded ?? 0, icon: ShieldAlert },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <KeyRound className="h-7 w-7" /> High School MFA/TAP Usage
          </h1>
          <p className="mt-1 text-muted-foreground">
            Daily Temporary Access Pass activity. Students may receive up to seven; four through seven is highlighted for IT review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger className="w-[150px]" aria-label="Report period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle><Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{value}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Daily student usage</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading usage…</div>
          ) : isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">The MFA usage report is temporarily unavailable.</div>
          ) : data?.rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>UTC date</TableHead><TableHead>Student</TableHead><TableHead>800 number</TableHead><TableHead>High school</TableHead><TableHead>Passes</TableHead><TableHead>Source</TableHead><TableHead>Last issued</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.rows.map((row) => {
                    const review = row.count >= (data.policy.reviewThreshold ?? 4);
                    const exceeded = row.count > (data.policy.dailyLimit ?? 7);
                    return (
                      <TableRow key={`${row.date}-${row.objectId}`} className={review ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/40" : undefined}>
                        <TableCell className="whitespace-nowrap">{row.date}</TableCell>
                        <TableCell><div className="font-medium">{row.displayName || "Unresolved student"}</div><div className="text-xs text-muted-foreground">{row.userPrincipalName}</div></TableCell>
                        <TableCell className="font-mono text-xs">{row.studentId || "—"}</TableCell>
                        <TableCell>{row.school || "Not recorded"}</TableCell>
                        <TableCell>{exceeded ? <Badge variant="destructive">{row.count} · above policy</Badge> : review ? <Badge className="bg-red-600 hover:bg-red-600">{row.count} · review</Badge> : <Badge variant="secondary">{row.count}</Badge>}</TableCell>
                        <TableCell className="text-xs">Self-service {row.selfServiceCount}<br />Faculty {row.facultyCount}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{centralTime(row.lastUtc)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : <div className="py-12 text-center text-muted-foreground">No student reached the four-pass review threshold during this period.</div>}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Counts follow the application's UTC-day enforcement window. This protected report excludes TAP values, passwords, authentication secrets, and Graph credentials. Last generated {data ? centralTime(data.generatedUtc) : "—"}.
      </p>
    </div>
  );
}
