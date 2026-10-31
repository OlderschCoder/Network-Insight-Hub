import { useEffect } from "react";
import { authFetch } from "@/lib/authFetch";

/**
 * Loads the official Zendesk Web Widget (the floating chat bubble) on every
 * authenticated page. The embed key comes from the backend (`ZENDESK_WIDGET_KEY`)
 * so it can be configured without rebuilding the frontend. No-ops when no key is
 * set. Mounted once inside <Layout> so it follows the user across the app.
 */
export function ZendeskChatWidget() {
  useEffect(() => {
    let cancelled = false;
    if (document.getElementById("ze-snippet")) return;

    authFetch(`${import.meta.env.BASE_URL}api/zendesk/widget-config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { enabled?: boolean; key?: string | null } | null) => {
        if (cancelled || !cfg?.enabled || !cfg.key) return;
        if (document.getElementById("ze-snippet")) return;
        const s = document.createElement("script");
        s.id = "ze-snippet";
        s.async = true;
        s.src = `https://static.zdassets.com/ekr/snippet.js?key=${encodeURIComponent(cfg.key)}`;
        document.body.appendChild(s);
      })
      .catch(() => {
        /* widget is best-effort; ignore load failures */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
