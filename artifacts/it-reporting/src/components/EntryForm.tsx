import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Plus, Trash2, Ticket } from "lucide-react";
import { format, startOfISOWeek, addDays } from "date-fns";

export type CompletedItem = {
  title: string;
  notes?: string;
  category?: string;
  itemDate?: string;
};
type ZTicket = { id: number; subject: string; status: string; url: string };

type FormData = {
  weekOf: string;
  category: string;
  title: string;
  description: string;
  challenges: string;
  supportNeeded: string;
};

export const ITEM_TYPES: { value: string; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "configuration", label: "Configuration" },
  { value: "research_issue", label: "Research Issue" },
  { value: "network_switch", label: "Network Switch" },
  { value: "network_config", label: "Network Config" },
  { value: "security_review", label: "Security Review" },
  { value: "documentation", label: "Documentation" },
  { value: "project_work", label: "Project Work" },
  { value: "meeting", label: "Meeting" },
  { value: "training", label: "Training" },
  { value: "vendor_coordination", label: "Vendor Coordination" },
  { value: "other", label: "Other" },
];

import { todayCentral as _today } from "@/lib/dates";
const todayISO = () => _today();
const weekStartFor = (dateStr: string) =>
  format(startOfISOWeek(new Date(dateStr + "T00:00:00")), "yyyy-MM-dd");

export type EntryFormProps = {
  mode: "new" | "edit";
  entry?: any;
};

