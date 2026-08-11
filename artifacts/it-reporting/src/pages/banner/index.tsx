import { ExternalLink, GraduationCap, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import reportMarkdown from "@/content/banner/corrected-report.md?raw";
import procedureMarkdown from "@/content/banner/operating-procedure.md?raw";
import changeLogMarkdown from "@/content/banner/change-log.md?raw";

const LIVE_REPORT_URL =
  "https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning";

function DocumentPanel({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 md:p-8">
      <article className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-a:text-primary prose-table:block prose-table:overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </div>
  );
}

export default function Banner() {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <GraduationCap className="h-7 w-7" />
            Banner
          </h1>
          <p className="mt-1 text-muted-foreground">
            Student provisioning status, operating guidance, and complete change history.
          </p>
        </div>
        <Button asChild>
          <a href={LIVE_REPORT_URL} target="_blank" rel="noreferrer">
            Open live EUP report
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>

      <div className="flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="text-sm">
          <p className="font-semibold">Entra is the required gate for Google.</p>
          <p className="text-muted-foreground">
            The process will not create a student Google account until the matching enabled Entra account and 800 number are verified.
          </p>
        </div>
      </div>

      <Tabs defaultValue="report" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3">
          <TabsTrigger value="report">Corrected Report</TabsTrigger>
          <TabsTrigger value="procedure">Operating Procedure</TabsTrigger>
          <TabsTrigger value="changes">Full Change Log</TabsTrigger>
        </TabsList>
        <TabsContent value="report"><DocumentPanel content={reportMarkdown} /></TabsContent>
        <TabsContent value="procedure"><DocumentPanel content={procedureMarkdown} /></TabsContent>
        <TabsContent value="changes"><DocumentPanel content={changeLogMarkdown} /></TabsContent>
      </Tabs>
    </div>
  );
}
