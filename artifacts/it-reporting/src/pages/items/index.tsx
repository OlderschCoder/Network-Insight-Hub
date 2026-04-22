import { useState } from "react";
import { Link } from "wouter";
import {
  useListLogItems,
  useDeleteLogItem,
  useUpdateLogItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { format, startOfISOWeek, addDays } from "date-fns";
import { Pencil, Trash2, Calendar } from "lucide-react";
import { ITEM_TYPES } from "@/components/EntryForm";
import QuickAddItemDialog from "@/components/QuickAddItemDialog";
import { todayCentral } from "@/lib/dates";

const itemLabel = (val?: string | null) =>
  ITEM_TYPES.find((t) => t.value === val)?.label || val || "Other";

const weekStartFor = (dateStr: string) =>
  format(startOfISOWeek(new Date(dateStr + "T00:00:00")), "yyyy-MM-dd");

export default function ItemsPage() {
  const queryClient = useQueryClient();
  const [weekOf, setWeekOf] = useState<string>(weekStartFor(todayCentral()));
  const { data: items, isLoading } = useListLogItems({ weekOf });
  const deleteMutation = useDeleteLogItem();
  const updateMutation = useUpdateLogItem();
  const [editing, setEditing] = useState<any | null>(null);

  const list = items ?? [];

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this item?")) return;
    await deleteMutation.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: ["/api/log-items"] });
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updateMutation.mutateAsync({
      id: editing.id,
      data: {
        title: editing.title,
        category: editing.category,
        notes: editing.notes ?? null,
        itemDate: editing.itemDate,
      },
    });
    queryClient.invalidateQueries({ queryKey: ["/api/log-items"] });
    setEditing(null);
  };

  // Group by date desc
  const byDate: Record<string, any[]> = {};
  for (const it of list) {
    const k = it.itemDate || "Undated";
    (byDate[k] ||= []).push(it);
  }
  const dates = Object.keys(byDate).sort().reverse();

  const weekEnd = format(addDays(new Date(weekOf + "T00:00:00"), 6), "MMM d, yyyy");
  const weekStart = format(new Date(weekOf + "T00:00:00"), "MMM d");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Items</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            <strong>Step 1 of the weekly workflow.</strong> Log every completed
            ticket, project task, install, or piece of research as you finish
            it — title + category + a quick note. Resolved Zendesk tickets pull
            in automatically. On Friday, click <em>Generate Weekly Log</em> to
            roll all of these into your weekly report.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <QuickAddItemDialog />
          <Link href={`/entries/new?weekOf=${weekOf}`}>
            <Button size="sm">Generate Weekly Log</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label htmlFor="week" className="text-xs">Week of (Monday)</Label>
              <Input
                id="week"
                type="date"
                value={weekOf}
                onChange={(e) => {
                  if (e.target.value) setWeekOf(weekStartFor(e.target.value));
                }}
                className="w-44"
              />
            </div>
            <div className="text-sm text-muted-foreground pb-2.5 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {weekStart} – {weekEnd}
            </div>
            <div className="ml-auto pb-2.5">
              <Badge variant="secondary">{list.length} item{list.length !== 1 ? "s" : ""}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="text-center text-muted-foreground py-8">Loading…</div>
      )}

      {!isLoading && list.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No items for this week yet. Click “Quick Add Item” to log one.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {dates.map((dateKey) => (
          <div key={dateKey}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {dateKey === "Undated"
                ? "Undated"
                : format(new Date(dateKey + "T00:00:00"), "EEEE, MMM d")}
            </p>
            <div className="space-y-2">
              {byDate[dateKey].map((it) => (
                <Card key={it.id}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
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
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          onClick={() => setEditing({ ...it })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => handleDelete(it.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={editing.category || "task"}
                    onValueChange={(v) => setEditing({ ...editing, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={editing.itemDate}
                    onChange={(e) => setEditing({ ...editing, itemDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