export default function EntryForm({ mode, entry }: EntryFormProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const initialWeek = entry?.weekOf || weekStartFor(todayISO());
  const initialItems: CompletedItem[] =
    entry?.completedItems && entry.completedItems.length > 0
      ? entry.completedItems
      : [];
  const [items, setItems] = useState<CompletedItem[]>(initialItems);
  const [tickets, setTickets] = useState<ZTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      weekOf: initialWeek,
      category: entry?.category || "general",
      title: entry?.title?.startsWith("Weekly Log") ? "" : (entry?.title || ""),
      description:
        entry?.description === "(See completed items list)" ||
        entry?.description === "(Quick-added items)"
          ? ""
          : entry?.description || "",
      challenges: entry?.challenges || "",
      supportNeeded: entry?.supportNeeded || "",
    },
  });

  const category = watch("category");
  const weekOf = watch("weekOf");

  useEffect(() => {
    if (!weekOf) return;
    setTicketsLoading(true);
    setTicketsError(null);
    const token = localStorage.getItem("auth_token");
    fetch(
      `${import.meta.env.BASE_URL}api/zendesk/my-tickets?weekOf=${weekOf}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    )
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) {
          setTicketsError(body.message || body.error || "Failed to load");
          setTickets([]);
        } else {
          setTickets(body.tickets ?? []);
        }
      })
      .catch((e) => setTicketsError(e.message))
      .finally(() => setTicketsLoading(false));
  }, [weekOf]);

  const updateItem = (i: number, patch: Partial<CompletedItem>) =>
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () =>
    setItems([
      ...items,
      { title: "", notes: "", category: "task", itemDate: todayISO() },
    ]);
  const removeItem = (i: number) =>
    setItems(items.filter((_, idx) => idx !== i));

  // Group items by date for display
  const groupedItems = items.reduce<Record<string, { item: CompletedItem; idx: number }[]>>(
    (acc, item, idx) => {
      const d = item.itemDate || "Undated";
      if (!acc[d]) acc[d] = [];
      acc[d].push({ item, idx });
      return acc;
    },
    {}
  );
  const sortedDates = Object.keys(groupedItems).sort();

  const weekDays = Array.from({ length: 7 }, (_, i) =>
    weekOf ? format(addDays(new Date(weekOf + "T00:00:00"), i), "yyyy-MM-dd") : ""
  );

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    const cleanItems = items.filter((it) => it.title.trim());
    const token = localStorage.getItem("auth_token");
    try {
      const url =
        mode === "edit"
          ? `${import.meta.env.BASE_URL}api/entries/${entry.id}`
          : `${import.meta.env.BASE_URL}api/entries`;
      const method = mode === "edit" ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          category: data.category,
          title: data.title || `Weekly Log – week of ${data.weekOf}`,
          description: data.description || "(See completed items list)",
          weekOf: data.weekOf,
          entryDate: data.weekOf,
          challenges: data.challenges || undefined,
          supportNeeded: data.supportNeeded || undefined,
          completedItems: cleanItems,
          zendeskTicketIds: tickets.map((t) => t.id),
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Failed to save");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
      setLocation(mode === "edit" ? `/entries/${entry.id}` : "/entries");
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const backHref = mode === "edit" ? `/entries/${entry?.id}` : "/entries";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          {mode === "edit" ? "Edit Weekly Log" : "New Weekly Log"}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="weekOf">Week of (Monday)</Label>
                <Input
                  id="weekOf"
                  type="date"
                  {...register("weekOf", { required: "Week is required" })}
                  onChange={(e) => {
                    // Snap to ISO week start
                    if (e.target.value) {
                      setValue("weekOf", weekStartFor(e.target.value));
                    }
                  }}
                />
                {errors.weekOf && (
                  <p className="text-xs text-destructive">{errors.weekOf.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {weekOf && weekDays[0] && weekDays[6] &&
                    `${format(new Date(weekDays[0] + "T00:00:00"), "MMM d")} – ${format(new Date(weekDays[6] + "T00:00:00"), "MMM d, yyyy")}`}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setValue("category", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="helpdesk">Help Desk</SelectItem>
                    <SelectItem value="network">Network</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Weekly Headline</Label>
              <Input
                id="title"
                placeholder="One-line summary of the week"
                {...register("title")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4" />
              Zendesk Tickets You Resolved This Week
              {tickets.length > 0 && (
                <Badge variant="secondary" className="ml-1">{tickets.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ticketsLoading && (
              <p className="text-sm text-muted-foreground">Checking Zendesk...</p>
            )}
            {ticketsError && (
              <p className="text-sm text-amber-500">Couldn't load: {ticketsError}</p>
            )}
            {!ticketsLoading && !ticketsError && tickets.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No tickets resolved by you this week in the Onsite_it group.
              </p>
            )}
            {tickets.length > 0 && (
              <ul className="space-y-2 max-h-64 overflow-auto">
                {tickets.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 p-2 rounded border bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{t.id}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {t.status}
                        </Badge>
                      </div>
                      <p className="text-sm truncate">{t.subject}</p>
                    </div>
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline shrink-0 inline-flex items-center gap-1"
                    >
                      Open <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Auto-attached to this weekly log.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Items Completed This Week</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Items added throughout the week (via Quick Add or below) — grouped by day.
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addItem}>
              <Plus className="h-3 w-3 mr-1" /> Add item
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No items yet. Use "Quick Add Item" from the dashboard during the week,
                or add items below.
              </p>
            )}
            {sortedDates.map((dateKey) => (
              <div key={dateKey} className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {dateKey === "Undated"
                    ? "Undated"
                    : format(new Date(dateKey + "T00:00:00"), "EEEE, MMM d")}
                </p>
                {groupedItems[dateKey].map(({ item: it, idx: i }) => (
                  <div key={i} className="flex gap-2 items-start">
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-[1fr_150px_140px] gap-2">
                        <Input
                          placeholder="What did you do?"
                          value={it.title}
                          onChange={(e) => updateItem(i, { title: e.target.value })}
                        />
                        <Select
                          value={it.category || "task"}
                          onValueChange={(v) => updateItem(i, { category: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Type" />
                          </SelectTrigger>
                          <SelectContent>
                            {ITEM_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="date"
                          value={it.itemDate || ""}
                          onChange={(e) => updateItem(i, { itemDate: e.target.value })}
                        />
                      </div>
                      <Input
                        placeholder="Notes (optional)"
                        value={it.notes ?? ""}
                        onChange={(e) => updateItem(i, { notes: e.target.value })}
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeItem(i)}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="description">Weekly Summary (optional)</Label>
              <Textarea
                id="description"
                rows={3}
                placeholder="Brief overview of the week..."
                {...register("description")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="challenges">Challenges / Blockers</Label>
              <Textarea
                id="challenges"
                rows={3}
                placeholder="Any obstacles encountered this week..."
                {...register("challenges")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supportNeeded">Support Needed</Label>
              <Textarea
                id="supportNeeded"
                rows={3}
                placeholder="Anything you need from the team or CIO..."
                {...register("supportNeeded")}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? "Saving..." : mode === "edit" ? "Save Changes" : "Save Weekly Log"}
          </Button>
          <Link href={backHref}>
            <Button variant="outline" type="button">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
