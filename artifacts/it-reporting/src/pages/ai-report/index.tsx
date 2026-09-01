import { useState, useRef, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
import {
  Loader2,
  Sparkles,
  Send,
  Copy,
  Download,
  Trash2,
  BookmarkPlus,
  Flag,
  Paperclip,
  X,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  QrCode,
  Eye,
  RefreshCw,
  History,
} from "lucide-react";
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
import { downloadAuthenticatedFile } from "@/lib/downloadFile";
import { trackProductUsage } from "@/lib/usage-tracking";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

interface AttachedFile {
  name: string;
  kind: "text" | "image";
  textContent?: string;   // for text/config files
  dataUrl?: string;       // for images
}

interface PersistedFredChat {
  version: 2 | 3;
  messages: ChatMessage[];
  checkpoint: string;
  title?: string;
  savedAt?: string;
  sessionId?: string | null;
}

interface FredChatSessionSummary {
  id: string;
  title: string;
  isActive: boolean;
  messageCount: number;
  updatedAt: string;
}

const FRED_RECENT_MESSAGE_LIMIT = 10;
const FRED_CHECKPOINT_LIMIT = 8000;

function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join(" ");
}

function compactFredConversation(messages: ChatMessage[], previousCheckpoint = "") {
  const recentMessages = messages.slice(-FRED_RECENT_MESSAGE_LIMIT);
  const newlyArchived = messages.slice(0, Math.max(0, messages.length - FRED_RECENT_MESSAGE_LIMIT));
  if (newlyArchived.length === 0) return { recentMessages, checkpoint: previousCheckpoint };

  const archiveLines = newlyArchived.map((message) => {
    const speaker = message.role === "user" ? "Mark/team" : "Fred";
    const text = messageText(message).replace(/\s+/g, " ").trim().slice(0, 650);
    return `${speaker}: ${text}`;
  });
  const checkpoint = Array.from(new Set([...(previousCheckpoint ? previousCheckpoint.split("\n") : []), ...archiveLines]))
    .filter(Boolean)
    .join("\n")
    .slice(-FRED_CHECKPOINT_LIMIT);
  return { recentMessages, checkpoint };
}

function checkpointAll(messages: ChatMessage[], previousCheckpoint = "") {
  const lines = messages.map((message) => {
    const speaker = message.role === "user" ? "Mark/team" : "Fred";
    return `${speaker}: ${messageText(message).replace(/\s+/g, " ").trim().slice(0, 650)}`;
  });
  return Array.from(new Set([...(previousCheckpoint ? previousCheckpoint.split("\n") : []), ...lines]))
    .filter(Boolean)
    .join("\n")
    .slice(-FRED_CHECKPOINT_LIMIT);
}

function requestsEnterpriseArchitecture(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(?:as[- ]is|current state)\b/.test(normalized)
    && /\benterprise architecture\b/.test(normalized)
    && /\b(?:network|switch|vlan|port|azure|entra|identity)\b/.test(normalized);
}

function boundMessagesForAI(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || typeof message.content !== "string" || message.content.length <= 30_000) return message;
    return {
      ...message,
      content: `${message.content.slice(0, 30_000)}\n\n[The complete architecture deliverable and deterministic inventory appendices remain stored in this Fred topic. Use the retained coverage manifest and ask for a specific section rather than resending the entire document.]`,
    };
  });
}

interface LiveObservationState {
  imageUrl: string;
  reply: string;
  updatedAt: string;
}

interface FredLibraryFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  reviewKind: "text" | "image" | "binary";
  uploadedBy: number | null;
  uploadedByName: string | null;
  createdAt: string;
}

interface FredLibraryPreview {
  record: FredLibraryFile;
  previewText: string | null;
  truncated: boolean;
}

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

function fredMobileUrl() {
  if (typeof window === "undefined") return "";
  return new URL("fred/mobile", new URL(import.meta.env.BASE_URL, window.location.origin)).toString();
}

