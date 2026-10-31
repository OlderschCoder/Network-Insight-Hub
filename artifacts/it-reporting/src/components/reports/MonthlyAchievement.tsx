import { useMemo, useState } from "react";
import { useListLogItems, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { todayCentral } from "@/lib/dates";

function monthBounds(yyyymm: string): { from: string; to: string; label: string } {
  const [y, m] = yyyymm.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0)); // last day of month
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label: format(from, "MMMM yyyy"),
  };
}

export default function MonthlyAchievement() {
  const { user, isCIO } = useAuth();
  const today = todayCentral();
  const defaultMonth = today.slice(0, 7);
  const [month, setMonth] = useState<string>(defaultMonth);
  const [scope, setScope] = useState<string>("all"); // 'all' or userId string

  const { data: users } = useListUsers({ query: { enabled: isCIO } } as any);

  const { from, to, label } = monthBounds(month);
  const userIdParam =
    !isCIO ? String(user?.id ?? "")
      : scope !== "all" ? scope : undefined;

  const { data: items } = useListLogItems(
    { from, to, ...(userIdParam ? { userId: userIdParam } : {}) } as any,
    { query: { enabled: !!from && !!to } } as any,
  );

  const list = (items ?? []) as any[];

  const byUser = useMemo(() => {
    const m: Record<string, { name: string; role: string; count: number }> = {};
    for (const it of list) {
      const k = String(it.userId);
      m[k] ||= { name: it.userName, role: it.userRole, count: 0 };
      m[k].count++;
    }
    return Object.values(m).sort((a, b) => b.count - a.count);
  }, [list]);

  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of list) m[it.category || "task"] = (m[it.category || "task"] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [list]);

  const byWeek = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of list) m[it.weekOf] = (m[it.weekOf] || 0) + 1;
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [list]);

  const userOptions = (users ?? []) as any[];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 grid md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Month</Label>
            <Input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </div>
          {isCIO && (
            <div>
              <Label className="text-xs">Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All team</SelectItem>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{label}</h2>
        <Badge variant="outline">{list.length} items completed</Badge>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">By Contributor</CardTitle></CardHeader>
          <CardContent>
            {byUser.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items in this month.</p>
            ) : (
              <ul className="space-y-1.5">
                {byUser.map((u) => (
                  <li key={u.name} className="flex items-center justify-between text-sm">
                    <span>{u.name} <span className="text-xs text-muted-foreground">· {u.role}</span></span>
                    <Badge variant="secondary">{u.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">By Category</CardTitle></CardHeader>
          <CardContent>
            {byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-1.5">
                {byCategory.map(([cat, n]) => (
                  <li key={cat} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{cat}</span>
                    <Badge variant="secondary">{n}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {byWeek.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Activity by Week</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {byWeek.map(([w, n]) => (
                <li key={w} className="flex items-center justify-between">
                  <span>Week of {format(new Date(w + "T00:00:00"), "MMM d")}</span>
                  <Badge variant="outline">{n} items</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">All Items ({list.length})</CardTitle></CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing logged in {label}.</p>
          ) : (
            <ul className="divide-y">
              {list.map((it) => (
                <li key={it.id} className="py-2 text-sm flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{it.title}</p>
                    {it.notes && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-2">{it.notes}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0 space-y-0.5">
                    <div>{format(new Date(it.itemDate + "T00:00:00"), "MMM d")}</div>
                    <div>{it.userName}</div>
                    <Badge variant="outline" className="text-[10px]">{it.category || "task"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
