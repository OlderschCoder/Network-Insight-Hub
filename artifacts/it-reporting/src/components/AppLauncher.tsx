import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, CornerDownLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getNavGroups, isNavItemActive, type NavItem } from "@/config/nav";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function AppLauncher({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { isCIO } = useAuth();
  const [location, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => getNavGroups(isCIO), [isCIO]);
  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return allItems.filter(
      (it) =>
        it.label.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q) || it.href.includes(q),
    );
  }, [q, allItems]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const go = (href: string) => {
    setLocation(href);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && q && results.length > 0) {
      e.preventDefault();
      go(results[0].href);
    }
  };

  const Tile = ({ item }: { item: NavItem }) => {
    const Icon = item.icon;
    const active = isNavItemActive(item, location);
    return (
      <button
        type="button"
        onClick={() => go(item.href)}
        className={cn(
          "group flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
          "hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40",
          active ? "border-primary/60 bg-primary/5" : "border-border bg-card",
        )}
      >
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-tight">{item.label}</span>
          <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">{item.desc}</span>
        </span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[min(96vw,72rem)] p-0 gap-0 overflow-hidden border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="flex items-baseline gap-2 border-b border-border px-5 pt-4 pb-2">
          <DialogTitle className="text-sm font-semibold">Menu</DialogTitle>
          <span className="text-xs text-muted-foreground">search or browse every page below</span>
        </div>

        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages…"
            aria-label="Search pages"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-[65vh] overflow-auto p-5">
          {q ? (
            results.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No matches for “{query}”.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
                  <span>
                    {results.length} result{results.length === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1">
                    <CornerDownLeft className="h-3 w-3" /> to open
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {results.map((it) => (
                    <Tile key={it.href} item={it} />
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => (
                <div key={g.label} className="space-y-2">
                  <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.label}
                  </h3>
                  <div className="grid gap-2">
                    {g.items.map((it) => (
                      <Tile key={it.href} item={it} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
