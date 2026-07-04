import { BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import guideMarkdown from "@/content/user-guide.md?raw";

export default function UserGuide() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="h-7 w-7" />
          User Guide
        </h1>
        <p className="text-muted-foreground mt-1">
          Step-by-step help for every part of the platform. Ask the AI Assistant
          anything covered here — it knows this guide too.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 md:p-8">
        <article className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-a:text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {guideMarkdown}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
