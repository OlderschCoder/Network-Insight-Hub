import { useParams, Link } from "wouter";
import { useGetEntry, useListLogItems } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ArrowLeft, Pencil, ArrowUpRight } from "lucide-react";
import { ITEM_TYPES } from "@/components/EntryForm";

const itemLabel = (val?: string) =>
  ITEM_TYPES.find((t) => t.value === val)?.label || val || "Other";

const categoryColor: Record<string, string> = {
  helpdesk: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  network: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  security: "bg-red-500/20 text-red-300 border-red-500/30",
  general: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

function Section({ title, content }: { title: string; content?: string | null }) {
  if (!content) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-muted-foreground mb-1">{title}</p>
      <p className="whitespace-pre-wrap text-sm">{content}</p>
    </div>
  );
}

export default function EntryDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");
  const { user } = useAuth();

  const { data: entry, isLoading } = useGetEntry(id);
  const e = entry as any;
  // Hooks must run on every render — gate the fetch via React Query's `enabled`.
  const { data: weekItems } = useListLogItems(
    { weekOf: e?.weekOf ?? "" },
    { query: { enabled: !!e?.weekOf } } as any,
  );

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-8">Loading...</div>;
  }

  if (!entry) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Entry not found.</p>
        <Link href="/entries">
          <Button variant="ghost" className="mt-4">Back to Entries</Button>
        </Link>
      </div>
    );
  }

  // `e` already aliased above (before the early returns) so hooks fire reliably.
  const canEdit = user?.role === "cio" || e.userId === user?.id;
  const ticketIds: number[] = e.zendeskTicketIds ?? [];
  // Prefer items stably linked to this weekly log; fall back to weekOf+userId.
  const allItems = (weekItems ?? []).filter((it: any) => it.userId === e.userId);
  const linked = allItems.filter((it: any) => it.weeklyEntryId === e.id);
  const completedItems = linked.length > 0 ? linked : allItems;
  const cleanDescription =
    e.description === "(See completed items list)" ||
    e.description === "(Quick-added items)"
      ? null
      : e.description;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/entries">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex-1 truncate">{e.title}</h1>
        {e.category && (
          <Badge variant="outline" className={categoryColor[e.category] ?? ""}>
            {e.category}
          </Badge>
        )}
        {canEdit && (
          <Link href={`/entries/${e.id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
          </Link>
        )}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span>Week of {format(new Date(e.weekOf + "T00:00:00"), "MMM d, yyyy")}</span>
            {e.userName && <span>By: {e.userName}</span>}
            {e.ticketCount != null && e.ticketCount > 0 && (
              <span>{e.ticketCount} ticket{e.ticketCount !== 1 ? "s" : ""} resolved</span>
            )}
          </div>

          <Section title="Summary" content={cleanDescription} />

          {ticketIds.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-muted-foreground mb-2">
                Zendesk Tickets ({ticketIds.length})
              </p>
              <ul className="space-y-1">
                {ticketIds.map((tid) => (
                  <li key={tid}>
                    <a
                      href={`https://sccc.zendesk.com/agent/tickets/${tid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Ticket #{tid} <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {completedItems.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-muted-foreground mb-2">
                Items Completed ({completedItems.length})
              </p>
              {(() => {
                const groups: Record<string, typeof completedItems> = {};
                for (const it of completedItems) {
                  const k = (it as any).itemDate || "Undated";
                  (groups[k] ||= []).push(it);
                }
                const sorted = Object.keys(groups).sort();
                return (
                  <div className="space-y-3">
                    {sorted.map((dateKey) => (
                      <div key={dateKey}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                          {dateKey === "Undated"
                            ? "Undated"
                            : format(new Date(dateKey + "T00:00:00"), "EEEE, MMM d")}
                        </p>
                        <ul className="space-y-2">
                          {groups[dateKey].map((it, i) => (
                            <li
                              key={i}
                              className="p-2 rounded border bg-muted/30 text-sm"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{it.title}</span>
                                {it.category && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                    {itemLabel(it.category)}
                                  </Badge>
                                )}
                              </div>
                              {it.notes && (
                                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                                  {it.notes}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          <Section title="Accomplishments" content={e.accomplishments} />
          <Section title="Challenges" content={e.challenges} />
          <Section title="Support Needed" content={e.supportNeeded} />
        </CardContent>
      </Card>
    </div>
  );
}
