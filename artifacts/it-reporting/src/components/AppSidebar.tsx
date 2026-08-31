import { Link, useLocation } from "wouter";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/system";
import { useAuth } from "@/context/AuthContext";
import { getNavGroups, isNavItemActive } from "@/config/nav";

export function AppSidebar() {
  const { isCIO, user } = useAuth();
  const [location] = useLocation();
  const canNetworkTools = ["cio", "network", "network_engineer"].includes(user?.role ?? "");
  const groups = getNavGroups(isCIO, canNetworkTools);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("it_hub_sidebar_groups");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("it_hub_sidebar_groups", JSON.stringify(openGroups));
    } catch {
      /* ignore storage failures */
    }
  }, [openGroups]);

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border/70"
      style={
        {
          "--sidebar-width": "14.5rem",
          "--sidebar-width-icon": "3.4rem",
        } as CSSProperties
      }
    >
      <SidebarHeader className="border-b border-sidebar-border/70 px-3 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/10"
        >
          <Logo variant="white" className="h-7 shrink-0" />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">
              Insights
            </p>
            <p className="truncate text-xs text-sidebar-foreground/70">
              Campus operations, monitoring, and reporting
            </p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        {groups.map((group) => {
          const isOpen = openGroups[group.label] ?? true;
          return (
            <Collapsible
              key={group.label}
              open={isOpen}
              onOpenChange={(open) =>
                setOpenGroups((prev) => ({
                  ...prev,
                  [group.label]: open,
                }))
              }
            >
              <SidebarGroup>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium uppercase tracking-[0.18em] text-sidebar-foreground/70 transition-colors hover:bg-white/5 hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
                  >
                    <SidebarGroupLabel className="p-0 text-inherit">{group.label}</SidebarGroupLabel>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden">
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item, idx) => {
                        const Icon = item.icon;
                        const active = isNavItemActive(item, location);
                        const showSeparator = group.separator?.includes(idx);
                        return (
                          <LinkRow
                            key={item.href}
                            active={active}
                            href={item.href}
                            icon={<Icon className="mt-0.5 h-4 w-4 shrink-0" />}
                            label={item.label}
                            desc={item.desc}
                            badge={item.cioBadge ? "CIO" : item.netBadge ? "NET" : null}
                            showSeparator={showSeparator}
                          />
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70 px-3 py-3 group-data-[collapsible=icon]:hidden">
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/55">
            Signed In
          </p>
          <p className="mt-1 truncate text-sm font-medium text-sidebar-foreground">
            {user?.name ?? "Team Member"}
          </p>
          <p className="truncate text-xs text-sidebar-foreground/70">
            {user?.jobTitle || user?.role || "Authenticated user"}
          </p>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function LinkRow({
  active,
  href,
  icon,
  label,
  desc,
  badge,
  showSeparator,
}: {
  active: boolean;
  href: string;
  icon: ReactNode;
  label: string;
  desc: string;
  badge: string | null;
  showSeparator?: boolean;
}) {
  return (
    <>
      {showSeparator ? (
        <li aria-hidden="true" className="my-1 border-t border-sidebar-border/70" />
      ) : null}
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={label}
          className="h-auto min-h-11 items-start rounded-xl px-2.5 py-2.5"
        >
          <Link href={href}>
            {icon}
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{label}</span>
                {badge ? (
                  <Badge
                    variant="outline"
                    className="h-4 border-white/20 bg-white/5 px-1 text-[10px] text-sidebar-foreground/70"
                  >
                    {badge}
                  </Badge>
                ) : null}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-sidebar-foreground/65">
                {desc}
              </span>
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </>
  );
}
