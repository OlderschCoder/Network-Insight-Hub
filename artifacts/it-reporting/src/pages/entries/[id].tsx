import { useParams, Link } from "wouter";
import { useGetEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";

const categoryColor: Record<string, string> = {
  helpdesk: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  network: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  security: "bg-red-500/20 text-red-300 border-red-500/30",
  general: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

function Section({ title, content }: { title: string; content?: string | null }) {
  if (!content) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-muted-foreground mb-1">{title}</p>
      <p className="whitespace-pre-wrap text-sm">{content}</p>
    </div>
  );
}

export default function EntryDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");

  const { data: entry, isLoading } = useGetEntry(id);

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-8">Loading...</div>;
  }

  if (!entry) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Entry not found.</p>
        <Link href="/entries">
          <Button variant="ghost" className="mt-4">Back to Entries</Button>
        </Link>
      </div>
    );
  }

  const e = entry as any;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/entries">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex-1 truncate">{e.title}</h1>
        {e.category && (
          <Badge variant="outline" className={categoryColor[e.category] ?? ""}>
            {e.category}
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              {e.entryDate ? format(new Date(e.entryDate), "MMMM d, yyyy") : `Week of ${e.weekOf}`}
            </span>
            {e.userName && <span>By: {e.userName}</span>}
            {e.ticketCount != null && e.ticketCount > 0 && (
              <span>{e.ticketCount} ticket{e.ticketCount !== 1 ? "s" : ""} resolved</span>
            )}
          </div>

          <Section title="Description" content={e.description} />
          <Section title="Accomplishments" content={e.accomplishments} />
          <Section title="Challenges" content={e.challenges} />
          <Section title="Support Needed" content={e.supportNeeded} />
        </CardContent>
      </Card>
    </div>
  );
}
