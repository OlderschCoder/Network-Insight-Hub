import * as React from "react";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-brand border border-line bg-surface p-5 shadow-brand",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        {icon ? <span className="text-brand">{icon}</span> : null}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-[-0.02em] tabular-nums text-ink">
        {value}
      </div>
      {hint ? <div className="mt-1 text-sm text-ink-muted">{hint}</div> : null}
    </div>
  );
}
