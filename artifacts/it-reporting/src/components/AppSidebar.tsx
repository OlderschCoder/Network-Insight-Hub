import { Link, useLocation } from "wouter";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
} from "@/components/ui/sidebar";
import { Logo } from "@/components/system";
import { useAuth } from "@/context/AuthContext";
import { getNavGroups, isNavItemActive } from "@/config/nav";
import { AppModeSwitcher, UserAvatar } from "@/components/portal-ui";

export function AppSidebar() {
  const { isCIO, user } = useAuth();
  const [location] = useLocation();
  const canNetworkTools = ["cio", "network", "network_engineer"].includes(
    user?.role ?? "",
  );
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
      window.localStorage.setItem(
        "it_hub_sidebar_groups",
        JSON.stringify(openGroups),
      );
    } catch {
      /* ignore storage failures */
    }
  }, [openGroups]);

  return (
    <Sidebar
      collapsible="none"
      className="border-r border-sidebar-border/70"
      style={
        {
          "--sidebar-width": "16rem",
        } as CSSProperties
      }
    >
      <SidebarHeader className="border-b border-sidebar-border/70 px-3 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/10"
        >
          <Logo
            variant="white"
            className="h-7 w-20 shrink-0 object-contain object-left"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-sidebar-foreground">
              SCCC IT
            </p>
            <p className="text-[9px] uppercase tracking-[0.12em] text-sidebar-foreground/45">
              Department Portal
            </p>
          </div>
        </Link>
        <AppModeSwitcher pathname={location} />
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        {groups.map((group) => {
          const isOpen = openGroups[group.label] ?? true;
          const groupActive = group.items.some((item) =>
            isNavItemActive(item, location),
          );
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
                <div className="group flex w-full items-center rounded-md text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/35 transition-colors hover:bg-white/5 hover:text-sidebar-foreground">
                  <Link
                    href={group.href}
                    className={`min-w-0 flex-1 rounded-l-md px-2 py-1.5 ${groupActive ? "text-sidebar-foreground" : "text-inherit"}`}
                    title={`Open ${group.label}`}
                  >
                    <SidebarGroupLabel className="cursor-pointer p-0 text-inherit">
                      {group.label}
                    </SidebarGroupLabel>
                  </Link>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 w-8 items-center justify-center rounded-r-md text-inherit hover:bg-white/10"
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${group.label}`}
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                      />
                    </button>
                  </CollapsibleTrigger>
                </div>
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
                            badge={
                              item.newBadge
                                ? "NEW"
                                : item.cioBadge
                                  ? "CIO"
                                  : item.netBadge
                                    ? "NET"
                                    : null
                            }
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

      <SidebarFooter className="border-t border-sidebar-border/70 px-3 py-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <UserAvatar name={user?.name} />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-sidebar-foreground">
              {user?.name ?? "Team Member"}
            </p>
            <p className="truncate text-[10px] text-sidebar-foreground/40">
              {user?.jobTitle || user?.role || "Authenticated user"}
            </p>
          </div>
        </div>
      </SidebarFooter>
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
        <li
          aria-hidden="true"
          className="my-1 border-t border-sidebar-border/70"
        />
      ) : null}
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={label}
          className="h-auto min-h-11 items-start rounded-lg px-3 py-2"
        >
          <Link href={href}>
            {icon}
            <span className="min-w-0 flex-1 !overflow-visible !text-clip !whitespace-normal">
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-medium leading-4">
                  {label}
                </span>
                {badge ? (
                  <Badge
                    variant="outline"
                    className="h-4 border-white/20 bg-white/5 px-1 text-[10px] text-sidebar-foreground/70"
                  >
                    {badge}
                  </Badge>
                ) : null}
              </span>
              <span className="mt-0.5 block !overflow-visible !text-clip !whitespace-normal text-[11px] leading-4 text-sidebar-foreground/35">
                {desc}
              </span>
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </>
  );
}
