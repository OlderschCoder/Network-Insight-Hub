import type { DashboardSummary } from "@workspace/api-client-react";
import { PhoneIncoming } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";

type Props = {
  summary?: DashboardSummary;
  isError?: boolean;
};

export default function ItHuntGroupCard({ summary, isError = false }: Props) {
  const configured = summary?.itHuntGroupConfigured ?? false;
  const calls = summary?.itHuntGroupCalls ?? 0;
  const answered = summary?.itHuntGroupAnswered ?? 0;
  const unanswered = summary?.itHuntGroupUnanswered ?? 0;
  const answerRate = summary?.itHuntGroupAnswerRate ?? 0;
  const windowHours = summary?.itHuntGroupWindowHours ?? 24;
  const extension = summary?.itHuntGroupExtension ?? "1200";
  const error = summary?.itHuntGroupError;

  let value = "—";
  let detail = "Couldn't load stats";

  if (!isError) {
    if (!configured) {
      detail = "Webex calling not configured";
    } else if (error) {
      detail = error;
    } else if (calls === 0) {
      value = "0 / 0";
      detail = `No calls in the last ${windowHours}h`;
    } else {
      value = `${answered} / ${calls}`;
      detail = `${unanswered} unanswered • ${answerRate}% answer rate`;
    }
  }

  return (
    <Link href="/it-apps/webex-calling" className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-primary">
    <Card className="h-full transition-colors hover:border-primary/60 hover:bg-accent/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">IT Calls ({extension})</CardTitle>
        <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{detail}</p>
        <p className="mt-3 text-xs font-medium text-primary">View calling report</p>
      </CardContent>
    </Card>
    </Link>
  );
}
