import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Send, UserPlus, CheckCircle2, Bot, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/authFetch";

async function apiRequest(method: string, url: string, body?: unknown) {
  const res = await authFetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res;
}
import ReactMarkdown from "react-markdown";

type Message = {
  id: number;
  roomId: number;
  userId: number | null;
  authorName: string;
  isFred: boolean;
  content: string;
  createdAt: string;
};

type Member = { userId: number; name: string; email: string };

type RoomDetail = {
  id: number;
  name: string;
  description: string | null;
  severity: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  messages: Message[];
  members: Member[];
};

const SEVERITY_COLOR: Record<string, string> = {
  low: "bg-blue-100 text-blue-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

export default function IncidentRoomPage() {
  const { id } = useParams<{ id: string }>();
  const roomId = parseInt(id);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [fredTyping, setFredTyping] = useState(false);

  const { data: room, isLoading } = useQuery<RoomDetail>({
    queryKey: [`/api/incidents/${roomId}`],
    refetchOnWindowFocus: false,
  });

  // Seed messages from initial fetch
  useEffect(() => {
    if (room?.messages) setMessages(room.messages);
  }, [room?.id]);

  // SSE — real-time messages
  useEffect(() => {
    const token = localStorage.getItem("auth_token") ?? "";
    const es = new EventSource(`/api/incidents/${roomId}/stream?token=${encodeURIComponent(token)}`);

    es.addEventListener("message", (e) => {
      const msg: Message = JSON.parse(e.data);
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      if (msg.isFred) setFredTyping(false);
    });

    es.addEventListener("resolved", () => {
      qc.invalidateQueries({ queryKey: [`/api/incidents/${roomId}`] });
    });

    es.addEventListener("member_joined", () => {
      qc.invalidateQueries({ queryKey: [`/api/incidents/${roomId}`] });
    });

    return () => es.close();
  }, [roomId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, fredTyping]);

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      apiRequest("POST", `/api/incidents/${roomId}/messages`, { content }),
    onSuccess: () => {
      setInput("");
      inputRef.current?.focus();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/incidents/${roomId}`, { status: "resolved" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/incidents/${roomId}`] }),
  });

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    if (/@fred/i.test(text)) setFredTyping(true);
    sendMutation.mutate(text);
  }, [input, sendMutation]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading room…</div>;
  if (!room) return <div className="p-6 text-muted-foreground">Room not found.</div>;

  const isResolved = room.status === "resolved";

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-start justify-between gap-4 shrink-0 bg-background">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/incidents")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-semibold text-base truncate">{room.name}</h1>
              <Badge className={SEVERITY_COLOR[room.severity] ?? ""}>{room.severity}</Badge>
              {isResolved && <Badge variant="outline" className="text-green-600 border-green-600">Resolved</Badge>}
            </div>
            {room.description && (
              <p className="text-xs text-muted-foreground truncate">{room.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:block">
            {room.members.length} member{room.members.length !== 1 ? "s" : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => setAddMemberOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1" /> Add
          </Button>
          {!isResolved && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-green-700 border-green-300 hover:bg-green-50">
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Resolve
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark as resolved?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This closes the incident room. All messages are preserved for review.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => resolveMutation.mutate()}>
                    Resolve Incident
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} isMine={msg.userId === user?.id} />
        ))}
        {fredTyping && (
          <div className="flex items-start gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-none px-3 py-2 text-sm text-muted-foreground italic">
              Fred is looking into it…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!isResolved && (
        <div className="border-t px-4 py-3 flex gap-2 shrink-0 bg-background">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type a message — use @fred to get Fred's attention…"
            className="flex-1"
            autoFocus
          />
          <Button onClick={handleSend} disabled={!input.trim() || sendMutation.isPending} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
      {isResolved && (
        <div className="border-t px-4 py-3 text-center text-sm text-muted-foreground bg-muted/30 shrink-0">
          This incident was resolved on {new Date(room.resolvedAt!).toLocaleString()}.
        </div>
      )}

      {/* Add member dialog */}
      <AddMemberDialog
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        roomId={roomId}
        currentMembers={room.members}
      />
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, isMine }: { msg: Message; isMine: boolean }) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isSystem = !msg.isFred && !msg.userId;

  if (isSystem) {
    return (
      <div className="text-center text-xs text-muted-foreground py-1">
        {msg.content}
      </div>
    );
  }

  if (msg.isFred) {
    return (
      <div className="flex items-start gap-2">
        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div className="max-w-[80%]">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-xs font-semibold text-primary">Fred</span>
            <span className="text-xs text-muted-foreground">{time}</span>
          </div>
          <div className="bg-primary/5 border border-primary/10 rounded-2xl rounded-tl-none px-3 py-2 text-sm prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  if (isMine) {
    return (
      <div className="flex items-start gap-2 flex-row-reverse">
        <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
          <User className="h-4 w-4" />
        </div>
        <div className="max-w-[75%]">
          <div className="flex items-baseline gap-2 mb-1 justify-end">
            <span className="text-xs text-muted-foreground">{time}</span>
            <span className="text-xs font-semibold">{msg.authorName}</span>
          </div>
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-none px-3 py-2 text-sm">
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <User className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="max-w-[75%]">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold">{msg.authorName}</span>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
        <div className="bg-muted rounded-2xl rounded-tl-none px-3 py-2 text-sm">
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ── Add member dialog ─────────────────────────────────────────────────────────

function AddMemberDialog({
  open, onClose, roomId, currentMembers,
}: {
  open: boolean;
  onClose: () => void;
  roomId: number;
  currentMembers: Member[];
}) {
  const qc = useQueryClient();
  const { data: allUsers = [] } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (userId: number) =>
      apiRequest("POST", `/api/incidents/${roomId}/members`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/incidents/${roomId}`] });
    },
  });

  const currentIds = new Set(currentMembers.map((m) => m.userId));
  const available = allUsers.filter((u) => !currentIds.has(u.id));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Team Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-y-auto py-2">
          {available.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              All team members are already in this room.
            </p>
          )}
          {available.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted">
              <div>
                <p className="text-sm font-medium">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addMutation.mutate(u.id)}
                disabled={addMutation.isPending}
              >
                Add
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
