import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListProcesses } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, BookOpen, Search, ChevronRight } from "lucide-react";
import { format } from "date-fns";

export const PROCESS_CATEGORIES = [
  { value: "onboarding", label: "Onboarding" },
  { value: "offboarding", label: "Offboarding" },
  { value: "email", label: "Email" },
  { value: "access", label: "Access & Accounts" },
  { value: "network", label: "Network" },
  { value: "security", label: "Security" },
  { value: "helpdesk", label: "Help Desk" },
  { value: "general", label: "General" },
];

export default function ProcessesIndex() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");

  const params: any = {};
  if (q.trim()) params.q = q.trim();
  if (category !== "all") params.category = category;

  const { data: processes, isLoading } = useListProcesses(params);
  const list = (processes ?? []) as any[];

  const grouped = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const p of list) (m[p.category || "general"] ||= []).push(p);
    return m;
  }, [list]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Process Library</h1>
          <p className="text-sm text-muted-foreground">
            Standard procedures for common IT tasks (onboarding, offboarding, email lookups, etc.).
          </p>
        </div>
        <Link href="/processes/new">
          <Button><Plus className="h-4 w-4 mr-2" /> New Process</Button>
        </Link>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, summary, or steps…"
            className="pl-8"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {PROCESS_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading…</div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <BookOpen className="h-8 w-8 mx-auto opacity-50" />
            <p>{q || category !== "all" ? "No processes match your filters." : "No processes yet."}</p>
            <Link href="/processes/new">
              <Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-2" /> Create the first one</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => {
            const label = PROCESS_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
            return (
              <div key={cat}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {label} ({items.length})
                </h2>
                <div className="space-y-2">
                  {items.map((p: any) => (
                    <Link key={p.id} href={`/processes/${p.id}`}>
                      <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                        <CardContent className="py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{p.title}</p>
                            {p.summary && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{p.summary}</p>
                            )}
                            <div className="flex gap-2 mt-1 flex-wrap">
                              {(p.tags ?? []).map((t: string) => (
                                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-muted-foreground hidden md:block">
                              Updated {format(new Date(p.updatedAt), "MMM d, yyyy")}
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
