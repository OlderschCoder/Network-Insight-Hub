import { useParams, Link } from "wouter";
import { useGetEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import EntryForm from "@/components/EntryForm";

export default function EditEntry() {
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

  return <EntryForm mode="edit" entry={entry} />;
}
