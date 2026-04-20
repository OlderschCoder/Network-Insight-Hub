import { useState } from "react";
import { todayCentral } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { ITEM_TYPES } from "./EntryForm";

type Props = {
  trigger?: React.ReactNode;
};

export default function QuickAddItemDialog({ trigger }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("task");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayCentral());
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setCategory("task");
    setNotes("");
    setDate(todayCentral());
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    const token = localStorage.getItem("auth_token");
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}api/entries/quick-item`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            title: title.trim(),
            category,
            notes: notes.trim() || undefined,
            itemDate: date,
          }),
        }
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Failed to save");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
      reset();
      setOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Zap className="h-4 w-4 mr-2" />
            Quick Add Item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Quick Add Completed Item</DialogTitle>
            <DialogDescription>
              Adds a single item to your weekly log. Creates the week's log if
              one doesn't exist yet. You can add as many items as you like
              throughout the day.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="qa-title">What did you do?</Label>
              <Input
                id="qa-title"
                placeholder="e.g. Replaced switch in MCC-204"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="qa-type">Type</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="qa-type">
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
                <Label htmlFor="qa-date">Date</Label>
                <Input
                  id="qa-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qa-notes">Notes (optional)</Label>
              <Textarea
                id="qa-notes"
                rows={3}
                placeholder="Any extra context..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
