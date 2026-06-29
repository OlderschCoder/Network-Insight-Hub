import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, BellOff, Ticket, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/authFetch";

interface ActivityItem {
  id: number;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

interface ActivityResp {
  configured: boolean;
  latestUpdatedAt: string | null;
  items: ActivityItem[];
}

const POLL_MS = 30_000;
const MUTE_KEY = "zendesk_alerts_muted";

/**
 * Plays a loud, attention-grabbing two-tone alert using the Web Audio API so we
 * don't need to ship an audio asset. A shared AudioContext is unlocked on the
 * first user gesture (browsers block audio until then).
 */
function useAlertSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    return ctxRef.current;
  }, []);

  useEffect(() => {
    const unlock = () => {
      const ctx = getCtx();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [getCtx]);

  return useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // Three urgent beeps alternating high/low, loud (gain ~0.9).
    const tones = [
      { f: 988, t: 0.0 },
      { f: 740, t: 0.22 },
      { f: 988, t: 0.44 },
    ];
    for (const { f, t } of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      const start = now + t;
      const dur = 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.9, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
  }, [getCtx]);
}

/**
 * Always-visible Zendesk activity watcher in the top bar. Polls the team's open
 * tickets and, when the newest update advances (a new ticket or a new reply),
 * plays a loud sound and shows a toast. Includes a mute toggle and a list of
 * recent items that deep-link into Zendesk.
 */
export function ZendeskAlerts() {
  const { toast } = useToast();
  const playAlert = useAlertSound();

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState<boolean>(
    () => localStorage.getItem(MUTE_KEY) === "1",
  );

  const lastSeenRef = useRef<string | null>(null);
  const baselineSetRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const toggleMute = (next: boolean) => {
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const r = await authFetch(
          `${import.meta.env.BASE_URL}api/zendesk/recent-activity`,
        );
        const body: ActivityResp | null = await r.json().catch(() => null);
        if (cancelled || !body) return;

        if (!r.ok || !body.configured) {
          setConfigured(body?.configured ?? false);
          return;
        }
        setConfigured(true);
        setItems(body.items);

        const latest = body.latestUpdatedAt;
        if (!baselineSetRef.current) {
          // First successful poll establishes the baseline silently.
          lastSeenRef.current = latest;
          baselineSetRef.current = true;
          return;
        }
        if (latest && (!lastSeenRef.current || latest > lastSeenRef.current)) {
          const prev = lastSeenRef.current;
          const fresh = body.items.filter((i) => !prev || i.updatedAt > prev);
          lastSeenRef.current = latest;
          if (fresh.length > 0) {
            setUnseen((c) => c + fresh.length);
            if (!mutedRef.current) playAlert();
            toast({
              title: `${fresh.length} new Zendesk update${fresh.length === 1 ? "" : "s"}`,
              description: fresh[0]?.subject?.slice(0, 80) || "New ticket activity",
            });
          }
        }
      } catch {
        /* network blips are non-fatal; next tick retries */
      }
    };

    poll();
    timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Don't render anything if Zendesk isn't configured at all.
  if (configured === false) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setUnseen(0);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative h-9 w-9 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          aria-label="Zendesk alerts"
        >
          {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unseen > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
              {unseen > 99 ? "99+" : unseen}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Ticket className="h-4 w-4" /> Zendesk Activity
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            Sound
            <Switch checked={!muted} onCheckedChange={(v) => toggleMute(!v)} />
          </label>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No open tickets right now.
            </p>
          ) : (
            items.map((t) => (
              <a
                key={t.id}
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 border-b px-4 py-3 text-sm last:border-b-0 hover:bg-muted"
              >
                <span className="flex-1">
                  <span className="line-clamp-2 font-medium">{t.subject}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    #{t.id} · {t.status} · {new Date(t.updatedAt).toLocaleString()}
                  </span>
                </span>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
