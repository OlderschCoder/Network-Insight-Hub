import { useMemo } from "react";
import { Link } from "wouter";
import { useListRisks } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
type Sev = (typeof SEVERITY_ORDER)[number];

const sevVariant = (s: string): "default" | "destructive" | "secondary" | "outline" => {
  if (s === "critical") return "destructive";
  if (s === "high") return "destructive";
  if (s === "medium") return "default";
  return "secondary";
};

export default function OpenItemsReport() {
  const { data: risks, isLoading } = useListRisks({ status: "open" } as any);
  const list = (risks ?? []) as any[];

  const grouped = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const r of list) (m[r.severity] ||= []).push(r);
    return m;
  }, [list]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of list) m[r.severity] = (m[r.severity] ?? 0) + 1;
    return m;
  }, [list]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          All open risks, issues, and suggestions across the team.
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {SEVERITY_ORDER.map((s) => (
            <Badge key={s} variant={sevVariant(s)} className="capitalize">
              {s}: {counts[s] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading…</div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No open items. Nice work.
          </CardContent>
        </Card>
      ) : (
        SEVERITY_ORDER.map((sev) => {
          const rows = grouped[sev] ?? [];
          if (rows.length === 0) return null;
          return (
            <Card key={sev}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base capitalize">
                  {sev} ({rows.length})
                </CardTitle>
                <Badge variant={sevVariant(sev)} className="capitalize">{sev}</Badge>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px] capitalize">{r.type}</Badge>
                          {r.category && (
                            <Badge variant="outline" className="text-[10px] capitalize">{r.category}</Badge>
                          )}
                          <span className="font-medium">{r.title}</span>
                        </div>
                        {r.description && (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3 mt-1">
                            {r.description}
                          </p>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          {r.userName ?? "Unknown"} · opened {format(new Date(r.createdAt), "MMM d, yyyy")}
                        </div>
                      </div>
                      <Link href={`/risks/${r.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
