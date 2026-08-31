export type FredEvidencePolicy = { toolNames: string[]; minimumCalls: number; reason: string } | null;

export function latestUserText(messages: Array<{ role?: string; content?: unknown }>): string {
  const message = [...messages].reverse().find(m => m?.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return message.content.map((p: any) => typeof p?.text === "string" ? p.text : "").join(" ");
  return "";
}

export function evidencePolicyFor(text: string): FredEvidencePolicy {
  const q = text.toLowerCase();
  const incident = /\b(down|offline|outage|broken|failed|failing|timeout|timing out|unreachable|not working|no wifi|no wi-fi|degraded|issue|problem)\b/.test(q);
  if (/\b(phone|phones|calling|webex|e-?911)\b/.test(q)) return { toolNames: ["cisco_calling_support", "query_building_network", "query_network_monitoring", "webex_device_status"], minimumCalls: 2, reason: "phone/service evidence must be cross-checked against building or device state" };
  if (/\b(azure|vm|virtual machine|resource health|defender|cloudapp)\b/.test(q) || /\bapp-server\d*\b/.test(q)) return { toolNames: ["query_azure_health", "query_azure_vm", "query_azure_resources", "query_azure_security", "http_check"], minimumCalls: incident ? 2 : 1, reason: "Azure claims require current platform and resource evidence" };
  if (/\b(zendesk|ticket|tickets)\b/.test(q)) return { toolNames: ["zendesk_get_ticket", "zendesk_search_tickets", "search_team_work"], minimumCalls: 1, reason: "ticket questions require the current ticket/work record" };
  if (/\b(switch|port|vlan|network|wifi|wi-fi|building|uplink|downlink|nexus|aruba|cisco|sfp|fiber|trunk|lacp|lldp|subnet|gateway|ping|latency|packet loss|interface|console)\b/.test(q) || incident) return { toolNames: ["query_network_monitoring", "query_network_map", "query_switch_ports", "query_building_network", "query_device_config", "query_influx_last_seen", "ping_host", "snmp_get", "probe_via_noc", "cisco_calling_support"], minimumCalls: 2, reason: "operational network claims require current state plus a corroborating path/service/baseline signal" };
  if (/\b(config|configuration|known good|known-good|backup)\b/.test(q)) return { toolNames: ["query_device_config", "search_team_work"], minimumCalls: 1, reason: "configuration claims require the stored baseline" };
  return null;
}
