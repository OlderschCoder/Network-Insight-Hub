import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Expand, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { ChatTab as FredChat } from "@/pages/ai-report";

/** Reuses Fred's authenticated chat, history and guarded actions on every page. */
export function FredAssistant({ path, label }: { path: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);

  if (path === "/ai-report") return null;
  return <>
    <Button ref={trigger} type="button" size="sm" aria-expanded={open} aria-controls="fred-page-assistant"
      onClick={() => { setMounted(true); setOpen(value => !value); }}>
      <Sparkles className="mr-1.5 h-4 w-4" /> Ask Fred
    </Button>
    {mounted && <aside id="fred-page-assistant" aria-label="Fred page assistant" hidden={!open}
      className={`${open ? "flex" : "hidden"} fixed inset-y-0 right-0 z-40 w-full flex-col border-l bg-background text-foreground shadow-2xl sm:w-[min(38rem,90vw)]`}>
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div><h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Fred</h2>
          <p className="text-xs text-muted-foreground">Ask about this page, find information, or record an update</p></div>
        <div className="flex gap-1">
          <Button asChild variant="ghost" size="icon"><Link href={`/ai-report?from=${encodeURIComponent(path)}`} aria-label="Open Fred workspace"><Expand className="h-4 w-4" /></Link></Button>
          <Button ref={closeButton} type="button" variant="ghost" size="icon" onClick={close} aria-label="Close Fred"><X className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
          <FredChat compact pagePath={path} contextHint={label} />
      </div>
    </aside>}
  </>;
}
