import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ClipboardCopy,
  ExternalLink,
  ListChecks,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Ticket,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ConfirmDialog";
import { SectionEyebrow } from "@/components/portal-ui";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authFetch";
import { cn } from "@/lib/utils";
import {
  assessZendeskTicketForDraft,
  cleanFredDraft,
  parseFredDraftDecision,
} from "@/lib/zendesk_batch_drafting";

type ZendeskTicketSummary = {
  id: number;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  channel?: string;
  url: string;
};

type ZendeskComment = {
  id: number | string;
  author: string;
  authorType?: string;
  public: boolean;
  body: string;
  createdAt: string;
  eventType?: string;
};

type ZendeskTicketDetail = ZendeskTicketSummary & {
  description?: string;
  priority?: string | null;
  requesterName?: string | null;
  assigneeName?: string | null;
  isMessaging?: boolean;
  threadSource?: "conversation_log" | "ticket_comments";
  comments: ZendeskComment[];
};

type ZendeskReplyDraft = {
  id: string;
  ticketId: number;
  ticketSubject: string;
  ticketUrl: string;
  channel: string;
  body: string;
  source: "fred" | "operator";
  status: "pending" | "sent";
  createdAt: string;
  createdBy: string;
  requestedBy: string;
  updatedAt: string;
  sentAt: string | null;
  sentBy: string | null;
};

type ZendeskAgent = {
  id: number;
  name: string;
  email: string;
  role: string;
};

