import { useParams, Link } from "wouter";
import { useGetRisk } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import RiskForm from "@/components/RiskForm";

export default function EditRisk() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");
  const { data: risk, isLoading } = useGetRisk(id);

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-8">Loading...</div>;
  }
  if (!risk) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Risk not found.</p>
        <Link href="/risks">
          <Button variant="ghost" className="mt-4">Back to Risks</Button>
        </Link>
      </div>
    );
  }
  return <RiskForm mode="edit" risk={risk} />;
}
