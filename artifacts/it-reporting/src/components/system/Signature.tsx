import { cn } from "@/lib/utils";

export function Monogram({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-forest text-brand-soft text-sm font-semibold tracking-tight",
        className,
      )}
      aria-hidden="true"
    >
      MB
    </span>
  );
}

export function Signature({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Monogram />
      <span className="text-[13px] text-ink-muted">
        Built by Dr. Mark Bojeun · SCCC IT
      </span>
    </div>
  );
}
