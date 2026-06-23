import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { useLocation, Link, useSearch } from "wouter";
import { useCreateAfterActionReport } from "@workspace/api-client-react";
import type { CreateAfterActionBody } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";

type FormData = {
  title: string;
  incidentDate: string;
  outcome: string;
  summary: string;
  timeline: string;
  whatWentWell: string;
  whatWentPoorly: string;
  actionItems: string;
};

export default function NewAfterAction() {
  const confirm = useConfirm();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createMutation = useCreateAfterActionReport();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const prefillTitle = params.get("title") ?? "";
  const prefillSummary = params.get("summary") ?? "";
  const prefillIncidentDate = params.get("incidentDate") ?? new Date().toISOString().slice(0, 10);
  const prefillOutcome = params.get("outcome") ?? "success";
  const sourcePath = params.get("source") ?? "";
  const sourceLabel = params.get("sourceLabel") ?? "";
  const prefillTimeline = params.get("timeline") ?? "";
  const zendeskTicketId = params.get("zendeskTicketId") ?? "";
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      title: prefillTitle,
      incidentDate: prefillIncidentDate,
      outcome: prefillOutcome,
      summary: prefillSummary,
      timeline: prefillTimeline,
      whatWentWell: "",
      whatWentPoorly: "",
      actionItems: "",
    },
  });

  useEffect(() => {
    if (prefillTitle) setValue("title", prefillTitle);
    if (prefillSummary) setValue("summary", prefillSummary);
    if (prefillTimeline) setValue("timeline", prefillTimeline);
  }, [prefillTitle, prefillSummary, prefillTimeline, setValue]);

  useEffect(() => {
    if (!zendeskTicketId) return;
    const initial = (prefillTimeline || "").trim();
    if (initial.length > 0) return;
    const token = localStorage.getItem("auth_token");
    let cancelled = false;
    fetch(
      `${import.meta.env.BASE_URL}api/zendesk/ticket/${encodeURIComponent(
        zendeskTicketId,
      )}/timeline`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || !body.timeline) return;
        // Don't clobber edits the user has already started while we waited.
        const current = (watch("timeline") || "").trim();
        if (current.length > 0) return;
        setValue("timeline", body.timeline);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zendeskTicketId]);

  const handleRefreshTimeline = async () => {
    if (!zendeskTicketId || isRefreshing) return;
    const current = (watch("timeline") || "").trim();
    if (current.length > 0) {
      const ok = await confirm({
        title: "Replace the current timeline?",
        description:
          "This will replace the current Timeline with the latest comments from Zendesk. Any edits you've made will be lost.",
        confirmText: "Replace",
      });
      if (!ok) return;
    }
    setIsRefreshing(true);
    try {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(
        `${import.meta.env.BASE_URL}api/zendesk/ticket/${encodeURIComponent(
          zendeskTicketId,
        )}/timeline`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.timeline) {
        toast({
          title: "Couldn't refresh timeline",
          description:
            (body && (body.error || body.message)) ||
            "Zendesk did not return a timeline for this ticket.",
          variant: "destructive",
        });
        return;
      }
      setValue("timeline", body.timeline, { shouldDirty: true });
      toast({
        title: "Timeline refreshed",
        description: `Pulled the latest comments from Zendesk ticket #${zendeskTicketId}.`,
      });
    } catch (err) {
      toast({
        title: "Couldn't refresh timeline",
        description:
          err instanceof Error ? err.message : "Network request failed.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const outcome = watch("outcome");

  const onSubmit = async (data: FormData) => {
    const lessons = [
      data.whatWentWell && `What went well:\n${data.whatWentWell}`,
      data.whatWentPoorly && `What went poorly:\n${data.whatWentPoorly}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const severity: CreateAfterActionBody["severity"] =
      data.outcome === "failure"
        ? "high"
        : data.outcome === "partial"
        ? "medium"
        : "low";
    const parsedTicketId = zendeskTicketId
      ? Number.parseInt(zendeskTicketId, 10)
      : NaN;
    const body: CreateAfterActionBody = {
      title: data.title,
      incident: data.summary || data.title,
      incidentDate: data.incidentDate || undefined,
      status: "open",
      severity,
      timeline: data.timeline || undefined,
      lessonsLearned: lessons || undefined,
      preventionMeasures: data.actionItems || undefined,
      zendeskTicketId: Number.isFinite(parsedTicketId) && parsedTicketId > 0
        ? parsedTicketId
        : undefined,
    };
    await createMutation.mutateAsync({ data: body });
    queryClient.invalidateQueries({ queryKey: ["/api/after-action"] });
    setLocation("/after-action");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/after-action">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">New Post-Incident Review</h1>
      </div>

      {sourcePath && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            Started from {sourceLabel || sourcePath}
          </span>
          <Link href={sourcePath}>
            <Button variant="ghost" size="sm">
              Back to {sourceLabel || "source"}
            </Button>
          </Link>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Title / Incident Name</Label>
              <Input
                id="title"
                placeholder="e.g. Network Outage - Main Campus"
                {...register("title", { required: "Title is required" })}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="incidentDate">Incident Date</Label>
                <Input
                  id="incidentDate"
                  type="date"
                  {...register("incidentDate", { required: true })}
                />
              </div>
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select value={outcome} onValueChange={(val) => setValue("outcome", val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="failure">Failure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="summary">Executive Summary</Label>
              <Textarea
                id="summary"
                rows={3}
                placeholder="Brief overview of what happened..."
                {...register("summary")}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="timeline">Timeline</Label>
                {zendeskTicketId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshTimeline}
                    disabled={isRefreshing}
                    data-testid="button-refresh-timeline"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 mr-1.5 ${
                        isRefreshing ? "animate-spin" : ""
                      }`}
                    />
                    {isRefreshing ? "Refreshing..." : "Refresh from Zendesk"}
                  </Button>
                )}
              </div>
              <Textarea
                id="timeline"
                rows={4}
                placeholder="Chronological sequence of events..."
                {...register("timeline")}
              />
              {zendeskTicketId && (
                <p className="text-xs text-muted-foreground">
                  Linked to Zendesk ticket #{zendeskTicketId}. Use Refresh to
                  pull in any new comments.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatWentWell">What Went Well</Label>
              <Textarea
                id="whatWentWell"
                rows={3}
                placeholder="Positive outcomes and effective responses..."
                {...register("whatWentWell")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatWentPoorly">What Went Poorly</Label>
              <Textarea
                id="whatWentPoorly"
                rows={3}
                placeholder="Areas that need improvement..."
                {...register("whatWentPoorly")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="actionItems">Action Items</Label>
              <Textarea
                id="actionItems"
                rows={3}
                placeholder="Follow-up tasks and assignments..."
                {...register("actionItems")}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1"
              >
                {createMutation.isPending ? "Saving..." : "Save Report"}
              </Button>
              <Link href="/after-action">
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
