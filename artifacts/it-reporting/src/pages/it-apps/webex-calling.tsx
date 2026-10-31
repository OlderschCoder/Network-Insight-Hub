import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, PhoneCall } from "lucide-react";
import { Link } from "wouter";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Daily = { day: string; calls: number; answered: number; unanswered: number };
type Employee = { employee: string; answered: number; average_ring_seconds: number };
type Report = {
  configured: boolean; name: string; extension: string; phoneNumber: string; retentionDays: number;
  calls: number; answered: number; unanswered: number; unansweredRingAttempts: number; answerRate: number; averageRingSeconds: number;
  daily: Daily[]; employees: Employee[]; data_from?: string; data_through?: string; backfill_cursor?: string;
  last_success_at?: string; sync_error?: string | null; lastRefreshedAt?: string; error?: string | null;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export default function WebexCallingReport() {
  const [rangeDays, setRangeDays] = useState(7);
  const [startDate, setStartDate] = useState(isoDay(new Date(Date.now() - 7 * 86400000)));
  const [endDate, setEndDate] = useState(isoDay(new Date()));
  const queryStart = `${startDate}T00:00:00`;
  const queryEnd = `${endDate}T23:59:59`;
  const { data, isLoading } = useQuery<Report>({
    queryKey: ["dashboard", "it-calls", queryStart, queryEnd],
    queryFn: async () => {
      const response = await authFetch(`/api/dashboard/it-calls?start=${encodeURIComponent(queryStart)}&end=${encodeURIComponent(queryEnd)}`);
      if (!response.ok) throw new Error("Unable to load calling report");
      return response.json();
    },
    refetchInterval: 300000,
  });
  const selectRange = (days: number) => {
    setRangeDays(days);
    setEndDate(isoDay(new Date()));
    setStartDate(isoDay(new Date(Date.now() - (days - 1) * 86400000)));
  };
  const maxCalls = Math.max(1, ...(data?.daily.map((row) => Number(row.calls)) || [1]));
  const estimatedRings = data?.averageRingSeconds ? (data.averageRingSeconds / 6).toFixed(1) : "0.0";
  const stats = [
    ["Total calls", data?.calls ?? 0], ["Answered calls", data?.answered ?? 0], ["Missed calls", data?.unanswered ?? 0],
    ["Unanswered employee rings", data?.unansweredRingAttempts ?? 0],
    ["Answer rate", `${data?.answerRate || 0}%`], ["Avg. ring time", `${data?.averageRingSeconds || 0}s`],
  ];

  return <div className="space-y-5">
    <div>
      <Link href="/it-apps" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" />IT Apps</Link>
      <h1 className="mt-2 flex items-center gap-2 text-3xl font-bold"><PhoneCall className="h-7 w-7" />IT Calls ({data?.extension || "1200"})</h1>
      <p className="text-muted-foreground">Webex Calling activity for {data?.name || "Information Technology"}. Caller details are intentionally not stored or shown.</p>
    </div>

    <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
      <div className="flex gap-2">{[1, 7, 30, 90].map((days) => <button key={days} onClick={() => selectRange(days)} className={`rounded-md border px-3 py-2 text-sm ${rangeDays === days ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{days === 1 ? "Today" : `${days} days`}</button>)}</div>
      <label className="text-xs text-muted-foreground">From<input type="date" value={startDate} min={isoDay(new Date(Date.now() - 90 * 86400000))} max={endDate} onChange={(event) => { setRangeDays(0); setStartDate(event.target.value); }} className="mt-1 block rounded-md border bg-background px-3 py-2 text-sm text-foreground" /></label>
      <label className="text-xs text-muted-foreground">Through<input type="date" value={endDate} min={startDate} max={isoDay(new Date())} onChange={(event) => { setRangeDays(0); setEndDate(event.target.value); }} className="mt-1 block rounded-md border bg-background px-3 py-2 text-sm text-foreground" /></label>
    </CardContent></Card>

    {isLoading ? <Card><CardContent className="p-6">Loading calling activity…</CardContent></Card> : data?.error ? <Card><CardContent className="p-6 text-amber-700">{data.error}</CardContent></Card> : null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{stats.map(([label, value]) => <Card key={String(label)}><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-3xl font-bold">{value}</CardContent></Card>)}</div>

    <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
      <Card><CardHeader><CardTitle>Daily call volume</CardTitle></CardHeader><CardContent>
        {data?.daily.length ? <div className="space-y-3">{data.daily.map((row) => <div key={row.day} className="grid grid-cols-[6rem_1fr_5rem] items-center gap-3"><span className="text-sm">{new Date(`${row.day}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</span><div className="flex h-7 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" title={`${row.answered} answered`} style={{ width: `${Math.max(row.answered ? 2 : 0, row.answered / maxCalls * 100)}%` }} /><div className="h-full bg-amber-400" title={`${row.unanswered} unanswered`} style={{ width: `${Math.max(row.unanswered ? 2 : 0, row.unanswered / maxCalls * 100)}%` }} /></div><span className="text-right text-sm">{row.calls} calls</span></div>)}</div> : <p className="text-sm text-muted-foreground">No stored calls are available for this date range yet.</p>}
        <div className="mt-4 flex gap-4 text-xs text-muted-foreground"><span><i className="mr-1 inline-block h-2 w-2 bg-primary" />Answered</span><span><i className="mr-1 inline-block h-2 w-2 bg-amber-400" />Unanswered</span></div>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Answered by employee</CardTitle></CardHeader><CardContent>
        {data?.employees.length ? <div className="divide-y">{data.employees.map((row) => <div key={row.employee} className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm"><span className="font-medium">{row.employee}</span><span>{row.answered} answered</span><span className="text-muted-foreground">{Number(row.average_ring_seconds).toFixed(1)}s avg.</span></div>)}</div> : <p className="text-sm text-muted-foreground">No answered calls are available for this date range.</p>}
      </CardContent></Card>
    </div>

    <Card><CardContent className="p-4 text-sm text-muted-foreground">
      <p><strong className="text-foreground">Estimated rings before answer:</strong> {estimatedRings}. Webex supplies ring duration, not a literal ring count; this estimate uses a six-second ring cycle.</p>
      <p className="mt-2"><strong className="text-foreground">Missed calls vs. unanswered rings:</strong> a missed call is one distinct call to 1200 that nobody answered. Unanswered employee rings count the individual IT-member ring attempts within those calls and within calls another employee eventually answered.</p>
      <p className="mt-2">The report retains a rolling 90 days. Stored coverage: {data?.data_from ? new Date(data.data_from).toLocaleString() : "starting now"} through {data?.data_through ? new Date(data.data_through).toLocaleString() : "awaiting first sync"}. Historical backfill runs automatically in small batches to respect Webex rate limits.</p>
      <p className="mt-2">Last successful sync: {data?.last_success_at ? new Date(data.last_success_at).toLocaleString() : "in progress"}{data?.sync_error ? ` · Latest retry: ${data.sync_error}` : ""}</p>
    </CardContent></Card>
  </div>;
}
