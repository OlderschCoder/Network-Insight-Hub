import { ExternalLink, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

const configuredUrl = (import.meta.env.VITE_STUDENT_ACCESS_URL as string | undefined)?.replace(/\/$/, "");
const STUDENT_ACCESS_BASE_URL =
  configuredUrl?.replace(/\/(?:kiosk|student-start)$/, "") ||
  "https://app-server2.centralus.cloudapp.azure.com:8443";
const STUDENT_ACCESS_URL = `${STUDENT_ACCESS_BASE_URL}/student-start`;

export default function StudentAccess() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <KeyRound className="h-7 w-7" /> High School Student Access
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Student self-service and staff-assisted Microsoft Entra Temporary Access Pass issuance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`${STUDENT_ACCESS_BASE_URL}/testing-guide`} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Tester guide
            </a>
          </Button>
          <Button asChild size="sm">
            <a href={STUDENT_ACCESS_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Open High School Student Access
            </a>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
        Microsoft sign-in opens in the full browser window because Entra does not permit its login
        page inside an embedded frame. After signing in, return to the IT Hub to continue here.
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <iframe
          src={STUDENT_ACCESS_URL}
          title="SCCC High School Student Access"
          allow="clipboard-write"
          className="h-[calc(100vh-13rem)] min-h-[720px] w-full border-0"
        />
      </div>
    </div>
  );
}
