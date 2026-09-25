import { describe, expect, it } from "vitest";
import {
  OBSERVATION_ONLY_ALLOWED_TOOLS,
  OBSERVATION_ONLY_BLOCKED_TOOLS,
  inventoryPreviewEnabled,
  isFredToolAllowed,
} from "./fred_chat_safety";

describe("Fred observation-only tool policy", () => {
  it.each([
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
  ])("blocks mutating or collection tool %s", (toolName) => {
    expect(OBSERVATION_ONLY_BLOCKED_TOOLS.has(toolName)).toBe(true);
    expect(isFredToolAllowed(toolName, true)).toBe(false);
  });

  it.each([
    "query_network_map",
    "query_switch_ports",
    "query_network_monitoring",
    "query_influx_last_seen",
    "read_accessible_file",
  ])("retains read-only evidence tool %s", (toolName) => {
    expect(OBSERVATION_ONLY_ALLOWED_TOOLS.has(toolName)).toBe(true);
    expect(isFredToolAllowed(toolName, true)).toBe(true);
  });

  it("fails closed for a future unreviewed tool", () => {
    expect(isFredToolAllowed("future_mutating_tool", true)).toBe(false);
  });

  it("does not restrict an interactive chat", () => {
    expect(isFredToolAllowed("upsert_switch", false)).toBe(true);
    expect(isFredToolAllowed("switch_telemetry_from_noc", false)).toBe(true);
  });

  it("fails closed to inventory preview when the caller omits a preference", () => {
    expect(inventoryPreviewEnabled()).toBe(true);
    expect(inventoryPreviewEnabled(true)).toBe(true);
    expect(inventoryPreviewEnabled(false)).toBe(false);
  });
});
