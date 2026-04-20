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
import { format, startOfISOWeek } from "date-fns";

export type CompletedItem = { title: string; notes?: string; category?: string };
type ZTicket = { id: number; subject: string; status: string; url: string };

type FormData = {
  entryDate: string;
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

export type EntryFormProps = {
  mode: "new" | "edit";
  entry?: any;
};

export default function EntryForm({ mode, entry }: EntryFormProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const initialDate =
    entry?.entryDate || new Date().toISOString().slice(0, 10);
  const initialItems: CompletedItem[] =
    entry?.completedItems && entry.completedItems.length > 0
      ? entry.completedItems
      : [{ title: "", notes: "", category: "" }];
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
      entryDate: initialDate,
      category: entry?.category || "helpdesk",
      title: entry?.title || "",
      description: entry?.description === "(See completed items list)" || entry?.description === "(Quick-added items)" ? "" : (entry?.description || ""),
      challenges: entry?.challenges || "",
      supportNeeded: entry?.supportNeeded || "",
    },
  });

  const category = watch("category");
  const entryDate = watch("entryDate");

  useEffect(() => {
    if (!entryDate) return;
    setTicketsLoading(true);
    setTicketsError(null);
    const token = localStorage.getItem("auth_token");
    fetch(`${import.meta.env.BASE_URL}api/zendesk/my-tickets?date=${entryDate}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
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
  }, [entryDate]);

  const updateItem = (i: number, patch: Partial<CompletedItem>) =>
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems([...items, { title: "", notes: "", category: "" }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    const cleanItems = items.filter((it) => it.title.trim());
    const weekOf = format(startOfISOWeek(new Date(data.entryDate)), "yyyy-MM-dd");
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
          title: data.title,
          description: data.description || "(See completed items list)",
          weekOf,
          entryDate: data.entryDate,
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
          {mode === "edit" ? "Edit Daily Log" : "New Daily Log"}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="entryDate">Date</Label>
                <Input
                  id="entryDate"
                  type="date"
                  {...register("entryDate", { required: "Date is required" })}
                />
                {errors.entryDate && (
                  <p className="text-xs text-destructive">{errors.entryDate.message}</p>
                )}
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
              <Label htmlFor="title">Headline</Label>
              <Input
                id="title"
                placeholder="One-line summary of the day"
                {...register("title", { required: "Headline is required" })}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4" />
              Zendesk Tickets You Resolved on {entryDate}
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
                No tickets resolved by you on this date in the Onsite_it group.
              </p>
            )}
            {tickets.length > 0 && (
              <ul className="space-y-2">
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
              These tickets are auto-attached to this log — no need to repeat them below.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Other Items Completed Today</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={addItem}>
              <Plus className="h-3 w-3 mr-1" /> Add item
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Add projects, meetings, configuration changes, etc. that aren't tickets.
              </p>
            )}
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-[1fr_180px] gap-2">
                    <Input
                      placeholder="What did you do?"
                      value={it.title}
                      onChange={(e) => updateItem(i, { title: e.target.value })}
                    />
                    <Select
                      value={it.category || ""}
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="description">Brief Summary (optional)</Label>
              <Textarea
                id="description"
                rows={2}
                placeholder="One or two sentences about the day overall..."
                {...register("description")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="challenges">Challenges / Blockers</Label>
              <Textarea
                id="challenges"
                rows={2}
                placeholder="Any obstacles encountered today..."
                {...register("challenges")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supportNeeded">Support Needed</Label>
              <Textarea
                id="supportNeeded"
                rows={2}
                placeholder="Anything you need from the team or CIO..."
                {...register("supportNeeded")}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? "Saving..." : mode === "edit" ? "Save Changes" : "Save Daily Log"}
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
