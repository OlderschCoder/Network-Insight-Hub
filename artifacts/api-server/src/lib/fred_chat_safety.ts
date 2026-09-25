/**
 * Tools that can persist data, change an external record, or start a collector.
 * Observation-only callers (for example, the near-live camera loop) must never
 * expose these tools to the model.
 */
export const OBSERVATION_ONLY_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "save_memory",
  "create_task",
  "save_shadow_note",
  "upsert_switch",
  "upsert_vlan",
  "switch_telemetry_from_noc",
  "create_formal_ea_actions",
  "update_architecture_element",
  "zendesk_add_comment",
  "zendesk_update_ticket",
  // A timed background image loop may read existing evidence but must not
  // launch active probes or scans every time its timer fires.
  "ping_host",
  "test_net_connection",
  "scan_network",
  "probe_via_noc",
  "webex_device_status",
  "dns_lookup",
  "traceroute",
  "http_check",
  "ssl_check",
  "snmp_get",
]);

/**
 * Passive evidence reads that are safe for timer-driven/background Fred calls.
 * This is intentionally an allow-list: a future tool is denied until someone
 * has reviewed it, instead of silently becoming available to an unattended
 * model call.
 */
export const OBSERVATION_ONLY_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "query_azure_vm",
  "query_azure_security",
  "query_azure_health",
  "query_azure_policy",
  "query_azure_resources",
  "list_accessible_files",
  "read_accessible_file",
  "query_device_config",
  "search_team_work",
  "zendesk_get_ticket",
  "zendesk_search_tickets",
  "cisco_calling_support",
  "query_network_map",
  "query_switch_ports",
  "query_building_network",
  "query_network_monitoring",
  "query_influx_last_seen",
  "grafana_panel_link",
  "query_architecture_snapshot",
  "query_formal_architecture",
]);

export function isFredToolAllowed(
  toolName: string,
  readOnly: boolean,
): boolean {
  return !readOnly || OBSERVATION_ONLY_ALLOWED_TOOLS.has(toolName);
}

/** An omitted preview preference must never be interpreted as write approval. */
export function inventoryPreviewEnabled(
  previewInventory?: boolean,
): boolean {
  return previewInventory !== false;
}
