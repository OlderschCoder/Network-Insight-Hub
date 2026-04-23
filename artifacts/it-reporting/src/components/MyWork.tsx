import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import {
  useListProjects,
  useListRisks,
  useListLogItems,
} from "@workspace/api-client-react";
import type { Project, Risk } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import QuickAddItemDialog from "@/components/QuickAddItemDialog";
import {
  Briefcase,
  ShieldAlert,
  Calendar,
  Ticket,
  Sparkles,
  ListChecks,
  CheckCircle2,
  Circle,
  ArrowRight,
} from "lucide-react";
import { isoMondayCentral, todayCentral } from "@/lib/dates";
import { format } from "date-fns";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekDates(weekOf: string): string[] {
  const [y, m, d] = weekOf.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start.getTime() + i * 86400000);
    return dt.toISOString().slice(0, 10);
  });
}

function MyZendesk() {
  const [data, setData] = useState<{ count: number; configured: boolean; error?: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch(`${import.meta.env.BASE_URL}api/zendesk/my-open-count`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        setData({
          count: body.count ?? 0,
          configured: body.configured ?? false,
          error: r.ok ? undefined : body.message || body.error,
        });
      })
      .catch((e) => setData({ count: 0, configured: false, error: e.message }));
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">My Open Zendesk Tickets</CardTitle>
        <Ticket className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data?.count ?? "—"}</div>
        <p className="text-xs text-muted-foreground mt-1">
          {!data
            ? "Loading…"
            : !data.configured
            ? "Zendesk not configured"
            : data.error
            ? data.error
            : "Tickets currently assigned to you"}
        </p>
      </CardContent>
    </Card>
  );
}

export default function MyWork() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const weekOf = isoMondayCentral(todayCentral());

  const { data: projects } = useListProjects();
  const { data: risks } = useListRisks({});
  const { data: items } = useListLogItems({ weekOf, userId });

  const myProjects: Project[] = (projects ?? []).filter((p) =>
    (p.assignees ?? []).some((a) => a.userId === userId)
  );
  const activeProjects = myProjects.filter(
    (p) => p.status !== "completed" && p.status !== "cancelled"
  );
  const myOpenRisks: Risk[] = (risks ?? []).filter(
    (r) => r.userId === userId && r.status === "open"
  );

  const weekDates = getWeekDates(weekOf);
  const today = todayCentral();
  const itemDates = new Set((items ?? []).map((i) => i.itemDate));

  const greeting = user?.name ? `Hey ${user.name.split(" ")[0]}` : "Hey there";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{greeting} — here's your work</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Week of {format(new Date(weekOf), "MMM d, yyyy")}
          </p>
        </div>
        <QuickAddItemDialog />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Projects</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeProjects.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Active assignments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Open Risks</CardTitle>
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myOpenRisks.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              That you submitted
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items Logged This Week</CardTitle>
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(items ?? []).length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Roll into Friday's weekly log
            </p>
          </CardContent>
        </Card>

        <MyZendesk />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              This Week — Logging Streak
            </CardTitle>
            <CardDescription>
              Days you've added at least one completed item. Log small wins as
              you finish them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {weekDates.map((d, i) => {
                const logged = itemDates.has(d);
                const isToday = d === today;
                const isFuture = d > today;
                return (
                  <div
                    key={d}
                    className={`flex-1 flex flex-col items-center rounded-md border p-2 text-center ${
                      isToday ? "border-primary" : "border-border"
                    } ${isFuture ? "opacity-40" : ""}`}
                  >
                    <span className="text-[11px] uppercase text-muted-foreground">
                      {DAY_LABELS[i]}
                    </span>
                    <span className="text-sm font-medium">{d.slice(8)}</span>
                    {logged ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-1" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/40 mt-1" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex gap-2">
              <Link href="/items">
                <Button size="sm" variant="outline">
                  Open My Tasks
                </Button>
              </Link>
              <Link href="/entries/new">
                <Button size="sm" variant="outline">
                  Generate Weekly Log
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Assistant
            </CardTitle>
            <CardDescription>
              Ask the AI about entries, risks, post-incident reviews, or your
              network inventory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>"What did I log last week?"</li>
              <li>"Which switch serves the Cosmetology building?"</li>
              <li>"Open risks tagged to my account"</li>
            </ul>
            <Link href="/ai-report">
              <Button size="sm">
                Open AI Assistant
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Projects assigned to me
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active projects assigned to you right now.
            </p>
          ) : (
            <div className="space-y-2">
              {activeProjects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <div className="flex items-center justify-between border rounded-md p-3 hover:border-primary/50 cursor-pointer">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.status} · {p.progress ?? 0}%
                        {p.targetDate && ` · target ${p.targetDate}`}
                      </div>
                    </div>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {myOpenRisks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              My Open Risks & Issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {myOpenRisks.slice(0, 6).map((r) => (
                <Link key={r.id} href={`/risks`}>
                  <div className="flex items-center justify-between border rounded-md p-3 hover:border-primary/50 cursor-pointer">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{r.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.type} · {r.severity}
                      </div>
                    </div>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
