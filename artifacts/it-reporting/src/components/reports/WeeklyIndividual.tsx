import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListUsers,
  useListEntries,
  useListLogItems,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { todayCentral, isoMondayCentral } from "@/lib/dates";

export default function WeeklyIndividual() {
  const { user, isCIO } = useAuth();
  const [weekOf, setWeekOf] = useState<string>(isoMondayCentral(todayCentral()));
  const [userId, setUserId] = useState<string>(String(user?.id ?? ""));

  const { data: users } = useListUsers(undefined, {
    query: { enabled: isCIO },
  } as any);

  const targetUserId = isCIO ? parseInt(userId || "0") : (user?.id ?? 0);

  const { data: entries } = useListEntries(
    { weekOf, userId: String(targetUserId) } as any,
    { query: { enabled: !!targetUserId && !!weekOf } } as any,
  );
  const { data: items } = useListLogItems(
    { weekOf, userId: String(targetUserId) } as any,
    { query: { enabled: !!targetUserId && !!weekOf } } as any,
  );

  const entry = (entries ?? [])[0] as any;
  const itemList = (items ?? []) as any[];

  const itemsByCategory = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const it of itemList) (map[it.category || "task"] ||= []).push(it);
    return map;
  }, [itemList]);

  const userOptions = (users ?? []) as any[];
  const targetUser =
    isCIO ? userOptions.find((u) => u.id === targetUserId) : user;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 grid md:grid-cols-2 gap-4">
          {isCIO && (
            <div>
              <Label className="text-xs">Person</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger><SelectValue placeholder="Choose a person" /></SelectTrigger>
                <SelectContent>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name} <span className="text-muted-foreground">· {u.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">Week of (Monday)</Label>
            <Input
              type="date"
              value={weekOf}
              onChange={(e) => e.target.value && setWeekOf(isoMondayCentral(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      {!targetUserId ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Select a person.</CardContent></Card>
      ) : (
        <>
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold">{targetUser?.name ?? "Person"}</h2>
              <p className="text-sm text-muted-foreground">
                Week of {format(new Date(weekOf + "T00:00:00"), "MMMM d, yyyy")}
              </p>
            </div>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{itemList.length} items</Badge>
              <Badge variant="outline">{entry ? "Weekly log saved" : "No weekly log yet"}</Badge>
            </div>
          </div>

          {entry && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Weekly Log</CardTitle>
                <Link href={`/entries/${entry.id}`}>
                  <Button variant="ghost" size="sm">Open</Button>
                </Link>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {entry.title && entry.title !== "Weekly Log" && (
                  <p className="font-medium">{entry.title}</p>
                )}
                {entry.description &&
                  entry.description !== "(See completed items list)" &&
                  entry.description !== "(Quick-added items)" && (
                    <Section label="Summary" body={entry.description} />
                )}
                {entry.accomplishments && <Section label="Accomplishments" body={entry.accomplishments} />}
                {entry.challenges && <Section label="Challenges" body={entry.challenges} />}
                {entry.supportNeeded && <Section label="Support Needed" body={entry.supportNeeded} />}
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>{entry.zendeskTicketIds?.length ?? entry.ticketCount ?? 0} tickets</span>
                  {entry.tags?.length ? <span>· tags: {entry.tags.join(", ")}</span> : null}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Completed Items ({itemList.length})</CardTitle></CardHeader>
            <CardContent>
              {itemList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items logged this week.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(itemsByCategory).map(([cat, list]) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        {cat} ({list.length})
                      </p>
                      <ul className="space-y-1">
                        {list.map((it) => (
                          <li key={it.id} className="text-sm border-l-2 border-primary/30 pl-2">
                            <div className="flex items-center justify-between gap-2">
                              <span>{it.title}</span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(it.itemDate + "T00:00:00"), "EEE MMM d")}
                              </span>
                            </div>
                            {it.notes && (
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{it.notes}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Section({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap">{body}</p>
    </div>
  );
}
