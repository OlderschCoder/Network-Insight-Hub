import { useState, useRef, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Sparkles, Send, Copy, Download, Trash2, BookmarkPlus, Flag } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MemoryTab } from "./memory-tab";
import { CIOInsightsTab } from "./cio-insights-tab";
import { CaptureDialog } from "./capture-dialog";
import {
  PendingInventoryChanges,
  type PendingNetworkChange,
} from "@/components/network/pending-inventory-changes";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function MarkdownMessage({ content }: { content: string }) {
  const [, navigate] = useLocation();
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => <h1 className="text-base font-bold mt-4 mb-2" {...props} />,
          h2: ({ node, ...props }) => <h2 className="text-sm font-bold mt-4 mb-2" {...props} />,
          h3: ({ node, ...props }) => <h3 className="text-sm font-semibold mt-3 mb-1.5" {...props} />,
          p: ({ node, ...props }) => <p className="my-2" {...props} />,
          ul: ({ node, ...props }) => <ul className="my-2 ml-5 list-disc space-y-1" {...props} />,
          ol: ({ node, ...props }) => <ol className="my-2 ml-5 list-decimal space-y-1" {...props} />,
          li: ({ node, ...props }) => <li className="pl-1 [&>ul]:mt-1 [&>ol]:mt-1" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
          em: ({ node, ...props }) => <em className="italic" {...props} />,
          a: ({ node, href, ...props }) => {
            const isInternal = typeof href === "string" && href.startsWith("/");
            if (isInternal) {
              return (
                <a
                  className="underline underline-offset-2 text-primary cursor-pointer"
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(href);
                  }}
                  {...props}
                />
              );
            }
            return (
              <a
                className="underline underline-offset-2"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              />
            );
          },
          code: ({ node, ...props }) => (
            <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em]" {...props} />
          ),
          pre: ({ node, ...props }) => (
            <pre className="my-2 overflow-x-auto rounded bg-background/60 p-3 font-mono text-xs" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 italic" {...props} />
          ),
          hr: ({ node, ...props }) => <hr className="my-3 border-border" {...props} />,
          table: ({ node, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => <th className="border border-border px-2 py-1 text-left font-semibold" {...props} />,
          td: ({ node, ...props }) => <td className="border border-border px-2 py-1 align-top" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function StatusReportTab() {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const nineMonthsAgo = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 9);
    return d.toISOString().slice(0, 10);
  })();

  const [form, setForm] = useState({
    startDate: nineMonthsAgo,
    endDate: today,
    accountName: "Seward County Community College",
    stakeholders: "Maddie Day, CFO / Brad Bennett, President",
    accountStatus: "Active – In Good Standing",
    oculusPM: "Matt Song",
    oculusITO: "SCCC IT",
    revenue: "$760,440",
    profitability: "35% gross margin / 5% net margin",
    contractValid: "July 1, 2027",
    additionalNotes: "",
  });

  const [report, setReport] = useState<string>("");
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setReport("");
    try {
      const res = await fetch(`${API_BASE}/status-report/generate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data.report ?? "");
      setSummary(data.dataSummary);
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(report);
    toast({ title: "Copied to clipboard" });
  };

  const handleDownload = () => {
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Seward_Status_${form.endDate}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (type: "pdf" | "docx") => {
    if (!report) return;
    try {
      const res = await fetch(`${API_BASE}/export/ai-status/${type}`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({
          title: `${form.accountName} — IT Status Report`,
          content: report,
          weekOf: form.endDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Seward_Status_${form.endDate}.${type}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Report Inputs</CardTitle>
          <CardDescription>
            Operational data is auto-pulled from the platform. Fill in the executive fields below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Period Start</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Period End</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Account Name</Label>
            <Input
              value={form.accountName}
              onChange={(e) => setForm({ ...form, accountName: e.target.value })}
            />
          </div>
          <div>
            <Label>Client / Stakeholders</Label>
            <Input
              value={form.stakeholders}
              onChange={(e) => setForm({ ...form, stakeholders: e.target.value })}
            />
          </div>
          <div>
            <Label>Account Status</Label>
            <Input
              value={form.accountStatus}
              onChange={(e) => setForm({ ...form, accountStatus: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>OculusIT PM</Label>
              <Input
                value={form.oculusPM}
                onChange={(e) => setForm({ ...form, oculusPM: e.target.value })}
              />
            </div>
            <div>
              <Label>OculusIT ITO</Label>
              <Input
                value={form.oculusITO}
                onChange={(e) => setForm({ ...form, oculusITO: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Revenue</Label>
              <Input
                value={form.revenue}
                onChange={(e) => setForm({ ...form, revenue: e.target.value })}
              />
            </div>
            <div>
              <Label>Profitability</Label>
              <Input
                value={form.profitability}
                onChange={(e) => setForm({ ...form, profitability: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Contract Valid Until</Label>
            <Input
              value={form.contractValid}
              onChange={(e) => setForm({ ...form, contractValid: e.target.value })}
            />
          </div>
          <div>
            <Label>Additional Notes (optional context for AI)</Label>
            <Textarea
              rows={3}
              value={form.additionalNotes}
              onChange={(e) => setForm({ ...form, additionalNotes: e.target.value })}
              placeholder="Anything specific you want the report to emphasize..."
            />
          </div>
          <Button onClick={handleGenerate} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating (this may take 30-60s)...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Status Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Generated Report</CardTitle>
            {summary && (
              <CardDescription className="mt-1">
                Pulled {summary.entriesCount} entries · {summary.weeklyReportsCount} weekly reports ·{" "}
                {summary.openRisksCount} open risks · {summary.aarCount} after-action reports ·{" "}
                {summary.totalTickets} tickets
              </CardDescription>
            )}
          </div>
          {report && (
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button variant="ghost" size="icon" onClick={handleCopy} title="Copy">
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} title="Export PDF">
                <Download className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport("docx")} title="Export Word">
                <Download className="h-4 w-4 mr-1" /> Word
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownload} title="Download Markdown">
                <Download className="h-4 w-4 mr-1" /> .md
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {report ? (
            <Textarea
              value={report}
              onChange={(e) => setReport(e.target.value)}
              rows={28}
              className="font-mono text-sm"
            />
          ) : (
            <div className="border-2 border-dashed border-border rounded-md py-16 text-center text-muted-foreground">
              Configure the inputs and click Generate. The AI will read your operational data and
              produce an executive status report.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function pageHintFromPath(path: string): string | null {
  if (!path || path === "/" || path === "/ai-report") return null;
  const map: Record<string, string> = {
    "/network": "the Network inventory page",
    "/risks": "the Risks & Issues page",
    "/after-action": "the Post-Incident Reviews page",
    "/items": "the My Tasks page",
    "/entries": "the Weekly Log page",
    "/projects": "the Projects page",
    "/strategic-objectives": "the Department Goals page",
    "/processes": "the Process Library page",
    "/reports": "the Reports page",
  };
  for (const [prefix, label] of Object.entries(map)) {
    if (path === prefix || path.startsWith(prefix + "/")) return label;
  }
  return null;
}

function ChatTab({ contextHint }: { contextHint?: string | null }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const storageKey = user?.id ? `ai_chat_history_${user.id}` : null;
  // Chat history is tagged with the storage key it belongs to. During a user
  // switch (before the load effect re-runs) `messages` falls back to empty, so
  // the previous user's transcript is never rendered or persisted under the new
  // user's key.
  const [chat, setChat] = useState<{ key: string | null; messages: ChatMessage[] }>({
    key: null,
    messages: [],
  });
  const messages = chat.key === storageKey ? chat.messages : [];
  const setMessages = (
    updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => {
    setChat((prev) => {
      const base = prev.key === storageKey ? prev.messages : [];
      const next = typeof updater === "function" ? updater(base) : updater;
      return { key: storageKey, messages: next };
    });
  };
  const [input, setInput] = useState("");
  const [capture, setCapture] = useState<{ open: boolean; text: string }>({
    open: false,
    text: "",
  });
  const [loading, setLoading] = useState(false);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [pendingChanges, setPendingChanges] = useState<PendingNetworkChange[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const isNetworkAdmin = ["cio", "network", "network_engineer"].includes(user?.role ?? "");

  // Load persisted chat history when the signed-in user (storage key) is known,
  // so the conversation survives navigating away and page reloads. Keying the
  // transcript by user id also prevents bleed between users on a shared browser.
  useEffect(() => {
    if (!storageKey) return;
    let loaded: ChatMessage[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      loaded = [];
    }
    setChat({ key: storageKey, messages: loaded });
  }, [storageKey]);

  // Persist only once the in-memory transcript belongs to the current key, so a
  // user switch can't write the previous user's messages under the new key.
  useEffect(() => {
    if (!storageKey || chat.key !== storageKey) return;
    try {
      if (chat.messages.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(chat.messages));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      /* ignore storage quota errors */
    }
  }, [chat, storageKey]);

  useEffect(() => {
    if (contextHint && !input) {
      setInput(`About ${contextHint}: `);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextHint]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const undoCreatedTasks = async (ids: number[]) => {
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`${API_BASE}/log-items/${id}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        if (!res.ok && res.status !== 404) {
          throw new Error(`HTTP ${res.status}`);
        }
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast({ title: ids.length === 1 ? "Task removed" : "Tasks removed" });
    } else if (failed === ids.length) {
      toast({ title: "Undo failed", description: "Could not remove the task(s).", variant: "destructive" });
    } else {
      toast({
        title: "Partly undone",
        description: `Removed ${ids.length - failed} of ${ids.length}; ${failed} could not be removed.`,
        variant: "destructive",
      });
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/status-report/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ messages: newMessages, lookbackDays, previewInventory: isNetworkAdmin }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.reply ?? "" }]);
      if (Array.isArray(data.savedMemories) && data.savedMemories.length > 0) {
        toast({
          title: "AI saved to memory",
          description: data.savedMemories.map((m: any) => m.title).join("; "),
        });
      }
      if (Array.isArray(data.createdTasks) && data.createdTasks.length > 0) {
        const created = data.createdTasks as { id: number; title: string }[];
        toast({
          title:
            created.length === 1
              ? "Added to My Tasks"
              : `Added ${created.length} items to My Tasks`,
          description: created.map((t) => t.title).join("; "),
          action: (
            <ToastAction altText="Undo" onClick={() => undoCreatedTasks(created.map((t) => t.id))}>
              Undo
            </ToastAction>
          ),
        });
      }
      if (Array.isArray(data.networkUpdates) && data.networkUpdates.length > 0) {
        const ups = data.networkUpdates as { kind: string; label: string; action: string }[];
        toast({
          title:
            ups.length === 1
              ? "Network inventory updated"
              : `Network inventory: ${ups.length} changes`,
          description: ups
            .map((u) => `${u.action === "created" ? "Added" : "Updated"} ${u.kind} ${u.label}`)
            .join("; "),
        });
      }
      if (Array.isArray(data.savedShadowNotes) && data.savedShadowNotes.length > 0) {
        const sn = data.savedShadowNotes as { title?: string; content?: string }[];
        toast({
          title:
            sn.length === 1
              ? "Saved to your shadow memory"
              : `Saved ${sn.length} notes to shadow memory`,
          description: sn
            .map((n) => n.title ?? (n.content ?? "").slice(0, 60))
            .join("; "),
        });
      }
      if (Array.isArray(data.pendingNetworkChanges) && data.pendingNetworkChanges.length > 0) {
        setPendingChanges((prev) => [...prev, ...(data.pendingNetworkChanges as PendingNetworkChange[])]);
      }
    } catch (e: any) {
      toast({ title: "Chat failed", description: e.message, variant: "destructive" });
      setMessages(newMessages);
    } finally {
      setLoading(false);
    }
  };

  const examples = [
    "Summarize the top 3 risks right now.",
    "Draft a 'Recent Wins' section for an executive report.",
    "What's our biggest network challenge in the last 90 days?",
    "Which incidents are still open in the after-action reports?",
  ];

  const handleCopyTranscript = async () => {
    if (messages.length === 0) {
      toast({ title: "Nothing to copy yet" });
      return;
    }
    const text = messages
      .map((m) => `${m.role === "user" ? "You" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Transcript copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleClear = () => {
    if (messages.length === 0) return;
    setMessages([]);
    toast({ title: "Chat cleared" });
  };

  return (
    <Card className="h-[calc(100vh-17rem)] min-h-[24rem] flex flex-col">
      <CardHeader className="border-b shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Ask the IT Data</CardTitle>
            <CardDescription>
              The AI has read access to entries, risks, after-action reports, and network inventory.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyTranscript}
              disabled={messages.length === 0}
              title="Copy transcript"
            >
              <Copy className="h-4 w-4 mr-1" /> Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={messages.length === 0}
              title="Clear chat"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Clear
            </Button>
            <Label className="text-xs text-muted-foreground">Lookback days:</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20 h-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto py-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3 py-6">
            <p className="text-sm text-center text-muted-foreground">
              Start by asking a question, or try one of these:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {examples.map((q) => (
                <Badge
                  key={q}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent py-2 px-3 font-normal"
                  onClick={() => setInput(q)}
                >
                  {q}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 text-sm ${
                m.role === "user"
                  ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {m.role === "user" ? m.content : <MarkdownMessage content={m.content} />}
            </div>
            {m.role === "assistant" && m.content.trim() && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setCapture({ open: true, text: m.content })}
                title="Capture this into a Task, Risk, or Post-Incident Review"
              >
                <BookmarkPlus className="h-3.5 w-3.5 mr-1" /> Capture
              </Button>
            )}
          </div>
        ))}
        {isNetworkAdmin && pendingChanges.length > 0 && (
          <PendingInventoryChanges
            changes={pendingChanges}
            onApplied={(change, message) => {
              setPendingChanges((prev) => prev.filter((c) => c !== change));
              toast({ title: message ?? `Applied ${change.kind} ${change.label}` });
              queryClient.invalidateQueries({ queryKey: ["network"] });
            }}
            onFailed={(change, err) => {
              toast({
                variant: "destructive",
                title: `Failed to apply ${change.kind} ${change.label}`,
                description: err,
              });
            }}
            onDismiss={(change) => {
              setPendingChanges((prev) => prev.filter((c) => c !== change));
            }}
          />
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Thinking...
            </div>
          </div>
        )}
      </CardContent>
      <div className="border-t p-3 shrink-0">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about entries, risks, AARs, network inventory..."
            rows={2}
            className="resize-none"
            disabled={loading}
          />
          <Button onClick={handleSend} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <CaptureDialog
        open={capture.open}
        onOpenChange={(v) => setCapture((c) => ({ ...c, open: v }))}
        sourceText={capture.text}
        authorName={user?.name ?? null}
      />
    </Card>
  );
}

export default function AIReport() {
  const { isCIO } = useAuth();
  const search = useSearch();
  const fromPath = new URLSearchParams(search).get("from") ?? "";
  const contextHint = pageHintFromPath(fromPath);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-7 w-7" />
          AI Assistant
        </h1>
        <p className="text-muted-foreground mt-1">
          Ask questions about IT data, or (for the CIO) generate executive status reports.
        </p>
      </div>

      <Tabs defaultValue="chat">
        <TabsList>
          {isCIO && <TabsTrigger value="status">Status Report</TabsTrigger>}
          <TabsTrigger value="chat">Ask AI</TabsTrigger>
          {isCIO && (
            <TabsTrigger value="insights">
              <Flag className="h-4 w-4 mr-1.5" /> CIO Insights
            </TabsTrigger>
          )}
          <TabsTrigger value="memory">AI Memory</TabsTrigger>
        </TabsList>
        {isCIO && (
          <TabsContent value="status" className="mt-6">
            <StatusReportTab />
          </TabsContent>
        )}
        {isCIO && (
          <TabsContent value="insights" className="mt-6">
            <CIOInsightsTab />
          </TabsContent>
        )}
        <TabsContent value="chat" className="mt-6">
          <ChatTab contextHint={contextHint} />
        </TabsContent>
        <TabsContent value="memory" className="mt-6">
          <MemoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