function formatBytes(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
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
      await downloadAuthenticatedFile(`${API_BASE}/export/ai-status/${type}`, `Seward_Status_${form.endDate}.${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: `${form.accountName} — IT Status Report`,
          content: report,
          weekOf: form.endDate,
        }),
      });
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

function ChatTab({
  contextHint,
  mobileFieldMode = false,
}: {
  contextHint?: string | null;
  mobileFieldMode?: boolean;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const storageKey = user?.id ? `ai_chat_history_${user.id}` : null;
  // Chat history is tagged with the storage key it belongs to. During a user
  // switch (before the load effect re-runs) `messages` falls back to empty, so
  // the previous user's transcript is never rendered or persisted under the new
  // user's key.
  const [chat, setChat] = useState<{ key: string | null; messages: ChatMessage[]; checkpoint: string; title: string; savedAt: string; sessionId: string | null }>({
    key: null,
    messages: [],
    checkpoint: "",
    title: "New Fred topic",
    savedAt: "",
    sessionId: null,
  });
  const chatRef = useRef(chat);
  useEffect(() => { chatRef.current = chat; }, [chat]);
  const messages = chat.key === storageKey ? chat.messages : [];
  const setMessages = (
    updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => {
    setChat((prev) => {
      const base = prev.key === storageKey ? prev.messages : [];
      const next = typeof updater === "function" ? updater(base) : updater;
      return { key: storageKey, messages: next, checkpoint: prev.key === storageKey ? prev.checkpoint : "", title: prev.key === storageKey ? prev.title : "New Fred topic", savedAt: new Date().toISOString(), sessionId: prev.key === storageKey ? prev.sessionId : null };
    });
  };
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [capture, setCapture] = useState<{ open: boolean; text: string }>({
    open: false,
    text: "",
  });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [audioListening, setAudioListening] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [nearLiveEnabled, setNearLiveEnabled] = useState(false);
  const [nearLiveBusy, setNearLiveBusy] = useState(false);
  const [nearLiveError, setNearLiveError] = useState<string | null>(null);
  const [liveObservation, setLiveObservation] = useState<LiveObservationState | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<DeferredInstallPromptEvent | null>(null);
  const [isInstalledStandalone, setIsInstalledStandalone] = useState(false);
  const [fredFilesOpen, setFredFilesOpen] = useState(false);
  const [fredFiles, setFredFiles] = useState<FredLibraryFile[]>([]);
  const [selectedFredFileIds, setSelectedFredFileIds] = useState<string[]>([]);
  const [fredFilesLoading, setFredFilesLoading] = useState(false);
  const [fredFilesUploading, setFredFilesUploading] = useState(false);
  const [fredFilesError, setFredFilesError] = useState<string | null>(null);
  const [fredPreview, setFredPreview] = useState<FredLibraryPreview | null>(null);
  const [fredPreviewLoading, setFredPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState<FredChatSessionSummary[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [pendingChanges, setPendingChanges] = useState<PendingNetworkChange[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const nearLiveIntervalRef = useRef<number | null>(null);
  const nearLiveInFlightRef = useRef(false);
  const mobileCameraInputRef = useRef<HTMLInputElement>(null);
  const fredUploadInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const isNetworkAdmin = ["cio", "network", "network_engineer"].includes(user?.role ?? "");
  const selectedFredFiles = fredFiles.filter((file) => selectedFredFileIds.includes(file.id));
  const speechCtor =
    typeof window === "undefined"
      ? null
      : ((window as typeof window & {
          SpeechRecognition?: BrowserSpeechRecognitionCtor;
          webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
        }).SpeechRecognition ??
        (window as typeof window & {
          SpeechRecognition?: BrowserSpeechRecognitionCtor;
          webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
        }).webkitSpeechRecognition ??
        null);

  // Load persisted chat history when the signed-in user (storage key) is known,
  // so the conversation survives navigating away and page reloads. Keying the
  // transcript by user id also prevents bleed between users on a shared browser.
  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    let loaded: ChatMessage[] = [];
    let checkpoint = "";
    let title = "New Fred topic";
    let savedAt = "";
    let sessionId: string | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[] | PersistedFredChat;
        if (Array.isArray(parsed)) loaded = parsed;
        else if (parsed?.version === 2 || parsed?.version === 3) {
          loaded = Array.isArray(parsed.messages) ? parsed.messages : [];
          checkpoint = typeof parsed.checkpoint === "string" ? parsed.checkpoint : "";
          if (parsed.version === 3) {
            title = typeof parsed.title === "string" ? parsed.title : title;
            savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";
            sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : null;
          }
        }
      }
    } catch {
      loaded = [];
    }
    setChat({ key: storageKey, messages: loaded, checkpoint, title, savedAt, sessionId });
    void fetch(`${API_BASE}/status-report/chat-session`, { headers: authHeaders() })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data) => {
        if (cancelled || !data?.session) return;
        const serverMessages = Array.isArray(data.session.messages) ? data.session.messages : [];
        const serverUpdatedAt = String(data.session.updatedAt ?? "");
        setChat((current) => {
          if (current.key !== storageKey) return current;
          if (current.savedAt && serverUpdatedAt && new Date(current.savedAt) > new Date(serverUpdatedAt)) return current;
          return {
            key: storageKey,
            messages: serverMessages,
            checkpoint: typeof data.session.checkpoint === "string" ? data.session.checkpoint : "",
            title: typeof data.session.title === "string" ? data.session.title : "New Fred topic",
            savedAt: serverUpdatedAt,
            sessionId: String(data.session.id),
          };
        });
      })
      .catch(() => { /* local cache remains the offline fallback */ });
    return () => { cancelled = true; };
  }, [storageKey]);

  // Persist only once the in-memory transcript belongs to the current key, so a
  // user switch can't write the previous user's messages under the new key.
  useEffect(() => {
    if (!storageKey || chat.key !== storageKey) return;
    try {
      if (chat.messages.length > 0 || chat.checkpoint) {
        localStorage.setItem(storageKey, JSON.stringify({ version: 3, messages: chat.messages, checkpoint: chat.checkpoint, title: chat.title, savedAt: chat.savedAt || new Date().toISOString(), sessionId: chat.sessionId } satisfies PersistedFredChat));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      /* ignore storage quota errors */
    }
    const persistServer = (keepalive = false) => {
      const serverMessages = chat.messages.map((message) => ({ role: message.role, content: messageText(message) }));
      void fetch(`${API_BASE}/status-report/chat-session`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ messages: serverMessages, checkpoint: chat.checkpoint, title: chat.title, sessionId: chat.sessionId }),
        keepalive,
      });
    };
    const timer = window.setTimeout(() => persistServer(), 250);
    return () => window.clearTimeout(timer);
  }, [chat, storageKey]);

  // Page navigation can unmount Fred before the debounce fires. Persist the
  // latest ref on pagehide/unmount without tying cleanup to every state change.
  useEffect(() => {
    if (!storageKey) return;
    const persistLatest = () => {
      const current = chatRef.current;
      if (current.key !== storageKey) return;
      const serverMessages = current.messages.map((message) => ({ role: message.role, content: messageText(message) }));
      void fetch(`${API_BASE}/status-report/chat-session`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ messages: serverMessages, checkpoint: current.checkpoint, title: current.title, sessionId: current.sessionId }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", persistLatest);
    return () => {
      window.removeEventListener("pagehide", persistLatest);
      persistLatest();
    };
  }, [storageKey]);

  useEffect(() => {
    if (contextHint && !input && !mobileFieldMode) {
      setInput(`About ${contextHint}: `);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextHint, mobileFieldMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const loadFredFiles = async () => {
    setFredFilesLoading(true);
    setFredFilesError(null);
    try {
      const res = await fetch(`${API_BASE}/fred-files`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setFredFiles(Array.isArray(data) ? (data as FredLibraryFile[]) : []);
    } catch (error) {
      setFredFilesError(error instanceof Error ? error.message : "Could not load Fred files.");
    } finally {
      setFredFilesLoading(false);
    }
  };

  useEffect(() => {
    if (!videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
  }, [cameraOpen]);

  useEffect(() => {
    if (!mobileFieldMode || typeof window === "undefined") return;
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const syncStandalone = () => {
      setIsInstalledStandalone(
        standaloneQuery.matches ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    };
    const handleInstallable = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as DeferredInstallPromptEvent);
    };
    const handleInstalled = () => {
      syncStandalone();
      setInstallPromptEvent(null);
      toast({ title: "Fred installed", description: "You can open Fred from your phone home screen now." });
    };

    syncStandalone();
    window.addEventListener("beforeinstallprompt", handleInstallable);
    window.addEventListener("appinstalled", handleInstalled);
    standaloneQuery.addEventListener?.("change", syncStandalone);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallable);
      window.removeEventListener("appinstalled", handleInstalled);
      standaloneQuery.removeEventListener?.("change", syncStandalone);
    };
  }, [mobileFieldMode, toast]);

  useEffect(() => {
    void loadFredFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!audioListening) {
      setVoicePanelOpen(false);
      return;
    }
    setVoicePanelOpen(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [audioListening]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (nearLiveIntervalRef.current !== null && typeof window !== "undefined") {
        window.clearInterval(nearLiveIntervalRef.current);
        nearLiveIntervalRef.current = null;
      }
      nearLiveInFlightRef.current = false;
      speechRef.current?.stop();
      speechRef.current = null;
    };
  }, []);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachedFile({ name: file.name, kind: "image", dataUrl: ev.target?.result as string });
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachedFile({ name: file.name, kind: "text", textContent: ev.target?.result as string });
      };
      reader.readAsText(file);
    }
  };

  const toggleFredFileSelection = (fileId: string) => {
    setSelectedFredFileIds((prev) => (prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]));
  };

  const handleFredUploadSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!fredUploadInputRef.current) return;
    fredUploadInputRef.current.value = "";
    if (files.length === 0) return;

    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }

    setFredFilesUploading(true);
    setFredFilesError(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${API_BASE}/fred-files`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const uploaded = Array.isArray(data.uploaded) ? (data.uploaded as FredLibraryFile[]) : [];
      if (uploaded.length > 0) {
        setFredFiles((prev) => [...uploaded, ...prev.filter((existing) => !uploaded.some((row) => row.id === existing.id))]);
        setSelectedFredFileIds((prev) => [...new Set([...prev, ...uploaded.map((file) => file.id)])]);
        toast({
          title: uploaded.length === 1 ? "File uploaded for Fred" : `${uploaded.length} files uploaded for Fred`,
          description: uploaded.map((file) => file.originalName).slice(0, 3).join(", "),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setFredFilesError(message);
      toast({ title: "Fred upload failed", description: message, variant: "destructive" });
    } finally {
      setFredFilesUploading(false);
    }
  };

  const loadFredPreview = async (fileId: string) => {
    setFredPreviewLoading(true);
    setFredFilesError(null);
    try {
      const res = await fetch(`${API_BASE}/fred-files/${fileId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as FredLibraryPreview;
      setFredPreview(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview failed.";
      setFredFilesError(message);
      toast({ title: "Preview failed", description: message, variant: "destructive" });
    } finally {
      setFredPreviewLoading(false);
    }
  };

  const deleteFredLibraryFile = async (fileId: string) => {
    try {
      const res = await fetch(`${API_BASE}/fred-files/${fileId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
      }
      setFredFiles((prev) => prev.filter((file) => file.id !== fileId));
      setSelectedFredFileIds((prev) => prev.filter((id) => id !== fileId));
      setFredPreview((prev) => (prev?.record.id === fileId ? null : prev));
      toast({ title: "Fred file deleted" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    }
  };

  const buildUserContent = (
    draftInput: string,
    file: AttachedFile | null,
    selectedFiles: FredLibraryFile[],
  ): ChatMessage["content"] => {
    const uploadedNote =
      selectedFiles.length > 0
        ? `\n\n[Using Fred File Library: ${selectedFiles.map((entry) => entry.originalName).join(", ")}]`
        : "";
    if (file?.kind === "image" && file.dataUrl) {
      // Vision message: image + text
      return [
        { type: "image_url", image_url: { url: file.dataUrl } },
        { type: "text", text: `${draftInput.trim() || `Analyze this image: ${file.name}`}${uploadedNote}`.trim() },
      ];
    }
    if (file?.kind === "text" && file.textContent) {
      // Prepend file content as text block
      return `[Attached file: ${file.name}]\n\`\`\`\n${file.textContent}\n\`\`\`\n\n${draftInput.trim()}${uploadedNote}`;
    }
    if (selectedFiles.length > 0 && !draftInput.trim()) {
      return `Please review the selected Fred File Library files.${uploadedNote}`;
    }
    return `${draftInput.trim()}${uploadedNote}`.trim();
  };

  const handleMobileCameraPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!mobileCameraInputRef.current) return;
    mobileCameraInputRef.current.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAttachedFile({ name: file.name || "fred-camera.jpg", kind: "image", dataUrl: ev.target?.result as string });
      toast({ title: "Camera image attached", description: "Add a note if needed, then send it to Fred." });
    };
    reader.readAsDataURL(file);
  };

  const sendUserMessage = async (draftInput: string, file: AttachedFile | null) => {
    if ((!draftInput.trim() && !file && selectedFredFiles.length === 0) || loading) return;
    const userContent = buildUserContent(draftInput, file, selectedFredFiles);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    if (chat.title === "New Fred topic" && draftInput.trim()) {
      setChat((current) => ({ ...current, title: draftInput.replace(/\s+/g, " ").trim().slice(0, 80), savedAt: new Date().toISOString() }));
    }
    setAttachedFile(null);
    const newMessages = [...messages, userMsg];
    const compacted = compactFredConversation(newMessages, chat.checkpoint);
    if (compacted.checkpoint !== chat.checkpoint) {
      setChat((current) => ({ ...current, checkpoint: compacted.checkpoint }));
    }
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    trackProductUsage("fred_message", "/ai-report");
    try {
      if (requestsEnterpriseArchitecture(draftInput)) {
        const response = await fetch(`${API_BASE}/status-report/enterprise-architecture`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message ?? `HTTP ${response.status}`);
        }
        const data = await response.json();
        const coverage = data.evidenceSummary
          ? `\n\n## Evidence coverage manifest\n\n\`\`\`json\n${JSON.stringify(data.evidenceSummary, null, 2)}\n\`\`\``
          : "";
        const verification = data.verification
          ? `\n\n# Independent acceptance review\n\n${data.verification}`
          : "";
        setMessages([...newMessages, { role: "assistant", content: `${data.report ?? ""}${coverage}${verification}` }]);
        toast({ title: "As-is architecture generated", description: "The complete report, authoritative appendices, coverage manifest, and independent review are retained in this topic." });
        return;
      }
      const res = await fetch(`${API_BASE}/status-report/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          messages: boundMessagesForAI(compacted.recentMessages),
          conversationCheckpoint: compacted.checkpoint,
          lookbackDays,
          previewInventory: isNetworkAdmin,
          uploadedFileIds: selectedFredFileIds,
        }),
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
        const created = data.createdTasks as { id: number; title: string; assigneeName?: string }[];
        const assigned = created.filter((t) => t.assigneeName);
        const title =
          created.length === 1
            ? created[0].assigneeName
              ? `Assigned to ${created[0].assigneeName}`
              : "Added to My Tasks"
            : assigned.length > 0
              ? `Added ${created.length} tasks (${assigned.length} delegated)`
              : `Added ${created.length} items to My Tasks`;
        toast({
          title,
          description: created
            .map((t) => (t.assigneeName ? `${t.title} → ${t.assigneeName}` : t.title))
            .join("; "),
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
            .map((u) => `${u.action === "created" ? "Added" : u.action === "deleted" ? "Deleted" : "Updated"} ${u.kind} ${u.label}`)
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

  const handleSend = async () => {
    await sendUserMessage(input, attachedFile);
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This device/browser does not support live camera access.");
      return;
    }
    try {
      setCameraError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      if (mobileFieldMode) {
        setNearLiveEnabled(true);
        setNearLiveError(null);
        toast({
          title: "Fred live assist is on",
          description: "Fred will analyze a fresh camera frame every 2 seconds while the camera stays open.",
        });
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Camera access was denied.");
      setCameraOpen(false);
    }
  };

  const stopNearLive = () => {
    if (nearLiveIntervalRef.current !== null && typeof window !== "undefined") {
      window.clearInterval(nearLiveIntervalRef.current);
      nearLiveIntervalRef.current = null;
    }
    nearLiveInFlightRef.current = false;
    setNearLiveEnabled(false);
    setNearLiveBusy(false);
  };

  const stopCamera = () => {
    stopNearLive();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  };

  const captureCurrentFrame = (showToast = true): AttachedFile | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      if (showToast) {
        toast({ title: "Camera not ready", description: "Wait for the live preview, then try again.", variant: "destructive" });
      }
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (showToast) {
        toast({ title: "Capture failed", description: "Could not access the capture canvas.", variant: "destructive" });
      }
      return null;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      name: `fred-live-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
      kind: "image",
      dataUrl: canvas.toDataURL("image/jpeg", 0.86),
    };
  };

  const handleCaptureFrame = () => {
    const frame = captureCurrentFrame();
    if (!frame) return;
    setAttachedFile(frame);
    toast({ title: "Current frame attached", description: "Ask Fred what to look at, then send." });
  };

  const handleSendCurrentView = async () => {
    const frame = captureCurrentFrame();
    if (!frame) return;
    const fallbackPrompt = input.trim() || "Please analyze this live camera view and tell me what you see.";
    await sendUserMessage(fallbackPrompt, frame);
  };

  const analyzeNearLiveFrame = async () => {
    if (!cameraOpen || nearLiveInFlightRef.current) return;
    const frame = captureCurrentFrame(false);
    if (!frame?.dataUrl) return;
    nearLiveInFlightRef.current = true;
    setNearLiveBusy(true);
    setNearLiveError(null);
    try {
      const livePrompt = [
        "Near-live camera mode.",
        "Describe only the current frame in a concise operational way.",
        "Call out people, devices, screens, cables, labels, damage, disconnected items, or anything unusual.",
        "If uncertain, say uncertain.",
        "Keep it short: 2 to 4 brief bullets.",
      ].join(" ");
      const liveMessages = [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: frame.dataUrl } },
            { type: "text", text: livePrompt },
          ],
        },
      ];
      const res = await fetch(`${API_BASE}/status-report/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ messages: liveMessages, lookbackDays, previewInventory: false, uploadedFileIds: [] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setLiveObservation({
        imageUrl: frame.dataUrl,
        reply: typeof data.reply === "string" ? data.reply : "No live observation returned.",
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setNearLiveError(error instanceof Error ? error.message : "Near-live analysis failed.");
    } finally {
      nearLiveInFlightRef.current = false;
      setNearLiveBusy(false);
    }
  };

  const toggleNearLive = async () => {
    if (nearLiveEnabled) {
      stopNearLive();
      return;
    }
    if (!cameraOpen) {
      setNearLiveError("Start Live View first, then turn on Near-Live mode.");
      return;
    }
    setNearLiveError(null);
    setNearLiveEnabled(true);
    await analyzeNearLiveFrame();
  };

  const stopAudioCapture = () => {
    speechRef.current?.stop();
    speechRef.current = null;
    setAudioListening(false);
  };

  const toggleAudioCapture = () => {
    if (audioListening) {
      stopAudioCapture();
      return;
    }
    if (!speechCtor) {
      setAudioError("This device/browser does not support live speech-to-text.");
      return;
    }
    try {
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const recognition = new speechCtor();
      speechRef.current = recognition;
      setAudioError(null);
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .slice(event.resultIndex)
          .map((result) => result?.[0]?.transcript ?? "")
          .join(" ")
          .trim();
        if (!transcript) return;
        setInput((prev) => {
          const needsSpace = prev.length > 0 && !prev.endsWith(" ");
          return `${prev}${needsSpace ? " " : ""}${transcript}`.trimStart();
        });
      };
      recognition.onerror = (event) => {
        setAudioError(event.error ? `Audio input error: ${event.error}.` : "Audio input could not start.");
      };
      recognition.onend = () => {
        speechRef.current = null;
        setAudioListening(false);
      };
      recognition.start();
      setAudioListening(true);
      toast({ title: "Audio listening", description: "Speak naturally. Your words will appear in the message box." });
    } catch (error) {
      speechRef.current = null;
      setAudioListening(false);
      setAudioError(error instanceof Error ? error.message : "Audio input could not start.");
    }
  };

  const handleInstallFred = async () => {
    if (isInstalledStandalone) {
      toast({ title: "Fred is already installed", description: "Look for the Fred icon on your home screen or app list." });
      return;
    }
    if (installPromptEvent) {
      try {
        await installPromptEvent.prompt();
        const choice = await installPromptEvent.userChoice;
        if (choice?.outcome === "accepted") {
          toast({ title: "Install started", description: "Android should add Fred to your home screen." });
        }
      } catch (error) {
        toast({
          title: "Install could not start",
          description: error instanceof Error ? error.message : "Use the browser menu and choose Add to Home screen.",
          variant: "destructive",
        });
      } finally {
        setInstallPromptEvent(null);
      }
      return;
    }
    setInstallDialogOpen(true);
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

  const handleClear = async () => {
    const checkpoint = checkpointAll(messages, chat.checkpoint);
    const serverMessages = messages.map((message) => ({ role: message.role, content: messageText(message) }));
    try {
      const response = await fetch(`${API_BASE}/status-report/chat-session/new`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ messages: serverMessages, checkpoint, title: chat.title }),
      });
      const data = response.ok ? await response.json() : null;
      setChat({ key: storageKey, messages: [], checkpoint: "", title: "New Fred topic", savedAt: String(data?.session?.updatedAt ?? new Date().toISOString()), sessionId: data?.session?.id ? String(data.session.id) : null });
      void loadTopics();
    } catch {
      // The local checkpoint still protects continuity when the server is temporarily unavailable.
      setChat({ key: storageKey, messages: [], checkpoint: "", title: "New Fred topic", savedAt: new Date().toISOString(), sessionId: null });
    }
    toast({ title: "New topic started", description: "The previous conversation was archived and remains available under Topics." });
  };

  const loadTopics = async () => {
    setTopicsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/status-report/chat-sessions`, { headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setTopics(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (error) {
      toast({ title: "Could not load Fred topics", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setTopicsLoading(false);
    }
  };

  const openTopic = async (sessionId: string) => {
    const response = await fetch(`${API_BASE}/status-report/chat-session/${encodeURIComponent(sessionId)}/activate`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const session = data.session;
    setChat({
      key: storageKey,
      messages: Array.isArray(session?.messages) ? session.messages : [],
      checkpoint: typeof session?.checkpoint === "string" ? session.checkpoint : "",
      title: typeof session?.title === "string" ? session.title : "Fred topic",
      savedAt: String(session?.updatedAt ?? new Date().toISOString()),
      sessionId: session?.id ? String(session.id) : null,
    });
  };

  useEffect(() => {
    if (!storageKey) return;
    void loadTopics();
    // The authenticated user key is the boundary for the per-user topic list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const qrUrl = fredMobileUrl();
  const qrImage = qrUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrUrl)}`
    : "";

  useEffect(() => {
    if (!mobileFieldMode) return;
    if (!nearLiveEnabled || !cameraOpen || typeof window === "undefined") {
      if (nearLiveIntervalRef.current !== null) {
        window.clearInterval(nearLiveIntervalRef.current);
        nearLiveIntervalRef.current = null;
      }
      return;
    }
    if (nearLiveIntervalRef.current !== null) {
      window.clearInterval(nearLiveIntervalRef.current);
    }
    nearLiveIntervalRef.current = window.setInterval(() => {
      void analyzeNearLiveFrame();
    }, 2000);
    return () => {
      if (nearLiveIntervalRef.current !== null) {
        window.clearInterval(nearLiveIntervalRef.current);
        nearLiveIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileFieldMode, nearLiveEnabled, cameraOpen, lookbackDays]);

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${mobileFieldMode ? "h-full max-h-full border-border/80 bg-white/95 shadow-xl" : "h-full min-h-[32rem] w-full flex-1"}`}>
      <CardHeader className={`shrink-0 border-b ${mobileFieldMode ? "px-3 pb-2 pt-3" : ""}`}>
        <div className={`gap-3 ${mobileFieldMode ? "flex flex-col" : "flex items-center justify-between flex-wrap"}`}>
          <div>
            <CardTitle className={mobileFieldMode ? "text-xl leading-tight" : undefined}>
              {mobileFieldMode ? "Fred" : "Ask Fred"}
            </CardTitle>
            <CardDescription className={mobileFieldMode ? "mt-0.5 text-xs leading-4" : undefined}>
              {mobileFieldMode
                ? "Field support chat"
                : "The AI has read access to entries, risks, after-action reports, and network inventory."}
            </CardDescription>
            <div className={`mt-2 ${mobileFieldMode ? "w-full" : "w-full max-w-md"}`}>
              <Label htmlFor="fred-current-topic" className="text-xs font-bold uppercase tracking-wide text-foreground">
                Current topic
              </Label>
              <Input
                id="fred-current-topic"
                value={chat.title}
                onChange={(event) => setChat((current) => ({ ...current, title: event.target.value.slice(0, 200), savedAt: new Date().toISOString() }))}
                className={`mt-1 font-bold ${mobileFieldMode ? "h-9 text-sm" : "h-8"}`}
                aria-label="Fred conversation topic"
                placeholder="Conversation topic"
              />
            </div>
            <div className={`mt-2 pl-4 ${mobileFieldMode ? "w-full" : "w-full max-w-md"}`}>
              <Label className="mb-1 block text-xs font-medium text-muted-foreground">Switch topic</Label>
              <Select
                value={chat.sessionId ?? undefined}
                onOpenChange={(open) => { if (open) void loadTopics(); }}
                onValueChange={(sessionId) => {
                  if (sessionId === chat.sessionId) return;
                  void openTopic(sessionId).catch((error) => toast({
                    title: "Could not open topic",
                    description: error instanceof Error ? error.message : String(error),
                    variant: "destructive",
                  }));
                }}
              >
                <SelectTrigger className={mobileFieldMode ? "h-10" : "h-8"} aria-label="Open a saved Fred topic">
                  <span className="mr-2 inline-flex items-center gap-1.5 truncate">
                    <History className="h-4 w-4 shrink-0" />
                    <SelectValue placeholder={topicsLoading ? "Loading topics..." : "Open an old topic"} />
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-[22rem]">
                  {[...topics]
                    .sort((left, right) => Number(right.id === chat.sessionId) - Number(left.id === chat.sessionId))
                    .map((topic) => {
                    const isCurrent = topic.id === chat.sessionId;
                    return (
                    <SelectItem key={topic.id} value={topic.id}>
                      <span className={`flex max-w-[32rem] items-center gap-2 ${isCurrent ? "font-bold" : "pl-3"}`}>
                        <span className="truncate">{topic.title || "Untitled Fred topic"}</span>
                        {isCurrent ? <span className="shrink-0 text-xs font-bold text-primary">Current</span> : null}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {topic.messageCount} messages · {new Date(topic.updatedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className={mobileFieldMode ? "grid grid-cols-2 gap-2" : "flex items-center gap-2 flex-wrap"}>
            {mobileFieldMode && (
              <>
                <input
                  ref={mobileCameraInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  capture="environment"
                  onChange={handleMobileCameraPick}
                />
                <input
                  ref={fredUploadInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={handleFredUploadSelect}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 justify-start rounded-2xl px-3 text-sm"
                  onClick={() => mobileCameraInputRef.current?.click()}
                  title="Use phone camera"
                >
                  <Camera className="mr-1.5 h-4 w-4" />
                  Photo
                </Button>
                <Button
                  variant={audioListening ? "secondary" : "outline"}
                  size="sm"
                  className="h-11 justify-start rounded-2xl px-3 text-sm"
                  onClick={toggleAudioCapture}
                  title={audioListening ? "Stop voice input" : "Start voice input"}
                >
                  {audioListening ? <MicOff className="mr-1.5 h-4 w-4" /> : <Mic className="mr-1.5 h-4 w-4" />}
                  {audioListening ? "Stop Mic" : "Audio"}
                </Button>
                <Drawer open={toolsOpen} onOpenChange={setToolsOpen}>
                  <DrawerTrigger asChild>
                    <Button
                      variant={cameraOpen || nearLiveEnabled ? "secondary" : "outline"}
                      size="sm"
                      className="h-11 justify-start rounded-2xl px-3 text-sm"
                      title="Open live tools"
                    >
                      <Camera className="mr-1.5 h-4 w-4" />
                      Live Tools
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent className="max-h-[85dvh] rounded-t-[1.5rem]">
                    <DrawerHeader className="pb-2 text-left">
                      <DrawerTitle>Live Tools</DrawerTitle>
                      <DrawerDescription>
                        Camera preview, near-live updates, capture, and send.
                      </DrawerDescription>
                    </DrawerHeader>
                    <div className="space-y-3 overflow-y-auto px-4 pb-4">
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant={cameraOpen ? "secondary" : "outline"}
                          className="h-11 rounded-2xl text-sm"
                          onClick={cameraOpen ? stopCamera : startCamera}
                          title={cameraOpen ? "Stop Fred live assist" : "Start Fred live assist"}
                        >
                          {cameraOpen ? <CameraOff className="mr-1.5 h-4 w-4" /> : <Camera className="mr-1.5 h-4 w-4" />}
                          {cameraOpen ? "Stop Live" : "Live View"}
                        </Button>
                        <Button
                          variant={nearLiveEnabled ? "secondary" : "outline"}
                          className="h-11 rounded-2xl text-sm"
                          onClick={() => void toggleNearLive()}
                          title={nearLiveEnabled ? "Stop near-live mode" : "Start near-live mode"}
                        >
                          <Sparkles className="mr-1.5 h-4 w-4" />
                          {nearLiveEnabled ? "Pause Auto-Share" : "Resume Auto-Share"}
                        </Button>
                      </div>
                      <div className="overflow-hidden rounded-2xl border bg-black">
                        {cameraOpen ? (
                          <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className="aspect-[16/10] max-h-72 w-full object-cover"
                          />
                        ) : (
                          <div className="flex aspect-[16/10] max-h-72 items-center justify-center px-6 text-center text-sm text-white/70">
                            Start Live View when you want Fred to watch the camera feed in near-live mode. Otherwise just send a photo, voice note, or typed message.
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button onClick={handleCaptureFrame} disabled={!cameraOpen} variant="outline" className="h-11 rounded-2xl text-sm">
                          <Camera className="mr-1.5 h-4 w-4" />
                          Capture
                        </Button>
                        <Button onClick={handleSendCurrentView} disabled={!cameraOpen || loading} className="h-11 rounded-2xl text-sm">
                          <Send className="mr-1.5 h-4 w-4" />
                          Send View
                        </Button>
                      </div>
                      {nearLiveEnabled || liveObservation ? (
                        <div className="rounded-2xl border bg-white/90 p-3 shadow-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">Fred Near-Live</p>
                              <p className="text-xs text-muted-foreground">
                                {nearLiveEnabled
                                  ? nearLiveBusy
                                    ? "Analyzing the latest frame..."
                                    : "Refreshing every 2 seconds while Live View stays open."
                                  : liveObservation
                                    ? "Last near-live observation is still shown below."
                                    : "Near-live is off."}
                              </p>
                            </div>
                            <div className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${nearLiveEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                              {nearLiveEnabled ? "ON" : "OFF"}
                            </div>
                          </div>
                          {liveObservation ? (
                            <div className="mt-3 space-y-3">
                              <img
                                src={liveObservation.imageUrl}
                                alt="Latest near-live frame"
                                className="max-h-40 w-full rounded-xl object-cover"
                              />
                              <div className="rounded-xl bg-[#edf4ed] px-3 py-2 text-sm leading-6 text-foreground">
                                <MarkdownMessage content={liveObservation.reply} />
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Last update{" "}
                                {new Date(liveObservation.updatedAt).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {cameraError ? (
                        <p className="text-sm text-destructive">{cameraError}</p>
                      ) : nearLiveError ? (
                        <p className="text-sm text-destructive">{nearLiveError}</p>
                      ) : audioError ? (
                        <p className="text-sm text-destructive">{audioError}</p>
                      ) : (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Live View now auto-shares a fresh frame every 2 seconds. Pause Auto-Share if you want preview only, or use Send View for a one-time frame.
                        </p>
                      )}
                    </div>
                  </DrawerContent>
                </Drawer>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-11 justify-start rounded-2xl px-3 text-sm" title="Open QR code">
                      <QrCode className="mr-1.5 h-4 w-4" />
                      QR Code
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-sm">
                    <DialogHeader>
                      <DialogTitle>Fred Mobile QR Code</DialogTitle>
                      <DialogDescription>
                        Scan this code to open the stripped-down Fred field app on a phone.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      {qrImage ? (
                        <img src={qrImage} alt="Fred Mobile QR code" className="mx-auto h-56 w-56 rounded-xl border bg-white p-2" />
                      ) : null}
                      <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground break-all">
                        {qrUrl}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <Dialog open={fredFilesOpen} onOpenChange={setFredFilesOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-11 justify-start rounded-2xl px-3 text-sm" title="Open Fred file library">
                      <Paperclip className="mr-1.5 h-4 w-4" />
                      Files
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Fred File Library</DialogTitle>
                      <DialogDescription>
                        Upload multiple larger files for Fred to review. Best for logs, configs, CSV, JSON, XML, Markdown, and screenshots.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" onClick={() => fredUploadInputRef.current?.click()} disabled={fredFilesUploading}>
                            {fredFilesUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Upload Files
                          </Button>
                          <Button type="button" variant="outline" onClick={() => void loadFredFiles()} disabled={fredFilesLoading}>
                            <RefreshCw className={`mr-2 h-4 w-4 ${fredFilesLoading ? "animate-spin" : ""}`} />
                            Refresh
                          </Button>
                          <Badge variant="secondary">{selectedFredFileIds.length} selected</Badge>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Each upload can include up to 20 files. Large text-style files stay on the server and can be attached into Fred chat without pasting them into the message box.
                        </p>
                        {fredFilesError ? (
                          <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {fredFilesError}
                          </p>
                        ) : null}
                        <div className="max-h-[50dvh] space-y-2 overflow-y-auto rounded-2xl border p-2">
                          {fredFilesLoading ? (
                            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading Fred files...
                            </div>
                          ) : fredFiles.length === 0 ? (
                            <div className="px-2 py-6 text-sm text-muted-foreground">
                              No Fred files uploaded yet.
                            </div>
                          ) : (
                            fredFiles.map((file) => {
                              const selected = selectedFredFileIds.includes(file.id);
                              return (
                                <div
                                  key={file.id}
                                  className={`rounded-2xl border px-3 py-3 ${selected ? "border-primary bg-primary/5" : "border-border/70 bg-background"}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{file.originalName}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {file.reviewKind} • {formatBytes(file.sizeBytes)} • {file.uploadedByName ?? "Unknown uploader"} •{" "}
                                        {new Date(file.createdAt).toLocaleString()}
                                      </p>
                                    </div>
                                    <Badge variant={selected ? "default" : "outline"}>
                                      {selected ? "Selected" : "Available"}
                                    </Badge>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <Button type="button" size="sm" variant={selected ? "secondary" : "outline"} onClick={() => toggleFredFileSelection(file.id)}>
                                      {selected ? "Remove from chat" : "Use in chat"}
                                    </Button>
                                    <Button type="button" size="sm" variant="ghost" onClick={() => void loadFredPreview(file.id)}>
                                      <Eye className="mr-1.5 h-4 w-4" />
                                      Preview
                                    </Button>
                                    {(user?.role === "cio" || user?.id === file.uploadedBy) && (
                                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteFredLibraryFile(file.id)}>
                                        <Trash2 className="mr-1.5 h-4 w-4" />
                                        Delete
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="rounded-2xl border bg-muted/20 p-4">
                          <p className="text-sm font-medium">Preview</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Fred reads text-like files directly. Binary/PDF/Office files can still be stored here, but preview and AI review may be limited until extraction is added for that format.
                          </p>
                        </div>
                        <div className="max-h-[50dvh] overflow-y-auto rounded-2xl border bg-background p-4">
                          {fredPreviewLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading preview...
                            </div>
                          ) : fredPreview ? (
                            <div className="space-y-3">
                              <div>
                                <p className="text-sm font-medium">{fredPreview.record.originalName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {fredPreview.record.reviewKind} • {formatBytes(fredPreview.record.sizeBytes)} • {fredPreview.record.mimeType}
                                </p>
                              </div>
                              {fredPreview.previewText ? (
                                <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs leading-5 text-foreground">
                                  {fredPreview.previewText}
                                </pre>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  This file type does not have inline text preview yet, but Fred can still keep it in the library for later download/reference.
                                </p>
                              )}
                              {fredPreview.truncated ? (
                                <p className="text-xs text-muted-foreground">
                                  Preview truncated because the stored file is larger than the inline review window.
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Choose Preview on any uploaded file to inspect what Fred will see.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button
                  variant={isInstalledStandalone ? "secondary" : "outline"}
                  size="sm"
                  className="col-span-2 h-11 justify-start rounded-2xl px-3 text-sm"
                  title="Install Fred on this phone"
                  onClick={() => void handleInstallFred()}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  {isInstalledStandalone ? "Installed" : "Install Fred"}
                </Button>
                <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
                  <DialogContent className="max-w-sm">
                    <DialogHeader>
                      <DialogTitle>Install Fred on this phone</DialogTitle>
                      <DialogDescription>
                        QR codes usually open a preview first, so Android does not always show the install prompt by itself.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <p>Best path:</p>
                      <ol className="ml-5 list-decimal space-y-2">
                        <li>Open this page in full Chrome or Samsung Internet, not just the QR scanner preview.</li>
                        <li>Tap the browser menu.</li>
                        <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                        <li>If that option is missing, refresh once and use this Install Fred button again.</li>
                      </ol>
                      <div className="rounded-xl border bg-muted/40 px-3 py-2 text-xs break-all">
                        {qrUrl}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
            {!mobileFieldMode && (
              <>
                <input
                  ref={fredUploadInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={handleFredUploadSelect}
                />
                <Dialog open={fredFilesOpen} onOpenChange={setFredFilesOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Open Fred file library"
                    >
                      <Paperclip className="h-4 w-4 mr-1" /> Files
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Fred File Library</DialogTitle>
                      <DialogDescription>
                        Upload multiple larger files for Fred to review. Best for logs, configs, CSV, JSON, XML, Markdown, and screenshots.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" onClick={() => fredUploadInputRef.current?.click()} disabled={fredFilesUploading}>
                            {fredFilesUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Upload Files
                          </Button>
                          <Button type="button" variant="outline" onClick={() => void loadFredFiles()} disabled={fredFilesLoading}>
                            <RefreshCw className={`mr-2 h-4 w-4 ${fredFilesLoading ? "animate-spin" : ""}`} />
                            Refresh
                          </Button>
                          <Badge variant="secondary">{selectedFredFileIds.length} selected</Badge>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Each upload can include up to 20 files. Large text-style files stay on the server and can be attached into Fred chat without pasting them into the message box.
                        </p>
                        {fredFilesError ? (
                          <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {fredFilesError}
                          </p>
                        ) : null}
                        <div className="max-h-[50dvh] space-y-2 overflow-y-auto rounded-2xl border p-2">
                          {fredFilesLoading ? (
                            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading Fred files...
                            </div>
                          ) : fredFiles.length === 0 ? (
                            <div className="px-2 py-6 text-sm text-muted-foreground">
                              No Fred files uploaded yet.
                            </div>
                          ) : (
                            fredFiles.map((file) => {
                              const selected = selectedFredFileIds.includes(file.id);
                              return (
                                <div
                                  key={file.id}
                                  className={`rounded-2xl border px-3 py-3 ${selected ? "border-primary bg-primary/5" : "border-border/70 bg-background"}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{file.originalName}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {file.reviewKind} • {formatBytes(file.sizeBytes)} • {file.uploadedByName ?? "Unknown uploader"} •{" "}
                                        {new Date(file.createdAt).toLocaleString()}
                                      </p>
                                    </div>
                                    <Badge variant={selected ? "default" : "outline"}>
                                      {selected ? "Selected" : "Available"}
                                    </Badge>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <Button type="button" size="sm" variant={selected ? "secondary" : "outline"} onClick={() => toggleFredFileSelection(file.id)}>
                                      {selected ? "Remove from chat" : "Use in chat"}
                                    </Button>
                                    <Button type="button" size="sm" variant="ghost" onClick={() => void loadFredPreview(file.id)}>
                                      <Eye className="mr-1.5 h-4 w-4" />
                                      Preview
                                    </Button>
                                    {(user?.role === "cio" || user?.id === file.uploadedBy) && (
                                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteFredLibraryFile(file.id)}>
                                        <Trash2 className="mr-1.5 h-4 w-4" />
                                        Delete
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="rounded-2xl border bg-muted/20 p-4">
                          <p className="text-sm font-medium">Preview</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Fred reads text-like files directly. Binary/PDF/Office files can still be stored here, but preview and AI review may be limited until extraction is added for that format.
                          </p>
                        </div>
                        <div className="max-h-[50dvh] overflow-y-auto rounded-2xl border bg-background p-4">
                          {fredPreviewLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading preview...
                            </div>
                          ) : fredPreview ? (
                            <div className="space-y-3">
                              <div>
                                <p className="text-sm font-medium">{fredPreview.record.originalName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {fredPreview.record.reviewKind} • {formatBytes(fredPreview.record.sizeBytes)} • {fredPreview.record.mimeType}
                                </p>
                              </div>
                              {fredPreview.previewText ? (
                                <pre className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs leading-5 text-foreground">
                                  {fredPreview.previewText}
                                </pre>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  This file type does not have inline text preview yet, but Fred can still keep it in the library for later download/reference.
                                </p>
                              )}
                              {fredPreview.truncated ? (
                                <p className="text-xs text-muted-foreground">
                                  Preview truncated because the stored file is larger than the inline review window.
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Choose Preview on any uploaded file to inspect what Fred will see.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
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
                  title="Archive this topic and start another"
                >
                  <Trash2 className="h-4 w-4 mr-1" /> New topic
                </Button>
                <Label className="text-xs text-muted-foreground">Lookback days:</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={lookbackDays}
                  onChange={(e) => setLookbackDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-8 w-20"
                />
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-scroll overscroll-contain py-4 pr-2 space-y-3 [scrollbar-gutter:stable] ${mobileFieldMode ? "bg-[linear-gradient(180deg,#f9fcf9_0%,#f3f7f3_100%)] px-3" : ""}`}
      >
        {messages.length === 0 && (
          <div className="space-y-3 py-6">
            <p className={`text-center text-muted-foreground ${mobileFieldMode ? "text-base leading-6" : "text-sm"}`}>
              Start by asking a question, or try one of these:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {examples.map((q) => (
                <Badge
                  key={q}
                  variant="outline"
                  className={`cursor-pointer hover:bg-accent font-normal ${mobileFieldMode ? "px-3 py-2.5 text-sm leading-5 whitespace-normal" : "py-2 px-3"}`}
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
              className={`max-w-[92%] px-4 py-3 ${mobileFieldMode ? "rounded-[1.4rem] text-base leading-6 shadow-sm" : "rounded-lg text-sm"} ${
                m.role === "user"
                  ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                  : mobileFieldMode
                    ? "border bg-[#edf4ed]"
                    : "bg-muted"
              }`}
            >
              {m.role === "user"
                ? typeof m.content === "string"
                  ? m.content
                  : (m.content as any[]).map((p: any, pi: number) =>
                      p.type === "image_url"
                        ? <img key={pi} src={p.image_url.url} alt="attachment" className={`mb-2 rounded-xl ${mobileFieldMode ? "max-h-56 w-auto object-cover" : "max-h-40 object-contain"}`} />
                        : <span key={pi}>{p.text}</span>
                    )
                : <MarkdownMessage content={typeof m.content === "string" ? m.content : JSON.stringify(m.content)} />}
            </div>
            {!mobileFieldMode && m.role === "assistant" && m.content.trim() && (
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
      <div className={`border-t shrink-0 space-y-2 ${mobileFieldMode ? "bg-white/98 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3" : "p-3"}`}>
        {selectedFredFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedFredFiles.map((file) => (
              <div
                key={file.id}
                className={`flex items-center gap-2 rounded-2xl border bg-muted/40 px-3 py-1.5 ${mobileFieldMode ? "text-sm" : "text-xs"}`}
              >
                <span className="max-w-[220px] truncate text-muted-foreground">{file.originalName}</span>
                <button
                  type="button"
                  onClick={() => toggleFredFileSelection(file.id)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Remove file from this chat"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {mobileFieldMode && voicePanelOpen && (
          <div className="rounded-[1.35rem] border border-primary/20 bg-primary/5 px-4 py-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Voice input is listening</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Speak naturally. Fred will place the transcript in the message box below.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-xl px-2 text-xs"
                onClick={stopAudioCapture}
              >
                <MicOff className="mr-1.5 h-3.5 w-3.5" />
                Stop
              </Button>
            </div>
          </div>
        )}
        {attachedFile && (
          <div className={`flex items-center gap-1.5 bg-muted rounded px-2 py-1 w-fit max-w-full ${mobileFieldMode ? "rounded-2xl text-sm" : "text-xs"}`}>
            {attachedFile.kind === "image" && attachedFile.dataUrl && (
              <img src={attachedFile.dataUrl} alt={attachedFile.name} className={`${mobileFieldMode ? "h-9 w-9" : "h-6 w-6"} rounded object-cover shrink-0`} />
            )}
            {attachedFile.kind === "text" && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate max-w-[200px] text-muted-foreground">{attachedFile.name}</span>
            <button
              type="button"
              onClick={() => setAttachedFile(null)}
              className="ml-1 text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className={mobileFieldMode ? "grid grid-cols-[auto_1fr_auto] items-end gap-2" : "flex gap-2"}>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.txt,.log,.cfg,.conf,.json,.csv,.md,.yaml,.yml,.xml,.ps1,.sh"
            onChange={handleFileSelect}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`shrink-0 ${mobileFieldMode ? "h-12 w-12 rounded-2xl border border-border/70 bg-white" : "h-9 w-9"}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title="Attach file or image (configs, logs, screenshots)"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={mobileFieldMode ? "Ask Fred what you need from the field..." : "Ask about entries, risks, AARs, network inventory — or attach a config/log/screenshot..."}
            rows={mobileFieldMode ? 2 : 2}
            className={`resize-none ${mobileFieldMode ? "min-h-[3.75rem] rounded-[1.4rem] border-border/80 bg-white text-base leading-6 shadow-sm" : ""}`}
            disabled={loading}
          />
          <Button
            onClick={handleSend}
            disabled={loading || (!input.trim() && !attachedFile && selectedFredFiles.length === 0)}
            className={mobileFieldMode ? "h-12 w-12 rounded-2xl px-0" : undefined}
          >
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

function EnterpriseArchitectureTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState("");
  const [verification, setVerification] = useState("");
  const [meta, setMeta] = useState<any>(null);

  const loadLatest = async (): Promise<boolean> => {
    const response = await fetch(`${API_BASE}/status-report/enterprise-architecture/latest`, { headers: authHeaders() });
    if (!response.ok) return false;
    const data = await response.json();
    setReport(data.report || "");
    setVerification(data.verification || "");
    setMeta({
      evidence: data.evidenceSummary,
      models: data.models,
      snapshotId: data.snapshotId,
      normalized: { entities: data.entityCount, relationships: data.relationshipCount },
    });
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    const restoreLatest = async () => {
      const response = await fetch(`${API_BASE}/status-report/enterprise-architecture/latest`, { headers: authHeaders() });
      if (!response.ok) return;
      const data = await response.json();
      if (cancelled) return;
      setReport(data.report || "");
      setVerification(data.verification || "");
      setMeta({
        evidence: data.evidenceSummary,
        models: data.models,
        snapshotId: data.snapshotId,
        normalized: { entities: data.entityCount, relationships: data.relationshipCount },
      });
    };
    void restoreLatest();
    return () => { cancelled = true; };
  }, []);

  const generate = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/status-report/enterprise-architecture`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      setReport(data.report || "");
      setVerification(data.verification || "");
      setMeta({ evidence: data.evidenceSummary, models: data.models, snapshotId: data.snapshotId, normalized: data.normalized });
    } catch (error: any) {
      const recovered = await loadLatest().catch(() => false);
      toast({
        title: recovered ? "Refresh timed out — saved architecture restored" : "Architecture generation failed",
        description: recovered ? `Showing saved snapshot #${meta?.snapshotId ?? 1}. No completed architecture was lost.` : error.message,
        variant: recovered ? "default" : "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    const content = `${report}\n\n---\n\n# Independent verification\n\n${verification}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `SCCC-As-Is-Enterprise-Architecture-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = async () => {
    try {
      const response = await fetch(`${API_BASE}/status-report/enterprise-architecture/latest.json`, { headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `SCCC-As-Is-Enterprise-Architecture-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "JSON download failed", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>As-Is Enterprise Architecture</CardTitle>
          <CardDescription>
            Fred inventories the current SCCC evidence, creates an evidence-labelled architecture with editable Mermaid diagrams, then sends it to the separately configured verification profile for an independent review.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {loading ? "Building and verifying…" : "Generate as-is architecture"}
          </Button>
          {report && <Button variant="outline" onClick={download}><Download className="mr-2 h-4 w-4" />Download Markdown</Button>}
          {meta?.snapshotId && <Button variant="outline" onClick={downloadJson}><Download className="mr-2 h-4 w-4" />Download evidence JSON</Button>}
          {meta && <p className="w-full text-xs text-muted-foreground">Snapshot #{meta.snapshotId ?? "pending"} · {meta.normalized?.entities ?? 0} queryable elements · {meta.normalized?.relationships ?? 0} relationships · Architect: {meta.models?.architect} · Verifier: {meta.models?.verifier} · Evidence captured {meta.evidence?.generatedAt}</p>}
        </CardContent>
      </Card>
      {report && <Card className="max-h-[65svh] overflow-hidden"><CardHeader><CardTitle>Architecture deliverable</CardTitle></CardHeader><CardContent className="max-h-[55svh] overflow-y-auto"><MarkdownMessage content={report} /></CardContent></Card>}
      {verification && <Card><CardHeader><CardTitle>Independent acceptance review</CardTitle></CardHeader><CardContent><MarkdownMessage content={verification} /></CardContent></Card>}
    </div>
  );
}

export default function AIReport() {
  const { isCIO } = useAuth();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const fromPath = searchParams.get("from") ?? "";
  const requestedTab = searchParams.get("tab");
  const defaultTab = isCIO && requestedTab === "architecture" ? "architecture" : "chat";
  const contextHint = pageHintFromPath(fromPath);

  return (
    <div className="flex h-full min-h-[calc(100svh-11rem)] min-w-0 flex-1 flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-7 w-7" />
          AI Assistant
        </h1>
        <p className="text-muted-foreground mt-1">
          Ask questions about IT data, or (for the CIO) generate executive status reports.
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          {isCIO && <TabsTrigger value="status">Status Report</TabsTrigger>}
          {isCIO && <TabsTrigger value="architecture">Architecture</TabsTrigger>}
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
          <TabsContent value="architecture" className="mt-6">
            <EnterpriseArchitectureTab />
          </TabsContent>
        )}
        {isCIO && (
          <TabsContent value="insights" className="mt-6">
            <CIOInsightsTab />
          </TabsContent>
        )}
        <TabsContent value="chat" className="mt-6 min-h-0 flex-1 data-[state=active]:flex">
          <ChatTab contextHint={contextHint} />
        </TabsContent>
        <TabsContent value="memory" className="mt-6">
          <MemoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function FredMobilePage() {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateViewportHeight = () => {
      const nextHeight = window.visualViewport?.height ?? window.innerHeight;
      setViewportHeight(Math.round(nextHeight));
    };
    updateViewportHeight();
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const { documentElement, body } = document;
    const root = document.getElementById("root");
    const prevHtmlOverflow = documentElement.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlHeight = documentElement.style.height;
    const prevBodyHeight = body.style.height;
    const prevRootHeight = root?.style.height ?? "";

    documentElement.style.height = "100%";
    body.style.height = "100%";
    documentElement.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (root) {
      root.style.height = "100%";
    }

    return () => {
      documentElement.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      documentElement.style.height = prevHtmlHeight;
      body.style.height = prevBodyHeight;
      if (root) {
        root.style.height = prevRootHeight;
      }
    };
  }, []);

  return (
    <div
      className="overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(47,174,107,0.12),_transparent_28%),linear-gradient(180deg,_#f6f8f7_0%,_#eef3ef_100%)]"
      style={{ height: viewportHeight ? `${viewportHeight}px` : "100dvh", maxHeight: viewportHeight ? `${viewportHeight}px` : "100dvh" }}
    >
      <div className="mx-auto flex h-full w-full max-w-md flex-col overflow-hidden px-2 py-2 sm:px-3 sm:py-3">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ChatTab contextHint="the mobile field support view" mobileFieldMode />
        </div>
      </div>
    </div>
  );
}
