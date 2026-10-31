const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");
const SESSION_KEY = "it_hub_usage_session";

export type UsageEventType = "page_view" | "heartbeat" | "fred_message";

export function getUsageSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

export function trackProductUsage(eventType: UsageEventType, path: string, durationSeconds = 0) {
  const token = localStorage.getItem("auth_token");
  if (!token || !path) return;
  void fetch(`${API_BASE}/analytics/events`, {
    method: "POST",
    keepalive: true,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType,
      path: path.split("?")[0].slice(0, 500),
      durationSeconds,
      clientSessionId: getUsageSessionId(),
    }),
  }).catch(() => undefined);
}
