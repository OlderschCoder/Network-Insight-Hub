import { useMemo, useState } from "react";
import {
  useGetUsageAnalytics,
  type UsageAnalytics,
  type UsagePerUser,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";

const FEATURE_LABELS: Record<string, string> = {
  entries: "Weekly Log",
  risks: "Risks & Issues",
  processes: "Processes",
  projects: "Projects",
  reports: "Reports",
  afterActions: "Post-Incident Reviews",
  items: "My Tasks",
  azureVms: "Azure VMs",
  objectives: "Goals",
};

const FEATURE_KEYS = [
  "entries",
  "risks",
  "processes",
  "projects",
  "reports",
  "afterActions",
  "items",
  "azureVms",
  "objectives",
] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];

const ROLE_COLORS: Record<string, string> = {
  cio: "#7c3aed",
  network_engineer: "#2563eb",
  network: "#2563eb",
  security_engineer: "#dc2626",
  security: "#dc2626",
  helpdesk: "#16a34a",
  staff: "#64748b",
};

function colorForRole(role: string): string {
  return ROLE_COLORS[role] ?? "#94a3b8";
}

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type SortKey = "name" | "role" | "total" | FeatureKey;

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, isError, refetch, isFetching } =
    useGetUsageAnalytics({ days });

  const sortedUsers = useMemo<UsagePerUser[]>(() => {
    if (!data?.perUser) return [];
    const rows = [...data.perUser];
    rows.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "name") {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sortKey === "role") {
        av = a.role;
        bv = b.role;
      } else if (sortKey === "total") {
        av = a.total;
        bv = b.total;
      } else {
        av = a.counts[sortKey] ?? 0;
        bv = b.counts[sortKey] ?? 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "role" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => handleSort(k)}
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      data-testid={`sort-${k}`}
    >
      {label}
      {sortKey === k ? (
        sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : null}
    </button>
  );

  const handleExportCSV = () => {
    if (!data) return;
    const header = [
      "User",
      "Email",
      "Role",
      "Active",
      ...FEATURE_KEYS.map((k) => FEATURE_LABELS[k]),
      "Total",
    ];
    const rows = sortedUsers.map((u) => [
      u.name,
      u.email,
      u.role,
      u.isActive ? "yes" : "no",
      ...FEATURE_KEYS.map((k) => u.counts[k] ?? 0),
      u.total,
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`usage-analytics-${data.range.days}d-${stamp}.csv`, [
      header,
      ...rows,
    ]);
  };

  const featureTotalsData = useMemo(() => {
    if (!data) return [];
    return FEATURE_KEYS.map((k) => ({
      feature: FEATURE_LABELS[k],
      key: k,
      count: data.featureTotals[k] ?? 0,
    })).sort((a, b) => b.count - a.count);
  }, [data]);

  const topContributors = useMemo(() => {
    if (!data) return [];
    return [...data.perUser]
      .filter((u) => u.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((u) => ({
        name: u.name,
        role: u.role,
        total: u.total,
      }));
  }, [data]);

  const dailyChartData = useMemo(() => {
    if (!data) return [];
    const longWindow = data.range.days > 90;
    return data.dailyActivity.map((d) => ({
      day: longWindow ? d.day : d.day.slice(5),
      count: d.count,
    }));
  }, [data]);

  const topUserName = useMemo(() => {
    if (!data || data.perUser.length === 0) return "—";
    const top = [...data.perUser]
      .filter((u) => u.total > 0)
      .sort((a, b) => b.total - a.total)[0];
    return top ? top.name : "—";
  }, [data]);

  const topFeature = useMemo(() => {
    if (!data) return "—";
    let best = "";
    let bestCount = -1;
    for (const k of FEATURE_KEYS) {
      const c = data.featureTotals[k] ?? 0;
      if (c > bestCount) {
        bestCount = c;
        best = FEATURE_LABELS[k];
      }
    }
    return bestCount > 0 ? best : "—";
  }, [data]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto" data-testid="analytics-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Usage Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Who is contributing what across the IT department, and how much.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(parseInt(v, 10))}
          >
            <SelectTrigger className="w-[160px]" data-testid="select-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 6 months</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
            data-testid="button-refresh"
          >
            {isFetching ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!data}
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {isError && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span>Couldn't load analytics. Please try again.</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading analytics…
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Total contributions"
              value={String(data.summary.totalContributions)}
              hint={`In the last ${data.range.days} days`}
              testId="card-total"
            />
            <SummaryCard
              label="Active contributors"
              value={`${data.summary.activeContributors} / ${data.summary.totalUsers}`}
              hint="Users with at least 1 contribution"
              testId="card-active"
            />
            <SummaryCard
              label="Top contributor"
              value={topUserName}
              hint="Most contributions in window"
              testId="card-top-user"
            />
            <SummaryCard
              label="Most-used area"
              value={topFeature}
              hint="Feature with most activity"
              testId="card-top-feature"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Daily activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyChartData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#2563eb"
                        fill="#2563eb"
                        fillOpacity={0.2}
                        name="Contributions"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Most-used features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={featureTotalsData}
                      layout="vertical"
                      margin={{ left: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="feature"
                        tick={{ fontSize: 11 }}
                        width={130}
                      />
                      <Tooltip />
                      <Bar dataKey="count" fill="#2563eb" name="Contributions" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top contributors</CardTitle>
            </CardHeader>
            <CardContent>
              {topContributors.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No contributions in this window yet.
                </p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topContributors}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="total" name="Contributions">
                        {topContributors.map((u, i) => (
                          <Cell key={i} fill={colorForRole(u.role)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity by role</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead className="text-right">Contributions</TableHead>
                    <TableHead className="text-right">Per user (avg)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.roleBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                        No data
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.roleBreakdown.map((r) => (
                      <TableRow key={r.role} data-testid={`role-row-${r.role}`}>
                        <TableCell>
                          <span
                            className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                            style={{ backgroundColor: colorForRole(r.role) }}
                          />
                          {r.role}
                        </TableCell>
                        <TableCell className="text-right">{r.users}</TableCell>
                        <TableCell className="text-right font-medium">{r.total}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {r.users > 0 ? (r.total / r.users).toFixed(1) : "0"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Per-user breakdown</CardTitle>
              <span className="text-xs text-muted-foreground">
                Click any column to sort
              </span>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><SortHeader k="name" label="User" /></TableHead>
                    <TableHead><SortHeader k="role" label="Role" /></TableHead>
                    {FEATURE_KEYS.map((k) => (
                      <TableHead key={k} className="text-right">
                        <SortHeader k={k} label={FEATURE_LABELS[k]} />
                      </TableHead>
                    ))}
                    <TableHead className="text-right">
                      <SortHeader k="total" label="Total" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={FEATURE_KEYS.length + 3} className="text-center text-muted-foreground py-6">
                        No users
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedUsers.map((u) => (
                      <TableRow key={u.userId} data-testid={`user-row-${u.userId}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {u.name}
                            {!u.isActive && (
                              <Badge variant="outline" className="text-xs">
                                inactive
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            style={{
                              backgroundColor: `${colorForRole(u.role)}20`,
                              color: colorForRole(u.role),
                            }}
                          >
                            {u.role}
                          </Badge>
                        </TableCell>
                        {FEATURE_KEYS.map((k) => (
                          <TableCell
                            key={k}
                            className={`text-right ${(u.counts[k] ?? 0) === 0 ? "text-muted-foreground" : ""}`}
                          >
                            {u.counts[k] ?? 0}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-semibold">
                          {u.total}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint: string;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold truncate" title={value}>
          {value}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  );
}

export type { UsageAnalytics };
