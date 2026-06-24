import { useState } from "react";
import { Link } from "wouter";
import { useListRisks, useUpdateRisk, useListProjects } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Search, Pencil, Download } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { RISK_CATEGORIES } from "@/components/RiskForm";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const severityColor: Record<string, string> = {
  critical: "bg-red-500/10 text-red-700 border-red-200",
  high: "bg-orange-500/10 text-orange-700 border-orange-200",
  medium: "bg-yellow-500/10 text-yellow-700 border-yellow-200",
  low: "bg-green-500/10 text-green-700 border-green-200",
};

const typeColor: Record<string, string> = {
  risk: "bg-red-500/10 text-red-700 border-red-200",
  issue: "bg-amber-500/10 text-amber-700 border-amber-200",
  design: "bg-blue-500/10 text-blue-700 border-blue-200",
};

const probabilityColor: Record<string, string> = {
  critical: "bg-purple-500/10 text-purple-700 border-purple-200",
  high: "bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-200",
  medium: "bg-sky-500/10 text-sky-700 border-sky-200",
  low: "bg-muted text-muted-foreground border-border",
};

const catLabel = (val?: string) =>
  RISK_CATEGORIES.find((c) => c.value === val)?.label || val || "Other";

export default function Risks() {
  const [search, setSearch] = useState("");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: risks, isLoading } = useListRisks({});
  const { data: projects } = useListProjects();
  const projectMap = new Map<number, string>(
    ((projects ?? []) as any[]).map((p) => [p.id, p.title]),
  );
  const updateMutation = useUpdateRisk();

  const filtered = (risks ?? []).filter((r) => {
    const q = search.toLowerCase();
    return (
      r.title?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    );
  });

  const handleStatusToggle = async (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === "open" ? "mitigated" : "open";
    await updateMutation.mutateAsync({ id, data: { status: nextStatus as any } });
    queryClient.invalidateQueries({ queryKey: ["/api/risks"] });
  };

  const { toast } = useToast();
  const handleExport = async (type: "pdf" | "docx") => {
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/export/risks/${type}?scope=open`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `risk-register-open.${type}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Risks, Issues & Design</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => handleExport("pdf")}>
            <Download className="h-4 w-4 mr-2" /> Export PDF
          </Button>
          <Button variant="outline" onClick={() => handleExport("docx")}>
            <Download className="h-4 w-4 mr-2" /> Export Word
          </Button>
          <Link href="/risks/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Item
            </Button>
          </Link>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">No items found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((risk) => (
            <Card
              key={risk.id}
              className={`transition-colors ${risk.status === "closed" ? "opacity-60" : "hover:border-primary/50"}`}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <Link href={`/risks/${risk.id}`} className="flex-1 min-w-0 cursor-pointer">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className={typeColor[risk.type ?? "risk"] ?? ""}>
                        {risk.type ?? "risk"}
                      </Badge>
                      {(risk as any).category && (
                        <Badge variant="outline">{catLabel((risk as any).category)}</Badge>
                      )}
                      {risk.severity && (
                        <Badge variant="outline" className={severityColor[risk.severity] ?? ""}>
                          impact: {risk.severity}
                        </Badge>
                      )}
                      {(risk as any).probability && (
                        <Badge
                          variant="outline"
                          className={probabilityColor[(risk as any).probability] ?? ""}
                        >
                          prob: {(risk as any).probability}
                        </Badge>
                      )}
                      <Badge variant={risk.status === "closed" || risk.status === "mitigated" ? "secondary" : "outline"}>
                        {risk.status}
                      </Badge>
                      {(risk as any).projectId && projectMap.has((risk as any).projectId) && (
                        <Link href={`/projects/${(risk as any).projectId}`}>
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-700 border-amber-200 hover:bg-amber-500/10 cursor-pointer"
                          >
                            Blocking: {projectMap.get((risk as any).projectId)}
                          </Badge>
                        </Link>
                      )}
                    </div>
                    <p className="font-medium">{risk.title}</p>
                    {risk.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {risk.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {format(new Date(risk.createdAt), "MMM d, yyyy")}
                    </p>
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    {(user?.role === "cio" || (risk as any).userId === user?.id) && (
                      <Link href={`/risks/${risk.id}/edit`}>
                        <Button variant="ghost" size="icon" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusToggle(risk.id, risk.status ?? "open")}
                      disabled={updateMutation.isPending}
                    >
                      {risk.status === "open" ? "Mitigate" : "Reopen"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
