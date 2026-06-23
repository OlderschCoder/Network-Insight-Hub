import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
  {
    variants: {
      tone: {
        brand: "bg-brand/14 text-[color:var(--forest-2)]",
        neutral: "bg-paper text-ink-muted border border-line",
        warning: "bg-amber-100 text-amber-800",
        danger: "bg-red-100 text-red-700",
      },
    },
    defaultVariants: {
      tone: "brand",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

type StatusKind = "live" | "neutral" | "warning" | "danger";

const dotColors: Record<StatusKind, string> = {
  live: "bg-brand",
  neutral: "bg-ink-muted",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

export function StatusPill({
  status = "neutral",
  children,
  className,
}: {
  status?: StatusKind;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink",
        className,
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          dotColors[status],
          status === "live" && "animate-pulse",
        )}
      />
      {children}
    </span>
  );
}

export { badgeVariants };
