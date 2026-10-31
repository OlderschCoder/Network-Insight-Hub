import * as React from "react";
import { cn } from "@/lib/utils";
import { Signature } from "./Signature";
import { Logo } from "./Logo";

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
        <header className="flex items-center justify-between border-b border-line pb-5">
          <Logo />
          <span className="text-[13px] font-medium text-ink-muted">
            IT Department Reporting
          </span>
        </header>
        <div className="flex-1 space-y-8">{children}</div>
        <footer className="mt-4 border-t border-line pt-5">
          <Signature />
        </footer>
      </div>
    </div>
  );
}
