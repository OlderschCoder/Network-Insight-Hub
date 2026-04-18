import { useState } from "react";
import { Link } from "wouter";
import { useListRisks, useUpdateRisk } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

const severityColor: Record<string, string> = {
  critical: "bg-red-600/20 text-red-300 border-red-500/30",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  low: "bg-green-500/20 text-green-300 border-green-500/30",
};

const typeColor: Record<string, string> = {
  risk: "bg-red-500/10 text-red-400 border-red-400/20",
  issue: "bg-amber-500/10 text-amber-400 border-amber-400/20",
  design: "bg-blue-500/10 text-blue-400 border-blue-400/20",
};

export default function Risks() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { data: risks, isLoading } = useListRisks({});
  const updateMutation = useUpdateRisk();

  const filtered = (risks ?? []).filter((r) => {
    const q = search.toLowerCase();
    return (
      r.title?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    );
  });

  const handleStatusToggle = async (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === "open" ? "resolved" : "open";
    await updateMutation.mutateAsync({ id, data: { status: nextStatus as any } });
    queryClient.invalidateQueries({ queryKey: ["/api/risks"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Risks, Issues & Design</h1>
        <Link href="/risks/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Item
          </Button>
        </Link>
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
              className={`transition-colors ${risk.status === "resolved" ? "opacity-60" : "hover:border-primary/50"}`}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className={typeColor[risk.type ?? "risk"] ?? ""}>
                        {risk.type ?? "risk"}
                      </Badge>
                      {risk.severity && (
                        <Badge variant="outline" className={severityColor[risk.severity] ?? ""}>
                          {risk.severity}
                        </Badge>
                      )}
                      <Badge variant={risk.status === "resolved" ? "secondary" : "outline"}>
                        {risk.status}
                      </Badge>
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
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStatusToggle(risk.id, risk.status ?? "open")}
                    disabled={updateMutation.isPending}
                  >
                    {risk.status === "open" ? "Resolve" : "Reopen"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
