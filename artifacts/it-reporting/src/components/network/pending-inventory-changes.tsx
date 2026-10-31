import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check, X, GitPullRequestArrow } from "lucide-react";

export interface AuditFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface PendingNetworkChange {
  kind: "switch" | "vlan";
  action: "create" | "update";
  targetId: number | null;
  label: string;
  changes: AuditFieldChange[];
  payload: Record<string, unknown>;
}

export interface ApplyResult {
  ok: boolean;
  result?: string;
  error?: string;
}

/**
 * POST a pending AI-proposed inventory change to the apply endpoint. Shared by
 * both AI chat surfaces (status-report Ask AI and the network AI panel).
 */
export async function applyPendingChange(change: PendingNetworkChange): Promise<ApplyResult> {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`${import.meta.env.BASE_URL}api/network/inventory/apply`.replace(/\/+/g, "/"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ kind: change.kind, payload: change.payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  return { ok: true, result: data?.result };
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

/**
 * Renders AI-proposed switch/VLAN inventory changes as review cards with
 * Apply / Dismiss actions. Only shown to network-admin users (the caller
 * gates on role); the apply endpoint also enforces the role server-side.
 */
export function PendingInventoryChanges({
  changes,
  onApplied,
  onFailed,
  onDismiss,
}: {
  changes: PendingNetworkChange[];
  onApplied: (change: PendingNetworkChange, message?: string) => void;
  onFailed: (change: PendingNetworkChange, error?: string) => void;
  onDismiss: (change: PendingNetworkChange) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);

  if (changes.length === 0) return null;

  return (
    <div className="space-y-2">
      {changes.map((change, idx) => (
        <Card key={idx} className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <GitPullRequestArrow className="h-4 w-4" />
              Proposed {change.action === "create" ? "new" : "update to"} {change.kind}
              <Badge variant="outline">{change.label}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="text-xs space-y-0.5">
              {change.changes.map((c) => (
                <li key={c.field} className="flex flex-wrap items-center gap-1">
                  <span className="font-medium">{c.field}:</span>
                  {change.action === "update" && (
                    <>
                      <span className="text-muted-foreground line-through">{fmtValue(c.from)}</span>
                      <span className="text-muted-foreground">→</span>
                    </>
                  )}
                  <span>{fmtValue(c.to)}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(idx);
                  try {
                    const r = await applyPendingChange(change);
                    if (r.ok) {
                      onApplied(change, r.result);
                    } else {
                      onFailed(change, r.error);
                    }
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === idx ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1" />
                )}
                Apply
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => onDismiss(change)}>
                <X className="h-3.5 w-3.5 mr-1" /> Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
