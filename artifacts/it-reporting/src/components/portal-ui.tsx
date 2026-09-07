import type { ComponentType, ReactNode } from "react";
import { Home, LifeBuoy, Map, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export type PortalMode = "status" | "network" | "support";

export function portalModeForPath(pathname: string): PortalMode {
  if (
    pathname.startsWith("/network") ||
    pathname.startsWith("/monitoring") ||
    pathname.startsWith("/azure") ||
    pathname.startsWith("/it-apps/cisco-calling")
  ) {
    return "network";
  }
  if (
    pathname.startsWith("/support") ||
    pathname.startsWith("/incidents") ||
    pathname.startsWith("/learn") ||
    pathname.startsWith("/processes")
  ) {
    return "support";
  }
  return "status";
}

const appModes: Record<
  PortalMode,
  Array<{
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }>
> = {
  status: [
    { href: "/", label: "Home", icon: Home },
    { href: "/status", label: "Status", icon: Sparkles },
    { href: "/support", label: "Support", icon: LifeBuoy },
  ],
  network: [
    { href: "/", label: "Home", icon: Home },
    { href: "/network", label: "IT Tools", icon: Map },
    { href: "/support", label: "Support", icon: LifeBuoy },
  ],
  support: [
    { href: "/", label: "Home", icon: Home },
    { href: "/network", label: "IT Tools", icon: Map },
    { href: "/support", label: "Support", icon: LifeBuoy },
  ],
};

export function AppModeSwitcher({ pathname }: { pathname: string }) {
  const mode = portalModeForPath(pathname);
  return (
    <nav
      aria-label="Switch portal app"
      className="mx-2 grid grid-cols-3 gap-1 rounded-lg bg-black/20 p-1"
    >
      {appModes[mode].map(({ href, label, icon: Icon }) => {
        const active =
          href === "/status"
            ? mode === "status"
            : href === "/network"
              ? mode === "network"
              : href === "/support"
                ? mode === "support"
                : false;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 py-2 text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
              active
                ? "bg-white/15 text-white"
                : "text-white/45 hover:bg-white/10 hover:text-white/80",
            )}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Breadcrumb({ app, page }: { app: string; page: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-xs text-white/50"
    >
      <Link href="/" className="shrink-0 transition-colors hover:text-white">
        IT Portal
      </Link>
      <span aria-hidden="true" className="text-white/25">
        ›
      </span>
      <span className="hidden shrink-0 sm:inline">{app}</span>
      <span aria-hidden="true" className="hidden text-white/25 sm:inline">
        ›
      </span>
      <span className="truncate font-semibold text-white/90">{page}</span>
    </nav>
  );
}

export type PortalHealth = "operational" | "degraded" | "outage";

const healthClasses: Record<PortalHealth, string> = {
  operational: "bg-[var(--status-green)]",
  degraded: "bg-[var(--status-amber)]",
  outage: "bg-[var(--status-red)]",
};

export function StatusDot({
  status,
  label,
  service,
  className,
}: {
  status: PortalHealth;
  label?: string;
  service?: string;
  className?: string;
}) {
  const fallback =
    status === "operational"
      ? "Operational"
      : status === "degraded"
        ? "Degraded"
        : "Outage";
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs", className)}>
      <span
        className={cn(
          "h-[7px] w-[7px] shrink-0 rounded-full",
          healthClasses[status],
        )}
        aria-hidden="true"
      />
      {service ? (
        <strong className="font-semibold text-foreground">{service}</strong>
      ) : null}
      <span className="text-muted-foreground">{label ?? fallback}</span>
    </span>
  );
}

const avatarTones = [
  "bg-emerald-600",
  "bg-teal-600",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-amber-700",
];

export function UserAvatar({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const safeName = name?.trim() || "Team Member";
  const initials = safeName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const tone = avatarTones[safeName.length % avatarTones.length];
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
        tone,
        className,
      )}
      aria-label={safeName}
    >
      {initials || "IT"}
    </span>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
      {children}
    </p>
  );
}

export function FredChip({ from }: { from: string }) {
  return (
    <Link
      href={`/ai-report?from=${encodeURIComponent(from)}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[var(--primary-hover)]"
    >
      <Sparkles className="h-3.5 w-3.5" /> Fred
    </Link>
  );
}
