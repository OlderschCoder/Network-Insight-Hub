import * as React from "react";
import { cn } from "@/lib/utils";
import { Signature } from "./Signature";

export function AppShell({
  children,
  className,
  contentClassName,
}: {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("min-h-full bg-paper text-ink", className)}>
      <div
        className={cn(
          "mx-auto flex min-h-full max-w-6xl flex-col gap-8 px-6 py-8",
          contentClassName,
        )}
      >
        <div className="flex-1 space-y-8">{children}</div>
        <footer className="mt-4 border-t border-line pt-5">
          <Signature />
        </footer>
      </div>
    </div>
  );
}
