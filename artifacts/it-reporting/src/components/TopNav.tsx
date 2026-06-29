import { Link, useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getNavGroups, isNavItemActive, type NavGroup } from "@/config/nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function GroupMenu({ group, location }: { group: NavGroup; location: string }) {
  const groupActive = group.items.some((it) => isNavItemActive(it, location));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "text-white/75 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
            "data-[state=open]:bg-white/15 data-[state=open]:text-white",
            groupActive && "bg-white/10 text-white",
          )}
        >
          {group.label}
          <ChevronDown className="h-3.5 w-3.5 opacity-70 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {group.items.map((it) => {
          const Icon = it.icon;
          const active = isNavItemActive(it, location);
          return (
            <DropdownMenuItem key={it.href} asChild>
              <Link
                href={it.href}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5",
                  active && "bg-accent",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{it.label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{it.desc}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopNav() {
  const { isCIO } = useAuth();
  const [location] = useLocation();
  const groups = getNavGroups(isCIO);

  return (
    <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
      {groups.map((g) => (
        <GroupMenu key={g.label} group={g} location={location} />
      ))}
    </nav>
  );
}
