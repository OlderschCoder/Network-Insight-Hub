import { describe, expect, it } from "vitest";
import {
  buildInfluxLastSeenFlux,
  INFLUX_LAST_SEEN_FIELDS,
} from "./influx_last_seen";

describe("Fred Influx last-seen query", () => {
  it("requests FortiGate health fields as well as reachability fields", () => {
    const flux = buildInfluxLastSeenFlux("telegraf", "172.25.0.1", 60);

    for (const field of [
      "sysUpTime",
      "fgSysCpuUsage",
      "fgSysMemUsage",
      "fgSysSesCount",
      "percent_packet_loss",
    ]) {
      expect(INFLUX_LAST_SEEN_FIELDS).toContain(field);
      expect(flux).toContain(`"${field}"`);
    }
    expect(flux).toContain('r.source == "172.25.0.1"');
    expect(flux).toContain('r.sysName == "172.25.0.1"');
    expect(flux).toContain("range(start: -60m)");
  });

  it("quotes configured values instead of splicing raw Flux", () => {
    const flux = buildInfluxLastSeenFlux(
      'bucket"name',
      'firewall"name',
      30,
    );

    expect(flux).toContain('from(bucket: "bucket\\"name")');
    expect(flux).toContain('r.source == "firewall\\"name"');
  });
});
