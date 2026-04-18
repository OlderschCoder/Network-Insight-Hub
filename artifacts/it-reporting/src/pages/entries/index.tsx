import { useState } from "react";
import { Link } from "wouter";
import { useListEntries, useDeleteEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { Plus, Search, Trash2, Eye } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";

const categoryColor: Record<string, string> = {
  helpdesk: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  network: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  security: "bg-red-500/20 text-red-300 border-red-500/30",
  general: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

export default function Entries() {
  const [search, setSearch] = useState("");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: entries, isLoading } = useListEntries({});
  const deleteMutation = useDeleteEntry();

  const filtered = (entries ?? []).filter((e: any) => {
    const q = search.toLowerCase();
    return (
      e.title?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q)
    );
  });

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this entry?")) return;
    await deleteMutation.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Log Entries</h1>
        <Link href="/entries/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Entry
          </Button>
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search entries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No entries found. Create your first log entry.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry: any) => (
            <Card key={entry.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm text-muted-foreground">
                        {entry.entryDate ? format(new Date(entry.entryDate), "MMM d, yyyy") : entry.weekOf}
                      </span>
                      {entry.category && (
                        <Badge
                          variant="outline"
                          className={categoryColor[entry.category] ?? ""}
                        >
                          {entry.category}
                        </Badge>
                      )}
                      {entry.ticketCount != null && entry.ticketCount > 0 && (
                        <Badge variant="secondary">
                          {entry.ticketCount} ticket{entry.ticketCount !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    <p className="font-medium truncate">{entry.title}</p>
                    {entry.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {entry.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`/entries/${entry.id}`}>
                      <Button variant="ghost" size="icon" title="View">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                    {(user?.role === "cio" || entry.userId === user?.id) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => handleDelete(entry.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
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
