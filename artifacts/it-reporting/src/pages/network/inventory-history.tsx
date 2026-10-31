import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Undo2, Server, Network as NetworkIcon, Bot, User } from "lucide-react";

interface AuditFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

interface InventoryAuditRow {
  id: number;
  entityType: "switch" | "vlan";
  entityId: number;
  entityLabel: string;
  action: "create" | "update" | "rollback";
  source: "manual" | "chat_ai";
  actorId: number | null;
  actorName: string | null;
  changes: AuditFieldChange[];
  createdAt: string;
}

const NETWORK_ADMIN_ROLES = ["cio", "network", "network_engineer"];

function apiBase() {
  return `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function InventoryHistory() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isNetworkAdmin = NETWORK_ADMIN_ROLES.includes(user?.role ?? "");

  const { data, isLoading, isError } = useQuery<InventoryAuditRow[]>({
    queryKey: ["network", "inventory-audit"],
    queryFn: async () => {
      const res = await fetch(`${apiBase()}/network/inventory/audit?limit=200`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: isNetworkAdmin,
  });

  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const rollback = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${apiBase()}/network/inventory/audit/${id}/rollback`, {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body as { result?: string };
    },
    onSuccess: (body) => {
      toast({ title: body?.result ?? "Change rolled back" });
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (e: any) => {
      toast({ title: "Rollback failed", description: e?.message, variant: "destructive" });
    },
    onSettled: () => setRollingBack(null),
  });

  if (!isNetworkAdmin) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Inventory change history is available to network administrators only.
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-8">Loading…</div>;
  }
  if (isError) {
    return <div className="text-center text-muted-foreground py-8">Could not load change history.</div>;
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No inventory changes recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const canRollback = row.action !== "create" && row.changes.length > 0;
        return (
          <Card key={row.id}>
            <CardContent className="py-3 px-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {row.entityType === "switch" ? (
                  <Server className="h-4 w-4 text-primary" />
                ) : (
                  <NetworkIcon className="h-4 w-4 text-primary" />
                )}
                <span className="font-medium">{row.entityLabel}</span>
                <Badge variant={row.action === "rollback" ? "secondary" : "outline"}>{row.action}</Badge>
                <Badge variant="outline" className="gap-1">
                  {row.source === "chat_ai" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                  {row.source === "chat_ai" ? "AI chat" : "manual"}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {row.actorName ? `${row.actorName} · ` : ""}
                  {fmtDate(row.createdAt)}
                </span>
              </div>
              {row.changes.length > 0 && (
                <ul className="text-xs space-y-0.5">
                  {row.changes.map((c) => (
                    <li key={c.field} className="flex flex-wrap items-center gap-1">
                      <span className="font-medium">{c.field}:</span>
                      <span className="text-muted-foreground line-through">{fmtValue(c.from)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{fmtValue(c.to)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {canRollback && (
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rollback.isPending}
                    onClick={() => {
                      setRollingBack(row.id);
                      rollback.mutate(row.id);
                    }}
                  >
                    {rollingBack === row.id && rollback.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Undo2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Roll back
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
