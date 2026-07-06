import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Siren, Plus, CheckCircle2, Clock } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import type { IncidentRoom } from "@workspace/db";

async function apiRequest(method: string, url: string, body?: unknown) {
  const res = await authFetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res;
}

const SEVERITY_COLOR: Record<string, string> = {
  low: "bg-blue-100 text-blue-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

export default function IncidentsPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", severity: "medium" });

  const { data: rooms = [], isLoading } = useQuery<IncidentRoom[]>({
    queryKey: ["/api/incidents"],
    refetchInterval: 15000,
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) => apiRequest("POST", "/api/incidents", body),
    onSuccess: async (res) => {
      const room = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/incidents"] });
      setShowNew(false);
      setForm({ name: "", description: "", severity: "medium" });
      navigate(`/incidents/${room.id}`);
    },
  });

  const open = rooms.filter((r) => r.status === "open");
  const resolved = rooms.filter((r) => r.status === "resolved");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Siren className="h-6 w-6 text-red-500" />
          <div>
            <h1 className="text-2xl font-bold">Incident Rooms</h1>
            <p className="text-sm text-muted-foreground">
              Real-time group chat for outage response — Fred is always in the room
            </p>
          </div>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Open Incident Room
        </Button>
      </div>

      {/* Open rooms */}
      {open.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse inline-block" />
            Active ({open.length})
          </h2>
          <div className="space-y-2">
            {open.map((room) => (
              <RoomCard key={room.id} room={room} onClick={() => navigate(`/incidents/${room.id}`)} />
            ))}
          </div>
        </section>
      )}

      {open.length === 0 && !isLoading && (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
          <p>No active incidents. Things look good.</p>
        </div>
      )}

      {/* Resolved rooms */}
      {resolved.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Resolved ({resolved.length})
          </h2>
          <div className="space-y-2 opacity-70">
            {resolved.slice(0, 10).map((room) => (
              <RoomCard key={room.id} room={room} onClick={() => navigate(`/incidents/${room.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* New incident dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open Incident Room</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                placeholder="e.g. Banner down — student portal unreachable"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description (optional)</label>
              <Textarea
                placeholder="What's happening?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Severity</label>
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Opening…" : "Open Room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoomCard({ room, onClick }: { room: IncidentRoom; onClick: () => void }) {
  const age = formatAge(new Date(room.createdAt));
  return (
    <button
      onClick={onClick}
      className="w-full text-left border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between gap-4"
    >
      <div className="min-w-0">
        <p className="font-medium truncate">{room.name}</p>
        {room.description && (
          <p className="text-sm text-muted-foreground truncate">{room.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge className={SEVERITY_COLOR[room.severity] ?? ""}>{room.severity}</Badge>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" /> {age}
        </span>
      </div>
    </button>
  );
}

function formatAge(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