type ZendeskControls = {
  fredEnabled: boolean;
  repliesEnabled: boolean;
  canManage: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ZendeskMonitor() {
  const [, navigate] = useLocation();
  const confirm = useConfirm();
  const { toast } = useToast();
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const stopBatchDraftingRef = useRef(false);
  const initialTicketId = Number.parseInt(
    new URLSearchParams(window.location.search).get("ticket") ?? "",
    10,
  );
  const [tickets, setTickets] = useState<ZendeskTicketSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(
    Number.isFinite(initialTicketId) ? initialTicketId : null,
  );
  const [detail, setDetail] = useState<ZendeskTicketDetail | null>(null);
  const [filter, setFilter] = useState("");
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [batchDrafting, setBatchDrafting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({
    processed: 0,
    total: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
    currentTicketId: null as number | null,
    lastResult: "",
  });
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [reply, setReply] = useState("");
  const [drafts, setDrafts] = useState<ZendeskReplyDraft[]>([]);
  const [currentDraft, setCurrentDraft] =
    useState<ZendeskReplyDraft | null>(null);
  const [agents, setAgents] = useState<ZendeskAgent[]>([]);
  const [escalationEmail, setEscalationEmail] = useState("");
  const [escalationNote, setEscalationNote] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [controls, setControls] = useState<ZendeskControls>({
    fredEnabled: true,
    repliesEnabled: true,
    canManage: false,
    updatedAt: null,
    updatedBy: null,
  });
  const [updatingControl, setUpdatingControl] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const loadTickets = async (quiet = false) => {
    if (!quiet) setLoadingTickets(true);
    try {
      const response = await authFetch(
        `${import.meta.env.BASE_URL}api/zendesk/recent-activity`,
      );
      const body = (await response.json().catch(() => null)) as {
        configured?: boolean;
        items?: ZendeskTicketSummary[];
        error?: string;
      } | null;
      if (!response.ok || !body?.configured) {
        throw new Error(body?.error || "Zendesk activity is unavailable.");
      }
      const open = (body.items ?? []).filter(
        (ticket) => !["solved", "closed"].includes(ticket.status.toLowerCase()),
      );
      setTickets(open);
      setSelectedId((current) => current ?? open[0]?.id ?? null);
      setLastRefreshedAt(new Date());
    } catch (error) {
      if (!quiet) {
        toast({
          title: "Zendesk monitor unavailable",
          description:
            error instanceof Error ? error.message : "Unable to load tickets.",
          variant: "destructive",
        });
      }
    } finally {
      if (!quiet) setLoadingTickets(false);
    }
  };

  const loadDetail = async (ticketId: number, quiet = false) => {
    if (!quiet) setLoadingDetail(true);
    try {
      const response = await authFetch(
        `${import.meta.env.BASE_URL}api/zendesk/ticket/${ticketId}`,
      );
      const body = (await response.json().catch(() => null)) as
        | ZendeskTicketDetail
        | { error?: string; message?: string }
        | null;
      if (!response.ok || !body || !("id" in body)) {
        const errorBody = body as { error?: string; message?: string } | null;
        throw new Error(
          errorBody?.message ||
            errorBody?.error ||
            "Unable to load conversation.",
        );
      }
      setDetail(body);
    } catch (error) {
      if (!quiet) {
        toast({
          title: "Conversation unavailable",
          description:
            error instanceof Error
              ? error.message
              : "Unable to load this ticket.",
          variant: "destructive",
        });
      }
    } finally {
      if (!quiet) setLoadingDetail(false);
    }
  };

  const loadDrafts = async (quiet = false) => {
    try {
      const response = await authFetch(
        `${import.meta.env.BASE_URL}api/zendesk/drafts`,
      );
      const body = (await response.json().catch(() => null)) as {
        drafts?: ZendeskReplyDraft[];
        error?: string;
      } | null;
      if (!response.ok) throw new Error(body?.error || "Unable to load drafts.");
      setDrafts(Array.isArray(body?.drafts) ? body.drafts : []);
    } catch (error) {
      if (!quiet) {
        toast({
          title: "Draft queue unavailable",
          description:
            error instanceof Error ? error.message : "Unable to load drafts.",
          variant: "destructive",
        });
      }
    }
  };

  const loadDraft = async (ticketId: number) => {
    try {
      const response = await authFetch(
        `${import.meta.env.BASE_URL}api/zendesk/ticket/${ticketId}/draft`,
      );
      const body = (await response.json().catch(() => null)) as {
        draft?: ZendeskReplyDraft | null;
      } | null;
      if (!response.ok) throw new Error("Unable to load this ticket's draft.");
      const draft = body?.draft ?? null;
      setCurrentDraft(draft);
      setReply(draft?.body ?? "");
    } catch {
      setCurrentDraft(null);
      setReply("");
    }
  };

  useEffect(() => {
    void loadTickets();
    void loadDrafts();
    void authFetch(`${import.meta.env.BASE_URL}api/zendesk/controls`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load controls.");
        return response.json() as Promise<ZendeskControls>;
      })
      .then(setControls)
      .catch(() => undefined);
    void authFetch(`${import.meta.env.BASE_URL}api/zendesk/agents`)
      .then((response) => (response.ok ? response.json() : []))
      .then((body: ZendeskAgent[]) =>
        setAgents(Array.isArray(body) ? body : []),
      )
      .catch(() => setAgents([]));
    const timer = window.setInterval(() => {
      void loadTickets(true);
      void loadDrafts(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setReply("");
    setCurrentDraft(null);
    setEscalationEmail("");
    setEscalationNote("");
    void Promise.all([loadDetail(selectedId), loadDraft(selectedId)]);
    const timer = window.setInterval(
      () => void loadDetail(selectedId, true),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [selectedId]);

  const visibleTickets = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return tickets;
    return tickets.filter(
      (ticket) =>
        String(ticket.id).includes(query) ||
        ticket.subject.toLowerCase().includes(query) ||
        ticket.status.toLowerCase().includes(query),
    );
  }, [filter, tickets]);

  const draftsByTicket = useMemo(
    () => new Map(drafts.map((draft) => [draft.ticketId, draft])),
    [drafts],
  );

  const selectTicket = (ticketId: number) => {
    setSelectedId(ticketId);
    navigate(`/support/zendesk?ticket=${ticketId}`, { replace: true });
  };

  const updateControl = async (
    key: "fredEnabled" | "repliesEnabled",
    nextValue: boolean,
  ) => {
    if (!controls.canManage || updatingControl) return;
    const name = key === "fredEnabled" ? "Fred drafting" : "Zendesk replies";
    const approved = await confirm({
      title: `Turn ${name} ${nextValue ? "on" : "off"}?`,
      description:
        key === "fredEnabled"
          ? nextValue
            ? "Fred will be allowed to prepare Zendesk drafts and perform confirmed Zendesk actions again."
            : "Fred will stop preparing drafts and all of his Zendesk write actions will be blocked."
          : nextValue
            ? "Supervisors will be able to post confirmed public replies from this monitor again."
            : "All public replies from this monitor and Fred will be blocked at the API. Escalation remains available.",
      confirmText: `Turn ${nextValue ? "on" : "off"}`,
      destructive: !nextValue,
    });
    if (!approved) return;

    setUpdatingControl(key);
    try {
      const response = await authFetch(
        `${import.meta.env.BASE_URL}api/zendesk/controls`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: nextValue }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | ZendeskControls
        | { error?: string }
        | null;
      if (!response.ok || !body || !("fredEnabled" in body)) {
        throw new Error(
          (body as { error?: string } | null)?.error ||
            "Unable to update Zendesk controls.",
        );
      }
      setControls(body);
      toast({
        title: `${name} turned ${nextValue ? "on" : "off"}`,
        description: "The global supervisor control is active now.",
      });
    } catch (error) {
      toast({
        title: "Control was not changed",
        description:
          error instanceof Error
            ? error.message
            : "Unable to save the control.",
        variant: "destructive",
      });
    } finally {
      setUpdatingControl(null);
    }
  };

  const fetchTicketDetail = async (ticketId: number) => {
    const response = await authFetch(
      `${import.meta.env.BASE_URL}api/zendesk/ticket/${ticketId}`,
    );
    const body = (await response.json().catch(() => null)) as
      | ZendeskTicketDetail
      | { error?: string; message?: string }
      | null;
    if (!response.ok || !body || !("id" in body)) {
      const errorBody = body as { error?: string; message?: string } | null;
      throw new Error(
        errorBody?.message || errorBody?.error || "Unable to load conversation.",
      );
    }
    return body;
  };

  const askFredForDraft = async (ticketDetail: ZendeskTicketDetail) => {
    const monitoredTranscript = ticketDetail.comments
        .slice(-30)
        .map(
          (comment) =>
            `[${comment.createdAt}] ${comment.author} (${comment.authorType ?? "participant"}):\n${comment.body}`,
        )
        .join("\n\n")
        .slice(-12_000);
    const response = await authFetch(
      `${import.meta.env.BASE_URL}api/status-report/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content:
                `Draft a concise, friendly response for Zendesk ticket #${ticketDetail.id}, “${ticketDetail.subject}”. ` +
                "Use the monitored Conversation Log below as the current source of truth. Use only supported facts, ask for missing safe details when needed, and never request a password. If a public reply would be unsafe, unnecessary, or the ticket instead needs a staff/security escalation, return exactly NO_DRAFT: followed by a brief reason. Otherwise return only the reply body with no heading or commentary. Do not post or change anything.\n\n" +
                `CURRENT CONVERSATION LOG:\n${monitoredTranscript || "No readable messages yet."}`,
            },
          ],
          lookbackDays: 90,
          previewInventory: false,
          observationOnly: true,
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      reply?: string;
      message?: string;
    } | null;
    if (!response.ok || !body?.reply) {
      throw new Error(body?.message || "Fred could not prepare a reply.");
    }
    return parseFredDraftDecision(body.reply);
  };

  const saveDraftForTicket = async (
    ticketId: number,
    body: string,
    source: "fred" | "operator",
  ) => {
    const exactBody = body.trim();
    if (!exactBody) throw new Error("Write a reply before saving the draft.");
    const response = await authFetch(
      `${import.meta.env.BASE_URL}api/zendesk/ticket/${ticketId}/draft`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: exactBody, source }),
      },
    );
    const result = (await response.json().catch(() => null)) as {
      draft?: ZendeskReplyDraft;
      error?: string;
      message?: string;
    } | null;
    if (!response.ok || !result?.draft) {
      throw new Error(
        result?.message || result?.error || "Unable to save the draft.",
      );
    }
    return result.draft;
  };

  const draftWithFred = async () => {
    if (!detail || drafting || batchDrafting || !controls.fredEnabled) return;
    setDrafting(true);
    try {
      const decision = await askFredForDraft(detail);
      if (!decision.body) {
        throw new Error(decision.reason || "Fred found no safe reply to prepare.");
      }
      const exactDraft = cleanFredDraft(decision.body);
      const saved = await persistDraft(exactDraft, "fred", true);
      setReply(exactDraft);
      setCurrentDraft(saved);
      window.setTimeout(() => replyRef.current?.focus(), 0);
      toast({
        title: "Fred saved a draft for approval",
        description:
          "Other signed-in staff can review or replace it. Nothing was sent.",
      });
    } catch (error) {
      toast({
        title: "Fred draft failed",
        description:
          error instanceof Error ? error.message : "Unable to create a draft.",
        variant: "destructive",
      });
    } finally {
      setDrafting(false);
    }
  };

  const persistDraft = async (
    body: string,
    source: "fred" | "operator",
    quiet = false,
  ) => {
    if (!detail) throw new Error("Select a Zendesk ticket first.");
    setSavingDraft(true);
    try {
      const savedDraft = await saveDraftForTicket(detail.id, body, source);
      setCurrentDraft(savedDraft);
      setReply(savedDraft.body);
      await loadDrafts(true);
      if (!quiet) {
        toast({
          title: `Draft saved for ticket #${detail.id}`,
          description: "It is now visible in the shared approval queue.",
        });
      }
      return savedDraft;
    } finally {
      setSavingDraft(false);
    }
  };

  const prepareOpenDrafts = async () => {
    if (batchDrafting || drafting || !controls.fredEnabled) return;
    const pendingTicketIds = new Set(drafts.map((draft) => draft.ticketId));
    const candidates = tickets
      .filter((ticket) => !pendingTicketIds.has(ticket.id))
      .slice(0, 25);
    if (candidates.length === 0) {
      toast({
        title: "Draft queue is already covered",
        description: "Every loaded open ticket already has a pending draft.",
      });
      return;
    }

    const approved = await confirm({
      title: `Let Fred review ${candidates.length} open ticket${candidates.length === 1 ? "" : "s"}?`,
      description:
        "Fred will inspect them one at a time and save only safe, necessary replies. Pending tickets, staff-last replies, internal-only activity, and escalation-only cases are skipped. Nothing is sent.",
      confirmText: "Prepare drafts",
    });
    if (!approved) return;

    stopBatchDraftingRef.current = false;
    setBatchDrafting(true);
    let processed = 0;
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    setBatchProgress({
      processed,
      total: candidates.length,
      saved,
      skipped,
      failed,
      currentTicketId: candidates[0]?.id ?? null,
      lastResult: "Starting supervised review…",
    });

    try {
      for (const ticket of candidates) {
        if (stopBatchDraftingRef.current) break;
        setBatchProgress((current) => ({
          ...current,
          currentTicketId: ticket.id,
          lastResult: `Reading ticket #${ticket.id}…`,
        }));
        let lastResult = "";
        try {
          const ticketDetail = await fetchTicketDetail(ticket.id);
          const assessment = assessZendeskTicketForDraft(ticketDetail);
          if (!assessment.shouldDraft) {
            skipped += 1;
            lastResult = `Skipped #${ticket.id}: ${assessment.reason}.`;
          } else {
            const decision = await askFredForDraft(ticketDetail);
            if (!decision.body) {
              skipped += 1;
              lastResult = `Skipped #${ticket.id}: ${decision.reason}.`;
            } else {
              await saveDraftForTicket(ticket.id, decision.body, "fred");
              saved += 1;
              lastResult = `Saved draft for #${ticket.id}.`;
            }
          }
        } catch (error) {
          failed += 1;
          lastResult = `Could not draft #${ticket.id}: ${
            error instanceof Error ? error.message : "unknown error"
          }`;
        }
        processed += 1;
        setBatchProgress({
          processed,
          total: candidates.length,
          saved,
          skipped,
          failed,
          currentTicketId: ticket.id,
          lastResult,
        });
      }
      await loadDrafts(true);
      if (selectedId) await loadDraft(selectedId);
      toast({
        title: stopBatchDraftingRef.current
          ? "Fred stopped after the current ticket"
          : "Fred finished the open-ticket review",
        description: `${saved} draft${saved === 1 ? "" : "s"} saved, ${skipped} skipped, ${failed} failed. Nothing was sent.`,
        variant: failed > 0 ? "destructive" : "default",
      });
    } finally {
      setBatchDrafting(false);
      setBatchProgress((current) => ({
        ...current,
        currentTicketId: null,
      }));
    }
  };

  const sendReply = async () => {
    if (!detail || !reply.trim() || sending || !controls.repliesEnabled) return;
    setSending(true);
    try {
      const exactReply = reply.trim();
      let draft = currentDraft;
      if (!draft || draft.body !== exactReply) {
        draft = await persistDraft(exactReply, "operator", true);
      }
      const approved = await confirm({
        title: `Approve and send draft for ticket #${detail.id}?`,
        description: `This sends the saved draft to the requester. Exact reply: “${exactReply.slice(0, 320)}${exactReply.length > 320 ? "…" : ""}”`,
        confirmText: "Approve & send",
      });
      if (!approved) return;
      const response = await authFetch(
        `${import.meta.env.BASE_URL}api/zendesk/ticket/${detail.id}/draft/approve-send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: draft.id,
            confirmed: true,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          body?.message || body?.error || "Zendesk rejected the reply.",
        );
      }
      setReply("");
      setCurrentDraft(null);
      await Promise.all([
        loadDetail(detail.id, true),
        loadTickets(true),
        loadDrafts(true),
      ]);
      toast({
        title: `Reply sent to Zendesk #${detail.id}`,
        description: "The conversation monitor has been refreshed.",
      });
    } catch (error) {
      toast({
        title: "Reply was not sent",
        description:
          error instanceof Error ? error.message : "Unable to post to Zendesk.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const openMessagingDraft = async () => {
    if (!detail || !reply.trim() || sending) return;
    setSending(true);
    try {
      const exactReply = reply.trim();
      if (!currentDraft || currentDraft.body !== exactReply) {
        await persistDraft(exactReply, "operator", true);
      }
      const approved = await confirm({
        title: `Open ticket #${detail.id} for Messaging approval?`,
        description:
          "The exact draft will be copied. Zendesk Agent Workspace is the supported place to review and send this live-message reply; nothing sends automatically.",
        confirmText: "Copy & open Zendesk",
      });
      if (!approved) return;
      await navigator.clipboard.writeText(exactReply);
      const opened = window.open(detail.url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.assign(detail.url);
      toast({
        title: "Draft copied; Zendesk opened",
        description:
          "Paste it into the Messaging composer, review it, and use Zendesk's Send confirmation.",
      });
    } catch (error) {
      toast({
        title: "Draft handoff failed",
        description:
          error instanceof Error ? error.message : "Unable to open the draft.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const escalateTicket = async () => {
    if (!detail || !escalationEmail || escalating) return;
    const agent = agents.find(
      (candidate) => candidate.email === escalationEmail,
    );
    const note = escalationNote.trim();
    const approved = await confirm({
      title: `Escalate ticket #${detail.id} to ${agent?.name ?? escalationEmail}?`,
      description: note
        ? `Zendesk will reassign the ticket and add this internal handoff note: “${note.slice(0, 320)}${note.length > 320 ? "…" : ""}”`
        : "Zendesk will reassign the ticket. No internal handoff note will be added.",
      confirmText: "Escalate ticket",
    });
    if (!approved) return;

    setEscalating(true);
    try {
      const response = await authFetch(
        `${import.meta.env.BASE_URL}api/zendesk/ticket/${detail.id}/escalate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigneeEmail: escalationEmail,
            note: note || null,
            confirmed: true,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        assigneeName?: string;
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          body?.message || body?.error || "Zendesk rejected the escalation.",
        );
      }
      setEscalationEmail("");
      setEscalationNote("");
      await Promise.all([loadDetail(detail.id, true), loadTickets(true)]);
      toast({
        title: `Ticket #${detail.id} escalated`,
        description: `Assigned to ${body?.assigneeName ?? agent?.name ?? escalationEmail}.`,
      });
    } catch (error) {
      toast({
        title: "Ticket was not escalated",
        description:
          error instanceof Error
            ? error.message
            : "Unable to reassign the ticket.",
        variant: "destructive",
      });
    } finally {
      setEscalating(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-[linear-gradient(135deg,var(--portal-sidebar-bg),var(--portal-primary))] px-5 py-6 text-white shadow-lg">
        <SectionEyebrow>
          <span className="text-emerald-300">Troubleshooting</span>
        </SectionEyebrow>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold">
              Zendesk Conversation Monitor
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-white/70">
              Watch incoming ticket conversations, let Fred prepare a response,
              then review, edit, replace, or stop it before anything reaches the
              requester.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-emerald-200">
              Live thread · 5-second refresh
            </span>
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-amber-100">
              {drafts.length} pending draft{drafts.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-white/15 bg-black/15 px-4 py-3">
            <div>
              <p className="text-sm font-bold">Fred drafting</p>
              <p className="text-[11px] text-white/65">
                {controls.fredEnabled
                  ? "Available for supervised drafts"
                  : "Blocked from Zendesk actions"}
              </p>
            </div>
            <Switch
              checked={controls.fredEnabled}
              onCheckedChange={(checked) =>
                void updateControl("fredEnabled", checked)
              }
              disabled={!controls.canManage || updatingControl !== null}
              aria-label="Toggle Fred Zendesk drafting"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-white/15 bg-black/15 px-4 py-3">
            <div>
              <p className="text-sm font-bold">Zendesk replies</p>
              <p className="text-[11px] text-white/65">
                {controls.repliesEnabled
                  ? "Confirmed public replies allowed"
                  : "Public replies blocked"}
              </p>
            </div>
            <Switch
              checked={controls.repliesEnabled}
              onCheckedChange={(checked) =>
                void updateControl("repliesEnabled", checked)
              }
              disabled={!controls.canManage || updatingControl !== null}
              aria-label="Toggle Zendesk public replies"
            />
          </div>
        </div>
        {controls.updatedBy ? (
          <p className="mt-2 text-right text-[10px] text-white/50">
            Last changed by {controls.updatedBy}
            {controls.updatedAt
              ? ` · ${formatTimestamp(controls.updatedAt)}`
              : ""}
          </p>
        ) : null}
      </section>

      <div className="grid min-h-[650px] gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-3 border-b pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <SectionEyebrow>Live queue</SectionEyebrow>
                <CardTitle className="mt-1 flex items-center gap-2 text-base">
                  <Ticket className="h-4 w-4 text-primary" /> Open conversations
                </CardTitle>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh Zendesk conversations"
                onClick={() => void Promise.all([loadTickets(), loadDrafts()])}
                disabled={loadingTickets || batchDrafting}
              >
                <RefreshCw
                  className={cn("h-4 w-4", loadingTickets && "animate-spin")}
                />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center"
              onClick={() => {
                if (batchDrafting) {
                  stopBatchDraftingRef.current = true;
                  setBatchProgress((current) => ({
                    ...current,
                    lastResult: "Stopping after the current ticket…",
                  }));
                  return;
                }
                void prepareOpenDrafts();
              }}
              disabled={
                drafting ||
                !controls.fredEnabled ||
                (!batchDrafting && tickets.length === 0)
              }
            >
              {batchDrafting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ListChecks className="mr-2 h-4 w-4" />
              )}
              {batchDrafting ? "Stop after current" : "Prepare open drafts"}
            </Button>
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter subject or ticket ID"
                className="pl-9"
              />
            </label>
            <p className="text-[10px] text-muted-foreground">
              {lastRefreshedAt
                ? `Last checked ${lastRefreshedAt.toLocaleTimeString()}`
                : "Connecting to Zendesk…"}
            </p>
            {batchProgress.total > 0 ? (
              <div
                className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <div className="space-y-1 font-semibold text-foreground">
                  <span>
                    Fred reviewed {batchProgress.processed} of {batchProgress.total}
                  </span>
                  <span>
                    {batchProgress.saved} saved · {batchProgress.skipped} skipped ·{" "}
                    {batchProgress.failed} failed
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width]"
                    style={{
                      width: `${Math.round(
                        (batchProgress.processed / batchProgress.total) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-2 line-clamp-2">{batchProgress.lastResult}</p>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="max-h-[650px] overflow-y-auto p-0">
            {loadingTickets && tickets.length === 0 ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading
                conversations…
              </div>
            ) : null}
            {!loadingTickets && visibleTickets.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No open conversations match this filter.
              </p>
            ) : null}
            {visibleTickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => selectTicket(ticket.id)}
                className={cn(
                  "w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  selectedId === ticket.id && "bg-primary/10",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug">
                    {ticket.subject || `Ticket #${ticket.id}`}
                  </p>
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[9px] uppercase"
                  >
                    {ticket.status}
                  </Badge>
                </div>
                {draftsByTicket.has(ticket.id) ? (
                  <Badge className="mt-2 bg-amber-500/15 text-[9px] text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
                    Draft awaiting approval
                  </Badge>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">ZD-{ticket.id}</span>
                  <span>
                    {ticket.channel ?? "ticket"} ·{" "}
                    {formatTimestamp(ticket.updatedAt)}
                  </span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="flex min-w-0 flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-4 font-semibold">
                Select a Zendesk conversation
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                The full monitored thread and supervised reply controls will
                appear here.
              </p>
            </div>
          ) : loadingDetail && !detail ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading conversation…
            </div>
          ) : detail ? (
            <>
              <CardHeader className="border-b pb-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <SectionEyebrow>Ticket #{detail.id}</SectionEyebrow>
                    <CardTitle className="mt-1 text-lg leading-snug">
                      {detail.subject}
                    </CardTitle>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{detail.requesterName || "Requester"}</span>
                      <span>·</span>
                      <span>
                        {detail.assigneeName
                          ? `Assigned to ${detail.assigneeName}`
                          : "Unassigned"}
                      </span>
                      <span>·</span>
                      <span>{detail.channel ?? "ticket"}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="uppercase">
                      {detail.status}
                    </Badge>
                    <Button variant="outline" size="sm" asChild>
                      <a href={detail.url} target="_blank" rel="noreferrer">
                        Zendesk <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-4 p-4">
                <div className="max-h-[390px] space-y-3 overflow-y-auto rounded-xl border bg-muted/20 p-4">
                  {detail.comments.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No comments are available for this ticket yet.
                    </p>
                  ) : (
                    detail.comments.map((comment) => (
                      <article
                        key={comment.id}
                        className="rounded-lg border bg-background p-3 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold">
                            <UserRound className="h-3.5 w-3.5 text-primary" />
                            {comment.author}
                            {!comment.public && (
                              <Badge variant="secondary" className="text-[9px]">
                                Internal note
                              </Badge>
                            )}
                          </div>
                          <time className="text-[10px] text-muted-foreground">
                            {formatTimestamp(comment.createdAt)}
                          </time>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                          {comment.body}
                        </p>
                      </article>
                    ))
                  )}
                </div>

                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-bold">
                        <Bot className="h-4 w-4 text-emerald-600" /> Supervised
                        response
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fred saves a shared draft; a person remains the final editor and sender.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void draftWithFred()}
                      disabled={drafting || batchDrafting || !controls.fredEnabled}
                    >
                      {drafting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Bot className="mr-2 h-4 w-4" />
                      )}
                      {drafting
                        ? "Fred is drafting…"
                        : controls.fredEnabled
                          ? "Draft with Fred"
                          : "Fred is off"}
                    </Button>
                  </div>
                  <Textarea
                    ref={replyRef}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    rows={6}
                    placeholder="Use Fred’s draft or write your own reply…"
                    className="mt-3 bg-background"
                    aria-label="Zendesk public reply"
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[11px] text-muted-foreground">
                      <p className="flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        Nothing sends until a person approves the exact reply.
                      </p>
                      {currentDraft ? (
                        <p className="mt-1">
                          Saved by {currentDraft.createdBy}
                          {currentDraft.requestedBy !== currentDraft.createdBy
                            ? ` for ${currentDraft.requestedBy}`
                            : ""}
                          {` · ${formatTimestamp(currentDraft.updatedAt)}`}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReply("");
                          replyRef.current?.focus();
                        }}
                        disabled={!reply || sending || savingDraft}
                      >
                        Override / clear
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void persistDraft(reply, "operator").catch((error) =>
                            toast({
                              title: "Draft was not saved",
                              description:
                                error instanceof Error
                                  ? error.message
                                  : "Unable to save the draft.",
                              variant: "destructive",
                            }),
                          )
                        }
                        disabled={!reply.trim() || sending || savingDraft}
                      >
                        {savingDraft ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        Save for approval
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          void (detail.isMessaging
                            ? openMessagingDraft()
                            : sendReply())
                        }
                        disabled={
                          !reply.trim() || sending || !controls.repliesEnabled
                        }
                      >
                        {sending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : detail.isMessaging ? (
                          <ClipboardCopy className="mr-2 h-4 w-4" />
                        ) : (
                          <Send className="mr-2 h-4 w-4" />
                        )}
                        {sending
                          ? detail.isMessaging
                            ? "Opening…"
                            : "Sending…"
                          : controls.repliesEnabled
                            ? detail.isMessaging
                              ? "Copy & open Zendesk"
                              : "Approve & send"
                            : "Replies are off"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <UserPlus className="h-4 w-4 text-amber-600" /> Escalate
                      to a team member
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reassign the Zendesk ticket and optionally leave a private
                      handoff note.
                    </p>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                    <select
                      value={escalationEmail}
                      onChange={(event) =>
                        setEscalationEmail(event.target.value)
                      }
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      aria-label="Escalation assignee"
                    >
                      <option value="">Choose team member…</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.email}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={escalationNote}
                      onChange={(event) =>
                        setEscalationNote(event.target.value)
                      }
                      placeholder="Private handoff note (optional)"
                      aria-label="Escalation handoff note"
                    />
                    <Button
                      variant="outline"
                      onClick={() => void escalateTicket()}
                      disabled={!escalationEmail || escalating}
                    >
                      {escalating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="mr-2 h-4 w-4" />
                      )}
                      {escalating ? "Escalating…" : "Review escalation"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
