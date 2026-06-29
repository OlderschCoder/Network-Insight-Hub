import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { authFetch } from "@/lib/authFetch";

const BULK_KEY = "__all__";

/**
 * Fetch the rendered timeline for a Zendesk ticket. Shared by every place
 * that pulls comments from Zendesk so the endpoint, auth handling, and error
 * shape stay consistent.
 */
export async function fetchZendeskTimeline(
  ticketId: string | number,
): Promise<string> {
  const res = await authFetch(
    `${import.meta.env.BASE_URL}api/zendesk/ticket/${encodeURIComponent(
      String(ticketId),
    )}/timeline`,
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.timeline) {
    throw new Error(
      (body && (body.error || body.message)) ||
        "Zendesk did not return a timeline for this ticket.",
    );
  }
  return body.timeline as string;
}

export type RefreshTimelineArgs = {
  ticketId: string | number;
  /** Existing timeline text; when non-empty the user is asked to confirm. */
  currentTimeline?: string | null;
  /** Apply the freshly fetched timeline (set form field, PATCH, etc.). */
  apply: (timeline: string) => void | Promise<void>;
  /** Optional key to identify this operation (e.g. a row id in a list). */
  key?: string | number;
};

export type RefreshManyItem = {
  ticketId: string | number;
  apply: (timeline: string) => void | Promise<void>;
  /**
   * Human-readable name used in the progress indicator and failure summary so
   * users can tell which review failed (falls back to the ticket number).
   */
  label?: string;
};

export type RefreshProgress = {
  /** 1-based index of the review currently being refreshed. */
  current: number;
  /** Total number of reviews in this bulk run. */
  total: number;
};

/**
 * Single source of truth for the "Refresh from Zendesk" flow: confirm before
 * overwriting, fetch the timeline, apply it, and toast the result. Used by the
 * reviews list, the review detail page, and the new-review form so the confirm
 * prompt, toasts, and spinner/disabled state stay identical everywhere.
 */
export function useTimelineRefresh() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [activeKey, setActiveKey] = useState<string | number | null>(null);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);

  const isRefreshing = activeKey !== null;
  const isRefreshingAll = activeKey === BULK_KEY;

  const refresh = async ({
    ticketId,
    currentTimeline,
    apply,
    key,
  }: RefreshTimelineArgs): Promise<boolean> => {
    if (!ticketId || isRefreshing) return false;
    const current = (currentTimeline ?? "").trim();
    if (current.length > 0) {
      const ok = await confirm({
        title: "Replace the current timeline?",
        description:
          "This will replace the current Timeline with the latest comments from Zendesk. Any edits you've made will be lost.",
        confirmText: "Replace",
        destructive: true,
      });
      if (!ok) return false;
    }
    setActiveKey(key ?? ticketId);
    try {
      const timeline = await fetchZendeskTimeline(ticketId);
      await apply(timeline);
      toast({
        title: "Timeline refreshed",
        description: `Pulled the latest comments from Zendesk ticket #${ticketId}.`,
      });
      return true;
    } catch (e: any) {
      toast({
        title: "Couldn't refresh timeline",
        description: e?.message ?? "Network request failed.",
        variant: "destructive",
      });
      return false;
    } finally {
      setActiveKey(null);
    }
  };

  const refreshMany = async (items: RefreshManyItem[]): Promise<void> => {
    if (isRefreshing) return;
    if (items.length === 0) {
      toast({
        title: "Nothing to refresh",
        description: "No post-incident reviews have a linked Zendesk ticket.",
      });
      return;
    }
    const ok = await confirm({
      title: "Replace all timelines?",
      description: `This will replace the Timeline on ${items.length} review${
        items.length === 1 ? "" : "s"
      } with the latest comments from Zendesk. Any edits you've made will be lost.`,
      confirmText: "Replace all",
      destructive: true,
    });
    if (!ok) return;
    setActiveKey(BULK_KEY);
    setProgress({ current: 0, total: items.length });
    let refreshed = 0;
    const failedLabels: string[] = [];
    try {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]!;
        setProgress({ current: i + 1, total: items.length });
        try {
          const timeline = await fetchZendeskTimeline(item.ticketId);
          await item.apply(timeline);
          refreshed += 1;
        } catch {
          failedLabels.push(item.label?.trim() || `Zendesk #${item.ticketId}`);
        }
      }
      const failed = failedLabels.length;
      const failPart =
        failed > 0 ? `, ${failed} failed: ${failedLabels.join(", ")}` : "";
      toast({
        title: "Timelines refreshed",
        description: `Refreshed ${refreshed} timeline${
          refreshed === 1 ? "" : "s"
        }${failPart}.`,
        variant: failed > 0 ? "destructive" : undefined,
      });
    } finally {
      setActiveKey(null);
      setProgress(null);
    }
  };

  return {
    isRefreshing,
    isRefreshingAll,
    activeKey,
    progress,
    refresh,
    refreshMany,
  };
}
