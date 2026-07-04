import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export type CaptureKind = "task" | "risk" | "pir";

function deriveTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\d.\s]+/, "").trim())
    .find((l) => l.length > 0);
  return (firstLine ?? text).slice(0, 120);
}

export function CaptureDialog({
  open,
  onOpenChange,
  sourceText,
  authorName,
  sourceHref = "/ai-report",
  sourceLabel = "AI Assistant",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourceText: string;
  authorName?: string | null;
  sourceHref?: string;
  sourceLabel?: string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [kind, setKind] = useState<CaptureKind>("task");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [riskType, setRiskType] = useState("issue");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(deriveTitle(sourceText));
      setDetails(sourceText.trim());
      setKind("task");
      setSeverity("medium");
      setRiskType("issue");
    }
  }, [open, sourceText]);

  const provenance = `\n\n— Captured from ${sourceLabel} on ${new Date().toLocaleDateString()}${
    authorName ? ` by ${authorName}` : ""
  }\nSource: [${sourceLabel}](${sourceHref})`;

  const handleSubmit = async () => {
    if (!title.trim() || !details.trim()) {
      toast({ title: "Title and details are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      let endpoint = "";
      let body: Record<string, unknown> = {};
      if (kind === "task") {
        endpoint = "/log-items";
        body = { title: title.trim(), category: "task", notes: details.trim() + provenance };
      } else if (kind === "risk") {
        endpoint = "/risks";
        body = {
          type: riskType,
          severity,
          title: title.trim(),
          description: details.trim() + provenance,
        };
      } else {
        endpoint = "/after-action";
        body = {
          title: title.trim(),
          incident: details.trim() + provenance,
          severity,
          status: "open",
        };
      }
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      const created = await res.json().catch(() => ({}));
      onOpenChange(false);

      const dest =
        kind === "task"
          ? "/items"
          : kind === "risk"
            ? "/risks"
            : created?.id
              ? `/after-action/${created.id}`
              : "/after-action";
      const label = kind === "task" ? "task" : kind === "risk" ? riskType : "post-incident review";
      toast({
        title: `Created ${label}`,
        description: title.trim(),
        action: (
          <ToastAction altText="View" onClick={() => navigate(dest)}>
            View
          </ToastAction>
        ),
      });
    } catch (e: any) {
      toast({ title: "Capture failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Capture to record</DialogTitle>
          <DialogDescription>
            Promote this AI insight into a tracked item. Attribution and the source are added
            automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Record type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CaptureKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">My Tasks item</SelectItem>
                <SelectItem value="risk">Risk / Issue</SelectItem>
                <SelectItem value="pir">Post-Incident Review</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "risk" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={riskType} onValueChange={setRiskType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="risk">Risk</SelectItem>
                    <SelectItem value="issue">Issue</SelectItem>
                    <SelectItem value="suggestion">Suggestion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {kind === "pir" && (
            <div>
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>{kind === "pir" ? "Incident summary" : "Details"}</Label>
            <Textarea
              rows={6}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
