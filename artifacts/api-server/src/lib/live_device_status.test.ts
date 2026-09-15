import { describe, expect, it } from "vitest";
import { selectFreshDeviceStatus } from "./live_device_status";

describe("live device status selection", () => {
  const now = "2026-09-14T18:00:00Z";

  it("gives a completed NOC probe priority over Influx", () => {
    expect(
      selectFreshDeviceStatus({
        now,
        nocStatus: "down",
        influx: { status: "up", lastSeen: "2026-09-14T17:59:55Z" },
      }),
    ).toBe("down");
  });

  it("uses a fresh Influx heartbeat when NOC is unavailable", () => {
    expect(
      selectFreshDeviceStatus({
        now,
        nocStatus: "unknown",
        influx: { status: "up", lastSeen: "2026-09-14T17:59:30Z" },
      }),
    ).toBe("up");
  });

  it("fails closed when the only Influx heartbeat is stale", () => {
    expect(
      selectFreshDeviceStatus({
        now,
        influx: { status: "up", lastSeen: "2026-09-14T17:55:00Z" },
      }),
    ).toBe("unknown");
  });
});
